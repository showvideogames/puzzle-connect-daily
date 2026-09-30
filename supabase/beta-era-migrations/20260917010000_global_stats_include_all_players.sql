-- ===========================================================================
-- Global Stats: count every official completed play, not just signed-in ones
--
-- THE BUG
-- -------
-- The player-facing "Global Stats" button (GameBoard -> DailyStatsModal)
-- calls get_puzzle_stats(), which has read public.game_results since it was
-- created. game_results is written only for a SIGNED-IN player's official
-- completion (see finalize_game_session, "required effect 2"), so Global
-- Stats has always silently excluded every anonymous play. On a game whose
-- daily audience is mostly anonymous, that is most of the audience.
--
-- THE FIX
-- -------
-- Read public.game_sessions instead: it is the complete population, written
-- for every player regardless of sign-in state. The three filters below are
-- exactly what "official completed play" means today:
--
--   * puzzle_id = the requested puzzle
--   * is_official          -- excludes non-official replays. A player's
--                             first completed attempt is official; any later
--                             replay is not (finalize_game_session decides
--                             this once, at completion, and it is enforced
--                             by a partial unique index per puzzle+identity).
--   * status in ('won','lost') -- excludes in_progress sessions.
--
-- No further de-duplication is needed. A session row is written once and
-- only updated in place by touch_game_session/finalize_game_session -- there
-- is no path that inserts a second row for the same attempt, so counting
-- rows already counts plays, not writes. The onboarding transfer in
-- import_guest_history changes a row's user_id; it does not insert or
-- delete a row, so a play counted before an import is the same play counted
-- after it, and Start Fresh (which never touches game_sessions) cannot
-- remove one either.
--
-- NOT IN SCOPE
-- ------------
-- game_results itself is untouched -- Admin's own per-puzzle panel and any
-- other reader of it are unaffected, and it is not being retired here.
-- "My Stats" reads a different RPC (get_own_completed_sessions) and is not
-- touched. The response shape and security properties of get_puzzle_stats
-- are unchanged: same argument type, same JSON keys, same aggregate-only
-- output, same LANGUAGE sql / RETURNS json / STABLE / SECURITY DEFINER /
-- SET search_path = public -- every one restated explicitly below rather
-- than left to CREATE OR REPLACE defaults, precisely because this function
-- is SECURITY DEFINER and reads a table anonymous callers cannot read
-- directly. A safe search_path is what stops that elevated body from being
-- tricked into resolving an object from a different, attacker-controlled
-- schema; STABLE is unchanged so the planner still knows this is read-only
-- within one statement.
--
-- ANONYMOUS ACCESS
-- -----------------
-- Anonymous players have no SELECT policy on game_sessions -- that is by
-- design, from the durable-session migration. This function is what lets
-- them see Global Stats anyway: SECURITY DEFINER runs its body as the
-- function's owner, which owns game_sessions and so is not subject to that
-- table's grants (a table owner is exempt from its own table's privilege
-- checks; RLS is a separate, table-level mechanism this function does not
-- touch either way, since access here is being narrowed by grants on the
-- FUNCTION, the same pattern has_official_result and
-- get_own_completed_sessions already use for the same table). The EXECUTE
-- grant below is what actually admits anon -- SECURITY DEFINER alone does
-- not; a role still needs permission to invoke the function at all.
--
-- The function was previously never named in any revoke/grant statement, so
-- it ran on Postgres's default: EXECUTE granted to PUBLIC (every role,
-- including ones with no reason to call it) and never revoked. That
-- happened to keep working, but it was never verified, and it is broader
-- than necessary. Narrowed here to the same three roles every comparable
-- read RPC in this codebase grants, with the same revoke-then-grant shape,
-- so it no longer depends on an implicit default nothing else in this
-- codebase relies on. Only aggregate counts are returned -- no player,
-- device, account, session, or guess-level data leaves this function.
--
-- STRAY OVERLOAD
-- ---------------
-- Live verification after this file was first applied found a SECOND
-- get_puzzle_stats, taking a text argument, that no migration in this repo
-- ever created -- Lovable-side drift, the same way several tables in this
-- project exist with no creating migration. With two same-named,
-- same-arity overloads, PostgREST could not tell them apart from the wire
-- format and returned PGRST203 for every caller, so the RPC was completely
-- uncallable until the text overload was dropped by hand in the SQL
-- Editor. Recorded here so this file is what actually needs to run for a
-- clean environment to end up in the same state production is in now, and
-- so the conflict cannot silently reappear from replaying this migration
-- elsewhere.
-- ===========================================================================

drop function if exists public.get_puzzle_stats(text);

create or replace function public.get_puzzle_stats(_puzzle_id uuid)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'total_players', count(*)::int,
    'wins', count(*) filter (where won)::int,
    'losses', count(*) filter (where not won)::int,
    'guess_distribution', json_build_object(
      '0', count(*) filter (where won and mistakes = 0)::int,
      '1', count(*) filter (where won and mistakes = 1)::int,
      '2', count(*) filter (where won and mistakes = 2)::int,
      '3', count(*) filter (where won and mistakes = 3)::int
    )
  )
  from public.game_sessions
  where puzzle_id = _puzzle_id::text
    and is_official
    and status in ('won', 'lost')
$$;

revoke all on function public.get_puzzle_stats(uuid) from public;
grant execute on function public.get_puzzle_stats(uuid) to anon, authenticated, service_role;

comment on function public.get_puzzle_stats(uuid) is
  'Aggregate-only per-puzzle stats for the "Global Stats" UI: every official completed session (anonymous + signed-in, wins + losses), across game_sessions. Never exposes individual rows.';
