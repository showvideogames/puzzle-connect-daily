-- ===========================================================================
-- Category Emoji: an explicit, optional visual for each category.
--
-- Until now a category's visual (the emoji shown in the Full Hint) was
-- extracted from the END OF ITS TITLE ("Parts of a Car 🚘" -> 🚘). That made
-- the title carry two jobs and made "___ 💬" impossible to express. Category
-- Emoji is its own value, stored literally (emoji, short text, underscores or
-- a custom emoji code such as :caveman:). Category Name, Category Emoji and
-- Small Hint are independent.
--
-- Storage
--   puzzle_groups.category_emoji     one per official category
--   puzzles.rainbow_category_emoji   the Rainbow category's
--   custom_puzzles.content           carries category_emoji per group and
--                                    rainbow_category_emoji (jsonb, no column)
--
-- Versioning: the canonical content emits these keys ONLY WHEN SET. An older
-- puzzle (no emoji) therefore canonicalises exactly as before, so re-saving it
-- unchanged does not mint a new puzzle version, and existing immutable
-- snapshots stay valid. Old puzzles keep working through the client's
-- fallback (title-emoji extraction only when no explicit value exists).
--
-- Separate from 20260921000000_custom_puzzle_counted_replays.sql on purpose.
-- Forward-only; functions are the latest definitions with only this added.
-- ===========================================================================

alter table public.puzzle_groups add column if not exists category_emoji text;
alter table public.puzzles add column if not exists rainbow_category_emoji text;

comment on column public.puzzle_groups.category_emoji is
  'Optional explicit category visual, stored literally (e.g. ''___ 💬'', '':caveman:''). NULL = fall back to the emoji at the end of the category title (older puzzles).';
comment on column public.puzzles.rainbow_category_emoji is
  'Optional explicit Rainbow category visual, stored literally. NULL = fall back to the emoji at the end of rainbow_category_name.';

