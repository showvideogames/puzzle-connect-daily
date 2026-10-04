-- ===========================================================================
-- Category Emoji: "Hint Only"
--
-- A Category Emoji is shown in two places: the Full Hint, and appended to the
-- category name on the solved colour bar. Some visuals only read as a clue --
-- "___ 💬" pointing at a "High ___" category -- and are noise on the solved
-- bar, which should simply say "HIGH ___".
--
-- Hint Only is a per-category flag that keeps such a visual in the Full Hint
-- and off the solved bar. It NEVER touches the Category Name: an emoji an
-- author typed into the name itself is part of the name, and is stored and
-- displayed exactly as written, flag or no flag.
--
-- Storage
--   puzzle_groups.category_emoji_hint_only      one per official category
--   puzzles.rainbow_category_emoji_hint_only    the Rainbow category's
--   custom_puzzles.content                      carries
--                                               category_emoji_hint_only per
--                                               group, and
--                                               rainbow_category_emoji_hint_only
--                                               (jsonb, no column)
--
-- Both columns are NOT NULL DEFAULT false, so every existing row reads back
-- as "show it on the solved bar" -- exactly how those puzzles look today.
-- Nothing already published changes appearance when this is applied.
--
-- CANONICAL OUTPUT: byte-identical for every puzzle that is already valid.
-- The two new keys are emitted ONLY when the flag is true AND there is a
-- Category Emoji for it to withhold. So no existing puzzle_versions snapshot
-- is invalidated, no puzzle canonicalises differently on apply, re-saving an
-- untouched puzzle still mints no new version, and a flag with no emoji is
-- dropped rather than stored.
--
-- WHAT THIS CHANGES
-- -----------------
--   2 columns added (both defaulted, so no rewrite that blocks readers)
--   public.validate_puzzle_content(jsonb)         + the group/Rainbow flags
--   public.admin_save_puzzle(uuid, jsonb, jsonb)  + writes the two columns
--   public.validate_custom_puzzle_content(jsonb)  + the group/Rainbow flags
--
-- Nothing else is touched: no index, constraint, policy or other function.
--
-- FORWARD-ONLY. Each function below is its CURRENT definition (Full/Mini from
-- 20260923000000 and 20260924000000) with only Hint Only added; earlier
-- migrations are never edited.
--
-- ROLLOUT ORDER: apply this migration BEFORE deploying the app build that
-- ships with it. The new client sends the two keys, and a database without
-- this migration would drop them silently -- so a puzzle saved in that window
-- would come back with the box unchecked. The other order is safe: this
-- migration on its own changes nothing an older client can see.
-- ===========================================================================

alter table public.puzzle_groups
  add column if not exists category_emoji_hint_only boolean not null default false;
alter table public.puzzles
  add column if not exists rainbow_category_emoji_hint_only boolean not null default false;

comment on column public.puzzle_groups.category_emoji_hint_only is
  'When true, this category''s Category Emoji appears in the Full Hint but is NOT appended to the category name on the solved bar. Never alters the category name itself. Meaningless without a category_emoji, and never stored as true in that case.';
comment on column public.puzzles.rainbow_category_emoji_hint_only is
  'When true, the Rainbow''s Category Emoji appears in the Full Hint but is NOT appended to its name on the solved bar. Never alters rainbow_category_name.';

