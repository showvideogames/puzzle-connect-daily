-- ===========================================================================
-- Fix: claim_anonymous_sessions must never contest an existing official
-- account result.
--
-- Follow-up to 20260916150000_durable_sessions_and_hint_events.sql and
-- 20260916220000_legacy_insert_official_parity.sql. Does not touch either of
-- those files, and makes no unrelated schema change.
--
-- THE BUG
-- -------
-- claim_anonymous_sessions blindly reassigned every unclaimed
-- (user_id IS NULL) row on a device to the signing-in account:
--
--   update public.game_sessions
--      set user_id = auth.uid()
--    where device_id = _device_id
--      and user_id is null;
--
-- Scenario: a player completes puzzle X while signed in (their account now
-- holds the official result). Later, on a different device/browser, they
-- play puzzle X again anonymously and that session ALSO becomes official for
-- its anonymous identity (game_sessions_one_official_per_device allows at
-- most one such row per device+puzzle). They then sign into their existing
-- account and this function runs.
--
-- Reassigning that anonymous row's user_id, unchanged, tries to create a
-- SECOND is_official=true row for the same (puzzle_id, user_id) and collides
-- with game_sessions_one_official_per_user -- a 23505 unique violation.
-- Because a single UPDATE statement is all-or-nothing, the failure is
-- non-destructive (nothing gets half-claimed), but the entire import for
-- that device silently fails: puzzles that don't collide never get attached
-- to the account either.
--
-- THE RULE
-- --------
-- The first completed official result for an identity is permanent
-- (established by finalize_game_session and the legacy-insert trigger in the
-- two migrations above). Claiming anonymous history at sign-in must never
-- override that, no matter which result is "better":
--
--   account already has an official result for puzzle X
--     -> the account's existing result stays official, untouched
--     -> the claimed anonymous row for puzzle X is demoted to
--        is_official = false in the SAME statement that assigns its
--        user_id, so the table is never in a state that would violate the
--        unique index
--
--   account has no official result for puzzle X yet
--     -> the claimed anonymous row (if it was official on the device) keeps
--        is_official = true and becomes the account's official result
--
-- No row is ever deleted. No gameplay field (mistakes, active_time_seconds,
-- found_rainbow, solve_order, hints_used, entry_context, timestamps, ...) is
-- touched. guess_events and hint_events are untouched -- they key off
-- game_session_id, which never changes. An in_progress session is never
-- finalized or promoted by this function; its is_official stays false
-- (already false by construction: is_official is only ever set true at
-- completion) and it transfers to the account exactly as before, so resuming
-- it after claim still works (session_capability_ok recognises the caller by
-- auth.uid() once user_id is set, independent of device_id).
--
-- Multiple claimable completed sessions for the SAME puzzle on one device
-- are not re-adjudicated here. game_sessions_one_official_per_device already
-- guarantees at most one of them is is_official = true (finalize_game_session
-- and the legacy-insert trigger both apply "first completed attempt wins" at
-- completion time), so this function only ever needs to decide whether THAT
-- one row keeps or loses official status -- it never invents an ordering of
-- its own.
--
-- CONCURRENCY
-- -----------
-- An advisory lock keyed on the calling account serializes overlapping calls
-- to this function for the same account (a double-invocation from two tabs,
-- an accidental retry). Within one call the UPDATE is a single statement, so
-- every row's "does this account already have an official result for this
-- puzzle" check reads one consistent pre-statement snapshot -- the same
-- reasoning finalize_game_session and the legacy-insert trigger already rely
-- on for this table. The partial unique indexes remain the hard backstop
-- either way: if that reasoning is ever wrong, the transaction fails loudly
-- rather than silently duplicating an official result.
-- ===========================================================================

create or replace function public.claim_anonymous_sessions(_device_id text)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  _claimed integer;
  _uid uuid := auth.uid();
begin
  if _uid is null then
    return 0;
  end if;
  if _device_id is null or _device_id = 'unknown' then
    return 0;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('claim:' || _uid::text, 0));

  update public.game_sessions gs
     set user_id = _uid,
         -- Demote only if BOTH: this row is currently official, AND the
         -- account already owns a completed official result for the same
         -- puzzle. Every other row (already non-official, or official with
         -- no existing account result to contest) passes through unchanged.
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

  get diagnostics _claimed = row_count;
  return _claimed;
end;
$$;

revoke all on function public.claim_anonymous_sessions(text) from public;
grant execute on function public.claim_anonymous_sessions(text) to authenticated, service_role;

comment on function public.claim_anonymous_sessions(text) is
  'Moves an authenticated caller''s anonymous game_sessions rows for _device_id onto their account. Never overrides an existing official result: a claimed row that would collide with one is demoted to is_official = false in the same statement, never deleted or otherwise altered. Requires auth.uid(); a device already owned by another account is never touched.';
