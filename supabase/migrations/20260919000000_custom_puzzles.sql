-- ===========================================================================
-- Public custom puzzles -- /create and /custom/:shareId (Phase 2)
--
-- WHAT THIS ADDS
--
--   1. custom_puzzles -- one row per player-created puzzle. The full
--      gameplay definition lives in one validated jsonb `content` column
--      (same "one snapshot, not a family of child tables" approach as
--      puzzle_versions.content), because there will eventually be thousands
--      of these and a normalized categories/answers schema buys nothing a
--      player-created, IMMUTABLE puzzle needs.
--
--   2. custom_puzzle_results -- one row per (puzzle, device) that finished a
--      game. Lightweight on purpose: no guess/hint event log, no session
--      table, no in-progress row at all -- in-progress play is
--      localStorage-only (see lib/customPuzzles.ts / useGame's "custom"
--      mode), and the server only ever hears about a FINISHED game, once.
--
--   3. Five RPCs: create_custom_puzzle, get_custom_puzzle,
--      submit_custom_puzzle_result, get_custom_puzzle_stats, and an
--      admin-only admin_set_custom_puzzle_status for future moderation (no
--      dashboard built yet -- this just avoids a follow-up migration for the
--      "hide abusive content" requirement).
--
-- WHAT THIS DELIBERATELY DOES NOT TOUCH
--
-- Nothing here references puzzles, puzzle_groups, puzzle_versions,
-- game_sessions, guess_events, hint_events, game_results, user_streaks,
-- puzzle_aggregates or beta_playtests/beta_feedback. A custom puzzle is
-- structurally incapable of writing into any official or Beta table --
-- that isolation is enforced here, not just by which buttons the frontend
-- shows.
--
-- ACCESS MODEL
--
-- Both tables have RLS enabled with NO policies and NO grants to
-- anon/authenticated: every read and write goes through a SECURITY DEFINER
-- RPC below, which is what lets get_custom_puzzle enforce "Private puzzles
-- are never listed, only ever fetched by their own unguessable share_id" and
-- get_custom_puzzle_stats return aggregates only, never a row.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. custom_puzzles
-- ---------------------------------------------------------------------------
create table public.custom_puzzles (
  id                uuid primary key default gen_random_uuid(),
  -- Long and unguessable (see create_custom_puzzle below: two concatenated
  -- gen_random_uuid()s worth of hex, no pgcrypto dependency -- same approach
  -- as device_identities.device_token in the 20260917000000 migration).
  -- This alone is what makes a Private puzzle safe to share by link: nothing
  -- about visibility narrows who CAN fetch it by this id, only whether it is
  -- ever surfaced anywhere without it.
  share_id          text not null unique,
  visibility        text not null check (visibility in ('public', 'private')),
  created_by        uuid references auth.users(id) on delete set null,
  creator_name      text not null,
  title             text not null,
  -- 'active': playable. 'hidden': an admin has taken it down for abuse; the
  -- row (and its results) stay for record-keeping but get_custom_puzzle and
  -- get_custom_puzzle_stats both refuse to serve it.
  moderation_status text not null default 'active' check (moderation_status in ('active', 'hidden')),
  -- Canonical gameplay content, in the exact shape
  -- validate_custom_puzzle_content() below produces: {mode, groups[4],
  -- word_order, rainbow_herring, rainbow_category_name, rainbow_hint_word,
  -- alphabetize_completed}. Immutable after creation -- there is no update
  -- RPC for it, matching "custom puzzles are immutable in this MVP".
  content           jsonb not null,
  created_at        timestamptz not null default now()
);

comment on table public.custom_puzzles is
  'Player-created puzzles (Phase 2, Full 4x4 only). Immutable after creation. Reachable only through create_custom_puzzle/get_custom_puzzle -- no direct grants to anon/authenticated.';

comment on column public.custom_puzzles.content is
  'Canonical gameplay content, shape enforced by validate_custom_puzzle_content(): {mode: classic|rainbow, groups:[{category,words[4],hint_word}]x4, word_order[16], rainbow_herring[4]|null, rainbow_category_name, rainbow_hint_word, alphabetize_completed}.';

alter table public.custom_puzzles enable row level security;
revoke all on table public.custom_puzzles from anon, authenticated;

-- Admin-only direct read, for a future moderation dashboard (not built in
-- this phase) -- everyone else, including the puzzle's own creator, reads
-- exclusively through get_custom_puzzle.
create policy "Admins can read custom puzzles" on public.custom_puzzles
  for select using (public.has_role(auth.uid(), 'admin'));

