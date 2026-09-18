-- ===========================================================================
-- Beta playtesting — unlisted /beta area for pre-release puzzle feedback
--
-- WHAT THIS ADDS
--
--   1. puzzles.is_beta — a third puzzle status alongside is_published:
--        Draft:     is_published = false, is_beta = false
--        Beta:      is_published = false, is_beta = true
--        Published: is_published = true,  is_beta = false
--      A CHECK constraint makes "both true" impossible at the schema level,
--      not just in the Admin form.
--
--   2. RLS on puzzles/puzzle_groups widened so a Beta puzzle is readable the
--      same way a Published one already is — /beta needs exactly the same
--      anonymous read access the Daily/Archive pages already rely on.
--      Draft stays admin-only, unchanged.
--
--   3. admin_save_puzzle() redefined (same signature) to also persist
--      is_beta as metadata — exactly like is_published, never versioned.
--
--   4. beta_playtests / beta_feedback — small, beta-only tables, modeled on
--      the same "SECURITY DEFINER RPC writes, admin-only direct reads"
--      pattern as game_sessions/guess_events. Beta plays never touch
--      game_sessions, guess_events, hint_events, game_results, user_streaks
--      or puzzle_aggregates — this is the server-side backstop for that
--      rule, not just a client-side path choice.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--
--   No raw guess/hint event log for Beta (unlike the official durable-session
--   system) — beta_playtests carries only the summary a playtest needs
--   (outcome, mistakes, hints used, reset count) to keep this genuinely
--   lightweight, per the product brief. No tester accounts, invitations or
--   access codes — /beta is unlisted, not secret.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. puzzles.is_beta
-- ---------------------------------------------------------------------------
alter table public.puzzles
  add column if not exists is_beta boolean not null default false;

alter table public.puzzles
  add constraint puzzles_not_beta_and_published check (not (is_published and is_beta));

comment on column public.puzzles.is_beta is
  'Unlisted playtest status. Mutually exclusive with is_published (see puzzles_not_beta_and_published). Metadata, not gameplay content -- never versioned.';

-- ---------------------------------------------------------------------------
-- 2. RLS: a Beta puzzle is readable the same way a Published one is
-- ---------------------------------------------------------------------------
drop policy if exists "Anyone can read published puzzles" on public.puzzles;
create policy "Anyone can read published or beta puzzles" on public.puzzles
  for select using (is_published = true or is_beta = true);

drop policy if exists "Anyone can read published puzzle groups" on public.puzzle_groups;
create policy "Anyone can read published or beta puzzle groups" on public.puzzle_groups
  for select using (
    exists (
      select 1 from public.puzzles
       where id = puzzle_id and (is_published = true or is_beta = true)
    )
  );

-- ---------------------------------------------------------------------------
-- 3. admin_save_puzzle — add is_beta as a metadata field
--
-- Same signature (_puzzle_id, _metadata, _content) as 20260918010000; only
-- the body changes, to also read/write _metadata->>'is_beta'. Everything
-- else (authorization, content validation, the versioning comparison, the
-- atomic groups rewrite) is unchanged. The mutual-exclusion CHECK constraint
-- is the actual guard; nothing here needs to duplicate it.
-- ---------------------------------------------------------------------------
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
      theme, is_emoji_puzzle, emoji_puzzle_icon, is_free_puzzle, free_puzzle_order
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
      nullif(_metadata ->> 'free_puzzle_order', '')::int
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
           free_puzzle_order     = nullif(_metadata ->> 'free_puzzle_order', '')::int
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
  'Atomically creates or updates a puzzle, including its Draft/Beta/Published status. Creates and promotes a new immutable version only when canonical gameplay content actually changed; metadata-only saves (status, designer_name) and no-op saves create none. Admin role required, checked inside the function.';

-- ---------------------------------------------------------------------------
-- 4. beta_playtests — one row per playtest attempt
--
-- Modeled on game_sessions, deliberately smaller: no live per-guess event
-- log, just the summary an admin needs to evaluate a playtest. Writes are
-- SECURITY DEFINER-only (no direct grant to anon/authenticated); reads are
-- admin-only, exactly like puzzle_ratings/feedback are read in this app.
-- ---------------------------------------------------------------------------
create table public.beta_playtests (
  id                 uuid primary key default gen_random_uuid(),
  puzzle_id          uuid not null references public.puzzles(id) on delete cascade,
  puzzle_version_id  uuid not null references public.puzzle_versions(id) on delete cascade,
  device_id          text not null,
  status             text not null default 'in_progress' check (status in ('in_progress', 'completed', 'abandoned')),
  won                boolean,
  mistakes           integer not null default 0,
  hints_used         boolean not null default false,
  -- True the moment this run ends via the Reset Puzzle button, whether it was
  -- still in progress (which also flips status to 'abandoned') or already
  -- completed (status is left alone -- a real result must not be erased by a
  -- later reset). This is the whole "reset count" metric: count rows where
  -- this is true.
  is_reset           boolean not null default false,
  started_at         timestamptz not null default now(),
  completed_at       timestamptz,
  updated_at         timestamptz not null default now()
);

