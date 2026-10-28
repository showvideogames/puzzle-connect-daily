-- A first game only starts a streak if it was won.
--
-- The streak counts consecutive days WON (since 2026-06-06: a loss sets it
-- to 0, a win the day after the last counted day adds 1, any other win
-- restarts it at 1). The branch that creates a player's FIRST streak row for
-- a format was missed by that change and still wrote 1/1 for any completed
-- game, so a player whose first Full (or first Mini) game was a loss showed
-- "Streak 1, Max Streak 1" — and a win the next day then counted as day 2.
--
-- The only change from 0001's definition is that one insert: a won first
-- game starts at 1/1 (unchanged), a lost first game at 0/0. Everything else
-- — the per-format rows, the once-per-day rule, the win/loss/missed-day rule
-- for every later game — is byte-for-byte the same.
--
-- Not retroactive: no existing user_streaks row is read or changed here.
-- CREATE OR REPLACE with the identical signature keeps the function's owner,
-- SECURITY DEFINER, search_path and its service_role-only grant.
--
-- Rollback: supabase/ops/streak-first-game/rollback.sql restores 0001's body.

CREATE OR REPLACE FUNCTION public.record_streak(_user_id uuid, _device_id text, _won boolean, _local_date text, _format text DEFAULT 'full'::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

  -- First game in this format: a win starts the streak at 1, a loss at 0.
  if _row.id is null then
    insert into public.user_streaks (user_id, device_id, current_streak, longest_streak, last_played_date, format)
    values (_user_id, _device_id,
            case when _won then 1 else 0 end,
            case when _won then 1 else 0 end,
            _today, _fmt);
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
