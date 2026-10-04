-- Phase 2, step 0 (owner-approved 2026-10-04): drop EXACTLY the three obsolete admin
-- policies on the empty cv_* / wtf_* leftover tables that depend on Rainbow's
-- user_roles table and app_role type. Nothing else: not the tables, not their
-- read policies, nothing of CrossPuns. Refuses to run unless exactly these three
-- policies exist and the three tables are still empty.
begin;
do $$
declare n integer;
begin
  select count(*) into n from pg_policies
   where schemaname = 'public'
     and (tablename, policyname) in (('cv_puzzles', 'Admins can manage cv puzzles'),
                                     ('cv_wordbank', 'Admins can manage cv wordbank'),
                                     ('wtf_games', 'Admins can manage wtf games'));
  if n <> 3 then raise exception 'expected exactly the 3 approved policies, found %', n; end if;
  select (select count(*) from public.cv_puzzles) + (select count(*) from public.cv_wordbank) + (select count(*) from public.wtf_games) into n;
  if n <> 0 then raise exception 'the leftover tables are no longer empty (% rows); stopping', n; end if;
end $$;
drop policy "Admins can manage cv puzzles" on public.cv_puzzles;
drop policy "Admins can manage cv wordbank" on public.cv_wordbank;
drop policy "Admins can manage wtf games" on public.wtf_games;
-- what remains on those three tables (their read policies must still be here)
select tablename, policyname, cmd from pg_policies where schemaname = 'public' and tablename in ('cv_puzzles', 'cv_wordbank', 'wtf_games') order by 1, 2;
commit;
