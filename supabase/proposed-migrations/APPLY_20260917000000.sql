-- ###########################################################################
--  PERMANENT APPLICATION  --  RUN THIS IN PROJECT  zmauemcjcrdrgfjzkvgd
-- ###########################################################################
--
--   >>> STOP AND CHECK THE PROJECT FIRST <<<
--   The browser address bar must read:
--       https://supabase.com/dashboard/project/zmauemcjcrdrgfjzkvgd/sql
--   If the project ref is anything other than zmauemcjcrdrgfjzkvgd, do not run
--   this. It is a shared project and the wrong target would be hard to undo.
--
-- WHAT THIS DOES
--   Applies the device-credential + account-onboarding cutover permanently:
--   creates device_identities and account_onboarding, classifies every
--   existing account as legacy, retires every pre-cutover device identity,
--   replaces the gameplay RPCs with token-checked versions, drops
--   claim_anonymous_sessions, and removes direct write access to
--   game_sessions, guess_events, hint_events, user_streaks and game_results.
--
--   No gameplay row is deleted. puzzle_aggregates is not recounted. Nothing
--   belonging to the other apps in this project (wtf_*, cv_*) is touched.
--
-- WHY IT IS WRAPPED IN A TRANSACTION
--   This is 1,464 lines and must be all-or-nothing rather than relying on the
--   editor. Everything between BEGIN and COMMIT either lands together or not
--   at all: the migration's own guards raise on any problem they find, and
--   any statement error aborts the transaction, so a failure leaves the
--   database exactly as it is now.
--
-- HOW TO RUN
--   1. Confirm the project ref above.
--   2. Select ALL of this file and paste it into one SQL Editor tab.
--   3. Run it once, and wait for it to finish.
--
-- WHAT SUCCESS LOOKS LIKE
--   The run completes with no red ERROR, and the last statement executed is
--   the COMMIT on the final line. The frontend is already deployed and will
--   pick this up on its own within a few seconds -- the "Saving is
--   temporarily unavailable" notice disappears by itself.
--
-- IF IT FAILS
--   Nothing is applied. Copy back the whole error, including any CONTEXT:
--   and HINT: lines. A message starting "Aborting:" is the migration's own
--   guard reporting something about the data; anything else is a problem in
--   the SQL itself. Either way the database is unchanged and the site keeps
--   working in its local-play mode.
--
-- AFTERWARDS
--   The migration ledger still needs `supabase migration repair --status
--   applied 20260916230000` and `... 20260917000000` from a CLI signed in to
--   the right Supabase account, before any future `supabase db push`.
-- ###########################################################################

begin;

-- Transaction-local safety rails; they end with the transaction either way.
--   lock_timeout      : the DDL below briefly takes locks on game_sessions
--                       and user_streaks. Fail fast instead of queueing
--                       behind a live request.
--   statement_timeout : no single statement may run away.
--   idle timeout      : if the editor tab dies mid-run, this cannot sit
--                       holding locks open.
set local lock_timeout = '15s';
set local statement_timeout = '120s';
set local idle_in_transaction_session_timeout = '300s';


-- ###########################################################################
-- BEGIN migration text, byte-for-byte from
--   supabase/migrations/20260917000000_device_credentials_and_account_onboarding.sql
-- ###########################################################################

-- ===========================================================================
-- Device credentials + account onboarding  (pre-launch HARD CUTOVER)
--
-- Follow-up to 20260916150000 (durable sessions), 20260916220000 (legacy
-- insert parity) and 20260916230000 (claim official-priority). This is a
-- FINAL-STATE migration: it deliberately contains no compatibility shims for
-- cached frontend bundles. Old bundles stop working the moment it lands, by
-- design, and the coordinated frontend deploy + maintenance screen is what
-- covers that window.
--
-- WHAT THIS FIXES
-- ---------------
-- 1. device_id was simultaneously an identifier and a bearer capability. It
--    is minted client-side, travels as ordinary request data, and every
--    privileged RPC accepted it as sole proof of ownership.
-- 2. user_streaks was readable and writable by ANYONE. Confirmed live: with
--    nothing but the public anon key, `select ... from user_streaks where
--    user_id is null` returns every guest's device_id and streak. Its UPDATE
--    policy (USING and WITH CHECK both
--    `user_id = auth.uid() OR (user_id IS NULL AND device_id IS NOT NULL)`)
--    additionally let any authenticated caller flip a stranger's anonymous
--    row onto their own account.
-- 3. Combined, those two made claim_anonymous_sessions remotely abusable:
--    harvest a device_id from (2), hand it to the claim RPC, inherit a
--    stranger's gameplay.
-- 4. game_sessions kept a direct INSERT policy for cached clients, which
--    bypasses every RPC-level rule including the new onboarding gate.
-- 5. increment_puzzle_aggregate was directly callable with fully
--    client-supplied values, and was a separate network call AFTER
--    finalization -- so a retry double-counted a play and a crash lost one.
--    Its body is also a read-then-write with no lock, which loses
--    increments under concurrency. That is the observed drift between
--    puzzle_aggregates.total_plays and the session counts.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
-- ----------------------------------
-- - No gameplay row is deleted. game_sessions, guess_events, hint_events,
--   user_streaks and game_results are preserved in full.
-- - puzzle_aggregates is NOT recounted, rebuilt or corrected. The historical
--   playtest totals stay exactly as they are, including the known drift.
--   The definition of a "play" is unchanged: +1 per official completion.
-- - Nothing outside Rainbow Connect is touched. This project is shared with
--   other apps (wtf_*, cv_*); every statement below names its table.
-- ===========================================================================


