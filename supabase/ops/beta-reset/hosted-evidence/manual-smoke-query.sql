-- Read-only snapshot used to verify the manual WorkOS smoke cases (S1, S4, S6, S7)
-- on the hosted beta project. Run: npm run phase2:hosted -- --project-ref <ref> sql --file <this file>
-- (ends in ROLLBACK, so the tool runs it without --apply). Emails of beta users are not listed;
-- only accounts created through the shared sign-in appear with their address.
begin;
select
  (select count(*) from auth.users) as auth_users,
  (select json_agg(json_build_object('provider', provider, 'n', n) order by provider)
     from (select provider, count(*)::int as n from auth.identities group by provider) p) as identities_by_provider,
  (select json_agg(json_build_object(
       'user_id', left(a.user_id::text, 8), 'global_user_id', a.global_user_id,
       'current_email', public.account_email(a.user_id), 'auth_users_email', u.email,
       'identity_email', (select i.identity_data->>'email' from auth.identities i where i.user_id = a.user_id and i.provider = 'custom:platform'),
       'created_at', a.created_at, 'games', (select count(*) from public.game_sessions s where s.user_id = a.user_id),
       'streaks', (select count(*) from public.user_streaks st where st.user_id = a.user_id)) order by a.created_at)
     from public.accounts a join auth.users u on u.id = a.user_id) as rainbow_accounts,
  (select json_agg(json_build_object('device', left(device_id, 8), 'reason', retired_reason, 'claimed_by', left(claimed_by::text, 8), 'decided_at', decided_at) order by decided_at desc)
     from (select * from public.device_identities where decided_at > now() - interval '1 day' order by decided_at desc limit 10) d) as devices_decided_last_day,
  (select json_agg(json_build_object('id', left(id::text, 8), 'format', format, 'status', status, 'owner', left(user_id::text, 8), 'device', left(device_id, 8), 'completed_at', completed_at) order by started_at desc)
     from (select * from public.game_sessions where started_at > now() - interval '1 day' order by started_at desc limit 12) s) as sessions_last_day,
  (select sum(total_plays) from public.puzzle_aggregates) as aggregate_total_plays;
rollback;
