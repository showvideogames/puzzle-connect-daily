-- Cleanup after the manual WorkOS smoke on the preview (2026-10-04): the three in-progress
-- sessions the operator's clicks created (already anonymised by the S7 deletion) and the two
-- retired devices from S1/S4. The test person's new account (same WorkOS id) is kept for further
-- beta testing. Rainbow tables only; refuses to run if the rows are not what it expects.
begin;
do $$
declare n integer;
begin
  select count(*) into n from public.game_sessions where id::text like 'c2eef838%' or id::text like '58bba8d8%' or id::text like '8d58d61e%';
  if n <> 3 then raise exception 'expected the 3 smoke sessions, found %', n; end if;
  select count(*) into n from public.game_sessions where (id::text like 'c2eef838%' or id::text like '58bba8d8%' or id::text like '8d58d61e%') and (user_id is not null or device_id is not null or status <> 'in_progress');
  if n <> 0 then raise exception 'smoke sessions are not the anonymised in-progress rows expected (%)', n; end if;
end $$;
delete from public.guess_events where game_session_id in (select id from public.game_sessions where id::text like 'c2eef838%' or id::text like '58bba8d8%' or id::text like '8d58d61e%');
delete from public.game_sessions where id::text like 'c2eef838%' or id::text like '58bba8d8%' or id::text like '8d58d61e%';
delete from public.device_identities where (device_id like '12fe57c3%' or device_id like '29229486%') and retired_at is not null and claimed_by is null;
select (select count(*) from public.game_sessions where started_at > now() - interval '2 hours') as smoke_sessions_left,
       (select count(*) from public.device_identities where device_id like '12fe57c3%' or device_id like '29229486%') as smoke_devices_left,
       (select count(*) from public.accounts) as accounts,
       (select sum(total_plays) from public.puzzle_aggregates) as aggregate_total_plays;
commit;
