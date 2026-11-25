-- Undo 0012_my_puzzles_rename_and_copy.sql: drops the two functions and puts
-- the table comment back. Titles already renamed stay as renamed (that is the
-- creator's data); nothing else is touched. Afterwards:
--   npx supabase migration repair --status reverted 0012 --linked
BEGIN;
DROP FUNCTION IF EXISTS public.rename_custom_puzzle(_share_id text, _title text);
DROP FUNCTION IF EXISTS public.get_my_custom_puzzle_source(_share_id text);
COMMENT ON TABLE public.custom_puzzles IS 'Player-created puzzles (Phase 2, Full 4x4 only). Immutable after creation. Reachable only through create_custom_puzzle/get_custom_puzzle -- no direct grants to anon/authenticated.';
COMMIT;
