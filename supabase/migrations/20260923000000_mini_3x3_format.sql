-- ===========================================================================
-- Mini 3x3 — one game system, two board formats
--
-- WHAT THIS ADDS
-- --------------
-- A `format` discriminator on the three shared structures that need to tell a
-- Full 4x4 game from a Mini 3x3 one:
--
--   puzzles.format        which board a puzzle is authored for
--   game_sessions.format  which board a play belongs to (stamped at creation
--                         from the puzzle, never asserted by the client)
--   user_streaks.format   which game a streak counts
--
-- Plus the content validation, save path, session creation, streak and stats
-- functions that have to respect it. A custom puzzle's format rides inside
-- custom_puzzles.content (validated below), with no new column: that table is
-- already content-as-jsonb by design.
--
-- WHY A DISCRIMINATOR AND NOT NEW TABLES
-- --------------------------------------
-- Full and Mini are the same game at two sizes. Duplicating puzzles /
-- puzzle_groups / puzzle_versions / game_sessions / guess_events /
-- hint_events / user_streaks / puzzle_aggregates for Mini would double every
-- future migration, every RLS policy and every analytics query for a
-- difference that is one column wide.
--
-- BACKWARD COMPATIBILITY — the whole contract in one line
-- ------------------------------------------------------
-- Everything that exists today IS Full, and says so by default. Every new
-- column is `not null default 'full'`, so existing rows are correct without
-- being touched; every new function argument defaults to 'full', so an OLD
-- DEPLOYED CLIENT calling without it keeps getting exactly the behaviour it
-- has now; and canonical puzzle content omits the `format` key entirely for a
-- Full puzzle, so re-saving an untouched Full puzzle canonicalises
-- byte-identically and does NOT mint a pointless new version (and every
-- existing puzzle_versions snapshot stays valid).
--
-- Forward-only. Idempotent where it can be (`add column if not exists`,
-- `create index if not exists`, `create or replace function`).
--
-- THE ONE STRUCTURAL CHANGE THAT IS NOT PURELY ADDITIVE
-- ----------------------------------------------------
-- `puzzles.date` has been UNIQUE since the very first migration. Full and
-- Mini are sibling Dailies, so one date must be able to hold one of each.
-- Section 1 replaces that single-column uniqueness with uniqueness on
-- (date, format). That is strictly WEAKER, so no existing row can violate it
-- and nothing that relied on "at most one puzzle per date" among Full
-- puzzles changes — every existing row has format 'full'.
--
-- OVERLOAD SAFETY
-- ---------------
-- Two client-facing functions gain a trailing defaulted argument. In
-- Postgres, `create or replace` with a different argument list creates a
-- SECOND function rather than replacing the first, and a call that matches
-- both is then ambiguous — which is exactly the PGRST203 outage this project
-- has already hit once. So each one is explicitly DROPPED at its old
-- signature before the new one is created. PostgREST still resolves an
-- old client's 2-argument named call to the new 3-argument function via its
-- default, so nothing breaks during the deploy window.
-- ===========================================================================


-- ===========================================================================
-- 1. puzzles.format  (+ per-format date uniqueness)
-- ===========================================================================

alter table public.puzzles add column if not exists format text not null default 'full';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.puzzles'::regclass
       and conname = 'puzzles_format_check'
  ) then
    alter table public.puzzles
      add constraint puzzles_format_check check (format in ('full', 'mini'));
  end if;
end;
$$;

comment on column public.puzzles.format is
  'Board format: ''full'' (4x4, 4 categories of 4) or ''mini'' (3x3, 3 categories of 3). Every puzzle that predates Mini is ''full'' by default.';

-- Replace the single-column UNIQUE on date with (date, format).
--
-- Found by name where possible, and by SHAPE otherwise: the original
-- constraint was created inline ("date DATE NOT NULL UNIQUE") so its name is
-- conventional rather than guaranteed, and this project has seen objects
-- appear outside git. Anything that enforces uniqueness on exactly the single
-- `date` column is dropped, whether it is a constraint or a bare index.
do $$
declare
  _rec record;
