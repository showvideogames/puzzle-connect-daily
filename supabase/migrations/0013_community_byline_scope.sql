-- Keep newly provisioned Community-only creator pages within the same listing
-- boundary on both creator routes. Existing profiles and direct shares are unchanged.
-- This migration does not create or edit any actual player or puzzle rows.
BEGIN;

ALTER TABLE public.creator_profiles ADD COLUMN community_only boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.get_creator_profile(_slug text, _sort text DEFAULT 'newest'::text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _uid   uuid;
  _name  text;
  _community_only boolean;
  _s     text := case when _sort in ('newest', 'plays', 'favorites') then _sort else 'newest' end;
begin
  select user_id, display_name, community_only into _uid, _name, _community_only
    from public.creator_profiles
   where public_slug = _slug;
  if _uid is null then
    return null;
  end if;

  return (
    with pub as (
      select cp.title,
             cp.content ->> 'mode' as mode,
             cp.short_code,
             (select coalesce(s.wins + s.losses, 0) from public.custom_puzzle_stats s where s.custom_puzzle_id = cp.id) as plays,
             (select count(*) from public.custom_puzzle_favorites f where f.custom_puzzle_id = cp.id) as favs,
             cp.created_at
        from public.custom_puzzles cp
       where cp.created_by = _uid
         and cp.visibility = 'public'
         and cp.moderation_status = 'active'
         and (not _community_only or public.custom_puzzle_in_community(cp))
    )
    select jsonb_build_object(
      'display_name',    _name,
      'public_slug',     _slug,
      'puzzle_count',    (select count(*) from pub),
      'total_plays',     (select coalesce(sum(plays), 0) from pub),
      'total_favorites', (select coalesce(sum(favs), 0) from pub),
      'puzzles',         coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'title',          q.title,
                   'mode',           q.mode,
                   'short_code',     q.short_code,
                   'finished_plays', q.plays,
                   'favorite_count', q.favs,
                   'created_at',     q.created_at
                 )
                 order by (case _s when 'plays' then q.plays end) desc nulls last,
                          (case _s when 'favorites' then q.favs end) desc nulls last,
                          q.created_at desc)
          from (select * from pub
                 order by (case _s when 'plays' then plays end) desc nulls last,
                          (case _s when 'favorites' then favs end) desc nulls last,
                          created_at desc
                 limit 100) q
      ), '[]'::jsonb)
    )
  );
end;
$$;

COMMIT;
