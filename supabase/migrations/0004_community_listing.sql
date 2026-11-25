-- Community Puzzles browse feed (PREVIEW; not applied to any hosted database).
--
-- Additive only. Listing in the Community feed is a separate, explicit opt-in
-- by the signed-in creator, never inferred from visibility:
--   * every existing puzzle, including Public ones and old link-only shares,
--     starts NOT listed (community_listed defaults to false; nothing is
--     backfilled);
--   * only the puzzle's own signed-in creator may list or unlist it;
--   * only a Public, active (not moderated-hidden), account-owned puzzle can be
--     listed, and the feed re-checks all of that on every read, so a puzzle that
--     is hidden by an admin, or whose creator deleted their account, drops out
--     even while its flag is still set;
--   * listing never changes the puzzle's share links, visibility or content:
--     unlisting only removes it from the feed.
--
-- The feed payload carries only what a puzzle card shows: title, the designer
-- name the creator typed, the creator's public profile slug, Classic/Rainbow,
-- the short share code, the finished-play and favourite counts. Never content
-- (categories, words, hints), the internal id, the long share id, created_by
-- or any account field.
--
-- Moderation: the only hook that exists is admin_set_custom_puzzle_status
-- ('hidden'), which this feed honours. There is no player report flow yet,
-- which is why the browse page ships behind VITE_COMMUNITY_PUZZLES=preview.
BEGIN;

ALTER TABLE public.custom_puzzles ADD COLUMN community_listed boolean DEFAULT false NOT NULL;
-- First time the creator listed it. Kept on unlist so re-listing cannot bump a
-- puzzle back to the top of Newest.
ALTER TABLE public.custom_puzzles ADD COLUMN community_listed_at timestamp with time zone;
-- Visibility is fixed at creation today; this keeps a private puzzle out even if
-- that ever changes. created_by is deliberately NOT in the constraint: account
-- deletion sets it to null (ON DELETE SET NULL) and must not fail; the feed
-- filters on it instead.
ALTER TABLE public.custom_puzzles ADD CONSTRAINT custom_puzzles_community_requires_public
  CHECK ((NOT community_listed) OR (visibility = 'public'::text));

CREATE INDEX custom_puzzles_community_feed_idx ON public.custom_puzzles USING btree (community_listed_at DESC, short_code)
  WHERE (community_listed AND (visibility = 'public'::text) AND (moderation_status = 'active'::text) AND (created_by IS NOT NULL));

-- list_community_puzzles(text, text, integer, integer)
CREATE FUNCTION public.list_community_puzzles(_query text DEFAULT NULL::text, _sort text DEFAULT 'newest'::text, _limit integer DEFAULT 24, _offset integer DEFAULT 0) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _s     text    := case when _sort = 'plays' then 'plays' else 'newest' end;
  _lim   integer := least(greatest(coalesce(_limit, 24), 1), 48);
  _off   integer := least(greatest(coalesce(_offset, 0), 0), 2000);
  _q     text    := nullif(btrim(left(coalesce(_query, ''), 60)), '');
  _like  text;
  _rows  jsonb;