create index custom_puzzles_share_id_idx on public.custom_puzzles (share_id);
create index custom_puzzles_created_by_idx on public.custom_puzzles (created_by) where created_by is not null;


-- ---------------------------------------------------------------------------
-- 2. custom_puzzle_results -- one row per (puzzle, device) that FINISHED
-- ---------------------------------------------------------------------------
create table public.custom_puzzle_results (
  id               uuid primary key default gen_random_uuid(),
  custom_puzzle_id uuid not null references public.custom_puzzles(id) on delete cascade,
  -- The existing verified device identity (device_identities), never a
  -- separately invented browser id -- see verify_device below.
  device_id        text not null,
  won              boolean not null,
  -- Submitted guesses only (correct + incorrect), before the game ended.
  -- Never tile selections, deselections, shuffles or hints -- see
  -- useGame.ts's commitOfficialResult "custom" branch, which derives this
  -- from the same guessHistory the official path already builds.
  total_guesses    smallint not null check (total_guesses >= 0 and total_guesses <= 60),
  completed_at     timestamptz not null default now(),
  -- One result per device per puzzle. This is the entire "replay doesn't
  -- inflate stats" guarantee: submit_custom_puzzle_result's insert simply
  -- does nothing on conflict.
  unique (custom_puzzle_id, device_id)
);

comment on table public.custom_puzzle_results is
  'One row per (custom_puzzle, device) that finished a game. No guess/hint/tile-selection detail, no player-identifying data beyond the existing verified device id. Written only by submit_custom_puzzle_result; read only in aggregate, by get_custom_puzzle_stats.';

alter table public.custom_puzzle_results enable row level security;
revoke all on table public.custom_puzzle_results from anon, authenticated;
-- No policies at all -- not even for admins. Individual result rows are
-- never exposed to any client; get_custom_puzzle_stats is the only reader,
-- and it returns aggregates only (see its "WHAT IT NEVER RETURNS" comment).

create index custom_puzzle_results_puzzle_idx on public.custom_puzzle_results (custom_puzzle_id);