-- ===========================================================================
-- 1. device_identities -- the private per-device credential
--
-- device_id stays what it always was: a non-secret identifier, stored in
-- localStorage and written onto every gameplay row for provenance. What is
-- new is that holding it proves nothing. Authority now comes from a separate
-- 256-bit-class token that the server hands back exactly once at creation
-- and never stores in the clear.
--
-- The hash is sha256() and the token is two concatenated gen_random_uuid()s
-- (~244 bits). Both are core PostgreSQL, so this migration has no pgcrypto
-- dependency and cannot fail over which schema an extension happens to live
-- in. A slow password hash (bcrypt) would be the wrong tool: the token's
-- strength is its entropy, not its resistance to dictionary attack, and
-- bcrypt would tax every gameplay write for nothing.
--
-- retired_at is the one-way door. A retired identity can never again pass
-- verification, so its history becomes permanently unclaimable and
-- inaccessible as a live guest profile -- while every gameplay row it owns
-- stays exactly where it is, still counted in aggregate analytics.
-- ===========================================================================
create table if not exists public.device_identities (
  device_id      text primary key,
  token_hash     text,
  created_at     timestamptz not null default now(),
  retired_at     timestamptz,
  retired_reason text
);

comment on table public.device_identities is
  'One row per anonymous browser identity. token_hash is sha256 of a token returned exactly once at creation and never stored in the clear. retired_at is permanent: a retired identity can never be verified, claimed or resumed, but its gameplay rows are never touched.';

alter table public.device_identities enable row level security;
-- No policies at all, and no grants: this table is reachable ONLY through the
-- SECURITY DEFINER functions below, which run as the owner and bypass RLS.
revoke all on table public.device_identities from anon, authenticated;


-- ===========================================================================
-- 2. account_onboarding -- the durable, server-side one-time decision
--
-- The frontend cannot be the source of truth for "has this account already
-- had its one import opportunity". A localStorage flag is lost on a new
-- device, survives nothing, and can be cleared at will.
--
-- Statuses:
--   pending          the one non-terminal state: a genuinely new account with
--                    an unresolved decision. Gameplay is BLOCKED here.
--   no_guest_history auto-resolved: nothing importable on this browser.
--   imported         the player chose "Add My Progress".
--   started_fresh    the player chose "Start Fresh".
--   legacy           backfilled below: the account already existed when this
--                    migration ran, so no decision was ever owed.
--
-- No transition ever leaves a terminal state, and nothing ever returns to
-- 'pending'. Every resolving write is a compare-and-swap on status='pending',
-- which is what makes multi-tab races, retries and double-clicks safe.
--
-- There is deliberately NO trigger on auth.users. The backfill in section 3
-- classifies every account that exists today as 'legacy'; therefore an
-- account with NO row can only have been created after this migration, and
-- resolve_onboarding creates its row as 'pending' on first sight. That makes
-- "new account" and "existing account" distinguishable without depending on
-- auth-schema trigger privileges, and it means a post-cutover account can
-- never be mistaken for legacy.
-- ===========================================================================
create table if not exists public.account_onboarding (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  status           text not null
                   check (status in ('pending','no_guest_history','imported','started_fresh','legacy')),
  source_device_id text,
  decided_at       timestamptz,
  created_at       timestamptz not null default now()
);

comment on table public.account_onboarding is
  'One row per account. status=pending means a genuinely new account with an unresolved import decision, and gameplay is refused until it resolves. Terminal states are never re-entered. Rows are created lazily by resolve_onboarding; every account existing at cutover was backfilled as legacy.';

alter table public.account_onboarding enable row level security;
revoke all on table public.account_onboarding from anon, authenticated;


-- ===========================================================================
-- 3. Backfill -- classify everything that already exists
--
-- Accounts: every account that exists right now is 'legacy'. It predates the
-- concept, was never shown a choice, and is owed none. Deliberately a
-- distinct status from 'imported' so that an audit can always tell a real
-- player decision from an administrative classification.
--
-- Devices: every device_id already present in gameplay data is registered
-- RETIRED, with a NULL token_hash. Two independent reasons it can never be
-- claimed: verify_device requires retired_at IS NULL, and a NULL hash can
-- never equal sha256 of anything. This is the approved Option A -- no legacy
-- claim window. The gameplay rows themselves are untouched and keep counting
-- in aggregate analytics exactly as before.
--
-- NULL, blank and 'unknown' device ids are excluded: 'unknown' is the shared
-- literal every storage-blocked browser reports, so it is not an identity,
-- and registering it would create one row standing for many strangers.
-- ===========================================================================
insert into public.account_onboarding (user_id, status, decided_at)
select u.id, 'legacy', now()
  from auth.users u
on conflict (user_id) do nothing;

insert into public.device_identities (device_id, token_hash, retired_at, retired_reason)
select distinct d.device_id, null, now(), 'pre_launch_cutover'
  from (
    select device_id from public.game_sessions
    union
    select device_id from public.user_streaks
  ) d
 where d.device_id is not null
   and btrim(d.device_id) <> ''
   and d.device_id <> 'unknown'
on conflict (device_id) do nothing;


-- ===========================================================================
-- 4. Credential primitives
-- ===========================================================================

-- The single definition of "is this caller really this device". Internal:
-- no grant to anon or authenticated, so it cannot be used as an oracle to
-- probe which device ids exist. SECURITY DEFINER callers reach it as owner.
create or replace function public.verify_device(_device_id text, _device_token text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.device_identities di
     where di.device_id = _device_id
       and di.retired_at is null
       and di.token_hash is not null
       and _device_token is not null
       and di.token_hash = encode(sha256(convert_to(_device_token, 'UTF8')), 'hex')
  )