begin
  for _rec in
    select con.conname
      from pg_constraint con
      join pg_attribute att
        on att.attrelid = con.conrelid
       and att.attnum = con.conkey[1]
     where con.conrelid = 'public.puzzles'::regclass
       and con.contype = 'u'
       and array_length(con.conkey, 1) = 1
       and att.attname = 'date'
  loop
    execute format('alter table public.puzzles drop constraint %I', _rec.conname);
  end loop;

  for _rec in
    select cls.relname
      from pg_index idx
      join pg_class cls on cls.oid = idx.indexrelid
     where idx.indrelid = 'public.puzzles'::regclass
       and idx.indisunique
       and not idx.indisprimary
       and idx.indnatts = 1
       and (select attname from pg_attribute
             where attrelid = idx.indrelid and attnum = idx.indkey[0]) = 'date'
  loop
    execute format('drop index public.%I', _rec.relname);
  end loop;
end;
$$;

create unique index if not exists puzzles_date_format_key
  on public.puzzles (date, format);

comment on index public.puzzles_date_format_key is
  'One puzzle per date PER FORMAT. Replaces the original single-column UNIQUE on date, which made a Mini Daily and a Full Daily on the same date impossible.';


-- ===========================================================================
-- 2. game_sessions.format
--
-- Stamped at creation from the puzzle being played (section 6). It is NOT a
-- client-supplied value: a caller cannot file a Full play under Mini, or the
-- reverse. Denormalised onto the session on purpose rather than joined back
-- to puzzles at read time, because a session must keep describing the game
-- that was played even if its puzzle is later deleted (puzzles rows can be
-- deleted from Admin).
-- ===========================================================================

alter table public.game_sessions add column if not exists format text not null default 'full';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.game_sessions'::regclass
       and conname = 'game_sessions_format_check'
  ) then
    alter table public.game_sessions
      add constraint game_sessions_format_check check (format in ('full', 'mini'));
  end if;
end;
$$;

comment on column public.game_sessions.format is
  'The board format this play belongs to, copied from the puzzle at session creation. Existing sessions default to ''full'', which is what every one of them is.';

-- Every per-player stats read filters on (identity, format), so the existing
-- ownership indexes gain format.
create index if not exists game_sessions_format_user_idx
  on public.game_sessions (format, user_id)
  where user_id is not null;

create index if not exists game_sessions_format_device_idx
  on public.game_sessions (format, device_id)
  where device_id is not null;


-- ===========================================================================
-- 3. user_streaks.format
--
-- A Mini completion must never extend, break or count toward the Full streak,
-- and vice versa. One row per (identity, format).
-- ===========================================================================

alter table public.user_streaks add column if not exists format text not null default 'full';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.user_streaks'::regclass
       and conname = 'user_streaks_format_check'
  ) then
    alter table public.user_streaks
      add constraint user_streaks_format_check check (format in ('full', 'mini'));
  end if;
end;
$$;

comment on column public.user_streaks.format is
  'Which game this streak counts. Existing rows default to ''full'' — every streak recorded before Mini is a Full streak.';

