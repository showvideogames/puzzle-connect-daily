-- Forward-only Best No-Hint Streak. No history is reset or backfilled.
-- Null order means completed before tracking; null qualification is unknown.
-- Sequence gaps (rollback, replay, other format) never imply a missed game.
BEGIN;
ALTER TABLE public.game_sessions ADD COLUMN no_hint_completion_order bigint;
ALTER TABLE public.game_sessions ADD COLUMN no_hint_qualified boolean;
CREATE SEQUENCE public.no_hint_completion_order_seq AS bigint;
REVOKE ALL ON SEQUENCE public.no_hint_completion_order_seq FROM PUBLIC, anon, authenticated;
CREATE UNIQUE INDEX game_sessions_no_hint_order_unique ON public.game_sessions(no_hint_completion_order) WHERE no_hint_completion_order IS NOT NULL;

CREATE FUNCTION public.stamp_no_hint_completion() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _owner text;
BEGIN
  -- Completed rows retain their first order/qualification through retries,
  -- bonus writes and ownership transfers. Read-time checks include late hints.
  IF TG_OP = 'UPDATE' AND OLD.status IN ('won', 'lost') THEN
    NEW.no_hint_completion_order := OLD.no_hint_completion_order;
    NEW.no_hint_qualified := OLD.no_hint_qualified;
    RETURN NEW;
  END IF;
  NEW.no_hint_completion_order := NULL;
  IF NEW.status IN ('won', 'lost') THEN
    _owner := CASE WHEN NEW.user_id IS NOT NULL THEN 'u:' || NEW.user_id::text ELSE 'd:' || coalesce(NEW.device_id, NEW.id::text) END;
    -- Serializes acceptance order within an owner/format until transaction
    -- end; timestamps, local clocks and calendar gaps are not used.
    PERFORM pg_advisory_xact_lock(hashtextextended('no_hint:' || _owner || ':' || NEW.format, 0));
    NEW.no_hint_completion_order := nextval('public.no_hint_completion_order_seq');
    -- Legacy direct completed INSERTs lack explicit completion-time evidence.
    IF TG_OP = 'INSERT' THEN NEW.no_hint_qualified := NULL; END IF;
  ELSE
    NEW.no_hint_qualified := NULL;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.stamp_no_hint_completion() FROM PUBLIC, anon, authenticated;
-- Alphabetically after the existing status-normalizing BEFORE trigger.
CREATE TRIGGER zz_stamp_no_hint_completion BEFORE INSERT OR UPDATE ON public.game_sessions
FOR EACH ROW EXECUTE FUNCTION public.stamp_no_hint_completion();