$$;

revoke all on function public.verify_device(text, text) from public, anon, authenticated;

-- Mint a new anonymous identity. The ONLY moment the raw token exists outside
-- the caller's own browser: it is returned once, over TLS, and never stored,
-- logged or re-derivable. A browser that loses it has lost that identity for
-- good -- the accepted trade for not keeping a recoverable secret anywhere.
create or replace function public.create_device_identity()
returns table (device_id text, device_token text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  _id    text := gen_random_uuid()::text;
  _token text := replace(gen_random_uuid()::text, '-', '')
              || replace(gen_random_uuid()::text, '-', '');
begin
  insert into public.device_identities (device_id, token_hash)
  values (_id, encode(sha256(convert_to(_token, 'UTF8')), 'hex'));

  device_id := _id;
  device_token := _token;
  return next;
end;
$$;

revoke all on function public.create_device_identity() from public;
grant execute on function public.create_device_identity() to anon, authenticated, service_role;

-- Is there anything on this device worth offering to import?
--
-- The product rule, made exact: any COMPLETED session counts; an unfinished
-- session counts only when it holds real saved activity (a guess, a revealed
-- hint, or a recorded mistake for the case where the child write failed);
-- legitimate anonymous streak history counts on its own. Merely opening an
-- untouched puzzle cannot qualify -- a session row is only ever created
-- immediately before a guess or hint write, so opening a board creates
-- nothing at all.
create or replace function public.device_has_importable_history(_device_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.game_sessions gs
     where gs.device_id = _device_id
       and gs.user_id is null
       and (
            gs.status in ('won', 'lost')
         or exists (select 1 from public.guess_events ge where ge.game_session_id = gs.id)
         or exists (select 1 from public.hint_events he where he.game_session_id = gs.id)
         or coalesce(gs.mistakes, 0) > 0
       )
  )
  or exists (
    select 1
      from public.user_streaks us
     where us.device_id = _device_id
       and us.user_id is null
       and (
            coalesce(us.current_streak, 0) > 0
         or coalesce(us.longest_streak, 0) > 0
         or us.last_played_date is not null
       )
  )
$$;

revoke all on function public.device_has_importable_history(text) from public, anon, authenticated;


-- ===========================================================================
-- 5. Onboarding
-- ===========================================================================

-- Called by the frontend on every authenticated load, before any board is
-- playable. Cheap for a resolved account (one indexed lookup), and it is what
-- removes the old, fragile habit of trying to infer "was this a signup?" from
-- a client-side auth event type.
--
-- Outcomes:
--   unauthenticated     no session; nothing to do
--   already_resolved    terminal status; proceed to play
--   no_guest_history    auto-resolved just now; proceed to play
--   import_available    pending WITH real history; show the choice
--   credential_invalid  fail closed -- status untouched
--
-- credential_invalid deliberately collapses "unknown device", "wrong token"
-- and "retired identity" into one answer. Distinguishing them would turn this
-- into an oracle for whether a given device id exists, and it must never
-- reveal whether a particular guest history exists. Failing closed also means
-- a bad or missing credential can never silently consume the account's single
-- import opportunity.
create or replace function public.resolve_onboarding(
  _device_id text default null,
  _device_token text default null
)
returns table (
  outcome        text,
  status         text,
  games_played   integer,
  current_streak integer,
  longest_streak integer
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  _uid    uuid := auth.uid();
  _status text;
begin
  outcome := 'unauthenticated';
  status := null;
  games_played := 0;
  current_streak := 0;
  longest_streak := 0;

  if _uid is null then
    return next;
    return;
  end if;

  -- No row means the account did not exist when section 3 classified every
  -- account as legacy, so it is genuinely new. ON CONFLICT DO NOTHING makes
  -- this safe from two tabs at once.
  insert into public.account_onboarding (user_id, status)
  values (_uid, 'pending')
  on conflict (user_id) do nothing;

  select ao.status into _status
    from public.account_onboarding ao
   where ao.user_id = _uid;

  if _status is distinct from 'pending' then
    outcome := 'already_resolved';
    status := _status;
    return next;
    return;
  end if;

  -- A browser with no identity at all cannot be holding guest history. This
  -- is the ordinary "signed up on a fresh browser" path and the path a
  -- legacy browser reaches after replacing its unusable credential.
  if _device_id is null or _device_token is null
     or btrim(_device_id) = '' or _device_id = 'unknown' then
    update public.account_onboarding
       set status = 'no_guest_history', decided_at = now()
     where user_id = _uid and status = 'pending';
    outcome := 'no_guest_history';
    status := 'no_guest_history';
    return next;
    return;
  end if;

  if not public.verify_device(_device_id, _device_token) then
    outcome := 'credential_invalid';
    status := 'pending';
    return next;
    return;
  end if;

  if not public.device_has_importable_history(_device_id) then
    update public.account_onboarding
       set status = 'no_guest_history', decided_at = now()
     where user_id = _uid and status = 'pending';
    outcome := 'no_guest_history';
    status := 'no_guest_history';
    return next;
    return;
  end if;

  outcome := 'import_available';
  status := 'pending';

  select count(*)::integer into games_played
    from public.game_sessions gs
   where gs.device_id = _device_id
     and gs.user_id is null
     and gs.status in ('won', 'lost');

  -- A device can legitimately carry more than one anonymous streak row (there
  -- is no unique constraint on user_streaks.device_id, and production already
  -- contains such pairs), so this picks the strongest rather than assuming
  -- one exists.
  select coalesce(us.current_streak, 0), coalesce(us.longest_streak, 0)
    into current_streak, longest_streak
    from public.user_streaks us
   where us.device_id = _device_id
     and us.user_id is null
   order by coalesce(us.longest_streak, 0) desc, coalesce(us.current_streak, 0) desc
   limit 1;

  current_streak := coalesce(current_streak, 0);
  longest_streak := coalesce(longest_streak, 0);
  return next;
end;
$$;

revoke all on function public.resolve_onboarding(text, text) from public, anon;
grant execute on function public.resolve_onboarding(text, text) to authenticated, service_role;

-- "Add My Progress".
--
-- Transfers ownership of the existing rows IN PLACE. Every game_session_id is
-- preserved; nothing is copied, recreated or re-finalized; no completion side
-- effect runs again. A transferred session is the same play it always was, so
-- puzzle_aggregates is deliberately never touched here: 100 plays before an
-- import are 100 plays after it.
--
-- Where the account somehow already holds an official result for the same
-- puzzle, the ACCOUNT's result wins and the incoming row is demoted to
-- is_official = false in the same statement -- never deleted, never
-- overwritten, and never left in a state that would violate
-- game_sessions_one_official_per_user. (This is the rule established in
-- 20260916230000, carried forward.)
create or replace function public.import_guest_history(
  _device_id text,
  _device_token text
)
returns table (outcome text, sessions_claimed integer)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  _uid  uuid := auth.uid();
  _rows integer;
begin
  outcome := 'unauthenticated';
  sessions_claimed := 0;

  if _uid is null then
    return next;
    return;
  end if;

  if _device_id is null or _device_token is null
     or not public.verify_device(_device_id, _device_token) then
    outcome := 'credential_invalid';
    return next;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('onboarding:' || _uid::text, 0));

  -- The one-time gate. Zero rows means somebody already decided -- another
  -- tab, or an earlier attempt -- so this is a no-op, not an error.
  update public.account_onboarding
     set status = 'imported', decided_at = now(), source_device_id = _device_id
   where user_id = _uid and status = 'pending';
  get diagnostics _rows = row_count;

  if _rows = 0 then
    outcome := 'already_resolved';
    return next;
    return;
  end if;

  update public.game_sessions gs
     set user_id = _uid,
         is_official = case
           when gs.is_official and exists (
             select 1
               from public.game_sessions existing
              where existing.puzzle_id = gs.puzzle_id
                and existing.user_id = _uid
                and existing.status in ('won', 'lost')
                and existing.is_official
           )
           then false
           else gs.is_official
         end
   where gs.device_id = _device_id
     and gs.user_id is null;
  get diagnostics sessions_claimed = row_count;

  -- The streak record moves by CHANGING OWNERSHIP of the existing row. It is
  -- never summed with anything, never reset and never duplicated, so the
  -- player's real streak arrives intact. Only done when the account has no
  -- streak of its own (a genuinely new account never does); if it somehow
  -- does, the account's own row stands and the guest row is simply left
  -- behind, unreachable, rather than merged.
  if not exists (select 1 from public.user_streaks where user_id = _uid) then
    update public.user_streaks
       set user_id = _uid
     where id = (
       select us.id
         from public.user_streaks us
        where us.device_id = _device_id
          and us.user_id is null
        order by coalesce(us.longest_streak, 0) desc,
                 coalesce(us.current_streak, 0) desc,
                 us.updated_at desc nulls last
        limit 1
     );
  end if;

  -- One-way: the source identity is retired, so this history can never be
  -- claimed again by this or any other account.
  update public.device_identities
     set retired_at = now(), retired_reason = 'imported'
   where device_id = _device_id
     and retired_at is null;

  outcome := 'imported';
  return next;
end;
$$;

revoke all on function public.import_guest_history(text, text) from public, anon;
grant execute on function public.import_guest_history(text, text) to authenticated, service_role;

-- "Start Fresh".
--
-- Retires the guest identity and resolves onboarding. It imports nothing and
-- DELETES nothing: the sessions, guesses, hints, outcomes, Rainbow data and
-- timestamps all remain exactly as they are, still anonymous, still counted
-- in site-wide analytics. Declining a play does not un-play it -- 100 plays
-- stay 100.
--
-- Unlike importing, this works even with a missing or unverifiable
-- credential. Declining grants nothing, so it needs no proof of ownership --
-- and that is what lets a browser whose token is broken still resolve its
-- account instead of being stuck pending forever. A device is only retired
-- when ownership was actually proven.
create or replace function public.decline_guest_history(
  _device_id text default null,
  _device_token text default null
)
returns table (outcome text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  _uid    uuid := auth.uid();
  _proven boolean;
  _rows   integer;
begin
  outcome := 'unauthenticated';

  if _uid is null then
    return next;
    return;
  end if;

  _proven := _device_id is not null
         and _device_token is not null
         and public.verify_device(_device_id, _device_token);

  perform pg_advisory_xact_lock(hashtextextended('onboarding:' || _uid::text, 0));

  update public.account_onboarding
     set status = 'started_fresh',
         decided_at = now(),
         source_device_id = case when _proven then _device_id else null end
   where user_id = _uid and status = 'pending';
  get diagnostics _rows = row_count;

  if _rows = 0 then
    outcome := 'already_resolved';
    return next;
    return;
  end if;

  if _proven then
    update public.device_identities
       set retired_at = now(), retired_reason = 'started_fresh'
     where device_id = _device_id
       and retired_at is null;
  end if;

  outcome := 'started_fresh';
  return next;
end;
$$;

revoke all on function public.decline_guest_history(text, text) from public, anon;
grant execute on function public.decline_guest_history(text, text) to authenticated, service_role;


-- ===========================================================================
-- 6. Streaks -- moved off direct table access
--
-- user_streaks loses every direct policy and grant in section 9. These three
-- functions are the entire replacement surface.
-- ===========================================================================

-- The streak rule, transplanted from updateStreak() in gameStats.ts with its
-- behaviour preserved EXACTLY, including the quirk that a first-ever game
-- seeds 1/1 even when it was a loss. This migration is a security change; it
-- is not the place to quietly alter what a streak means.
--
-- _local_date is the PLAYER'S local calendar date, supplied by the client
-- exactly as toLocaleDateString('en-CA') produced it before. Using the
-- server's date instead would silently move every streak boundary to UTC and
-- break streaks for players who are not on it. It is client-supplied, and a
-- player can therefore influence their own streak by changing their device
-- clock -- which was equally true before, and affects nobody else.
--
-- The old code also silently adopted an orphaned device row for a signed-in
-- player with no streak of their own. That is deliberately NOT carried over:
-- ownership transfer now happens once, explicitly, through
-- import_guest_history, so a player who chose Start Fresh can never later
-- absorb the guest streak by accident.
create or replace function public.record_streak(
  _user_id uuid,
  _device_id text,
  _won boolean,
  _local_date text
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
     order by updated_at desc nulls last
     limit 1;
  elsif _device_id is not null and _device_id <> 'unknown' and btrim(_device_id) <> '' then
    select * into _row
      from public.user_streaks
     where device_id = _device_id and user_id is null
     order by updated_at desc nulls last
     limit 1;
  else
    return;
  end if;

  if _row.id is null then
    insert into public.user_streaks (user_id, device_id, current_streak, longest_streak, last_played_date)
    values (_user_id, _device_id, 1, 1, _today);
    return;
  end if;

  -- Already counted today.
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

revoke all on function public.record_streak(uuid, text, boolean, text) from public, anon, authenticated;

-- The caller's own streak. An account reads by auth.uid() and needs no device
-- credential at all; a guest must prove its device. A failed check returns an
-- empty result rather than an error, so it reveals nothing either way.
create or replace function public.get_own_streak(
  _device_id text default null,
  _device_token text default null
)
returns table (current_streak integer, longest_streak integer, last_played_date text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
begin
  if _uid is not null then
    select coalesce(us.current_streak, 0), coalesce(us.longest_streak, 0), us.last_played_date::text
      into current_streak, longest_streak, last_played_date
      from public.user_streaks us
     where us.user_id = _uid
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
   order by coalesce(us.longest_streak, 0) desc
   limit 1;
  if found then
    return next;
  end if;
  return;
end;
$$;

revoke all on function public.get_own_streak(text, text) from public;
grant execute on function public.get_own_streak(text, text) to anon, authenticated, service_role;

-- The Admin dashboard's three streak numbers, which until now came from
-- direct table reads that section 9 removes. Narrowly scoped: it returns
-- three integers and never a row, and it refuses anyone who is not an admin.
--
-- Note these numbers will now be CORRECT. The direct reads they replace were
-- silently filtered by the old SELECT policy to the admin's own row plus
-- anonymous rows, so the "accounts with streaks" count has always been wrong.
create or replace function public.get_streak_admin_summary()
returns table (
  accounts_with_streaks integer,
  max_current_streak    integer,
  max_longest_streak    integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*)::integer from public.user_streaks where user_id is not null),
    (select coalesce(max(current_streak), 0)::integer from public.user_streaks),
    (select coalesce(max(longest_streak), 0)::integer from public.user_streaks)
  where public.has_role(auth.uid(), 'admin')
$$;

revoke all on function public.get_streak_admin_summary() from public, anon;
grant execute on function public.get_streak_admin_summary() to authenticated, service_role;


-- ===========================================================================
-- 7. Gameplay RPCs -- every one now requires a proven device
--
-- Each takes _device_token alongside _device_id and verifies it before doing
-- anything. The old signatures are dropped in section 8; these are new
-- signatures, not replacements, so both exist for the instant between.
-- ===========================================================================

-- The shared capability check. Account-owned sessions are unlocked by
-- auth.uid() alone, exactly as before -- a device credential is deliberately
-- NOT an alternative route into an account's games. Anonymous sessions now
-- require the device to prove itself, which also means a retired identity can
-- no longer touch even its own rows.
create or replace function public.session_capability_ok(
  _session_id uuid,
  _device_id text,
  _device_token text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.game_sessions gs
     where gs.id = _session_id
       and (
         (gs.user_id is not null and gs.user_id = auth.uid())
         or (
           gs.user_id is null
           and gs.device_id = _device_id
           and public.verify_device(_device_id, _device_token)
         )
       )
  )
$$;

revoke all on function public.session_capability_ok(uuid, text, text) from public;
grant execute on function public.session_capability_ok(uuid, text, text) to anon, authenticated, service_role;

-- Session creation, now also the onboarding gate.
--
-- A signed-in caller whose onboarding has not resolved cannot create a
-- session, and therefore cannot generate any account-owned gameplay,
-- statistics or streak. This is the server-side half of "no normal gameplay
-- before onboarding resolves" -- the frontend gate is a courtesy, this is the
-- enforcement. It fails CLOSED: a missing account_onboarding row blocks too,
-- which is why section 3 backfills every existing account.
create or replace function public.create_game_session(
  _puzzle_id text,
  _device_id text,
  _device_token text,
  _entry_context text,
  _active_time_seconds integer default 0,
  _mistakes integer default 0
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  _id  uuid;
  _uid uuid := auth.uid();
begin
  if not public.verify_device(_device_id, _device_token) then
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

  insert into public.game_sessions (
    puzzle_id, user_id, device_id, entry_context,
    status, won, completed_at, started_at, last_activity_at,
    active_time_seconds, mistakes, found_rainbow, hints_used
  ) values (
    _puzzle_id, _uid, _device_id, _entry_context,
    'in_progress', null, null, now(), now(),
    coalesce(_active_time_seconds, 0), coalesce(_mistakes, 0), false, false
  )
  returning id into _id;

  return _id;
end;
$$;

revoke all on function public.create_game_session(text, text, text, text, integer, integer) from public;
grant execute on function public.create_game_session(text, text, text, text, integer, integer) to anon, authenticated, service_role;

create or replace function public.touch_game_session(
  _session_id uuid,
  _device_id text,
  _device_token text,
  _active_time_seconds integer,
  _mistakes integer
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  found boolean;
begin
  if not public.session_capability_ok(_session_id, _device_id, _device_token) then
    return false;
  end if;

  update public.game_sessions
     set last_activity_at = now(),
         active_time_seconds = coalesce(_active_time_seconds, active_time_seconds),
         mistakes = coalesce(_mistakes, mistakes)
   where id = _session_id
     and status = 'in_progress';

  get diagnostics found = row_count;
  return found;
end;
$$;

revoke all on function public.touch_game_session(uuid, text, text, integer, integer) from public;
grant execute on function public.touch_game_session(uuid, text, text, integer, integer) to anon, authenticated, service_role;

-- Formal completion -- now the single trusted completion transaction.
--
-- It still decides is_official itself, from the session's own stored
-- identity, and is still restricted to status = 'in_progress' so a finished
-- game can never be re-finalized. What is new is that the three side effects
-- that used to be separate client calls happen HERE, inside the same
-- transaction and behind the same one-shot status transition:
--
--   * puzzle_aggregates   (was: a separate increment_puzzle_aggregate call)
--   * game_results        (was: a direct client upsert)
--   * user_streaks        (was: a direct client read-modify-write)
--
-- That is what makes completion retry-safe. Previously a retry re-ran the
-- aggregate call and double-counted a play, and a crash between the two calls
-- lost one; now the row_count guard below means the side effects run exactly
-- once, on the transition that actually happened.
--
-- Each side effect is wrapped in its own exception block. That is deliberate
-- and preserves prior fault isolation: these were client-side calls in
-- try/catch, and a failing analytics write must never cost a player their
-- finished game. The trade is unchanged from before -- a failed side effect
-- is simply not retried.
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

  select gs.puzzle_id, gs.user_id, gs.device_id
    into _puzzle_id, _user_id, _session_device
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

  -- =====================================================================
  -- REQUIRED COMPLETION EFFECTS
  --
  -- None of the three below is wrapped in an exception handler, and that is
  -- deliberate. They run in THIS transaction, so if any of them fails the
  -- session's completion rolls back with it and the row stays in_progress.
  --
  -- That is the whole point. The old arrangement made these separate client
  -- calls AFTER finalization, so a failure left a permanently completed
  -- session with no play counted -- and no way to repair it, because a retry
  -- finds the session already finished and stops. Swallowing the error here
  -- would rebuild exactly that hole inside the new function.
  --
  -- Rolling back is safe to retry precisely because the whole thing is
  -- guarded by the in_progress -> won/lost transition: a rolled-back attempt
  -- leaves the session retryable, and an attempt that actually committed
  -- makes every later attempt a no-op. So the play is counted exactly once,
  -- never zero times and never twice.
  -- =====================================================================

  -- ---- required effect 1: site-wide aggregates --------------------------
  -- Same +1-per-official-completion definition and the same running-average
  -- arithmetic as the standalone function this replaces. The advisory lock is
  -- new: that function was a read-then-write with no serialization, so two
  -- simultaneous completions of the same puzzle could both read the same
  -- total and write the same value, losing a play.
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
  -- OFFICIAL completion by a SIGNED-IN player. Anonymous play has never
  -- written this table, which is why get_puzzle_stats() -- and the Daily
  -- Stats modal it feeds -- reports signed-in players only. That is
  -- deliberately preserved here; changing it is a separate product decision.
  --
  -- The two PRECONDITIONS are what make this safe to make mandatory, and
  -- they are checks rather than a swallowed exception, so anything they do
  -- not cover still rolls the transaction back:
  --
  --   * game_sessions.puzzle_id is TEXT while game_results.puzzle_id is
  --     UUID, so a non-UUID puzzle id would fail the cast.
  --   * game_results.puzzle_id has an FK to puzzles(id) ON DELETE CASCADE,
  --     and the Admin screen can delete a puzzle. A result row for a deleted
  --     puzzle is one the FK would have removed anyway.
  --
  -- Without these, a player finishing a game whose puzzle had been deleted
  -- could never complete it -- an analytics row blocking real gameplay,
  -- which is a worse failure than the one this section fixes.
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
  -- Archive games still do not touch streaks.
  if not coalesce(_skip_streak, false) then
    perform public.record_streak(_user_id, _session_device, _won, _local_date);
  end if;

  return true;
end;
$$;

revoke all on function public.finalize_game_session(uuid, text, text, boolean, integer, integer, boolean, smallint, jsonb, boolean, text, boolean, text) from public;
grant execute on function public.finalize_game_session(uuid, text, text, boolean, integer, integer, boolean, smallint, jsonb, boolean, text, boolean, text) to anon, authenticated, service_role;

create or replace function public.record_guess_events(
  _session_id uuid,
  _device_id text,
  _device_token text,
  _events jsonb
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  _inserted integer;
begin
  if not public.session_capability_ok(_session_id, _device_id, _device_token) then
    return null;
  end if;

  with rows as (
    insert into public.guess_events (
      game_session_id, guess_number, words, correct, group_name, guessed_at,
      is_rainbow_attempt, attempt_type, is_one_away, is_almost_rainbow,
      active_time_seconds, groups_solved
    )
    select
      _session_id,
      (e ->> 'guess_number')::integer,
      e -> 'words',
      (e ->> 'correct')::boolean,
      e ->> 'group_name',
      (e ->> 'guessed_at')::timestamptz,
      (e ->> 'is_rainbow_attempt')::boolean,
      'normal',
      (e ->> 'is_one_away')::boolean,
      (e ->> 'is_almost_rainbow')::boolean,
      (e ->> 'active_time_seconds')::integer,
      (e ->> 'groups_solved')::smallint
      from jsonb_array_elements(_events) as e
    on conflict (game_session_id, guess_number) do nothing
    returning 1
  )
  select count(*)::integer into _inserted from rows;

  return _inserted;
end;
$$;

revoke all on function public.record_guess_events(uuid, text, text, jsonb) from public;
grant execute on function public.record_guess_events(uuid, text, text, jsonb) to anon, authenticated, service_role;

create or replace function public.record_hint_event(
  _session_id uuid,
  _device_id text,
  _device_token text,
  _hint_type text,
  _revealed_at timestamptz,
  _active_time_seconds integer,
  _guess_count smallint,
  _mistakes smallint,
  _groups_solved smallint,
  _rainbow_found boolean
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.session_capability_ok(_session_id, _device_id, _device_token) then
    return false;
  end if;

  insert into public.hint_events (
    game_session_id, hint_type, revealed_at, active_time_seconds,
    guess_count, mistakes, groups_solved, rainbow_found
  ) values (
    _session_id, _hint_type, coalesce(_revealed_at, now()), _active_time_seconds,
    _guess_count, _mistakes, _groups_solved, _rainbow_found
  )
  on conflict (game_session_id, hint_type) do nothing;

  return true;
end;
$$;

revoke all on function public.record_hint_event(uuid, text, text, text, timestamptz, integer, smallint, smallint, smallint, boolean) from public;
grant execute on function public.record_hint_event(uuid, text, text, text, timestamptz, integer, smallint, smallint, smallint, boolean) to anon, authenticated, service_role;

create or replace function public.record_bonus_rainbow(
  _session_id uuid,
  _device_id text,
  _device_token text,
  _guess_number integer,
  _words jsonb,
  _correct boolean,
  _guessed_at timestamptz,
  _active_time_seconds integer,
  _groups_solved smallint
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.session_capability_ok(_session_id, _device_id, _device_token) then
    return false;
  end if;

  if not exists (
    select 1 from public.game_sessions
     where id = _session_id and status in ('won', 'lost')
  ) then
    return false;
  end if;

  insert into public.guess_events (
    game_session_id, guess_number, words, correct, group_name,
    is_rainbow_attempt, attempt_type, guessed_at, active_time_seconds,
    groups_solved
  ) values (
    _session_id, _guess_number, _words, _correct, null,
    true, 'bonus_rainbow', coalesce(_guessed_at, now()), _active_time_seconds,
    _groups_solved
  )
  on conflict (game_session_id, guess_number) do nothing;

  update public.game_sessions
     set bonus_rainbow_attempted = true,
         found_rainbow = case when _correct then true else found_rainbow end,
         rainbow_source = case when _correct then 'post_game' else rainbow_source end,
         rainbow_solve_index = case when _correct then 4::smallint else rainbow_solve_index end
   where id = _session_id
     and status in ('won', 'lost')
     and not coalesce(found_rainbow, false);

  return true;
end;
$$;

revoke all on function public.record_bonus_rainbow(uuid, text, text, integer, jsonb, boolean, timestamptz, integer, smallint) from public;
grant execute on function public.record_bonus_rainbow(uuid, text, text, integer, jsonb, boolean, timestamptz, integer, smallint) to anon, authenticated, service_role;

-- Own-data reads.
--
-- CRITICAL and easy to get wrong: the device check applies ONLY to the
-- anonymous branch. An account reads its own rows by auth.uid() alone, so
-- history that was imported keeps showing up after its source device is
-- retired. Retirement hides a guest profile from itself; it must never hide
-- an account's own sessions, guesses, hints or statistics.
create or replace function public.has_official_result(
  _puzzle_id text,
  _device_id text,
  _device_token text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.game_sessions
     where puzzle_id = _puzzle_id
       and status in ('won', 'lost')
       and is_official
       and (
         (auth.uid() is not null and user_id = auth.uid())
         or (
           user_id is null
           and device_id = _device_id
           and public.verify_device(_device_id, _device_token)
         )
       )
  )
$$;

revoke all on function public.has_official_result(text, text, text) from public;
grant execute on function public.has_official_result(text, text, text) to anon, authenticated, service_role;

create or replace function public.get_own_completed_sessions(
  _device_id text default null,
  _device_token text default null
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
     and (
       (auth.uid() is not null and gs.user_id = auth.uid())
       or (
         gs.user_id is null
         and gs.device_id = _device_id
         and public.verify_device(_device_id, _device_token)
       )
     )
$$;

revoke all on function public.get_own_completed_sessions(text, text) from public;
grant execute on function public.get_own_completed_sessions(text, text) to anon, authenticated, service_role;

create or replace function public.count_own_anonymous_sessions(
  _device_id text,
  _device_token text
)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
    from public.game_sessions
   where user_id is null
     and status in ('won', 'lost')
     and device_id = _device_id
     and public.verify_device(_device_id, _device_token)
$$;

revoke all on function public.count_own_anonymous_sessions(text, text) from public;
grant execute on function public.count_own_anonymous_sessions(text, text) to anon, authenticated, service_role;


-- ===========================================================================
-- 8. Retire the superseded functions
--
-- Dropped by exact old signature, AFTER the replacements above exist. These
-- are the entry points that accepted a bare device_id as authority.
-- claim_anonymous_sessions goes entirely: import_guest_history does its job
-- behind a proven credential and a one-time gate, and leaving a second
-- claiming route alive would leave the harvest-a-device-id attack open.
-- ===========================================================================
drop function if exists public.claim_anonymous_sessions(text);
drop function if exists public.create_game_session(text, text, text, integer, integer);
drop function if exists public.session_capability_ok(uuid, text);
drop function if exists public.touch_game_session(uuid, text, integer, integer);
drop function if exists public.finalize_game_session(uuid, text, boolean, integer, integer, boolean, smallint, jsonb, boolean, text);
drop function if exists public.record_guess_events(uuid, text, jsonb);
drop function if exists public.record_hint_event(uuid, text, text, timestamptz, integer, smallint, smallint, smallint, boolean);
drop function if exists public.record_bonus_rainbow(uuid, text, integer, jsonb, boolean, timestamptz, integer, smallint);
drop function if exists public.has_official_result(text, text);
drop function if exists public.get_own_completed_sessions(text);
drop function if exists public.count_own_anonymous_sessions(text);


-- ===========================================================================
-- 9. Lock down direct table access
--
-- Strictly table-by-table and privilege-by-privilege. Nothing schema-wide,
-- and nothing belonging to the other applications in this project.
--
-- SELECT grants and the existing own/admin SELECT policies are left ALONE on
-- game_sessions, guess_events, hint_events and game_results, so the Admin
-- dashboard keeps working unchanged. Only write access goes.
-- ===========================================================================

-- The last direct write route into gameplay: a client could insert a
-- fully-formed completed row, which the sync trigger would even stamp
-- is_official for -- bypassing create_game_session and its onboarding gate.
drop policy if exists "Users can insert own or anonymous game sessions" on public.game_sessions;

-- The confirmed exposure: readable and writable by anyone, including the
-- path that let an authenticated caller flip a stranger's anonymous row onto
-- their own account.
drop policy if exists "Users can insert own streaks" on public.user_streaks;
drop policy if exists "Users can read own streaks"   on public.user_streaks;
drop policy if exists "Users can update own streaks" on public.user_streaks;

-- game_results is now written only by finalize_game_session.
drop policy if exists "Users can insert own results" on public.game_results;
drop policy if exists "Users can update own results" on public.game_results;

revoke insert, update, delete, truncate on public.game_sessions from anon, authenticated;
revoke insert, update, delete, truncate on public.guess_events  from anon, authenticated;
revoke insert, update, delete, truncate on public.hint_events   from anon, authenticated;
revoke insert, update, delete, truncate on public.game_results  from anon, authenticated;
revoke all on public.user_streaks from anon, authenticated;

-- Aggregates are now maintained exclusively inside finalize_game_session. A
-- client calling this directly could inflate total_plays and skew every
-- average with values of its choosing. Revoked by name so the exact argument
-- list cannot make this miss.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'increment_puzzle_aggregate'
  loop
    execute format('revoke all on function %s from anon, authenticated, public', r.sig);
  end loop;
end
$$;


-- ===========================================================================
-- 10. Self-verifying guard
--
-- The migration runs in one transaction, so raising here rolls the whole file
-- back rather than leaving the schema half-applied.
-- ===========================================================================
do $$
declare
  n integer;
begin
  -- Every account must be classified, or create_game_session's fail-closed
  -- gate would lock a real player out.
  select count(*) into n
    from auth.users u
   where not exists (select 1 from public.account_onboarding ao where ao.user_id = u.id);
  if n > 0 then
    raise exception 'Aborting: % existing account(s) were not classified.', n;
  end if;

  -- Every pre-existing device identity must be registered AND retired.
  select count(*) into n
    from (
      select device_id from public.game_sessions
      union
      select device_id from public.user_streaks
    ) d
   where d.device_id is not null
     and btrim(d.device_id) <> ''
     and d.device_id <> 'unknown'
     and not exists (
       select 1 from public.device_identities di
        where di.device_id = d.device_id and di.retired_at is not null
     );
  if n > 0 then
    raise exception 'Aborting: % pre-cutover device id(s) are not retired.', n;
  end if;

  -- No pre-cutover identity may carry a usable credential.
  select count(*) into n
    from public.device_identities
   where retired_reason = 'pre_launch_cutover' and token_hash is not null;
  if n > 0 then
    raise exception 'Aborting: % retired legacy identity(ies) have a token hash.', n;
  end if;

  -- The claiming route that accepted a bare device id must be gone.
  if exists (
    select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = 'claim_anonymous_sessions'
  ) then
    raise exception 'Aborting: claim_anonymous_sessions still exists.';
  end if;
end
$$;


-- ###########################################################################
-- END migration text.
--
-- Everything above either lands together or not at all. This is the only
-- statement that makes it permanent.
-- ###########################################################################
commit;
