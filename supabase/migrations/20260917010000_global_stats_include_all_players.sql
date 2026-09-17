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
-- touched. The response shape, grants, and security properties of
-- get_puzzle_stats are unchanged: same JSON keys, same aggregate-only
-- output, same SECURITY DEFINER function replaced in place by name and
-- signature, which preserves whatever grants already exist on it.
-- ===========================================================================

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

comment on function public.get_puzzle_stats(uuid) is
  'Aggregate-only per-puzzle stats for the "Global Stats" UI: every official completed session (anonymous + signed-in, wins + losses), across game_sessions. Never exposes individual rows.';