create or replace function public.validate_puzzle_content(_content jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  _format      text;
  _groups      jsonb;
  _g           jsonb;
  _words       jsonb;
  _all         text[] := '{}';
  _out         jsonb := '[]'::jsonb;
  _herring     jsonb;
  _order       jsonb;
  _i           integer;
  _w           text;
  _emoji       text;
  -- Hint Only for this group's Category Emoji -- see the header.
  _hint_only   boolean;
  _cats        integer;   -- categories in this format
  _per         integer;   -- answers per category
  _tiles       integer;   -- total answers on the board
  _first_diff  integer;   -- difficulty of the EASIEST category
  _diffs       integer[] := '{}';
  _has_rainbow boolean;
  -- Does this format require the Rainbow to take exactly one answer from
  -- each category? See the header: Mini does, Full keeps its original rule.
  _rainbow_one_per_category boolean;
  _herring_words text[];
  _hits        integer;
begin
  if _content is null or jsonb_typeof(_content) <> 'object' then
    raise exception 'puzzle content must be a JSON object' using errcode = 'invalid_parameter_value';
  end if;

  -- Absent/null format means Full. That single line is what keeps every
  -- puzzle, draft and payload written before Mini valid and unchanged.
  _format := coalesce(nullif(btrim(coalesce(_content ->> 'format', '')), ''), 'full');
  if _format not in ('full', 'mini') then
    raise exception 'unknown puzzle format "%"', _format using errcode = 'invalid_parameter_value';
  end if;

  if _format = 'mini' then
    -- A Mini CAN now carry a Rainbow: three answers, one per category.
    _cats := 3; _per := 3; _tiles := 9; _first_diff := 2;
    _has_rainbow := true; _rainbow_one_per_category := true;
  else
    _cats := 4; _per := 4; _tiles := 16; _first_diff := 1;
    _has_rainbow := true; _rainbow_one_per_category := false;
  end if;

  _groups := _content -> 'groups';
  if _groups is null or jsonb_typeof(_groups) <> 'array' or jsonb_array_length(_groups) <> _cats then
    raise exception 'a % puzzle must contain exactly % groups', _format, _cats using errcode = 'invalid_parameter_value';
  end if;

  for _i in 0 .. _cats - 1 loop
    _g := _groups -> _i;
    if jsonb_typeof(_g) <> 'object' then
      raise exception 'group % must be an object', _i + 1 using errcode = 'invalid_parameter_value';
    end if;

    if coalesce(btrim(_g ->> 'category'), '') = '' then
      raise exception 'group % needs a category name', _i + 1 using errcode = 'invalid_parameter_value';
    end if;

    if (_g ->> 'difficulty') is null
       or (_g ->> 'difficulty') !~ '^[1-4]$' then
      raise exception 'group % needs a difficulty between 1 and 4', _i + 1 using errcode = 'invalid_parameter_value';
    end if;

    -- A format restricted to a SUBSET of the difficulty ladder must use only
    -- its own colours. Mini is Green/Blue/Red = 2, 3, 4, so a Mini can never
    -- be stored claiming Yellow.
    --
    -- Applied only where the format actually restricts the range. Full keeps
    -- its original rule -- any difficulty 1-4, in any group order -- exactly
    -- as it has always been, because reordering a Full puzzle's difficulties
    -- without reordering its groups is a save an admin can legitimately make
    -- and has always been able to make.
    if _first_diff > 1 and (_g ->> 'difficulty')::int not between _first_diff and _first_diff + _cats - 1 then
      raise exception 'a % puzzle needs difficulties between % and % (group % has %)',
        _format, _first_diff, _first_diff + _cats - 1, _i + 1, (_g ->> 'difficulty')::int
        using errcode = 'invalid_parameter_value';
    end if;
    _diffs := _diffs || (_g ->> 'difficulty')::int;

    _words := _g -> 'words';
    if _words is null or jsonb_typeof(_words) <> 'array' or jsonb_array_length(_words) <> _per then
      raise exception 'group % needs exactly % words', _i + 1, _per using errcode = 'invalid_parameter_value';
    end if;

    for _w in select jsonb_array_elements_text(_words) loop
      if coalesce(btrim(_w), '') = '' then
        raise exception 'group % contains an empty word', _i + 1 using errcode = 'invalid_parameter_value';
      end if;
      _all := _all || _w;
    end loop;

    _emoji := nullif(btrim(coalesce(_g ->> 'category_emoji', '')), '');
    if _emoji is not null and length(_emoji) > 40 then
      raise exception 'group % Category Emoji is too long (max 40 characters)', _i + 1 using errcode = 'invalid_parameter_value';
    end if;

    -- Hint Only rides on the Category Emoji and is emitted ONLY when true AND
    -- there is an emoji for it to withhold. A flag with no emoji has no
    -- meaning, so it is dropped rather than stored: it can never make an
    -- otherwise-unchanged puzzle canonicalise differently, and can never be
    -- silently resurrected later by someone typing an emoji into that field.
    _hint_only := coalesce((_g ->> 'category_emoji_hint_only')::boolean, false);

    _out := _out || jsonb_build_array(jsonb_build_object(
      'category',   btrim(_g ->> 'category'),
      'words',      _words,
      'difficulty', (_g ->> 'difficulty')::int,
      'hint_word',  nullif(btrim(coalesce(_g ->> 'hint_word', '')), ''),
      'sort_order', _i
    ) || case when _emoji is null then '{}'::jsonb else jsonb_build_object('category_emoji', _emoji) end
      || case when _emoji is null or not _hint_only then '{}'::jsonb else jsonb_build_object('category_emoji_hint_only', true) end);
  end loop;

  if (select count(distinct w) from unnest(_all) w) <> _tiles then
    raise exception 'a % puzzle needs % unique words', _format, _tiles using errcode = 'invalid_parameter_value';
  end if;

  -- Two categories sharing a colour is meaningless on any board. Enforced
  -- only for a restricted-range format, for the same "do not change Full"
  -- reason as the range check above.
  if _first_diff > 1 and (select count(distinct d) from unnest(_diffs) d) <> _cats then
    raise exception 'a % puzzle needs one category per colour', _format using errcode = 'invalid_parameter_value';
  end if;

  _herring := _content -> 'rainbow_herring';
  if _herring is not null and jsonb_typeof(_herring) <> 'null' then
    -- Kept for shape: both shipped formats can carry a Rainbow today, so this
    -- never fires. It stays so that adding a format that genuinely cannot
    -- (a future size, a themed variant) is a one-line change here and not a
    -- silently accepted Rainbow on a board that has nowhere to show it.
    if not _has_rainbow then
      raise exception 'a % puzzle cannot have a Rainbow category', _format using errcode = 'invalid_parameter_value';
    end if;
    if jsonb_typeof(_herring) <> 'array' or jsonb_array_length(_herring) <> _cats then
      raise exception 'rainbow_herring must have exactly % words', _cats using errcode = 'invalid_parameter_value';
    end if;
    for _w in select jsonb_array_elements_text(_herring) loop
      if not (_w = any (_all)) then
        raise exception 'rainbow_herring word "%" is not one of this puzzle''s % words', _w, _tiles
          using errcode = 'invalid_parameter_value';
      end if;
    end loop;

    -- ONE ANSWER PER CATEGORY (Mini). The length check above only proves the
    -- Rainbow has the right NUMBER of board answers; without this, three
    -- answers all taken from the Red category would pass, and the resulting
    -- puzzle would be unsolvable as a Rainbow while looking valid.
    --
    -- Counted by re-deriving each group's words from _groups, exactly as
    -- validate_custom_puzzle_content does -- see 20260919020000 on why the
    -- 2-D text array approach does not work in Postgres.
    if _rainbow_one_per_category then
      _herring_words := array(select jsonb_array_elements_text(_herring));
      for _i in 1 .. _cats loop
        _hits := (
          select count(*)
            from unnest(_herring_words) hw
           where hw = any (
             select gw from jsonb_array_elements_text(_groups -> (_i - 1) -> 'words') gw
           )
        );
        if _hits <> 1 then
          raise exception 'group % must contribute exactly one Rainbow answer (got %)', _i, _hits
            using errcode = 'invalid_parameter_value';
        end if;
      end loop;
    end if;
  else
    _herring := null;
  end if;

  if not _has_rainbow
     and (nullif(btrim(coalesce(_content ->> 'rainbow_category_name', '')), '') is not null
          or nullif(btrim(coalesce(_content ->> 'rainbow_hint_word', '')), '') is not null
          or nullif(btrim(coalesce(_content ->> 'rainbow_category_emoji', '')), '') is not null) then
    raise exception 'a % puzzle cannot have Rainbow category details', _format using errcode = 'invalid_parameter_value';
  end if;

  _order := _content -> 'word_order';
  if _order is not null and jsonb_typeof(_order) <> 'null' then
    if jsonb_typeof(_order) <> 'array' or jsonb_array_length(_order) <> _tiles then
      raise exception 'word_order must list all % words', _tiles using errcode = 'invalid_parameter_value';
    end if;
    for _w in select jsonb_array_elements_text(_order) loop
      if not (_w = any (_all)) then
        raise exception 'word_order word "%" is not one of this puzzle''s % words', _w, _tiles
          using errcode = 'invalid_parameter_value';
      end if;
    end loop;
  else
    _order := null;
  end if;

  if length(coalesce(nullif(btrim(coalesce(_content ->> 'rainbow_category_emoji', '')), ''), '')) > 40 then
    raise exception 'Rainbow Category Emoji is too long (max 40 characters)' using errcode = 'invalid_parameter_value';
  end if;

  return
    -- A Full puzzle emits NO format key, so its canonical content is
    -- byte-identical to what it has always been and re-saving it unchanged
    -- creates no new version. A Mini says what it is.
    (case when _format = 'full' then '{}'::jsonb else jsonb_build_object('format', _format) end)
    || jsonb_build_object(
      'groups',                _out,
      'word_order',            _order,
      'rainbow_herring',       _herring,
      'rainbow_category_name', nullif(btrim(coalesce(_content ->> 'rainbow_category_name', '')), ''),
      'rainbow_hint_word',     nullif(btrim(coalesce(_content ->> 'rainbow_hint_word', '')), ''),
      'theme',                 nullif(btrim(coalesce(_content ->> 'theme', '')), ''),
      'is_emoji_puzzle',       coalesce((_content ->> 'is_emoji_puzzle')::boolean, false),
      'alphabetize_completed', coalesce((_content ->> 'alphabetize_completed')::boolean, true)
    )
    || case when nullif(btrim(coalesce(_content ->> 'rainbow_category_emoji', '')), '') is null then '{}'::jsonb else jsonb_build_object('rainbow_category_emoji', nullif(btrim(coalesce(_content ->> 'rainbow_category_emoji', '')), '')) end
    -- Same rule as the per-group flag above: only when true, and only when
    -- there is a Rainbow Category Emoji for it to withhold.
    || case when nullif(btrim(coalesce(_content ->> 'rainbow_category_emoji', '')), '') is null
              or not coalesce((_content ->> 'rainbow_category_emoji_hint_only')::boolean, false)
             then '{}'::jsonb
             else jsonb_build_object('rainbow_category_emoji_hint_only', true) end;
end;
$$;

revoke all on function public.validate_puzzle_content(jsonb) from public;
grant execute on function public.validate_puzzle_content(jsonb) to authenticated, service_role;

comment on function public.validate_puzzle_content(jsonb) is
  'Canonicalises and validates official puzzle content for its format (absent format = full). Full: 4 groups of 4, difficulties 1-4, optional 4-word Rainbow. Mini: 3 groups of 3, difficulties 2-4, optional 3-word Rainbow taking exactly one answer from each category. A Category Emoji may be flagged Hint Only, which is emitted only alongside an emoji.';

create or replace function public.admin_save_puzzle(
  _puzzle_id uuid,
  _metadata jsonb,
  _content jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  _uid           uuid := auth.uid();
  _canonical     jsonb;
  _current       jsonb;
  _next          integer;
  _vid           uuid;
  _created       boolean := false;
  _pid           uuid := _puzzle_id;
  _date          date;
  _designer_name text;
  _format        text;
begin
  if _uid is null or not public.has_role(_uid, 'admin') then
    raise exception 'admin role required to save puzzles' using errcode = 'insufficient_privilege';
  end if;

  _canonical := public.validate_puzzle_content(_content);
  _format := coalesce(_canonical ->> 'format', 'full');

  _date := nullif(_metadata ->> 'date', '')::date;
  if _date is null then
    raise exception 'a puzzle needs a date' using errcode = 'invalid_parameter_value';
  end if;

  -- A puzzle's format is fixed for life. Its stored groups, its players'
  -- pinned boards and its statistics all assume one shape, so re-shaping an
  -- existing puzzle in place would invalidate all three at once.
  if _pid is not null then
    if exists (select 1 from public.puzzles p where p.id = _pid and p.format <> _format) then
      raise exception 'a puzzle cannot change format after it is created'
        using errcode = 'invalid_parameter_value';
    end if;
  end if;

  _designer_name := coalesce(nullif(btrim(coalesce(_metadata ->> 'designer_name', '')), ''), 'Sam West');

  if _pid is null then
    insert into public.puzzles (
      date, title, is_published, is_beta, created_by, designer_name,
      word_order, rainbow_herring, rainbow_category_name, rainbow_hint_word,
      theme, is_emoji_puzzle, emoji_puzzle_icon, is_free_puzzle, free_puzzle_order,
      alphabetize_completed, rainbow_category_emoji, rainbow_category_emoji_hint_only, format
    ) values (
      _date,
      nullif(btrim(coalesce(_metadata ->> 'title', '')), ''),
      coalesce((_metadata ->> 'is_published')::boolean, false),
      coalesce((_metadata ->> 'is_beta')::boolean, false),
      _uid,
      _designer_name,
      case when _canonical -> 'word_order' = 'null'::jsonb then null
           else array(select jsonb_array_elements_text(_canonical -> 'word_order')) end,
      case when _canonical -> 'rainbow_herring' = 'null'::jsonb then null
           else array(select jsonb_array_elements_text(_canonical -> 'rainbow_herring')) end,
      _canonical ->> 'rainbow_category_name',
      _canonical ->> 'rainbow_hint_word',
      _canonical ->> 'theme',
      (_canonical ->> 'is_emoji_puzzle')::boolean,
      nullif(btrim(coalesce(_metadata ->> 'emoji_puzzle_icon', '')), ''),
      coalesce((_metadata ->> 'is_free_puzzle')::boolean, false),
      nullif(_metadata ->> 'free_puzzle_order', '')::int,
      (_canonical ->> 'alphabetize_completed')::boolean,
      _canonical ->> 'rainbow_category_emoji',
      coalesce((_canonical ->> 'rainbow_category_emoji_hint_only')::boolean, false),
      _format
    )
    returning id into _pid;
  else
    perform 1 from public.puzzles where id = _pid for update;
    if not found then
      raise exception 'puzzle % does not exist', _pid using errcode = 'no_data_found';
    end if;

    update public.puzzles
       set date                  = _date,
           title                 = nullif(btrim(coalesce(_metadata ->> 'title', '')), ''),
           is_published          = coalesce((_metadata ->> 'is_published')::boolean, false),
           is_beta               = coalesce((_metadata ->> 'is_beta')::boolean, false),
           designer_name         = _designer_name,
           word_order            = case when _canonical -> 'word_order' = 'null'::jsonb then null
                                        else array(select jsonb_array_elements_text(_canonical -> 'word_order')) end,
           rainbow_herring       = case when _canonical -> 'rainbow_herring' = 'null'::jsonb then null
                                        else array(select jsonb_array_elements_text(_canonical -> 'rainbow_herring')) end,
           rainbow_category_name = _canonical ->> 'rainbow_category_name',
           rainbow_hint_word     = _canonical ->> 'rainbow_hint_word',
           theme                 = _canonical ->> 'theme',
           is_emoji_puzzle       = (_canonical ->> 'is_emoji_puzzle')::boolean,
           emoji_puzzle_icon     = nullif(btrim(coalesce(_metadata ->> 'emoji_puzzle_icon', '')), ''),
           is_free_puzzle        = coalesce((_metadata ->> 'is_free_puzzle')::boolean, false),
           free_puzzle_order     = nullif(_metadata ->> 'free_puzzle_order', '')::int,
           alphabetize_completed = (_canonical ->> 'alphabetize_completed')::boolean,
           rainbow_category_emoji = _canonical ->> 'rainbow_category_emoji',
           rainbow_category_emoji_hint_only = coalesce((_canonical ->> 'rainbow_category_emoji_hint_only')::boolean, false),
           format                = _format
     where id = _pid;
  end if;

  select pv.content, pv.id
    into _current, _vid
    from public.puzzle_versions pv
    join public.puzzles p on p.current_version_id = pv.id
   where p.id = _pid;

  if _current is null or _current <> _canonical then
    select coalesce(max(pv.version_number), 0) + 1
      into _next
      from public.puzzle_versions pv
     where pv.puzzle_id = _pid;

    insert into public.puzzle_versions (puzzle_id, version_number, content, created_by)
    values (_pid, _next, _canonical, _uid)
    returning id into _vid;

    update public.puzzles set current_version_id = _vid where id = _pid;
    _created := true;
  end if;

  delete from public.puzzle_groups where puzzle_id = _pid;

  insert into public.puzzle_groups (puzzle_id, category, words, difficulty, sort_order, hint_word, category_emoji, category_emoji_hint_only)
  select _pid,
         g ->> 'category',
         array(select jsonb_array_elements_text(g -> 'words')),
         (g ->> 'difficulty')::int,
         (g ->> 'sort_order')::int,
         g ->> 'hint_word',
         g ->> 'category_emoji',
         -- The canonical form omits this key unless it is true, and the
         -- column is NOT NULL DEFAULT false, so an absent key lands as a real
         -- false on the live read path.
         coalesce((g ->> 'category_emoji_hint_only')::boolean, false)
    from jsonb_array_elements(_canonical -> 'groups') g;

  select pv.version_number
    into _next
    from public.puzzle_versions pv
   where pv.id = _vid;

  return jsonb_build_object(
    'puzzle_id',       _pid,
    'version_id',      _vid,
    'version_number',  _next,
    'created_version', _created,
    'format',          _format
  );
end;
$$;

revoke all on function public.admin_save_puzzle(uuid, jsonb, jsonb) from public;
grant execute on function public.admin_save_puzzle(uuid, jsonb, jsonb) to authenticated, service_role;

create or replace function public.validate_custom_puzzle_content(_content jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  _format      text;
  _mode        text;
  _groups      jsonb;
  _g           jsonb;
  _words       jsonb;
  _all         text[] := '{}';
  _hints       text[];
  _out         jsonb := '[]'::jsonb;
  _herring     jsonb;
  _order       jsonb;
  _i           integer;
  _w           text;
  _hint        text;
  _emoji       text;
  _hint_only   boolean;
  _herring_words text[];
  _hits        integer;
  _cats        integer;
  _per         integer;
  _tiles       integer;
  _has_rainbow boolean;
begin
  if _content is null or jsonb_typeof(_content) <> 'object' then
    raise exception 'puzzle content must be a JSON object' using errcode = 'invalid_parameter_value';
  end if;

  -- Absent/null format means Full — see the section header.
  _format := coalesce(nullif(btrim(coalesce(_content ->> 'format', '')), ''), 'full');
  if _format not in ('full', 'mini') then
    raise exception 'unknown puzzle format "%"', _format using errcode = 'invalid_parameter_value';
  end if;

  if _format = 'mini' then
    _cats := 3; _per := 3; _tiles := 9; _has_rainbow := false;
  else
    _cats := 4; _per := 4; _tiles := 16; _has_rainbow := true;
  end if;
  _hints := array_fill(null::text, array[_cats]);

  _mode := _content ->> 'mode';
  if _mode not in ('classic', 'rainbow') then
    raise exception 'mode must be classic or rainbow' using errcode = 'invalid_parameter_value';
  end if;
  -- A format with no bonus category cannot be in Rainbow mode. Rejected, not
  -- coerced: the creator must be told, not silently given a different puzzle.
  if _mode = 'rainbow' and not _has_rainbow then
    raise exception 'a % puzzle cannot be a Rainbow puzzle', _format using errcode = 'invalid_parameter_value';
  end if;

  _groups := _content -> 'groups';
  if _groups is null or jsonb_typeof(_groups) <> 'array' or jsonb_array_length(_groups) <> _cats then
    raise exception 'a % puzzle must contain exactly % groups', _format, _cats using errcode = 'invalid_parameter_value';
  end if;

  for _i in 0 .. _cats - 1 loop
    _g := _groups -> _i;
    if jsonb_typeof(_g) <> 'object' then
      raise exception 'group % must be an object', _i + 1 using errcode = 'invalid_parameter_value';
    end if;

    if coalesce(btrim(_g ->> 'category'), '') = '' then
      raise exception 'group % needs a category name', _i + 1 using errcode = 'invalid_parameter_value';
    end if;
    if length(btrim(_g ->> 'category')) > 80 then
      raise exception 'group % category name is too long (max 80 characters)', _i + 1 using errcode = 'invalid_parameter_value';
    end if;

    _words := _g -> 'words';
    if _words is null or jsonb_typeof(_words) <> 'array' or jsonb_array_length(_words) <> _per then
      raise exception 'group % needs exactly % answers', _i + 1, _per using errcode = 'invalid_parameter_value';
    end if;

    for _w in select jsonb_array_elements_text(_words) loop
      if coalesce(btrim(_w), '') = '' then
        raise exception 'group % contains an empty answer', _i + 1 using errcode = 'invalid_parameter_value';
      end if;
      if length(_w) > 40 then
        raise exception 'group % has an answer that is too long (max 40 characters)', _i + 1 using errcode = 'invalid_parameter_value';
      end if;
      _all := _all || _w;
    end loop;

    -- Length-checked here, but NOT checked for duplication yet: _all only
    -- holds groups 0..i so far, and a hint must be compared against all board
    -- answers, including groups that haven't been processed yet (see the
    -- dedicated pass below, once _all is complete) -- unchanged from the
    -- 20260919000000 cross-group Small Hint fix.
    _hint := nullif(btrim(coalesce(_g ->> 'hint_word', '')), '');
    if _hint is not null and length(_hint) > 40 then
      raise exception 'group % Small Hint is too long (max 40 characters)', _i + 1 using errcode = 'invalid_parameter_value';
    end if;
    _hints[_i + 1] := _hint;

    _emoji := nullif(btrim(coalesce(_g ->> 'category_emoji', '')), '');
    if _emoji is not null and length(_emoji) > 40 then
      raise exception 'group % Category Emoji is too long (max 40 characters)', _i + 1 using errcode = 'invalid_parameter_value';
    end if;

    -- Hint Only, exactly as validate_puzzle_content handles it: emitted only
    -- when true AND there is an emoji for it to withhold.
    _hint_only := coalesce((_g ->> 'category_emoji_hint_only')::boolean, false);

    _out := _out || jsonb_build_array(jsonb_build_object(
      'category',   btrim(_g ->> 'category'),
      'words',      _words,
      'hint_word',  _hint,
      'sort_order', _i
    ) || case when _emoji is null then '{}'::jsonb else jsonb_build_object('category_emoji', _emoji) end
      || case when _emoji is null or not _hint_only then '{}'::jsonb else jsonb_build_object('category_emoji_hint_only', true) end);
  end loop;

  if (select count(distinct upper(w)) from unnest(_all) w) <> _tiles then
    raise exception 'a % puzzle needs % unique answers', _format, _tiles using errcode = 'invalid_parameter_value';
  end if;

  -- Now that _all holds every board answer, check every group's hint
  -- against the COMPLETE board -- not just the groups seen before it.
  for _i in 1 .. _cats loop
    if _hints[_i] is not null and upper(_hints[_i]) = any (select upper(x) from unnest(_all) x) then
      raise exception 'group % Small Hint cannot duplicate a board answer', _i using errcode = 'invalid_parameter_value';
    end if;
  end loop;

  -- Rainbow: 'classic' must carry none at all; 'rainbow' must select EXACTLY
  -- one answer from EACH group (not merely N-of-board anywhere in the puzzle).
  _herring := _content -> 'rainbow_herring';
  _herring := case when _herring is null or jsonb_typeof(_herring) = 'null' then null else _herring end;

  if _mode = 'classic' then
    if _herring is not null then
      raise exception 'classic puzzles cannot include a Rainbow selection' using errcode = 'invalid_parameter_value';
    end if;
  else
    if _herring is null or jsonb_typeof(_herring) <> 'array' or jsonb_array_length(_herring) <> _cats then
      raise exception 'a Rainbow puzzle needs exactly one selected answer from each of the % groups', _cats using errcode = 'invalid_parameter_value';
    end if;
    _herring_words := array(select jsonb_array_elements_text(_herring));
    for _i in 1 .. _cats loop
      -- Re-derived directly from _groups (still in scope) instead of the
      -- removed _group_words 2-D array -- see the 20260919020000 migration
      -- header for why that construct never worked in Postgres.
      _hits := (
        select count(*)
          from unnest(_herring_words) hw
         where upper(hw) = any (
           select upper(gw) from jsonb_array_elements_text(_groups -> (_i - 1) -> 'words') gw
         )
      );
      if _hits <> 1 then
        raise exception 'group % must contribute exactly one Rainbow answer (got %)', _i, _hits
          using errcode = 'invalid_parameter_value';
      end if;
    end loop;
  end if;

  -- The starting tile layout: must be a permutation of this puzzle's own
  -- answers, exactly like validate_puzzle_content's word_order check.
  _order := _content -> 'word_order';
  if _order is not null and jsonb_typeof(_order) <> 'null' then
    if jsonb_typeof(_order) <> 'array' or jsonb_array_length(_order) <> _tiles then
      raise exception 'the starting board must list all % answers', _tiles using errcode = 'invalid_parameter_value';
    end if;
    for _w in select jsonb_array_elements_text(_order) loop
      if not (upper(_w) = any (select upper(x) from unnest(_all) x)) then
        raise exception 'starting board answer "%" is not one of this puzzle''s % answers', _w, _tiles
          using errcode = 'invalid_parameter_value';
      end if;
    end loop;
  else
    raise exception 'a starting board order is required' using errcode = 'invalid_parameter_value';
  end if;

  if _content ->> 'rainbow_category_name' is not null and length(btrim(_content ->> 'rainbow_category_name')) > 80 then
    raise exception 'Rainbow category name is too long (max 80 characters)' using errcode = 'invalid_parameter_value';
  end if;
  if _content ->> 'rainbow_hint_word' is not null and length(btrim(_content ->> 'rainbow_hint_word')) > 40 then
    raise exception 'Rainbow Small Hint is too long (max 40 characters)' using errcode = 'invalid_parameter_value';
  end if;

  if length(coalesce(nullif(btrim(coalesce(_content ->> 'rainbow_category_emoji', '')), ''), '')) > 40 then
    raise exception 'Rainbow Category Emoji is too long (max 40 characters)' using errcode = 'invalid_parameter_value';
  end if;

  return
    -- Full emits no format key, so every custom puzzle already stored
    -- canonicalises byte-identically to what it is today.
    (case when _format = 'full' then '{}'::jsonb else jsonb_build_object('format', _format) end)
    || jsonb_build_object(
      'mode',                   _mode,
      'groups',                 _out,
      'word_order',             _order,
      'rainbow_herring',        _herring,
      'rainbow_category_name',  nullif(btrim(coalesce(_content ->> 'rainbow_category_name', '')), ''),
      'rainbow_hint_word',      nullif(btrim(coalesce(_content ->> 'rainbow_hint_word', '')), ''),
      'alphabetize_completed',  coalesce((_content ->> 'alphabetize_completed')::boolean, true)
    )
    || case when nullif(btrim(coalesce(_content ->> 'rainbow_category_emoji', '')), '') is null then '{}'::jsonb else jsonb_build_object('rainbow_category_emoji', nullif(btrim(coalesce(_content ->> 'rainbow_category_emoji', '')), '')) end
    -- A classic puzzle has no Rainbow at all, so it can never carry the flag.
    || case when _mode <> 'rainbow'
              or nullif(btrim(coalesce(_content ->> 'rainbow_category_emoji', '')), '') is null
              or not coalesce((_content ->> 'rainbow_category_emoji_hint_only')::boolean, false)
             then '{}'::jsonb
             else jsonb_build_object('rainbow_category_emoji_hint_only', true) end;
end;
$$;

revoke all on function public.validate_custom_puzzle_content(jsonb) from public;
grant execute on function public.validate_custom_puzzle_content(jsonb) to anon, authenticated, service_role;
