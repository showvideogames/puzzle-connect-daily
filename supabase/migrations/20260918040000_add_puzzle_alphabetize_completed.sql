-- ============================================================================
-- "Alphabetize answers in completed categories" — a per-puzzle gameplay flag
--
-- The Admin builder's "Alphabetize answers in completed categories" checkbox
-- needs somewhere to persist its value and something to make it real. Before
-- this migration there was no such column, and the solved-category bar
-- (SolvedGroup.tsx) always rendered a group's words in exactly the order
-- they were saved in puzzle_groups.words — never alphabetized.
--
-- Default TRUE, applied to every existing row: this is the creator-facing
-- default going forward (checked = alphabetical), and it is what every
-- existing puzzle and every pre-existing immutable puzzle_versions snapshot
-- (which cannot be rewritten — see 20260917120000) is treated as meaning when
-- the key is absent from its content jsonb. See validate_puzzle_content
-- below and lib/puzzles.ts's mapPuzzle / lib/puzzleVersion.ts, which apply
-- the same "missing = true" default on the client.
--
-- Treated as GAMEPLAY content (inside _content, versioned), not metadata:
-- it changes what a player sees once they solve a category, so changing it
-- creates a new puzzle version exactly like changing a word or a category
-- name does.
-- ============================================================================

alter table public.puzzles
  add column if not exists alphabetize_completed boolean not null default true;

comment on column public.puzzles.alphabetize_completed is
  'Whether this puzzle''s solved-category bar shows its answers alphabetically (true) or in the creator''s authored comma-separated order (false). Gameplay content, versioned like any other field in validate_puzzle_content(). Default true.';


-- ===========================================================================
-- validate_puzzle_content -- add alphabetize_completed to the canonical shape
--
-- Same function as 20260917120000, re-created with one more key. Missing or
-- non-boolean input coalesces to true, matching the column default and the
-- client's own "absent = true" reading of older immutable snapshots.
-- ===========================================================================
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

    _out := _out || jsonb_build_array(jsonb_build_object(
      'category',   btrim(_g ->> 'category'),
      'words',      _words,
      'difficulty', (_g ->> 'difficulty')::int,
      'hint_word',  nullif(btrim(coalesce(_g ->> 'hint_word', '')), ''),
      'sort_order', _i
    ));
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

  return jsonb_build_object(
    'groups',                _out,
    'word_order',            _order,
    'rainbow_herring',       _herring,
    'rainbow_category_name', nullif(btrim(coalesce(_content ->> 'rainbow_category_name', '')), ''),
    'rainbow_hint_word',     nullif(btrim(coalesce(_content ->> 'rainbow_hint_word', '')), ''),
    'theme',                 nullif(btrim(coalesce(_content ->> 'theme', '')), ''),
    'is_emoji_puzzle',       coalesce((_content ->> 'is_emoji_puzzle')::boolean, false),
    'alphabetize_completed', coalesce((_content ->> 'alphabetize_completed')::boolean, true)
  );
end;
$$;

revoke all on function public.validate_puzzle_content(jsonb) from public;
grant execute on function public.validate_puzzle_content(jsonb) to authenticated, service_role;

comment on function public.validate_puzzle_content(jsonb) is
  'Validates and canonicalises puzzle gameplay content. Canonical output is what makes jsonb equality a reliable "did gameplay change?" test.';


-- ===========================================================================
-- admin_save_puzzle -- write alphabetize_completed alongside the other
-- content columns, on both insert and update. Same function as
-- 20260917120000, re-created with this one additional column.
-- ===========================================================================
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
  _uid       uuid := auth.uid();
  _canonical jsonb;
  _current   jsonb;
  _next      integer;
  _vid       uuid;
  _created   boolean := false;
  _pid       uuid := _puzzle_id;
  _date      date;
begin
  if _uid is null or not public.has_role(_uid, 'admin') then
    raise exception 'admin role required to save puzzles' using errcode = 'insufficient_privilege';
  end if;

  _canonical := public.validate_puzzle_content(_content);

  _date := nullif(_metadata ->> 'date', '')::date;
  if _date is null then
    raise exception 'a puzzle needs a date' using errcode = 'invalid_parameter_value';
  end if;

  if _pid is null then
    insert into public.puzzles (
      date, title, is_published, created_by,
      word_order, rainbow_herring, rainbow_category_name, rainbow_hint_word,
      theme, is_emoji_puzzle, emoji_puzzle_icon, is_free_puzzle, free_puzzle_order,
      alphabetize_completed
    ) values (
      _date,
      nullif(btrim(coalesce(_metadata ->> 'title', '')), ''),
      coalesce((_metadata ->> 'is_published')::boolean, false),
      _uid,
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
      (_canonical ->> 'alphabetize_completed')::boolean
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
           alphabetize_completed = (_canonical ->> 'alphabetize_completed')::boolean
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

  insert into public.puzzle_groups (puzzle_id, category, words, difficulty, sort_order, hint_word)
  select _pid,
         g ->> 'category',
         array(select jsonb_array_elements_text(g -> 'words')),
         (g ->> 'difficulty')::int,
         (g ->> 'sort_order')::int,
         g ->> 'hint_word'
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

comment on function public.admin_save_puzzle(uuid, jsonb, jsonb) is
  'Atomically creates or updates a puzzle. Creates and promotes a new immutable version only when canonical gameplay content actually changed; metadata-only and no-op saves create none. Admin role required, checked inside the function.';


-- ===========================================================================
-- NOT applied, not pushed, not merged as part of this change. See handoff:
-- migrations are written for review only; db push/deploy is a separate,
-- explicitly-approved step.
-- ===========================================================================