alter table public.beta_playtests enable row level security;
revoke all on table public.beta_playtests from anon, authenticated;
grant select on table public.beta_playtests to authenticated;

create policy "Admins can read beta playtests" on public.beta_playtests
  for select using (public.has_role(auth.uid(), 'admin'));

create index beta_playtests_puzzle_id_idx on public.beta_playtests (puzzle_id);
create index beta_playtests_device_puzzle_idx on public.beta_playtests (puzzle_id, device_id, started_at desc);

comment on table public.beta_playtests is
  'Lightweight Beta-only playtest tracking. Never contributes to game_sessions/game_results/user_streaks/puzzle_aggregates. Written only through start_beta_playtest/complete_beta_playtest/reset_beta_playtest; read only by admins.';

-- ---------------------------------------------------------------------------
-- 5. beta_feedback — one row per submitted playtest feedback form
-- ---------------------------------------------------------------------------
create table public.beta_feedback (
  id                        uuid primary key default gen_random_uuid(),
  puzzle_id                 uuid not null references public.puzzles(id) on delete cascade,
  puzzle_version_id         uuid not null references public.puzzle_versions(id) on delete cascade,
  playtest_id               uuid references public.beta_playtests(id) on delete set null,
  tester_name                text,
  fun_rating                 smallint not null check (fun_rating between 1 and 5),
  difficulty_rating          smallint not null check (difficulty_rating between 1 and 5),
  -- Only meaningful for a puzzle that actually has a Rainbow; null otherwise.
  rainbow_fairness_rating    smallint check (rainbow_fairness_rating between 1 and 5),
  confusing_or_incorrect     text,
  additional_comments        text,
  would_play_again           boolean not null,
  created_at                 timestamptz not null default now()
);

alter table public.beta_feedback enable row level security;
revoke all on table public.beta_feedback from anon, authenticated;
grant select on table public.beta_feedback to authenticated;

create policy "Admins can read beta feedback" on public.beta_feedback
  for select using (public.has_role(auth.uid(), 'admin'));

create index beta_feedback_puzzle_id_idx on public.beta_feedback (puzzle_id);

comment on table public.beta_feedback is
  'Beta playtest feedback forms. No account required to submit -- validated and inserted only through submit_beta_feedback(). Read only by admins.';

-- ---------------------------------------------------------------------------
-- 6. RPCs
-- ---------------------------------------------------------------------------