-- Deliberately NOT unique: production already contains duplicate
-- (user_id) / (device_id) streak rows from before the RPC-only cutover, which
-- record_streak handles by taking the most recently updated row (see the
-- 20260917000000 migration's note). Adding uniqueness here would fail on that
-- existing data. These are lookup indexes only.
create index if not exists user_streaks_user_format_idx
  on public.user_streaks (user_id, format)
  where user_id is not null;

create index if not exists user_streaks_device_format_idx
  on public.user_streaks (device_id, format)
  where user_id is null and device_id is not null;


-- ===========================================================================
-- 4. validate_puzzle_content — format-aware canonical official content
--
-- Rules, by format:
--   full  4 groups of 4, difficulties 1-4 (Yellow/Green/Blue/Red), 16 unique
--         words, optional 4-word rainbow_herring. UNCHANGED in every respect,
--         INCLUDING the canonical output shape (no `format` key is emitted),
--         so an existing puzzle re-saved unchanged still produces byte-equal
--         content and creates no new version.
--   mini  3 groups of 3, difficulties 2-4 (Green/Blue/Red) in that order,
--         9 unique words, and NO rainbow of any kind.
--
-- Difficulty numbering is the shared colour key across the whole product
-- (1=Yellow 2=Green 3=Blue 4=Red), which is why Mini uses 2-4 rather than
-- 1-3 — see src/lib/puzzleFormat.ts.
-- ===========================================================================

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
  _cats        integer;   -- categories in this format
  _per         integer;   -- answers per category
  _tiles       integer;   -- total answers on the board
  _first_diff  integer;   -- difficulty of the EASIEST category
  _diffs       integer[] := '{}';
  _has_rainbow boolean;
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
    _cats := 3; _per := 3; _tiles := 9; _first_diff := 2; _has_rainbow := false;
  else
    _cats := 4; _per := 4; _tiles := 16; _first_diff := 1; _has_rainbow := true;
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

    _out := _out || jsonb_build_array(jsonb_build_object(
      'category',   btrim(_g ->> 'category'),
      'words',      _words,
      'difficulty', (_g ->> 'difficulty')::int,
      'hint_word',  nullif(btrim(coalesce(_g ->> 'hint_word', '')), ''),
      'sort_order', _i
    ) || case when _emoji is null then '{}'::jsonb else jsonb_build_object('category_emoji', _emoji) end);
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
    -- Mini has no bonus category today. Rejected outright rather than
    -- silently dropped: a creator who selected a Rainbow must be told it is
    -- not supported, not have it quietly discarded.
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
    || case when nullif(btrim(coalesce(_content ->> 'rainbow_category_emoji', '')), '') is null then '{}'::jsonb else jsonb_build_object('rainbow_category_emoji', nullif(btrim(coalesce(_content ->> 'rainbow_category_emoji', '')), '')) end;
end;
$$;

revoke all on function public.validate_puzzle_content(jsonb) from public;
grant execute on function public.validate_puzzle_content(jsonb) to authenticated, service_role;

comment on function public.validate_puzzle_content(jsonb) is
  'Canonicalises and validates official puzzle content for its format (absent format = full). Full: 4 groups of 4, difficulties 1-4, optional Rainbow. Mini: 3 groups of 3, difficulties 2-4, no Rainbow.';


-- ===========================================================================
-- 5. admin_save_puzzle — persist the puzzle's format
--
-- The format comes from the CANONICAL CONTENT, not from _metadata. One
-- source, already validated, so an Admin save cannot claim one format while
-- submitting another format's groups — validate_puzzle_content above would
-- have rejected the mismatch before this line is reached.
--
-- Signature unchanged (3 args) — create or replace, no new overload.
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
      alphabetize_completed, rainbow_category_emoji, format
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
    'created_version', _created,
    'format',          _format
  );
end;
$$;

revoke all on function public.admin_save_puzzle(uuid, jsonb, jsonb) from public;
grant execute on function public.admin_save_puzzle(uuid, jsonb, jsonb) to authenticated, service_role;


-- ===========================================================================
-- 6. create_game_session — stamp the session's format from the PUZZLE
--
-- Same signature (7 args, unchanged) — create or replace, no new overload.
-- The format is read from the puzzle row this session is for, in the same
-- lookup that already checks is_published, so there is no extra query and no
-- way for a client to assert a format at all.
-- ===========================================================================