-- ===========================================================================
-- 3. validate_custom_puzzle_content -- the server-side shape contract
--
-- Mirrors validate_puzzle_content (20260917120000) closely, plus the extra
-- rules a player-authored puzzle needs that an admin-only puzzle didn't:
--   - mode: 'classic' (no rainbow_herring at all) or 'rainbow' (exactly one
--     answer selected from EACH of the 4 groups, not just 4-of-16 anywhere);
--   - a group's hint_word may never equal one of the puzzle's own 16 board
--     words (it would otherwise give the answer away, or "become" a board/
--     Rainbow answer by simply matching one);
--   - explicit length limits on every free-text field, since this content
--     now arrives from the public rather than from an admin account.
-- ===========================================================================
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
  _group_words text[][];
  _out         jsonb := '[]'::jsonb;
  _herring     jsonb;
  _order       jsonb;
  _i           integer;
  _w           text;
  _hint        text;
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

  _group_words := array_fill(null::text, array[4, 4]);

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
      _group_words[_i + 1] := array_append(_group_words[_i + 1], _w);
    end loop;

    _hint := nullif(btrim(coalesce(_g ->> 'hint_word', '')), '');
    if _hint is not null then
      if length(_hint) > 40 then
        raise exception 'group % Small Hint is too long (max 40 characters)', _i + 1 using errcode = 'invalid_parameter_value';
      end if;
      if upper(_hint) = any (select upper(x) from unnest(_all) x) then
        raise exception 'group % Small Hint cannot duplicate a board answer', _i + 1 using errcode = 'invalid_parameter_value';
      end if;
    end if;

    _out := _out || jsonb_build_array(jsonb_build_object(
      'category',   btrim(_g ->> 'category'),
      'words',      _words,
      'hint_word',  _hint,
      'sort_order', _i
    ));
  end loop;

  if (select count(distinct upper(w)) from unnest(_all) w) <> 16 then
    raise exception 'a puzzle needs 16 unique answers' using errcode = 'invalid_parameter_value';
  end if;

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
      _hits := (
        select count(*) from unnest(_herring_words) hw
         where upper(hw) = any (select upper(x) from unnest(_group_words[_i]) x)
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

  return jsonb_build_object(
    'mode',                   _mode,
    'groups',                 _out,
    'word_order',             _order,
    'rainbow_herring',        _herring,
    'rainbow_category_name',  nullif(btrim(coalesce(_content ->> 'rainbow_category_name', '')), ''),
    'rainbow_hint_word',      nullif(btrim(coalesce(_content ->> 'rainbow_hint_word', '')), ''),
    'alphabetize_completed',  coalesce((_content ->> 'alphabetize_completed')::boolean, true)
  );
end;
$$;

revoke all on function public.validate_custom_puzzle_content(jsonb) from public;
grant execute on function public.validate_custom_puzzle_content(jsonb) to anon, authenticated, service_role;

comment on function public.validate_custom_puzzle_content(jsonb) is
  'Validates and canonicalises a player-submitted custom puzzle. Unlike validate_puzzle_content, enforces one-Rainbow-answer-per-group (not just 4-of-16) and rejects any Rainbow content on a classic puzzle.';


-- ===========================================================================
-- 4. create_custom_puzzle -- works for anon AND authenticated
-- ===========================================================================
create or replace function public.create_custom_puzzle(
  _creator_name text,
  _title text,
  _visibility text,
  _content jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  _uid        uuid := auth.uid();
  _canonical  jsonb;
  _title_n    text;
  _creator_n  text;
  _share_id   text;
  _id         uuid;
begin
  if _visibility not in ('public', 'private') then
    raise exception 'visibility must be public or private' using errcode = 'invalid_parameter_value';
  end if;

  _canonical := public.validate_custom_puzzle_content(_content);

  _title_n := nullif(btrim(coalesce(_title, '')), '');
  if _title_n is null then
    raise exception 'a puzzle needs a title' using errcode = 'invalid_parameter_value';
  end if;
  if length(_title_n) > 100 then
    raise exception 'title is too long (max 100 characters)' using errcode = 'invalid_parameter_value';
  end if;

  _creator_n := nullif(btrim(coalesce(_creator_name, '')), '');
  if _creator_n is null then
    raise exception 'a designer name is required' using errcode = 'invalid_parameter_value';
  end if;
  if length(_creator_n) > 60 then
    raise exception 'designer name is too long (max 60 characters)' using errcode = 'invalid_parameter_value';
  end if;

  -- Same no-pgcrypto-dependency token shape as create_device_identity (two
  -- concatenated gen_random_uuid()s, dashes stripped): long and unguessable
  -- enough to be the entire access control for a Private puzzle's link.
  loop
    _share_id := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    exit when not exists (select 1 from public.custom_puzzles where share_id = _share_id);
  end loop;

  insert into public.custom_puzzles (share_id, visibility, created_by, creator_name, title, content)
  values (_share_id, _visibility, _uid, _creator_n, _title_n, _canonical)
  returning id into _id;

  return jsonb_build_object('puzzle_id', _id, 'share_id', _share_id);
end;
$$;

revoke all on function public.create_custom_puzzle(text, text, text, jsonb) from public;
grant execute on function public.create_custom_puzzle(text, text, text, jsonb) to anon, authenticated, service_role;

comment on function public.create_custom_puzzle(text, text, text, jsonb) is
  'Creates an immutable player custom puzzle. Works for both anon and authenticated callers; associates auth.uid() when present. Generates the share_id server-side -- never client-supplied.';


-- ===========================================================================
-- 5. get_custom_puzzle -- the play-page read path
--
-- Deliberately a single lookup BY share_id, never a listing query: knowledge
-- of the share_id is what makes a Private puzzle's link work at all, and
-- this function is the only thing that can turn a share_id into content, so
-- there is no query shape that enumerates puzzles a caller doesn't already
-- have the link to.
-- ===========================================================================
create or replace function public.get_custom_puzzle(_share_id text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id',           cp.id,
    'share_id',     cp.share_id,
    'title',        cp.title,
    'creator_name', cp.creator_name,
    'visibility',   cp.visibility,
    'content',      cp.content
  )
  from public.custom_puzzles cp
  where cp.share_id = _share_id
    and cp.moderation_status = 'active'
$$;

revoke all on function public.get_custom_puzzle(text) from public;
grant execute on function public.get_custom_puzzle(text) to anon, authenticated, service_role;

comment on function public.get_custom_puzzle(text) is
  'Fetches one custom puzzle by its share_id, or null if it does not exist or has been hidden by moderation. Public and Private puzzles are fetched identically -- Private''s only protection is the unguessable share_id itself.';


-- ===========================================================================
-- 6. submit_custom_puzzle_result -- the ONLY write to custom_puzzle_results
--
-- Idempotent by construction: (custom_puzzle_id, device_id) is unique, and a
-- repeat call for the same device+puzzle is a harmless no-op that still
-- returns true, matching "handle repeated completion calls safely".
-- ===========================================================================
create or replace function public.submit_custom_puzzle_result(
  _share_id text,
  _device_id text,
  _device_token text,
  _won boolean,
  _total_guesses smallint
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  _cpid uuid;
begin
  if not public.verify_device(_device_id, _device_token) then
    return false;
  end if;

  if _won is null then
    raise exception 'won is required' using errcode = 'invalid_parameter_value';
  end if;
  if _total_guesses is null or _total_guesses < 0 or _total_guesses > 60 then
    raise exception 'total_guesses out of range' using errcode = 'invalid_parameter_value';
  end if;

  select id into _cpid
    from public.custom_puzzles
   where share_id = _share_id
     and moderation_status = 'active';

  if _cpid is null then
    return false;
  end if;

  insert into public.custom_puzzle_results (custom_puzzle_id, device_id, won, total_guesses)
  values (_cpid, _device_id, _won, _total_guesses)
  on conflict (custom_puzzle_id, device_id) do nothing;

  return true;
end;
$$;

revoke all on function public.submit_custom_puzzle_result(text, text, text, boolean, smallint) from public;
grant execute on function public.submit_custom_puzzle_result(text, text, text, boolean, smallint) to anon, authenticated, service_role;

comment on function public.submit_custom_puzzle_result(text, text, text, boolean, smallint) is
  'Records the FIRST finished result for (custom_puzzle, device). A repeat call for the same pair is a no-op that still returns true -- replays never inflate stats. Never writes to any official or Beta table.';


-- ===========================================================================
-- 7. get_custom_puzzle_stats -- aggregates only, never a row
--
-- WHAT IT NEVER RETURNS: device ids, account ids, or anything resembling an
-- individual result row. Only counts and a distribution keyed by guess
-- count.
-- ===========================================================================
create or replace function public.get_custom_puzzle_stats(_share_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  _cpid uuid;
  _result jsonb;
begin
  select id into _cpid
    from public.custom_puzzles
   where share_id = _share_id
     and moderation_status = 'active';

  if _cpid is null then
    return null;
  end if;

  select jsonb_build_object(
           'finished_plays',    count(*),
           'wins',              count(*) filter (where r.won),
           'losses',            count(*) filter (where not r.won),
           'avg_guesses',       coalesce(round(avg(r.total_guesses)::numeric, 2), 0),
           'guess_distribution', coalesce(
             (select jsonb_object_agg(d.total_guesses::text, d.cnt)
                from (
                  select total_guesses, count(*) as cnt
                    from public.custom_puzzle_results
                   where custom_puzzle_id = _cpid
                   group by total_guesses
                ) d),
             '{}'::jsonb
           )
         )
    into _result
    from public.custom_puzzle_results r
   where r.custom_puzzle_id = _cpid;

  return _result;
end;
$$;

revoke all on function public.get_custom_puzzle_stats(text) from public;
grant execute on function public.get_custom_puzzle_stats(text) to anon, authenticated, service_role;

comment on function public.get_custom_puzzle_stats(text) is
  'Aggregate finished-play stats for one custom puzzle (by share_id, so Private stats require possessing the link). Never returns anything row-level -- no device or account identifiers.';


-- ===========================================================================
-- 8. admin_set_custom_puzzle_status -- moderation primitive (no dashboard yet)
--
-- Not wired to any UI in this phase. Exists now so that hiding an abusive
-- custom puzzle later needs no further migration -- see the product brief's
-- "an Admin can hide abusive content later without deleting it".
-- ===========================================================================
create or replace function public.admin_set_custom_puzzle_status(
  _puzzle_id uuid,
  _status text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  did_update boolean;
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'admin') then
    raise exception 'admin role required' using errcode = 'insufficient_privilege';
  end if;
  if _status not in ('active', 'hidden') then
    raise exception 'status must be active or hidden' using errcode = 'invalid_parameter_value';
  end if;

  update public.custom_puzzles set moderation_status = _status where id = _puzzle_id;
  get diagnostics did_update = row_count;
  return did_update;
end;
$$;

revoke all on function public.admin_set_custom_puzzle_status(uuid, text) from public;
grant execute on function public.admin_set_custom_puzzle_status(uuid, text) to authenticated, service_role;

comment on function public.admin_set_custom_puzzle_status(uuid, text) is
  'Admin-only moderation switch for a custom puzzle. No UI in this phase -- exists so a follow-up moderation dashboard needs no schema change.';
