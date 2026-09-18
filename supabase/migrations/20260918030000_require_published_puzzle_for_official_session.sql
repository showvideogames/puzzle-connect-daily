-- ===========================================================================
-- create_game_session -- require the puzzle to actually be Published
--
-- THE GAP
-- -------
-- create_game_session (redefined most recently in
-- 20260917120000_puzzle_content_versioning.sql) verifies the device and, for
-- a signed-in caller, the onboarding gate -- but never checks the referenced
-- puzzle's status at all. As of 20260917000000 section 9, it is also the
-- ONLY way anon/authenticated can insert into game_sessions: the legacy
-- direct-INSERT policy was dropped and INSERT/UPDATE/DELETE were revoked
-- from both roles outright. So nothing server-side stopped a caller who
-- simply knew (or enumerated) a Draft or Beta puzzle's id from getting a
-- real, official, is_official-eligible game_sessions row for it -- entirely
-- independent of what the frontend happens to call. The /beta feature's
-- claim that "a Beta puzzle cannot produce a game_sessions row" was true only
-- because the client never asked for one; the database did not enforce it.
--
-- THE FIX
-- -------
-- One additional check, in the one function that is the sole creation path:
-- the referenced puzzle must have is_published = true. Since Draft
-- (is_published = false, is_beta = false) and Beta (is_published = false,
-- is_beta = true) both fail this, one condition covers both without needing
-- to know about is_beta at all -- the same trick puzzles.is_published
-- already plays for the public read policies.
--
-- Refuses via the SAME idiom the function already uses for a failed device
-- check or a pending-onboarding account: returns NULL rather than raising.
-- The client already treats a NULL id as "session creation failed" (see
-- createGameSession in lib/gameSession.ts) and degrades to an unsaved game
-- rather than breaking play -- exactly the behavior a puzzle that should
-- never have had an official session reachable in the first place deserves.
--
-- WHAT THIS DELIBERATELY DOES NOT TOUCH
-- --------------------------------------
-- touch_game_session, finalize_game_session, record_guess_events and
-- record_hint_event are untouched. They authorize purely by
-- session_capability_ok (device/account ownership of an EXISTING
-- _session_id), never by re-checking the puzzle's current status. That is
-- what keeps this guard scoped to the moment of creation only: a session
-- that was validly created while its puzzle was Published keeps working
-- exactly as before even if an admin later drafts, edits or (were it ever
-- possible) betas that same puzzle. Only the creation of a NEW official
-- session for a not-currently-published puzzle is refused.
--
-- Same signature as the live function (7 args, unchanged) -- CREATE OR
-- REPLACE, no new overload, so PostgREST has nothing new to disambiguate.
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
begin
  if not public.verify_device(_device_id, _device_token) then
    return null;
  end if;

  -- Compared as text for the same reason the version check below does:
  -- game_sessions.puzzle_id is text, not guaranteed to be a parseable uuid,
  -- and casting IT would raise instead of simply failing the check. Casting
  -- puzzles.id (a real uuid) to text is always safe.
  if not exists (
    select 1 from public.puzzles p
     where p.id::text = _puzzle_id
       and p.is_published = true
  ) then
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
    active_time_seconds, mistakes, found_rainbow, hints_used
  ) values (
    _puzzle_id, _version, _uid, _device_id, _entry_context,
    'in_progress', null, null, now(), now(),
    coalesce(_active_time_seconds, 0), coalesce(_mistakes, 0), false, false
  )
  returning id into _id;

  return _id;
end;
$$;

revoke all on function public.create_game_session(text, text, text, text, integer, integer, uuid) from public;
grant execute on function public.create_game_session(text, text, text, text, integer, integer, uuid) to anon, authenticated, service_role;

comment on function public.create_game_session(text, text, text, text, integer, integer, uuid) is
  'Creates an in_progress official session, pinned to the puzzle version the player''s board was built from. Refuses (returns NULL) for a device that cannot be verified, a puzzle that is not currently Published (covers Draft and Beta alike), or a signed-in account still pending onboarding. A session already created while its puzzle WAS published is never retroactively affected by a later status change -- only creation is gated here.';
