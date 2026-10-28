-- ROLLBACK for supabase/migrations/0003_streak_first_game_counts_wins_only.sql
--
-- Restores record_streak exactly as 0001_rainbow_baseline.sql defined it
-- (a first game of either outcome starts the streak at 1/1). Run as one
-- transaction in the Supabase SQL editor for the Rainbow project.
--
-- Data: 0003 changes no existing rows, and neither does this. Rows created
-- while 0003 was live (a lost first game stored as 0/0) are left as they are
-- — they are correct under the documented rule.
--
-- The second statement removes 0003 from the migration ledger, so a later
-- `supabase db push` would offer to apply it again. Leave it out if the
-- intent is to keep 0003 marked as applied.

begin;

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

delete from supabase_migrations.schema_migrations where version = '0003';

commit;