begin
  if _q is not null then
    -- Literal substring search: the user's % _ and \ are not wildcards.
    _like := '%' || replace(replace(replace(_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  with eligible as (
    select cp.title,
           cp.creator_name,
           prof.public_slug as creator_slug,
           cp.content ->> 'mode' as mode,
           cp.short_code,
           coalesce((select s.wins + s.losses from public.custom_puzzle_stats s where s.custom_puzzle_id = cp.id), 0) as plays,
           (select count(*) from public.custom_puzzle_favorites f where f.custom_puzzle_id = cp.id) as favs,
           cp.community_listed_at as listed_at
      from public.custom_puzzles cp
      left join public.creator_profiles prof on prof.user_id = cp.created_by
     where cp.community_listed
       and cp.visibility = 'public'
       and cp.moderation_status = 'active'
       and cp.created_by is not null
       and (_like is null
            or cp.title ilike _like
            or cp.creator_name ilike _like
            or prof.display_name ilike _like)
  ), page as (
    select e.*,
           row_number() over (order by (case when _s = 'plays' then e.plays end) desc nulls last,
                                       e.listed_at desc nulls last,
                                       e.short_code) as rn
      from eligible e
     order by rn
     limit _lim + 1 offset _off
  )
  select jsonb_build_object(
           'items', coalesce(jsonb_agg(jsonb_build_object(
                      'title',          p.title,
                      'creator_name',   p.creator_name,
                      'creator_slug',   p.creator_slug,
                      'mode',           p.mode,
                      'short_code',     p.short_code,
                      'finished_plays', p.plays,
                      'favorite_count', p.favs,
                      'listed_at',      p.listed_at
                    ) order by p.rn) filter (where p.rn <= _off + _lim), '[]'::jsonb),
           'has_more', count(*) > _lim,
           'limit',    _lim,
           'offset',   _off)
    into _rows
    from page p;

  return _rows;
end;
$$;

-- get_my_custom_puzzle_listing(text)
-- Whether the CALLER created this puzzle, and its Community state. A guest, or
-- any other account, gets only {"owned": false}: nothing about who owns it.
CREATE FUNCTION public.get_my_custom_puzzle_listing(_share_id text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _uid uuid := public.rainbow_uid();
  _p   public.custom_puzzles%rowtype;
begin
  select * into _p from public.custom_puzzles where share_id = _share_id;
  if _p.id is null then
    return null;
  end if;
  if _uid is null or _p.created_by is distinct from _uid then
    return jsonb_build_object('owned', false);
  end if;
  return jsonb_build_object(
    'owned',    true,
    'listed',   _p.community_listed and _p.moderation_status = 'active',
    'can_list', _p.visibility = 'public' and _p.moderation_status = 'active',
    'visibility', _p.visibility
  );
end;
$$;

-- set_custom_puzzle_community_listing(text, boolean)
-- Sets (not toggles), so a retry or double click can never flip the state.
CREATE FUNCTION public.set_custom_puzzle_community_listing(_share_id text, _listed boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _uid uuid := public.rainbow_uid();
  _p   public.custom_puzzles%rowtype;
begin
  if _uid is null then
    raise exception 'sign in to list a puzzle in Community' using errcode = 'insufficient_privilege';
  end if;
  if _listed is null then
    raise exception 'listed is required' using errcode = 'invalid_parameter_value';
  end if;

  select * into _p from public.custom_puzzles where share_id = _share_id for update;
  if _p.id is null then
    raise exception 'puzzle not found' using errcode = 'no_data_found';
  end if;
  if _p.created_by is distinct from _uid then
    raise exception 'only the puzzle''s creator can change its Community listing' using errcode = 'insufficient_privilege';
  end if;

  if _listed then
    if _p.visibility <> 'public' then
      raise exception 'private puzzles cannot be listed in Community' using errcode = 'invalid_parameter_value';
    end if;
    if _p.moderation_status <> 'active' then
      raise exception 'this puzzle cannot be listed in Community' using errcode = 'insufficient_privilege';
    end if;
  end if;

  update public.custom_puzzles
     set community_listed    = _listed,
         community_listed_at = case when _listed then coalesce(community_listed_at, now()) else community_listed_at end
   where id = _p.id
     and created_by = _uid;

  return jsonb_build_object('listed', _listed);
end;
$$;

REVOKE ALL ON FUNCTION public.list_community_puzzles(_query text, _sort text, _limit integer, _offset integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_community_puzzles(_query text, _sort text, _limit integer, _offset integer) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_my_custom_puzzle_listing(_share_id text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_custom_puzzle_listing(_share_id text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.set_custom_puzzle_community_listing(_share_id text, _listed boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_custom_puzzle_community_listing(_share_id text, _listed boolean) TO authenticated, service_role;

COMMENT ON FUNCTION public.list_community_puzzles(_query text, _sort text, _limit integer, _offset integer) IS 'Community Puzzles feed: only puzzles their signed-in creator explicitly listed, that are Public, active and still account-owned. Bounded (<=48 per page, offset <=2000, query <=60 chars, literal substring). Card fields only: never content, ids, share_id, created_by or account data.';
COMMENT ON FUNCTION public.set_custom_puzzle_community_listing(_share_id text, _listed boolean) IS 'The puzzle''s own signed-in creator lists or unlists it in Community. Never changes visibility, links or content.';
COMMENT ON FUNCTION public.get_my_custom_puzzle_listing(_share_id text) IS 'For the caller''s own puzzle: its Community listing state. Anyone else gets {owned:false}.';

COMMIT;