create or replace function public.validate_puzzle_content(_content jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
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
begin
  if _content is null or jsonb_typeof(_content) <> 'object' then
    raise exception 'puzzle content must be a JSON object' using errcode = 'invalid_parameter_value';
  end if;

  _groups := _content -> 'groups';
  if _groups is null or jsonb_typeof(_groups) <> 'array' or jsonb_array_length(_groups) <> 4 then
    raise exception 'puzzle content must contain exactly 4 groups' using errcode = 'invalid_parameter_value';
  end if;

  for _i in 0 .. 3 loop
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

    _words := _g -> 'words';
    if _words is null or jsonb_typeof(_words) <> 'array' or jsonb_array_length(_words) <> 4 then
      raise exception 'group % needs exactly 4 words', _i + 1 using errcode = 'invalid_parameter_value';
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

    _out := _out || jsonb_build_array(jsonb_build_object(
      'category',   btrim(_g ->> 'category'),
      'words',      _words,
      'difficulty', (_g ->> 'difficulty')::int,
      'hint_word',  nullif(btrim(coalesce(_g ->> 'hint_word', '')), ''),
      'sort_order', _i
    ) || case when _emoji is null then '{}'::jsonb else jsonb_build_object('category_emoji', _emoji) end);
  end loop;

  if (select count(distinct w) from unnest(_all) w) <> 16 then
    raise exception 'a puzzle needs 16 unique words' using errcode = 'invalid_parameter_value';
  end if;

  _herring := _content -> 'rainbow_herring';
  if _herring is not null and jsonb_typeof(_herring) <> 'null' then
    if jsonb_typeof(_herring) <> 'array' or jsonb_array_length(_herring) <> 4 then
      raise exception 'rainbow_herring must have exactly 4 words' using errcode = 'invalid_parameter_value';
    end if;
    for _w in select jsonb_array_elements_text(_herring) loop
      if not (_w = any (_all)) then
        raise exception 'rainbow_herring word "%" is not one of this puzzle''s 16 words', _w
          using errcode = 'invalid_parameter_value';
      end if;
    end loop;
  else
    _herring := null;
  end if;

  _order := _content -> 'word_order';
  if _order is not null and jsonb_typeof(_order) <> 'null' then
    if jsonb_typeof(_order) <> 'array' or jsonb_array_length(_order) <> 16 then
      raise exception 'word_order must list all 16 words' using errcode = 'invalid_parameter_value';
    end if;
    for _w in select jsonb_array_elements_text(_order) loop
      if not (_w = any (_all)) then
        raise exception 'word_order word "%" is not one of this puzzle''s 16 words', _w
          using errcode = 'invalid_parameter_value';
      end if;
    end loop;
  else
    _order := null;
  end if;


  if length(coalesce(nullif(btrim(coalesce(_content ->> 'rainbow_category_emoji', '')), ''), '')) > 40 then
    raise exception 'Rainbow Category Emoji is too long (max 40 characters)' using errcode = 'invalid_parameter_value';
  end if;

  return jsonb_build_object(
    'groups',                _out,
    'word_order',            _order,
    'rainbow_herring',       _herring,
    'rainbow_category_name', nullif(btrim(coalesce(_content ->> 'rainbow_category_name', '')), ''),
    'rainbow_hint_word',     nullif(btrim(coalesce(_content ->> 'rainbow_hint_word', '')), ''),
    'theme',                 nullif(btrim(coalesce(_content ->> 'theme', '')), ''),
    'is_emoji_puzzle',       coalesce((_content ->> 'is_emoji_puzzle')::boolean, false),
    'alphabetize_completed', coalesce((_content ->> 'alphabetize_completed')::boolean, true)
  ) || case when nullif(btrim(coalesce(_content ->> 'rainbow_category_emoji', '')), '') is null then '{}'::jsonb else jsonb_build_object('rainbow_category_emoji', nullif(btrim(coalesce(_content ->> 'rainbow_category_emoji', '')), '')) end;
end;
$$;

revoke all on function public.validate_puzzle_content(jsonb) from public;
grant execute on function public.validate_puzzle_content(jsonb) to authenticated, service_role;

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
begin
  if _uid is null or not public.has_role(_uid, 'admin') then
    raise exception 'admin role required to save puzzles' using errcode = 'insufficient_privilege';
  end if;

  _canonical := public.validate_puzzle_content(_content);

  _date := nullif(_metadata ->> 'date', '')::date;
  if _date is null then
    raise exception 'a puzzle needs a date' using errcode = 'invalid_parameter_value';
  end if;

  _designer_name := coalesce(nullif(btrim(coalesce(_metadata ->> 'designer_name', '')), ''), 'Sam West');

  if _pid is null then
    insert into public.puzzles (
      date, title, is_published, is_beta, created_by, designer_name,
      word_order, rainbow_herring, rainbow_category_name, rainbow_hint_word,
      theme, is_emoji_puzzle, emoji_puzzle_icon, is_free_puzzle, free_puzzle_order,
      alphabetize_completed, rainbow_category_emoji
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
      _canonical ->> 'rainbow_category_emoji'
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
           rainbow_category_emoji = _canonical ->> 'rainbow_category_emoji'
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

  insert into public.puzzle_groups (puzzle_id, category, words, difficulty, sort_order, hint_word, category_emoji)
  select _pid,
         g ->> 'category',
         array(select jsonb_array_elements_text(g -> 'words')),
         (g ->> 'difficulty')::int,
         (g ->> 'sort_order')::int,
         g ->> 'hint_word',
         g ->> 'category_emoji'
    from jsonb_array_elements(_canonical -> 'groups') g;

  select pv.version_number
    into _next
    from public.puzzle_versions pv
   where pv.id = _vid;

  return jsonb_build_object(
    'puzzle_id',       _pid,
    'version_id',      _vid,
    'version_number',  _next,
    'created_version', _created
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
  _mode        text;
  _groups      jsonb;
  _g           jsonb;
  _words       jsonb;
  _all         text[] := '{}';
  _hints       text[] := array[null, null, null, null];
  _out         jsonb := '[]'::jsonb;
  _herring     jsonb;
  _order       jsonb;
  _i           integer;
  _w           text;
  _hint        text;
  _emoji       text;
  _herring_words text[];
  _hits        integer;
begin
  if _content is null or jsonb_typeof(_content) <> 'object' then
    raise exception 'puzzle content must be a JSON object' using errcode = 'invalid_parameter_value';
  end if;

  _mode := _content ->> 'mode';
  if _mode not in ('classic', 'rainbow') then
    raise exception 'mode must be classic or rainbow' using errcode = 'invalid_parameter_value';
  end if;

  _groups := _content -> 'groups';
  if _groups is null or jsonb_typeof(_groups) <> 'array' or jsonb_array_length(_groups) <> 4 then
    raise exception 'puzzle content must contain exactly 4 groups' using errcode = 'invalid_parameter_value';
  end if;

  for _i in 0 .. 3 loop
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
    if _words is null or jsonb_typeof(_words) <> 'array' or jsonb_array_length(_words) <> 4 then
      raise exception 'group % needs exactly 4 answers', _i + 1 using errcode = 'invalid_parameter_value';
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
    -- holds groups 0..i so far, and a hint must be compared against all 16
    -- board answers, including groups that haven't been processed yet (see
    -- the dedicated pass below, once _all is complete) -- unchanged from the
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

    _out := _out || jsonb_build_array(jsonb_build_object(
      'category',   btrim(_g ->> 'category'),
      'words',      _words,
      'hint_word',  _hint,
      'sort_order', _i
    ) || case when _emoji is null then '{}'::jsonb else jsonb_build_object('category_emoji', _emoji) end);
  end loop;

  if (select count(distinct upper(w)) from unnest(_all) w) <> 16 then
    raise exception 'a puzzle needs 16 unique answers' using errcode = 'invalid_parameter_value';
  end if;

  -- Now that _all holds all 16 board answers, check every group's hint
  -- against the COMPLETE board -- not just the groups seen before it.
  for _i in 1 .. 4 loop
    if _hints[_i] is not null and upper(_hints[_i]) = any (select upper(x) from unnest(_all) x) then
      raise exception 'group % Small Hint cannot duplicate a board answer', _i using errcode = 'invalid_parameter_value';
    end if;
  end loop;

  -- Rainbow: 'classic' must carry none at all; 'rainbow' must select EXACTLY
  -- one answer from EACH group (not merely 4-of-16 anywhere in the puzzle).
  _herring := _content -> 'rainbow_herring';
  _herring := case when _herring is null or jsonb_typeof(_herring) = 'null' then null else _herring end;

  if _mode = 'classic' then
    if _herring is not null then
      raise exception 'classic puzzles cannot include a Rainbow selection' using errcode = 'invalid_parameter_value';
    end if;
  else
    if _herring is null or jsonb_typeof(_herring) <> 'array' or jsonb_array_length(_herring) <> 4 then
      raise exception 'a Rainbow puzzle needs exactly one selected answer from each of the 4 groups' using errcode = 'invalid_parameter_value';
    end if;
    _herring_words := array(select jsonb_array_elements_text(_herring));
    for _i in 1 .. 4 loop
      -- Re-derived directly from _groups (still in scope) instead of the
      -- removed _group_words 2-D array -- see the migration header for why
      -- that construct never worked in Postgres.
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

  -- The starting tile layout: must be a permutation of this puzzle's own 16
  -- answers, exactly like validate_puzzle_content's word_order check.
  _order := _content -> 'word_order';
  if _order is not null and jsonb_typeof(_order) <> 'null' then
    if jsonb_typeof(_order) <> 'array' or jsonb_array_length(_order) <> 16 then
      raise exception 'the starting board must list all 16 answers' using errcode = 'invalid_parameter_value';
    end if;
    for _w in select jsonb_array_elements_text(_order) loop
      if not (upper(_w) = any (select upper(x) from unnest(_all) x)) then
        raise exception 'starting board answer "%" is not one of this puzzle''s 16 answers', _w
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

  return jsonb_build_object(
    'mode',                   _mode,
    'groups',                 _out,
    'word_order',             _order,
    'rainbow_herring',        _herring,
    'rainbow_category_name',  nullif(btrim(coalesce(_content ->> 'rainbow_category_name', '')), ''),
    'rainbow_hint_word',      nullif(btrim(coalesce(_content ->> 'rainbow_hint_word', '')), ''),
    'alphabetize_completed',  coalesce((_content ->> 'alphabetize_completed')::boolean, true)
  ) || case when nullif(btrim(coalesce(_content ->> 'rainbow_category_emoji', '')), '') is null then '{}'::jsonb else jsonb_build_object('rainbow_category_emoji', nullif(btrim(coalesce(_content ->> 'rainbow_category_emoji', '')), '')) end;
end;
$$;

revoke all on function public.validate_custom_puzzle_content(jsonb) from public;
grant execute on function public.validate_custom_puzzle_content(jsonb) to anon, authenticated, service_role;