CREATE OR REPLACE FUNCTION public.finalize_game_session(_session_id uuid, _device_id text, _device_token text, _won boolean, _mistakes integer, _active_time_seconds integer, _found_rainbow boolean, _rainbow_solve_index smallint, _solve_order jsonb, _hints_used boolean, _share_grid text, _skip_streak boolean DEFAULT false, _local_date text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  _puzzle_id      text;
  _user_id        uuid;
  _session_device text;
  _session_format text;
  _is_official    boolean;
  _identity       text;
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
     and gs.status = 'in_progress'
   FOR UPDATE;

  -- Ownership can change while waiting for an import or another completion.
  -- Recheck capability against the locked, current row before any write.
  if not public.session_capability_ok(_session_id, _device_id, _device_token) then
    return null;
  end if;

  if _puzzle_id is null then
    return null;
  end if;

  -- Match the baseline completed-INSERT lock, BEFORE classifying official.
  -- The unique indexes prevent duplicate officials, but without this lock a
  -- racing completion fails with 23505 instead of completing as a replay.
  -- Lock order: session row -> puzzle/owner -> no-hint owner/format trigger.
  _identity := case when _user_id is not null then 'u:' || _user_id::text
                    else 'd:' || _session_device end;
  perform pg_advisory_xact_lock(hashtextextended(coalesce(_puzzle_id, '') || '|' || _identity, 0));

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
           and other.user_id is null
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
         no_hint_qualified = case
           when not _won or _hints_used is true then false
           when _hints_used is false then true
           else null
         end,
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

  -- (The beta-era game_results mirror that used to be written here is gone:
  -- game_sessions is the single record of a play.)

  -- ---- required effect 3: streak ----------------------------------------
  -- Archive games still do not touch streaks. The format comes from the
  -- SESSION, so a Mini completion can only ever move the Mini streak.
  if not coalesce(_skip_streak, false) then
    perform public.record_streak(_user_id, _session_device, _won, _local_date, coalesce(_session_format, 'full'));
  end if;

  return true;
end;
$_$;


-- Same completion/ownership/format filter as personal stats. Baseline rows
-- have no order and are intentionally absent. Replays are never included.
CREATE FUNCTION public.no_hint_history_for_owner(_device_id text DEFAULT NULL, _device_token text DEFAULT NULL, _format text DEFAULT 'full')
RETURNS TABLE(completion_order text, qualified boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT gs.no_hint_completion_order::text,
         CASE WHEN gs.won IS FALSE OR gs.hints_used IS TRUE OR EXISTS (
           SELECT 1 FROM public.hint_events he WHERE he.game_session_id = gs.id
         ) THEN false ELSE gs.no_hint_qualified END
    FROM public.game_sessions gs
   WHERE gs.status IN ('won', 'lost') AND gs.is_official
     AND gs.no_hint_completion_order IS NOT NULL
     AND gs.format = coalesce(nullif(btrim(coalesce(_format, '')), ''), 'full')
     AND ((public.rainbow_uid() IS NOT NULL AND gs.user_id = public.rainbow_uid())
       OR (gs.user_id IS NULL AND gs.device_id = _device_id AND public.verify_device(_device_id, _device_token)))
   ORDER BY gs.no_hint_completion_order;
$$;
REVOKE ALL ON FUNCTION public.no_hint_history_for_owner(text,text,text) FROM PUBLIC, anon, authenticated, service_role;

-- Aggregate on the server so PostgREST's row limit cannot truncate a long
-- streak history. The helper is private; only this one-row RPC is exposed.
CREATE FUNCTION public.get_own_no_hint_streak(_device_id text DEFAULT NULL, _device_token text DEFAULT NULL, _format text DEFAULT 'full')
RETURNS TABLE(best integer, tracked integer, unknown integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH history AS (
    SELECT * FROM public.no_hint_history_for_owner(_device_id,_device_token,_format)
  ), runs AS (
    SELECT qualified, count(*) FILTER (WHERE qualified IS NOT TRUE)
      OVER (ORDER BY completion_order::bigint) AS run_id FROM history
  ), lengths AS (
    SELECT count(*) FILTER (WHERE qualified IS TRUE)::integer AS n FROM runs GROUP BY run_id
  )
  SELECT coalesce((SELECT max(n) FROM lengths),0),
         (SELECT count(*)::integer FROM history),
         (SELECT count(*)::integer FROM history WHERE qualified IS NULL);
$$;
REVOKE ALL ON FUNCTION public.get_own_no_hint_streak(text,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_own_no_hint_streak(text,text,text) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.get_own_no_hint_streak(text,text,text) IS 'Best consecutive official no-hint wins since tracking began, independent of calendar gaps. Losses, hints and unknown evidence break runs. Server aggregation avoids API row limits.';

COMMENT ON COLUMN public.game_sessions.no_hint_completion_order IS 'Forward-only database acceptance order at first completion after tracking migration. Immutable; NULL for pre-tracking history. Gaps do not break streaks. Replays are excluded at read time.';
COMMENT ON COLUMN public.game_sessions.no_hint_qualified IS 'Completion-time no-hint win evidence. True only for an explicit unhinted win; NULL is unknown, never a win. The read RPC additionally checks losses and all persisted hint events.';
COMMENT ON FUNCTION public.no_hint_history_for_owner(text,text,text) IS 'Owned, format-specific, completed official games recorded since forward tracking began; legacy history is not backfilled. Ordered by database acceptance sequence, not calendar date.';
-- One scalar JSON snapshot avoids PostgREST's SETOF row cap. The existing
-- function remains the sole ownership/format predicate; restoration callers
-- retain its original interface. No history or gameplay records are changed.
CREATE FUNCTION public.get_own_personal_stats_history(_device_id text DEFAULT NULL, _device_token text DEFAULT NULL, _format text DEFAULT 'full')
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(history)), '[]'::jsonb)
    FROM public.get_own_completed_sessions(_device_id, _device_token, _format) history;
$$;
REVOKE ALL ON FUNCTION public.get_own_personal_stats_history(text,text,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_own_personal_stats_history(text,text,text) TO anon, authenticated, service_role;
COMMENT ON FUNCTION public.get_own_personal_stats_history(text,text,text) IS 'Complete owned official history for one format in a single snapshot, not truncated by API row limits. Uses the existing completed-session ownership predicate.';
COMMIT;
