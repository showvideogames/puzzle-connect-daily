-- Undo 0011_my_custom_puzzles.sql (read-only function and its index). No data
-- is touched: puzzles, listings and covers are unchanged. Afterwards:
--   npx supabase migration repair --status reverted 0011 --linked
BEGIN;
DROP FUNCTION IF EXISTS public.list_my_custom_puzzles(_limit integer, _offset integer);
DROP INDEX IF EXISTS public.custom_puzzles_owner_newest_idx;
COMMIT;