-- Lazily creates the playtest row on the first meaningful gameplay action --
-- same trigger and same "a page view creates nothing" rule as
-- create_game_session. Refuses anything that is not actually a current Beta
-- puzzle+version pair, so a puzzle that was promoted to Published (or a
-- stale version id) mid-session cannot mint a new beta_playtests row.
create or replace function public.start_beta_playtest(
  _puzzle_id uuid,
  _puzzle_version_id uuid,
  _device_id text,
  _device_token text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  _id uuid;
begin
  if not public.verify_device(_device_id, _device_token) then
    return null;
  end if;

  if not exists (select 1 from public.puzzles where id = _puzzle_id and is_beta = true) then
    return null;
  end if;

  if not exists (
    select 1 from public.puzzle_versions
     where id = _puzzle_version_id and puzzle_id = _puzzle_id
  ) then
    return null;
  end if;

  insert into public.beta_playtests (puzzle_id, puzzle_version_id, device_id)
  values (_puzzle_id, _puzzle_version_id, _device_id)
  returning id into _id;

  return _id;
end;
$$;

revoke all on function public.start_beta_playtest(uuid, uuid, text, text) from public;
grant execute on function public.start_beta_playtest(uuid, uuid, text, text) to anon, authenticated, service_role;

-- Formal win/loss for a playtest. Restricted to the owning device and to a
-- still-in_progress row, exactly like finalize_game_session's
-- in_progress -> won/lost transition -- a completed playtest cannot be
-- re-finalized by a retried call.
create or replace function public.complete_beta_playtest(
  _playtest_id uuid,
  _device_id text,
  _device_token text,
  _won boolean,
  _mistakes integer,
  _hints_used boolean
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
  if not public.verify_device(_device_id, _device_token) then
    return false;
  end if;

  update public.beta_playtests
     set status       = 'completed',
         won          = _won,
         mistakes     = coalesce(_mistakes, mistakes),
         hints_used   = coalesce(_hints_used, hints_used),
         completed_at = now(),
         updated_at   = now()
   where id = _playtest_id
     and device_id = _device_id
     and status = 'in_progress';

  get diagnostics did_update = row_count;
  return did_update;
end;
$$;

revoke all on function public.complete_beta_playtest(uuid, text, text, boolean, integer, boolean) from public;
grant execute on function public.complete_beta_playtest(uuid, text, text, boolean, integer, boolean) to anon, authenticated, service_role;

-- Reset Puzzle: ends the device's most recent playtest for this puzzle (if
-- any) and flags it as a reset, which is the entire "reset count" metric.
-- An in-progress run is marked abandoned; an already-completed run keeps its
-- real won/lost result -- a reset must never erase a finished outcome, it
-- only records that the player chose to go again. No row to touch (the
-- player reset before their first meaningful action) is a harmless no-op.
create or replace function public.reset_beta_playtest(
  _puzzle_id uuid,
  _device_id text,
  _device_token text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  _row_id uuid;
begin
  if not public.verify_device(_device_id, _device_token) then
    return false;
  end if;

  select id into _row_id
    from public.beta_playtests
   where puzzle_id = _puzzle_id
     and device_id = _device_id
   order by started_at desc
   limit 1;

  if _row_id is null then
    return false;
  end if;

  update public.beta_playtests
     set is_reset     = true,
         status       = case when status = 'in_progress' then 'abandoned' else status end,
         completed_at = coalesce(completed_at, now()),
         updated_at   = now()
   where id = _row_id;

  return true;
end;
$$;

revoke all on function public.reset_beta_playtest(uuid, text, text) from public;
grant execute on function public.reset_beta_playtest(uuid, text, text) to anon, authenticated, service_role;

-- Feedback submission. No device/account requirement by product design (no
-- login for playtesters) -- validation is length/range only, no anti-spam
-- infrastructure, per the MVP brief.
create or replace function public.submit_beta_feedback(
  _puzzle_id uuid,
  _puzzle_version_id uuid,
  _playtest_id uuid,
  _tester_name text,
  _fun_rating smallint,
  _difficulty_rating smallint,
  _rainbow_fairness_rating smallint,
  _confusing_or_incorrect text,
  _additional_comments text,
  _would_play_again boolean
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  _id uuid;
begin
  if not exists (select 1 from public.puzzles where id = _puzzle_id and is_beta = true) then
    return null;
  end if;

  if not exists (
    select 1 from public.puzzle_versions
     where id = _puzzle_version_id and puzzle_id = _puzzle_id
  ) then
    return null;
  end if;

  if _playtest_id is not null and not exists (
    select 1 from public.beta_playtests where id = _playtest_id and puzzle_id = _puzzle_id
  ) then
    _playtest_id := null;
  end if;

  if _fun_rating is null or _fun_rating < 1 or _fun_rating > 5 then
    raise exception 'fun rating must be between 1 and 5' using errcode = 'invalid_parameter_value';
  end if;
  if _difficulty_rating is null or _difficulty_rating < 1 or _difficulty_rating > 5 then
    raise exception 'difficulty rating must be between 1 and 5' using errcode = 'invalid_parameter_value';
  end if;
  if _rainbow_fairness_rating is not null and (_rainbow_fairness_rating < 1 or _rainbow_fairness_rating > 5) then
    raise exception 'rainbow fairness rating must be between 1 and 5' using errcode = 'invalid_parameter_value';
  end if;
  if _would_play_again is null then
    raise exception 'would_play_again is required' using errcode = 'invalid_parameter_value';
  end if;
  if _tester_name is not null and length(_tester_name) > 80 then
    raise exception 'tester name is too long' using errcode = 'invalid_parameter_value';
  end if;
  if _confusing_or_incorrect is not null and length(_confusing_or_incorrect) > 2000 then
    raise exception 'response is too long' using errcode = 'invalid_parameter_value';
  end if;
  if _additional_comments is not null and length(_additional_comments) > 2000 then
    raise exception 'response is too long' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.beta_feedback (
    puzzle_id, puzzle_version_id, playtest_id, tester_name,
    fun_rating, difficulty_rating, rainbow_fairness_rating,
    confusing_or_incorrect, additional_comments, would_play_again
  ) values (
    _puzzle_id, _puzzle_version_id, _playtest_id,
    nullif(btrim(coalesce(_tester_name, '')), ''),
    _fun_rating, _difficulty_rating, _rainbow_fairness_rating,
    nullif(btrim(coalesce(_confusing_or_incorrect, '')), ''),
    nullif(btrim(coalesce(_additional_comments, '')), ''),
    _would_play_again
  )
  returning id into _id;

  return _id;
end;
$$;

revoke all on function public.submit_beta_feedback(uuid, uuid, uuid, text, smallint, smallint, smallint, text, text, boolean) from public;
grant execute on function public.submit_beta_feedback(uuid, uuid, uuid, text, smallint, smallint, smallint, text, text, boolean) to anon, authenticated, service_role;
