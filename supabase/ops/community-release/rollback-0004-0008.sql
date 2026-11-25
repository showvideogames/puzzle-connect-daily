-- ROLLBACK of the Community Puzzles release (migrations 0004-0008).
--
-- NOT a migration and never applied automatically. Only for a reviewed,
-- deliberate database rollback after the frontend is already off (the
-- VITE_COMMUNITY_PUZZLES=off switch or a revert): the frontend rollback alone
-- is enough for an incident, because 0004-0008 are additive and the old app
-- never calls them.
--
-- DATA LOSS: this deletes every Community listing flag, follow, curation entry
-- and cover. Puzzles themselves, their links, plays and favourites are kept.
-- Take a backup first. Run in one transaction, then record it in the ledger:
--   npx supabase migration repair --status reverted 0008 0007 0006 0005 0004
--
-- Verified by `npm run e2e:db:release`: it restores exactly the pre-release
-- schema (every table, column, constraint, index and function definition).
BEGIN;

-- 0008 replaced two baseline functions: put the baseline bodies back first.
CREATE OR REPLACE FUNCTION public.custom_puzzle_public_json(_p public.custom_puzzles) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select jsonb_build_object(
    'id',              _p.id,
    'share_id',        _p.share_id,
    'short_code',      _p.short_code,
    'title',           _p.title,
    'creator_name',    _p.creator_name,
    'visibility',      _p.visibility,
    'content',         _p.content,
    -- Only a signed-in creator has a profile; anonymous puzzles stay unlinked.
    'creator_slug',    (select cp.public_slug from public.creator_profiles cp where cp.user_id = _p.created_by),
    'favorite_count',  (select count(*) from public.custom_puzzle_favorites f where f.custom_puzzle_id = _p.id),
    'favorited_by_me', exists (
      select 1 from public.custom_puzzle_favorites f
       where f.custom_puzzle_id = _p.id and f.user_id = public.rainbow_uid()
    )
  )
$$;

CREATE OR REPLACE FUNCTION public.get_my_favorites() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(jsonb_agg(q.item order by q.favorited_at desc), '[]'::jsonb)
    from (
      select f.created_at as favorited_at,
             jsonb_build_object(
               'title',          cp.title,
               'creator_name',   cp.creator_name,
               'creator_slug',   (select p.public_slug from public.creator_profiles p where p.user_id = cp.created_by),
               'mode',           cp.content ->> 'mode',
               'short_code',     cp.short_code,
               'favorite_count', (select count(*) from public.custom_puzzle_favorites x where x.custom_puzzle_id = cp.id),
               'favorited_at',   f.created_at
             ) as item
        from public.custom_puzzle_favorites f
        join public.custom_puzzles cp on cp.id = f.custom_puzzle_id
       where f.user_id = public.rainbow_uid()
         and cp.moderation_status = 'active'
       order by f.created_at desc
       limit 200
    ) q
$$;

-- 0004-0008 functions.
DROP FUNCTION IF EXISTS public.set_custom_puzzle_cover(text, text, text);
DROP FUNCTION IF EXISTS public.admin_set_community_curation(text, text[]);
DROP FUNCTION IF EXISTS public.admin_get_community_curation();
DROP FUNCTION IF EXISTS public.list_community_newest(integer, timestamp with time zone, text);
DROP FUNCTION IF EXISTS public.get_community_explore();
DROP FUNCTION IF EXISTS public.custom_puzzle_share_id(text);
DROP FUNCTION IF EXISTS public.get_custom_puzzle_cards(text[]);
DROP FUNCTION IF EXISTS public.get_following_feed(integer, integer);
DROP FUNCTION IF EXISTS public.set_creator_follow(text, boolean);
DROP FUNCTION IF EXISTS public.get_creator_community(text);
DROP FUNCTION IF EXISTS public.search_community_creators(text, integer, integer);
DROP FUNCTION IF EXISTS public.community_creator_json(public.creator_profiles);
DROP FUNCTION IF EXISTS public.custom_puzzle_card_json(public.custom_puzzles);
DROP FUNCTION IF EXISTS public.custom_puzzle_in_community(public.custom_puzzles);
DROP FUNCTION IF EXISTS public.set_custom_puzzle_community_listing(text, boolean);
DROP FUNCTION IF EXISTS public.get_my_custom_puzzle_listing(text);
DROP FUNCTION IF EXISTS public.list_community_puzzles(text, text, integer, integer);

-- 0006-0008 tables.
DROP TABLE IF EXISTS public.community_curation;
DROP TABLE IF EXISTS public.creator_follows;

-- 0008 and 0004 columns, constraints and indexes on custom_puzzles.
ALTER TABLE public.custom_puzzles DROP CONSTRAINT IF EXISTS custom_puzzles_cover_pair;
ALTER TABLE public.custom_puzzles DROP CONSTRAINT IF EXISTS custom_puzzles_cover_background_check;
ALTER TABLE public.custom_puzzles DROP CONSTRAINT IF EXISTS custom_puzzles_cover_emoji_fkey;
ALTER TABLE public.custom_puzzles DROP COLUMN IF EXISTS cover_background;
ALTER TABLE public.custom_puzzles DROP COLUMN IF EXISTS cover_emoji;
DROP TABLE IF EXISTS public.community_cover_emoji;
DROP INDEX IF EXISTS public.custom_puzzles_community_feed_idx;
ALTER TABLE public.custom_puzzles DROP CONSTRAINT IF EXISTS custom_puzzles_community_requires_public;
ALTER TABLE public.custom_puzzles DROP COLUMN IF EXISTS community_listed_at;
ALTER TABLE public.custom_puzzles DROP COLUMN IF EXISTS community_listed;

COMMIT;
