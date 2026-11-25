-- Community Puzzles, part 2 (PREVIEW; not applied to any hosted database):
-- creator discovery, one-way Follow, a Following feed, and card lookups that
-- let the existing Favorites (account rows + guest device-only flags) show as
-- bookmarks. Additive on top of 0004_community_listing.sql.
--
-- What is reused, not duplicated:
--   * identity: creator_profiles (public_slug, display_name). No new account,
--     profile or avatar storage; the app draws a monogram from the public name.
--   * saves: custom_puzzle_favorites via set_custom_puzzle_favorite /
--     get_my_favorites for accounts, and the guest's existing per-browser
--     `custom-favorite:<shareId>` flags. Nothing here stores a bookmark.
--   * eligibility: exactly 0004's rule (listed, Public, active, account-owned),
--     re-checked on every read, so unlisting, an admin hide or a deleted
--     account removes a puzzle from Explore, creator search and Following at
--     once, without touching its links or anyone's saved copy.
--
-- Privacy: who follows whom is readable only by the follower (their own
-- Following list). Creators and everyone else get an aggregate follower count
-- only. No follower lists, no notifications, no messages, no player records.
BEGIN;

CREATE TABLE public.creator_follows (
    follower_id uuid NOT NULL,
    creator_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT creator_follows_pkey PRIMARY KEY (follower_id, creator_id),
    CONSTRAINT creator_follows_not_self CHECK ((follower_id <> creator_id)),
    -- Deleting either account removes the follow.
    CONSTRAINT creator_follows_follower_id_fkey FOREIGN KEY (follower_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    CONSTRAINT creator_follows_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES public.creator_profiles(user_id) ON DELETE CASCADE
);
CREATE INDEX creator_follows_creator_idx ON public.creator_follows USING btree (creator_id);
CREATE INDEX creator_follows_follower_idx ON public.creator_follows USING btree (follower_id, created_at DESC);
ALTER TABLE public.creator_follows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.creator_follows FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.creator_follows TO service_role;

-- custom_puzzle_in_community(public.custom_puzzles)
-- 0004's eligibility rule, in one place for every new read below.
CREATE FUNCTION public.custom_puzzle_in_community(_p public.custom_puzzles) RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select _p.community_listed
     and _p.visibility = 'public'
     and _p.moderation_status = 'active'
     and _p.created_by is not null
$$;

-- custom_puzzle_card_json(public.custom_puzzles)
-- Exactly the card fields 0004's feed returns. Never content, ids, share_id,
-- created_by or account data.
CREATE FUNCTION public.custom_puzzle_card_json(_p public.custom_puzzles) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select jsonb_build_object(
    'title',          _p.title,
    'creator_name',   _p.creator_name,
    'creator_slug',   (select prof.public_slug from public.creator_profiles prof where prof.user_id = _p.created_by),
    'mode',           _p.content ->> 'mode',
    'short_code',     _p.short_code,
    'finished_plays', coalesce((select s.wins + s.losses from public.custom_puzzle_stats s where s.custom_puzzle_id = _p.id), 0),
    'favorite_count', (select count(*) from public.custom_puzzle_favorites f where f.custom_puzzle_id = _p.id),
    'listed_at',      _p.community_listed_at
  )
$$;

-- community_creator_json(public.creator_profiles)
-- A creator as discovery shows them: public name and slug, how many puzzles
-- they have in Community now, an aggregate follower count, and whether the
-- CALLER follows them. Nothing about who the followers are.
CREATE FUNCTION public.community_creator_json(_c public.creator_profiles) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select jsonb_build_object(
    'display_name',   _c.display_name,
    'public_slug',    _c.public_slug,
    'listed_count',   (select count(*) from public.custom_puzzles cp where cp.created_by = _c.user_id and public.custom_puzzle_in_community(cp)),
    'follower_count', (select count(*) from public.creator_follows f where f.creator_id = _c.user_id),
    'followed_by_me', coalesce(public.rainbow_uid() is not null and exists (
                        select 1 from public.creator_follows f
                         where f.creator_id = _c.user_id and f.follower_id = public.rainbow_uid()), false),
    'is_me',          coalesce(_c.user_id = public.rainbow_uid(), false)
  )
$$;

-- search_community_creators(text, integer, integer)
-- Creators with at least one puzzle in Community now, matched on public name
-- or slug (literal substring, 60 chars max). Most recently active first.
CREATE FUNCTION public.search_community_creators(_query text DEFAULT NULL::text, _limit integer DEFAULT 24, _offset integer DEFAULT 0) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _lim  integer := least(greatest(coalesce(_limit, 24), 1), 48);
  _off  integer := least(greatest(coalesce(_offset, 0), 0), 2000);
  _q    text    := nullif(btrim(left(coalesce(_query, ''), 60)), '');
  _like text;
  _out  jsonb;
begin
  if _q is not null then
    _like := '%' || replace(replace(replace(_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  with active as (
    select cp.created_by as user_id, max(cp.community_listed_at) as last_listed
      from public.custom_puzzles cp
     where public.custom_puzzle_in_community(cp)
     group by cp.created_by
  ), page as (
    select prof as c, row_number() over (order by a.last_listed desc nulls last, prof.public_slug) as rn
      from active a
      join public.creator_profiles prof on prof.user_id = a.user_id
     where _like is null or prof.display_name ilike _like or prof.public_slug ilike _like
     order by rn
     limit _lim + 1 offset _off
  )
  select jsonb_build_object(
           'items', coalesce(jsonb_agg(public.community_creator_json(p.c) order by p.rn) filter (where p.rn <= _off + _lim), '[]'::jsonb),
           'has_more', count(*) > _lim,
           'limit', _lim,
           'offset', _off)
    into _out
    from page p;
  return _out;
end;
$$;

-- get_creator_community(text)
-- The Community view of an existing creator page: identity, aggregate counts,
-- the caller's follow state and ONLY their puzzles currently in Community,
-- newest listing first. get_creator_profile (all Public puzzles) is unchanged.
CREATE FUNCTION public.get_creator_community(_slug text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _c public.creator_profiles%rowtype;
begin
  select * into _c from public.creator_profiles where public_slug = _slug;
  if _c.user_id is null then
    return null;
  end if;
  return public.community_creator_json(_c) || jsonb_build_object(
    'puzzles', coalesce((
      select jsonb_agg(public.custom_puzzle_card_json(cp) order by cp.community_listed_at desc nulls last, cp.short_code)
        from (select * from public.custom_puzzles x
               where x.created_by = _c.user_id and public.custom_puzzle_in_community(x)
               order by x.community_listed_at desc nulls last, x.short_code
               limit 100) cp
    ), '[]'::jsonb)
  );
end;
$$;

-- set_creator_follow(text, boolean)
-- One-way and set (not toggled). Starting to follow needs a creator with at
-- least one puzzle in Community; unfollowing is always allowed.
CREATE FUNCTION public.set_creator_follow(_slug text, _follow boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _uid uuid := public.rainbow_uid();
  _c   public.creator_profiles%rowtype;
begin
  if _uid is null then
    raise exception 'sign in to follow creators' using errcode = 'insufficient_privilege';
  end if;
  if _follow is null then
    raise exception 'follow is required' using errcode = 'invalid_parameter_value';
  end if;
  select * into _c from public.creator_profiles where public_slug = _slug;
  if _c.user_id is null then
    raise exception 'creator not found' using errcode = 'no_data_found';
  end if;
  if _c.user_id = _uid then
    raise exception 'you cannot follow yourself' using errcode = 'invalid_parameter_value';
  end if;

  if _follow then
    if not exists (select 1 from public.custom_puzzles cp where cp.created_by = _c.user_id and public.custom_puzzle_in_community(cp)) then
      raise exception 'this creator has no puzzles in Community yet' using errcode = 'invalid_parameter_value';
    end if;
    insert into public.creator_follows (follower_id, creator_id) values (_uid, _c.user_id)
    on conflict (follower_id, creator_id) do nothing;
  else
    delete from public.creator_follows where follower_id = _uid and creator_id = _c.user_id;
  end if;

  return jsonb_build_object(
    'following',      exists (select 1 from public.creator_follows where follower_id = _uid and creator_id = _c.user_id),
    'follower_count', (select count(*) from public.creator_follows where creator_id = _c.user_id)
  );
end;
$$;

-- get_following_feed(integer, integer)
-- The caller's own Following: who they follow (private to them) and those
-- creators' puzzles currently in Community, newest listing first.
CREATE FUNCTION public.get_following_feed(_limit integer DEFAULT 24, _offset integer DEFAULT 0) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _uid uuid := public.rainbow_uid();
  _lim integer := least(greatest(coalesce(_limit, 24), 1), 48);
  _off integer := least(greatest(coalesce(_offset, 0), 0), 2000);
  _out jsonb;
begin
  if _uid is null then
    raise exception 'sign in to see who you follow' using errcode = 'insufficient_privilege';
  end if;

  with page as (
    select cp as c, row_number() over (order by cp.community_listed_at desc nulls last, cp.short_code) as rn
      from public.custom_puzzles cp
      join public.creator_follows f on f.creator_id = cp.created_by and f.follower_id = _uid
     where public.custom_puzzle_in_community(cp)
     order by rn
     limit _lim + 1 offset _off
  )
  select jsonb_build_object(
           'items', coalesce(jsonb_agg(public.custom_puzzle_card_json(p.c) order by p.rn) filter (where p.rn <= _off + _lim), '[]'::jsonb),
           'has_more', count(*) > _lim,
           'limit', _lim,
           'offset', _off)
    into _out
    from page p;

  return _out || jsonb_build_object('creators', coalesce((
    select jsonb_agg(public.community_creator_json(prof) order by f.created_at desc)
      from (select * from public.creator_follows where follower_id = _uid order by created_at desc limit 100) f
      join public.creator_profiles prof on prof.user_id = f.creator_id
  ), '[]'::jsonb));
end;
$$;

-- get_custom_puzzle_cards(text[])
-- Card fields for puzzles the caller already holds the share id of: a guest's
-- device-only bookmarks. Active puzzles of any visibility or listing state, so
-- a saved legacy, link-only or unlisted puzzle stays in Favorites. Returns
-- nothing the caller couldn't already get from get_custom_puzzle(share_id).
CREATE FUNCTION public.get_custom_puzzle_cards(_share_ids text[]) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  -- share_id is the caller's OWN input echoed back, so a bookmark can be matched to its card.
  select coalesce(jsonb_agg(jsonb_build_object('share_id', ids.share_id) || public.custom_puzzle_card_json(cp) order by ids.n), '[]'::jsonb)
    from unnest((coalesce(_share_ids, '{}'::text[]))[1:200]) with ordinality as ids(share_id, n)
    join public.custom_puzzles cp on cp.share_id = ids.share_id
   where cp.moderation_status = 'active'
$$;

-- custom_puzzle_share_id(text)
-- The permanent id that the existing Favorites contracts key on, for a short
-- code the caller holds. get_custom_puzzle_by_short_code already returns it;
-- this returns only it, so a card can be saved without fetching the puzzle.
CREATE FUNCTION public.custom_puzzle_share_id(_short_code text) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select cp.share_id from public.custom_puzzles cp
   where cp.short_code = _short_code and cp.moderation_status = 'active'
$$;

REVOKE ALL ON FUNCTION public.custom_puzzle_in_community(_p public.custom_puzzles) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.custom_puzzle_in_community(_p public.custom_puzzles) TO service_role;
REVOKE ALL ON FUNCTION public.custom_puzzle_card_json(_p public.custom_puzzles) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.custom_puzzle_card_json(_p public.custom_puzzles) TO service_role;
REVOKE ALL ON FUNCTION public.community_creator_json(_c public.creator_profiles) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.community_creator_json(_c public.creator_profiles) TO service_role;

REVOKE ALL ON FUNCTION public.search_community_creators(_query text, _limit integer, _offset integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_community_creators(_query text, _limit integer, _offset integer) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_creator_community(_slug text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_creator_community(_slug text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_creator_follow(_slug text, _follow boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_creator_follow(_slug text, _follow boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_following_feed(_limit integer, _offset integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_following_feed(_limit integer, _offset integer) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_custom_puzzle_cards(_share_ids text[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_custom_puzzle_cards(_share_ids text[]) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.custom_puzzle_share_id(_short_code text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.custom_puzzle_share_id(_short_code text) TO anon, authenticated, service_role;

COMMENT ON TABLE public.creator_follows IS 'One-way follows of a creator by a Rainbow account. Readable only through the follower''s own get_following_feed; others see an aggregate count.';
COMMENT ON FUNCTION public.search_community_creators(_query text, _limit integer, _offset integer) IS 'Creators with at least one puzzle currently in Community, by public name or slug. Aggregate counts only.';
COMMENT ON FUNCTION public.get_following_feed(_limit integer, _offset integer) IS 'The caller''s followed creators and their puzzles currently in Community, newest listing first.';

COMMIT;
