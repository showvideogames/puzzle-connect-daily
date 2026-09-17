-- ===========================================================================
-- ROLLBACK-ONLY REHEARSAL for
--   supabase/migrations/20260917000000_device_credentials_and_account_onboarding.sql
--
-- THIS FILE IS NOT A MIGRATION. It lives in proposed-migrations/ precisely so
-- that `supabase db push` can never pick it up.
--
-- WHY
-- ---
-- That migration is 1,464 lines and has never executed against PostgreSQL.
-- Its first run should not be the permanent production application. This
-- rehearsal runs the real thing inside an explicit transaction, proves it
-- parses, resolves every dependency and passes its own guards against REAL
-- production data, then throws all of it away.
--
-- WHY A ROLLBACK IS SUFFICIENT HERE
-- ---------------------------------
-- Every statement in the migration is transactional. It was checked for the
-- statements PostgreSQL refuses to run inside a transaction block, and
-- contains none of them:
--
--   CREATE INDEX CONCURRENTLY   - none
--   VACUUM / REINDEX            - none
--   ALTER SYSTEM                - none
--   CREATE DATABASE / TABLESPACE- none
--   an explicit COMMIT          - none
--
-- What it does contain is CREATE TABLE, CREATE/DROP FUNCTION, DROP POLICY,
-- GRANT/REVOKE, INSERT and DO blocks. All of those are fully transactional in
-- PostgreSQL, including the DDL and the privilege changes, so ROLLBACK
-- restores the database exactly as it was. Advisory locks taken inside the
-- transaction are released on rollback too.
--
-- The one thing a rehearsal cannot prove is behaviour under concurrency, and
-- it does not exercise the frontend at all.
--
-- HOW TO RUN IT (Supabase Dashboard -> SQL Editor, project zmauemcjcrdrgfjzkvgd)
-- ----------------------------------------------------------------------------
--   1. Confirm the project ref in the URL is zmauemcjcrdrgfjzkvgd.
--   2. Paste, in ONE editor tab and in this order:
--        a. the line `begin;`
--        b. the ENTIRE contents of
--           supabase/migrations/20260917000000_device_credentials_and_account_onboarding.sql
--        c. everything in section VERIFY below
--        d. the line `rollback;`
--   3. Run it as a single execution.
--   4. Read the VERIFY output, then confirm `rollback;` ran.
--
-- INTERPRETING IT
-- ---------------
--   * The migration raising an exception is a RESULT, not an accident: its
--     self-verifying guard found something. The transaction is then aborted,
--     so the VERIFY queries will report "current transaction is aborted" --
--     that is expected. Just run `rollback;` and report what it raised.
--   * If it completes, every VERIFY row below should match its expectation.
--   * Nothing is persisted either way.
--
-- AFTERWARDS
-- ----------
-- A successful rehearsal does NOT apply anything. The canonical migration is
-- applied separately, as its own permanent run, from the exact same file.
-- ===========================================================================


-- ############################ VERIFY #######################################
-- Paste this block AFTER the migration text and BEFORE `rollback;`.

-- 1. Every account classified, and none of them left pending.
--    expect: unclassified = 0, pending = 0, and legacy = the account count
select 'accounts' as check,
       (select count(*) from auth.users) as total_accounts,
       (select count(*) from auth.users u
         where not exists (select 1 from public.account_onboarding ao
                            where ao.user_id = u.id)) as unclassified,
       (select count(*) from public.account_onboarding where status = 'legacy') as legacy,
       (select count(*) from public.account_onboarding where status = 'pending') as pending;

-- 2. Every pre-cutover device registered AND retired AND credential-less.
--    expect: unretired = 0, with_token = 0
select 'devices' as check,
       (select count(*) from public.device_identities) as registered,
       (select count(*) from public.device_identities where retired_at is null) as unretired,
       (select count(*) from public.device_identities
         where retired_reason = 'pre_launch_cutover' and token_hash is not null) as with_token;

-- 3. The backfill excluded null/blank/'unknown', per the safeguard.
--    expect: 0
select 'excluded_ids' as check, count(*) as must_be_zero
  from public.device_identities
 where device_id is null or btrim(device_id) = '' or device_id = 'unknown';

-- 4. The retired claiming route is gone and the new surface exists.
--    expect: claim_gone = true, and every new function present
select 'functions' as check,
       not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = 'claim_anonymous_sessions') as claim_gone,
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in ('create_device_identity','verify_device','resolve_onboarding',
                             'import_guest_history','decline_guest_history','get_own_streak',
                             'get_streak_admin_summary','device_has_importable_history',
                             'record_streak')) as new_functions_present;

-- 5. No SECURITY DEFINER function left without a pinned search_path.
--    expect: 0
select 'search_path' as check, count(*) as unpinned
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.prosecdef
   and not exists (
     select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%'
   );

-- 6. Internal-only functions must not be executable by browsers.
--    expect: false for all three
select 'internal_grants' as check,
       has_function_privilege('anon',          'public.verify_device(text,text)', 'execute') as anon_verify,
       has_function_privilege('authenticated', 'public.verify_device(text,text)', 'execute') as auth_verify,
       has_function_privilege('authenticated', 'public.record_streak(uuid,text,boolean,text)', 'execute') as auth_streak;

-- 7. Direct write access is gone, and the aggregate counter is no longer
--    client-callable. expect: all false
select 'revoked_writes' as check,
       has_table_privilege('anon',          'public.user_streaks',  'select') as anon_read_streaks,
       has_table_privilege('authenticated', 'public.user_streaks',  'update') as auth_write_streaks,
       has_table_privilege('authenticated', 'public.game_sessions', 'insert') as auth_insert_sessions,
       has_table_privilege('authenticated', 'public.game_results',  'insert') as auth_insert_results,
       has_function_privilege('authenticated',
         'public.increment_puzzle_aggregate(text,boolean,integer,numeric,text)', 'execute') as auth_aggregate;

-- 8. RLS on, and no policies, on the two new tables. expect: rls true, policies 0
select 'new_table_rls' as check, c.relname, c.relrowsecurity as rls_enabled,
       (select count(*) from pg_policies pol
         where pol.schemaname = 'public' and pol.tablename = c.relname) as policies
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname in ('device_identities','account_onboarding');

-- 9. Gameplay data is untouched by the migration itself.
--    expect: identical to the numbers before the rehearsal
select 'data_untouched' as check,
       (select count(*) from public.game_sessions)     as sessions,
       (select count(*) from public.guess_events)      as guesses,
       (select count(*) from public.hint_events)       as hints,
       (select count(*) from public.user_streaks)      as streaks,
       (select count(*) from public.game_results)      as results,
       (select coalesce(sum(total_plays),0) from public.puzzle_aggregates) as total_plays;

-- 10. Nothing belonging to the other apps in this shared project was touched.
--     expect: their row counts unchanged (compare against a pre-run reading)
select 'shared_project' as check,
       (select count(*) from public.wtf_games)   as wtf_games,
       (select count(*) from public.wtf_players) as wtf_players,
       (select count(*) from public.cv_puzzles)  as cv_puzzles;

-- ######################## END VERIFY #######################################
-- Now run:  rollback;
