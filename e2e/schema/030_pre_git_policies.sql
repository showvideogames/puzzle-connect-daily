-- Row-level security for the three pre-git tables no migration defines.
--
-- Applied AFTER every migration, for two reasons: these policies call
-- public.has_role(), which a migration creates, and the migrations
-- deliberately drop-and-redefine every policy on game_sessions and
-- guess_events (see 20260916150000 §6d/§6e) and revoke all client access to
-- user_streaks (see 20260917000000) — so those three are already fully
-- described by git and are not touched here.
--
-- HONESTY NOTE, because it matters when reading a test result:
-- production's live definitions for these three tables are not in the
-- repository and could not be read while this was written. What is below is
-- reconstructed from (a) exactly how the application uses each table and
-- (b) the security audit recorded in the project notes ("puzzle_ratings
-- SELECT is own-only + admin, no public read"; "puzzle_aggregates is
-- public-read-only, writes go through SECURITY DEFINER RPC
-- increment_puzzle_aggregate"). If production ever proves to differ, fix it
-- HERE and in production — do not loosen a test to match.

-- ── puzzle_aggregates: world-readable, never client-writable ───────────────
-- Global Stats reads this from the browser as an anonymous visitor. Writes
-- go exclusively through increment_puzzle_aggregate(), which is
-- SECURITY DEFINER and therefore unaffected by the absence of a write policy.
drop policy if exists "Anyone can read puzzle aggregates" on public.puzzle_aggregates;
create policy "Anyone can read puzzle aggregates"
on public.puzzle_aggregates
for select
to public
using (true);

-- ── puzzle_ratings: a player sees only their own rating ───────────────────
drop policy if exists "Users can read own rating" on public.puzzle_ratings;
create policy "Users can read own rating"
on public.puzzle_ratings
for select
to authenticated
using (user_id = auth.uid());

-- Admin's per-puzzle rating summary reads every row for one puzzle.
drop policy if exists "Admins can read all ratings" on public.puzzle_ratings;
create policy "Admins can read all ratings"
on public.puzzle_ratings
for select
to authenticated
using (public.has_role(auth.uid(), 'admin'));

drop policy if exists "Users can rate as themselves" on public.puzzle_ratings;
create policy "Users can rate as themselves"
on public.puzzle_ratings
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "Users can change own rating" on public.puzzle_ratings;
create policy "Users can change own rating"
on public.puzzle_ratings
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- ── feedback: admin-readable only ─────────────────────────────────────────
-- Submission goes through the submit-feedback edge function using the
-- service role, so there is no client INSERT policy by design.
drop policy if exists "Admins can read feedback" on public.feedback;
create policy "Admins can read feedback"
on public.feedback
for select
to authenticated
using (public.has_role(auth.uid(), 'admin'));

-- PostgREST caches the schema; after a full rebuild it must be told.
notify pgrst, 'reload schema';
