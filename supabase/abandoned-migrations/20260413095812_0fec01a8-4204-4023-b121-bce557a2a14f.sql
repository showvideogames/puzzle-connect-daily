-- ============================================================================
-- ABANDONED -- NEVER APPLIED, NOT IN USE. DO NOT MOVE BACK INTO
-- supabase/migrations/ WITHOUT RE-VERIFYING. See the README in this folder.
--
-- Verified 2026-09-16 against the live project (zmauemcjcrdrgfjzkvgd):
--   * public.puzzle_stats does NOT exist -- confirmed twice: PostgREST
--     returns 404 / PGRST205, and a direct-database table listing over the
--     CLI connection, which does not go through the schema cache, does not
--     contain it
--   * zero references to it in src/ or supabase/functions/
--
-- Moved out of the executable migrations directory rather than marked
-- `reverted`, because `migration repair` only edits the remote history table
-- and would have left this file pending for a future `db push`.
--
-- Not to be confused with puzzle_aggregates (a real table, in use) or the
-- get_puzzle_stats() RPC (real, in use, reads game_results).
--
-- puzzle_stat_submissions is NOT a counterexample. It does not exist in the
-- database either; like puzzle_stats it survives only as a stale entry in the
-- generated src/integrations/supabase/types.ts.
-- ============================================================================

CREATE TABLE public.puzzle_stats (
  puzzle_id text PRIMARY KEY,
  mistakes_0 integer NOT NULL DEFAULT 0,
  mistakes_1 integer NOT NULL DEFAULT 0,
  mistakes_2 integer NOT NULL DEFAULT 0,
  mistakes_3 integer NOT NULL DEFAULT 0,
  mistakes_4 integer NOT NULL DEFAULT 0
);

ALTER TABLE public.puzzle_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read puzzle stats"
ON public.puzzle_stats
FOR SELECT
TO public
USING (true);

CREATE POLICY "Admins can manage puzzle stats"
ON public.puzzle_stats
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));