create or replace function public.create_game_session(
  _puzzle_id text,
  _device_id text,
  _device_token text,
  _entry_context text,
  _active_time_seconds integer default 0,
  _mistakes integer default 0,
  _puzzle_version_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  _id      uuid;
  _uid     uuid := auth.uid();
  _version uuid := _puzzle_version_id;
  _format  text;
begin
  if not public.verify_device(_device_id, _device_token) then
    return null;
  end if;

  -- Compared as text for the same reason the version check below does:
  -- game_sessions.puzzle_id is text, not guaranteed to be a parseable uuid,
  -- and casting IT would raise instead of simply failing the check. Casting
  -- puzzles.id (a real uuid) to text is always safe.
  select p.format
    into _format
    from public.puzzles p
   where p.id::text = _puzzle_id
     and p.is_published = true;

  if _format is null then
    return null;
  end if;

  if _uid is not null then
    if not exists (
      select 1 from public.account_onboarding ao
       where ao.user_id = _uid and ao.status <> 'pending'
    ) then
      return null;
    end if;
  end if;

  if _version is not null then
    if not exists (
      select 1 from public.puzzle_versions pv
       where pv.id = _version
         and pv.puzzle_id::text = _puzzle_id
    ) then
      raise exception 'puzzle version % does not belong to puzzle %', _version, _puzzle_id
        using errcode = 'foreign_key_violation';
    end if;
  end if;

  insert into public.game_sessions (
    puzzle_id, puzzle_version_id, user_id, device_id, entry_context,
    status, won, completed_at, started_at, last_activity_at,
    active_time_seconds, mistakes, found_rainbow, hints_used, format
  ) values (
    _puzzle_id, _version, _uid, _device_id, _entry_context,
    'in_progress', null, null, now(), now(),
    coalesce(_active_time_seconds, 0), coalesce(_mistakes, 0), false, false, _format
  )
  returning id into _id;

  return _id;
end;
$$;

revoke all on function public.create_game_session(text, text, text, text, integer, integer, uuid) from public;
grant execute on function public.create_game_session(text, text, text, text, integer, integer, uuid) to anon, authenticated, service_role;


-- ===========================================================================
-- 7. record_streak — one streak per (identity, format)
--
-- DROPPED at its old 4-argument signature first (see the OVERLOAD SAFETY
-- note in the header). It is internal — revoked from every client role — and
-- is called only from finalize_game_session, which is redefined below in the
-- same transaction.
-- ===========================================================================

drop function if exists public.record_streak(uuid, text, boolean, text);

create or replace function public.record_streak(
  _user_id uuid,
  _device_id text,
  _won boolean,
  _local_date text,
  _format text default 'full'
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  _today       date;
  _row         public.user_streaks%rowtype;
  _new_streak  integer;
  _new_longest integer;
  _fmt         text := coalesce(nullif(btrim(coalesce(_format, '')), ''), 'full');
begin
  begin
    _today := coalesce(nullif(btrim(coalesce(_local_date, '')), '')::date, current_date);
  exception when others then
    _today := current_date;
  end;

  if _user_id is not null then
    select * into _row
      from public.user_streaks
     where user_id = _user_id
       and format = _fmt
     order by updated_at desc nulls last
     limit 1;
  elsif _device_id is not null and _device_id <> 'unknown' and btrim(_device_id) <> '' then
    select * into _row
      from public.user_streaks
     where device_id = _device_id and user_id is null
       and format = _fmt
     order by updated_at desc nulls last
     limit 1;
  else
    return;
  end if;

  if _row.id is null then
    insert into public.user_streaks (user_id, device_id, current_streak, longest_streak, last_played_date, format)
    values (_user_id, _device_id, 1, 1, _today, _fmt);
    return;
  end if;

  -- Already counted today. Per format: finishing the Mini after the Full on
  -- the same day must still advance the Mini streak.
  if _row.last_played_date = _today then
    return;
  end if;

  _new_streak := case
                   when _won then
                     case when _row.last_played_date = (_today - 1)
                          then coalesce(_row.current_streak, 0) + 1
                          else 1 end
                   else 0
                 end;
  _new_longest := greatest(_new_streak, coalesce(_row.longest_streak, 0));

  update public.user_streaks
     set current_streak = _new_streak,
         longest_streak = _new_longest,
         last_played_date = _today,
         updated_at = now()
   where id = _row.id;
end;
$$;

revoke all on function public.record_streak(uuid, text, boolean, text, text) from public, anon, authenticated;


-- ===========================================================================
-- 8. finalize_game_session — hand the session's format to record_streak
--
-- Signature UNCHANGED (13 args) — create or replace, no new overload, no
-- client change required. The format is read off the session row itself, so
-- a completing client cannot influence which streak it lands on.
--
-- Everything else in this function is carried over verbatim from
-- 20260917000000: the one-shot in_progress -> won/lost transition, the
-- server-decided is_official, the three required completion effects and their
-- rollback semantics.
-- ===========================================================================

create or replace function public.finalize_game_session(
  _session_id uuid,
  _device_id text,
  _device_token text,
  _won boolean,
  _mistakes integer,
  _active_time_seconds integer,
  _found_rainbow boolean,
  _rainbow_solve_index smallint,
  _solve_order jsonb,
  _hints_used boolean,
  _share_grid text,
  _skip_streak boolean default false,
  _local_date text default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  _puzzle_id      text;
  _user_id        uuid;
  _session_device text;
  _session_format text;
  _is_official    boolean;
  _completed_at   timestamptz := now();
  _rows           integer;
  _first_solve    text := _solve_order ->> 0;
  _t              integer;
  _w              integer;
  _am             numeric;
  _at             numeric;
begin
  if _won is null then
    raise exception 'finalize_game_session requires a definite outcome';
  end if;

  if not public.session_capability_ok(_session_id, _device_id, _device_token) then
    return null;
  end if;

  select gs.puzzle_id, gs.user_id, gs.device_id, gs.format
    into _puzzle_id, _user_id, _session_device, _session_format
    from public.game_sessions gs
   where gs.id = _session_id
     and gs.status = 'in_progress';

  if _puzzle_id is null then
    return null;
  end if;

  _is_official := not exists (
    select 1
      from public.game_sessions other
     where other.puzzle_id = _puzzle_id
       and other.id <> _session_id
       and other.status in ('won', 'lost')
       and other.is_official
       and (
         (_user_id is not null and other.user_id = _user_id)
         or (
           _user_id is null
           and _session_device is not null
           and _session_device <> 'unknown'
           and other.device_id = _session_device
         )
       )
  );

  update public.game_sessions
     set status = case when _won then 'won' else 'lost' end,
         won = _won,
         completed_at = _completed_at,
         last_activity_at = _completed_at,
         is_official = _is_official,
         mistakes = coalesce(_mistakes, mistakes),
         active_time_seconds = coalesce(_active_time_seconds, active_time_seconds),
         found_rainbow = coalesce(_found_rainbow, found_rainbow),
         rainbow_solve_index = coalesce(_rainbow_solve_index, rainbow_solve_index),
         rainbow_source = case
                            when coalesce(_found_rainbow, false) then 'in_game'
                            else rainbow_source
                          end,
         solve_order = coalesce(_solve_order, solve_order),
         hints_used = coalesce(_hints_used, hints_used),
         share_grid = coalesce(_share_grid, share_grid)
   where id = _session_id
     and status = 'in_progress';

  get diagnostics _rows = row_count;

  -- Someone else finalized this session between the read above and here.
  -- Claiming the transition we did not make is exactly how a play gets
  -- counted twice, so stop.
  if _rows = 0 then
    return null;
  end if;

  if not _is_official then
    return false;
  end if;

  -- ---- required effect 1: site-wide aggregates --------------------------
  -- Keyed on puzzle_id, which is already format-specific (a puzzle belongs to
  -- exactly one format), so these need no format handling of their own.
  perform pg_advisory_xact_lock(hashtextextended('puzzle_aggregate:' || _puzzle_id, 0));

  select pa.total_plays, pa.total_wins, pa.avg_mistakes, pa.avg_time_seconds
    into _t, _w, _am, _at
    from public.puzzle_aggregates pa
   where pa.puzzle_id = _puzzle_id;

  if found then
    _t := _t + 1;
    _w := _w + (case when _won then 1 else 0 end);
    _am := ((coalesce(_am, 0) * (_t - 1)) + coalesce(_mistakes, 0)) / _t;
    _at := ((coalesce(_at, 0) * (_t - 1)) + coalesce(_active_time_seconds, 0)) / _t;

    update public.puzzle_aggregates
       set total_plays = _t,
           total_wins = _w,
           avg_mistakes = _am,
           avg_time_seconds = _at,
           most_common_first_solve = coalesce(_first_solve, most_common_first_solve),
           updated_at = now()
     where puzzle_id = _puzzle_id;
  else
    insert into public.puzzle_aggregates (
      puzzle_id, total_plays, total_wins, avg_mistakes, avg_time_seconds,
      most_common_first_solve, updated_at
    ) values (
      _puzzle_id, 1, (case when _won then 1 else 0 end),
      coalesce(_mistakes, 0), coalesce(_active_time_seconds, 0),
      _first_solve, now()
    );
  end if;

  -- ---- required effect 2: game_results ----------------------------------
  -- Unchanged meaning: one row per (account, puzzle), written only on an
  -- OFFICIAL completion by a SIGNED-IN player. Keyed on puzzle_id, so it is
  -- already per-format without a format column.
  if _user_id is not null
     and _puzzle_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
     and exists (select 1 from public.puzzles p where p.id = _puzzle_id::uuid)
  then
    insert into public.game_results (user_id, puzzle_id, won, mistakes)
    values (_user_id, _puzzle_id::uuid, _won, coalesce(_mistakes, 0))
    on conflict (user_id, puzzle_id) do update
      set won = excluded.won,
          mistakes = excluded.mistakes;
  end if;

  -- ---- required effect 3: streak ----------------------------------------
  -- Archive games still do not touch streaks. The format comes from the
  -- SESSION, so a Mini completion can only ever move the Mini streak.
  if not coalesce(_skip_streak, false) then
    perform public.record_streak(_user_id, _session_device, _won, _local_date, coalesce(_session_format, 'full'));
  end if;

  return true;
end;
$$;

revoke all on function public.finalize_game_session(uuid, text, text, boolean, integer, integer, boolean, smallint, jsonb, boolean, text, boolean, text) from public;
grant execute on function public.finalize_game_session(uuid, text, text, boolean, integer, integer, boolean, smallint, jsonb, boolean, text, boolean, text) to anon, authenticated, service_role;


-- ===========================================================================
-- 9. get_own_streak / get_own_completed_sessions — scoped to one format
--
-- Both gain a trailing `_format text default 'full'`, and both are DROPPED at
-- their old 2-argument signatures first so that no ambiguous overload pair
-- can exist (see OVERLOAD SAFETY in the header). An old deployed client that
-- calls with only _device_id/_device_token still resolves here and still gets
-- exactly its Full numbers.
-- ===========================================================================

drop function if exists public.get_own_streak(text, text);

create or replace function public.get_own_streak(
  _device_id text default null,
  _device_token text default null,
  _format text default 'full'
)
returns table (current_streak integer, longest_streak integer, last_played_date text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _fmt text := coalesce(nullif(btrim(coalesce(_format, '')), ''), 'full');
begin
  if _uid is not null then
    select coalesce(us.current_streak, 0), coalesce(us.longest_streak, 0), us.last_played_date::text
      into current_streak, longest_streak, last_played_date
      from public.user_streaks us
     where us.user_id = _uid
       and us.format = _fmt
     order by coalesce(us.longest_streak, 0) desc
     limit 1;
    if found then
      return next;
    end if;
    return;
  end if;

  if _device_id is null or _device_token is null
     or not public.verify_device(_device_id, _device_token) then
    return;
  end if;

  select coalesce(us.current_streak, 0), coalesce(us.longest_streak, 0), us.last_played_date::text
    into current_streak, longest_streak, last_played_date
    from public.user_streaks us
   where us.device_id = _device_id
     and us.user_id is null
     and us.format = _fmt
   order by coalesce(us.longest_streak, 0) desc
   limit 1;
  if found then
    return next;
  end if;
  return;
end;
$$;

revoke all on function public.get_own_streak(text, text, text) from public;
grant execute on function public.get_own_streak(text, text, text) to anon, authenticated, service_role;


drop function if exists public.get_own_completed_sessions(text, text);

create or replace function public.get_own_completed_sessions(
  _device_id text default null,
  _device_token text default null,
  _format text default 'full'
)
returns table (
  puzzle_id text,
  won boolean,
  mistakes integer,
  found_rainbow boolean,
  solve_order jsonb,
  hints_used boolean,
  rainbow_solve_index smallint,
  rainbow_source text,
  bonus_rainbow_attempted boolean,
  status text
)
language sql
stable
security definer
set search_path = public
as $$
  select gs.puzzle_id, gs.won, gs.mistakes, gs.found_rainbow, gs.solve_order,
         gs.hints_used, gs.rainbow_solve_index, gs.rainbow_source,
         gs.bonus_rainbow_attempted, gs.status
    from public.game_sessions gs
   where gs.status in ('won', 'lost')
     and gs.is_official
     and gs.format = coalesce(nullif(btrim(coalesce(_format, '')), ''), 'full')
     and (
       (auth.uid() is not null and gs.user_id = auth.uid())
       or (
         gs.user_id is null
         and gs.device_id = _device_id
         and public.verify_device(_device_id, _device_token)
       )
     )
$$;

revoke all on function public.get_own_completed_sessions(text, text, text) from public;
grant execute on function public.get_own_completed_sessions(text, text, text) to anon, authenticated, service_role;


-- ===========================================================================
-- 10. validate_custom_puzzle_content — the custom-puzzle half
--
-- PREPARED, NOT EXPOSED. The public /create page does not offer Mini yet (see
-- FormatSelector's `unavailable` prop); this is the schema/validation
-- foundation so that enabling it later is a UI change rather than a data
-- change.
--
-- Format rides inside custom_puzzles.content — no new column. Absent = full,
-- so every custom puzzle already stored validates and canonicalises exactly
-- as it does today, and every existing /p/:shortCode and /custom/:shareId URL
-- keeps working untouched.
--
-- Everything not format-related is carried over verbatim from
-- 20260922000000, including the cross-group Small Hint check and the
-- one-Rainbow-answer-PER-GROUP rule.
-- ===========================================================================

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

    _out := _out || jsonb_build_array(jsonb_build_object(
      'category',   btrim(_g ->> 'category'),
      'words',      _words,
      'hint_word',  _hint,
      'sort_order', _i
    ) || case when _emoji is null then '{}'::jsonb else jsonb_build_object('category_emoji', _emoji) end);
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
    || case when nullif(btrim(coalesce(_content ->> 'rainbow_category_emoji', '')), '') is null then '{}'::jsonb else jsonb_build_object('rainbow_category_emoji', nullif(btrim(coalesce(_content ->> 'rainbow_category_emoji', '')), '')) end;
end;
$$;

revoke all on function public.validate_custom_puzzle_content(jsonb) from public;
grant execute on function public.validate_custom_puzzle_content(jsonb) to anon, authenticated, service_role;
