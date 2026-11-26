-- Per-emoji cover sizes (PREVIEW; not applied to any hosted database).
--
-- Additive. Each occupied emoji slot (1-3) of a creator cover can have its
-- own size, a whole percentage of the standard size from 50 to 250. Stored as
-- one bounded array beside the emoji, slot for slot, in the same order. Null
-- (every existing cover, and any cover whose sizes are all 100) means the
-- standard sizes, so older covers look exactly as before.
--
-- Only the puzzle's creator sets sizes, through set_custom_puzzle_cover_sized,
-- which runs every check of set_custom_puzzle_cover_emojis (owner, allowlisted
-- keys, distinct, 1-3, preset background) and then checks the sizes. The older
-- setters still work and clear the sizes, since their emoji may change. Sizes
-- reach every payload that carries a cover, as cover_sizes. Nothing else about
-- a puzzle, its listing or its links changes.
BEGIN;

ALTER TABLE public.custom_puzzles ADD COLUMN cover_emoji_sizes smallint[];
ALTER TABLE public.custom_puzzles ADD CONSTRAINT custom_puzzles_cover_emoji_sizes CHECK (
  cover_emoji_sizes IS NULL OR (
    cover_emoji IS NOT NULL
    AND array_ndims(cover_emoji_sizes) = 1
    AND cardinality(cover_emoji_sizes) = (CASE WHEN cover_emoji_3 IS NOT NULL THEN 3 WHEN cover_emoji_2 IS NOT NULL THEN 2 ELSE 1 END)
    AND array_position(cover_emoji_sizes, NULL) IS NULL
    AND 50 <= ALL (cover_emoji_sizes)
    AND 250 >= ALL (cover_emoji_sizes)
  )
);

CREATE OR REPLACE FUNCTION public.custom_puzzle_card_json(_p public.custom_puzzles) RETURNS jsonb
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
    'listed_at',      _p.community_listed_at,
    'cover_emoji',    _p.cover_emoji,
    'cover_emoji_2',  _p.cover_emoji_2,
    'cover_emoji_3',  _p.cover_emoji_3,
    'cover_sizes',  _p.cover_emoji_sizes,
    'cover_background', _p.cover_background
  )
$$;

CREATE OR REPLACE FUNCTION public.list_community_puzzles(_query text DEFAULT NULL::text, _sort text DEFAULT 'newest'::text, _limit integer DEFAULT 24, _offset integer DEFAULT 0) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _s     text    := case when _sort in ('plays', 'likes') then _sort else 'newest' end;
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
           cp.community_listed_at as listed_at,
           cp.cover_emoji,
           cp.cover_emoji_2,
           cp.cover_emoji_3,
           cp.cover_emoji_sizes,
           cp.cover_background
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
                                       (case when _s = 'likes' then e.favs end) desc nulls last,
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
                      'listed_at',      p.listed_at,
                      'cover_emoji',    p.cover_emoji,
                      'cover_emoji_2',  p.cover_emoji_2,
                      'cover_emoji_3',  p.cover_emoji_3,
                      'cover_sizes',  p.cover_emoji_sizes,
                      'cover_background', p.cover_background
                    ) order by p.rn) filter (where p.rn <= _off + _lim), '[]'::jsonb),
           'has_more', count(*) > _lim,
           'limit',    _lim,
           'offset',   _off)
    into _rows
    from page p;

  return _rows;
end;
$$;

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
    'cover_emoji',     _p.cover_emoji,
    'cover_emoji_2',   _p.cover_emoji_2,
    'cover_emoji_3',   _p.cover_emoji_3,
    'cover_sizes',   _p.cover_emoji_sizes,
    'cover_background', _p.cover_background,
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
               'favorited_at',   f.created_at,
               'cover_emoji',    cp.cover_emoji,
               'cover_emoji_2',  cp.cover_emoji_2,
               'cover_emoji_3',  cp.cover_emoji_3,
               'cover_sizes',  cp.cover_emoji_sizes,
               'cover_background', cp.cover_background
             ) as item
        from public.custom_puzzle_favorites f
        join public.custom_puzzles cp on cp.id = f.custom_puzzle_id
       where f.user_id = public.rainbow_uid()
         and cp.moderation_status = 'active'
       order by f.created_at desc
       limit 200
    ) q
$$;

CREATE OR REPLACE FUNCTION public.list_my_custom_puzzles(_limit integer DEFAULT 24, _offset integer DEFAULT 0) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _uid   uuid := public.rainbow_uid();
  _lim   integer := least(greatest(coalesce(_limit, 24), 1), 48);
  _off   integer := least(greatest(coalesce(_offset, 0), 0), 10000);
  _items jsonb;
  _more  boolean;
  _total integer;
begin
  if _uid is null then
    raise exception 'sign in to see your puzzles' using errcode = 'insufficient_privilege';
  end if;

  select count(*) into _total from public.custom_puzzles where created_by = _uid;

  -- One row past the page says whether there is more.
  select coalesce(jsonb_agg(pg.j order by pg.n) filter (where pg.n <= _lim), '[]'::jsonb), count(*) > _lim
    into _items, _more
    from (
      select row_number() over (order by cp.created_at desc, cp.short_code) - _off as n,
             jsonb_build_object(
               'share_id',         cp.share_id,
               'short_code',       cp.short_code,
               'title',            cp.title,
               'creator_name',     cp.creator_name,
               'mode',             cp.content ->> 'mode',
               'visibility',       cp.visibility,
               'hidden',           cp.moderation_status <> 'active',
               'listed',           cp.community_listed and cp.moderation_status = 'active',
               'can_list',         cp.visibility = 'public' and cp.moderation_status = 'active',
               'cover_emoji',      cp.cover_emoji,
               'cover_emoji_2',    cp.cover_emoji_2,
               'cover_emoji_3',    cp.cover_emoji_3,
               'cover_sizes',    cp.cover_emoji_sizes,
               'cover_background', cp.cover_background,
               'created_at',       cp.created_at
             ) as j
        from public.custom_puzzles cp
       where cp.created_by = _uid
       order by cp.created_at desc, cp.short_code
       limit _lim + 1 offset _off
    ) pg;

  return jsonb_build_object('items', _items, 'has_more', _more, 'total', _total, 'limit', _lim, 'offset', _off);
end;
$$;

CREATE OR REPLACE FUNCTION public.set_custom_puzzle_cover(_share_id text, _emoji text, _background text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _uid uuid := public.rainbow_uid();
  _p   public.custom_puzzles%rowtype;
begin
  if _uid is null then
    raise exception 'sign in to add a cover' using errcode = 'insufficient_privilege';
  end if;
  if (_emoji is null) <> (_background is null) then
    raise exception 'a cover is one emoji and one background' using errcode = 'invalid_parameter_value';
  end if;
  if _emoji is not null and not exists (select 1 from public.community_cover_emoji where key = _emoji) then
    raise exception 'that emoji is not available for covers' using errcode = 'invalid_parameter_value';
  end if;
  if _background is not null and _background <> all (array['rainbow-bands'::text, 'pastel-rainbow'::text, 'dusk-gradient'::text, 'ocean-gradient'::text, 'retro-sunburst'::text, 'sunset-split'::text, 'lilac'::text, 'butter'::text, 'mint'::text, 'sunflower'::text, 'tangerine'::text, 'coral'::text, 'bubblegum'::text, 'ocean'::text, 'forest'::text, 'charcoal'::text, 'lime-checks'::text, 'apricot-stripes'::text, 'lilac-dots'::text, 'indigo-stars'::text, 'teal-waves'::text, 'pink-waves'::text, 'sky-grid'::text, 'cream-confetti'::text, 'berry-stripes'::text, 'cherry-polka'::text, 'peach-rings'::text, 'mint-checks'::text, 'terrazzo'::text, 'sparkles'::text, 'ripples'::text, 'bold-checker'::text, 'candy-stripes'::text, 'polka-pop'::text, 'mint-zigzag'::text, 'peach-sorbet'::text, 'northern-lights'::text, 'rosey-dawn'::text, 'pool-party'::text, 'blue-hour'::text, 'lemon-lime'::text, 'plum-velvet'::text, 'watermelon-split'::text, 'frost-blue'::text, 'tomato'::text, 'tart-cherry'::text, 'evergreen'::text, 'deep-navy'::text, 'periwinkle'::text, 'marigold'::text, 'warm-sand'::text, 'oat-paper'::text, 'picnic-gingham'::text, 'blueberry-gingham'::text, 'school-paper'::text, 'graph-paper'::text, 'navy-pinstripe'::text, 'citrus-dots'::text, 'purple-disco'::text, 'caramel-weave'::text, 'seaglass-scales'::text, 'retro-mosaic'::text, 'moonlit'::text, 'snowfall'::text, 'daisy-field'::text, 'sugar-hearts'::text, 'daydream-clouds'::text, 'desert-dunes'::text, 'botanical-stems'::text, 'arcade-pixels'::text, 'retro-orbits'::text, 'little-lightning'::text]) then
    raise exception 'that background is not available for covers' using errcode = 'invalid_parameter_value';
  end if;

  select * into _p from public.custom_puzzles where share_id = _share_id for update;
  if _p.id is null then
    raise exception 'puzzle not found' using errcode = 'no_data_found';
  end if;
  if _p.created_by is distinct from _uid then
    raise exception 'only the puzzle''s creator can change its cover' using errcode = 'insufficient_privilege';
  end if;

  -- The one-emoji call (0008) still works and means exactly one emoji.
  update public.custom_puzzles set cover_emoji = _emoji, cover_emoji_2 = null, cover_emoji_3 = null, cover_emoji_sizes = null, cover_background = _background
   where id = _p.id and created_by = _uid;
  return jsonb_build_object('cover_emoji', _emoji, 'cover_background', _background);
end;
$$;

CREATE OR REPLACE FUNCTION public.set_custom_puzzle_cover_emojis(_share_id text, _emojis text[], _background text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _uid  uuid := public.rainbow_uid();
  _p    public.custom_puzzles%rowtype;
  _list text[] := coalesce(_emojis, '{}'::text[]);
  _k    text;
begin
  if _uid is null then
    raise exception 'sign in to add a cover' using errcode = 'insufficient_privilege';
  end if;
  if array_ndims(_list) > 1 then
    raise exception 'a cover is a simple list of emoji' using errcode = 'invalid_parameter_value';
  end if;
  if (cardinality(_list) = 0) <> (_background is null) then
    raise exception 'a cover is one to three emoji and one background' using errcode = 'invalid_parameter_value';
  end if;
  if cardinality(_list) > 3 then
    raise exception 'a cover has at most three emoji' using errcode = 'invalid_parameter_value';
  end if;
  if array_position(_list, null) is not null then
    raise exception 'a cover is one to three emoji and one background' using errcode = 'invalid_parameter_value';
  end if;
  if (select count(distinct x) from unnest(_list) x) <> cardinality(_list) then
    raise exception 'each emoji can be used once' using errcode = 'invalid_parameter_value';
  end if;
  foreach _k in array _list loop
    if not exists (select 1 from public.community_cover_emoji where key = _k) then
      raise exception 'that emoji is not available for covers' using errcode = 'invalid_parameter_value';
    end if;
  end loop;
  if _background is not null and _background <> all (array['rainbow-bands'::text, 'pastel-rainbow'::text, 'dusk-gradient'::text, 'ocean-gradient'::text, 'retro-sunburst'::text, 'sunset-split'::text, 'lilac'::text, 'butter'::text, 'mint'::text, 'sunflower'::text, 'tangerine'::text, 'coral'::text, 'bubblegum'::text, 'ocean'::text, 'forest'::text, 'charcoal'::text, 'lime-checks'::text, 'apricot-stripes'::text, 'lilac-dots'::text, 'indigo-stars'::text, 'teal-waves'::text, 'pink-waves'::text, 'sky-grid'::text, 'cream-confetti'::text, 'berry-stripes'::text, 'cherry-polka'::text, 'peach-rings'::text, 'mint-checks'::text, 'terrazzo'::text, 'sparkles'::text, 'ripples'::text, 'bold-checker'::text, 'candy-stripes'::text, 'polka-pop'::text, 'mint-zigzag'::text, 'peach-sorbet'::text, 'northern-lights'::text, 'rosey-dawn'::text, 'pool-party'::text, 'blue-hour'::text, 'lemon-lime'::text, 'plum-velvet'::text, 'watermelon-split'::text, 'frost-blue'::text, 'tomato'::text, 'tart-cherry'::text, 'evergreen'::text, 'deep-navy'::text, 'periwinkle'::text, 'marigold'::text, 'warm-sand'::text, 'oat-paper'::text, 'picnic-gingham'::text, 'blueberry-gingham'::text, 'school-paper'::text, 'graph-paper'::text, 'navy-pinstripe'::text, 'citrus-dots'::text, 'purple-disco'::text, 'caramel-weave'::text, 'seaglass-scales'::text, 'retro-mosaic'::text, 'moonlit'::text, 'snowfall'::text, 'daisy-field'::text, 'sugar-hearts'::text, 'daydream-clouds'::text, 'desert-dunes'::text, 'botanical-stems'::text, 'arcade-pixels'::text, 'retro-orbits'::text, 'little-lightning'::text]) then
    raise exception 'that background is not available for covers' using errcode = 'invalid_parameter_value';
  end if;

  select * into _p from public.custom_puzzles where share_id = _share_id for update;
  if _p.id is null then
    raise exception 'puzzle not found' using errcode = 'no_data_found';
  end if;
  if _p.created_by is distinct from _uid then
    raise exception 'only the puzzle''s creator can change its cover' using errcode = 'insufficient_privilege';
  end if;

  update public.custom_puzzles
     set cover_emoji = _list[1], cover_emoji_2 = _list[2], cover_emoji_3 = _list[3], cover_emoji_sizes = null, cover_background = _background
   where id = _p.id and created_by = _uid;
  return jsonb_build_object('cover_emoji', _list[1], 'cover_emoji_2', _list[2], 'cover_emoji_3', _list[3], 'cover_background', _background);
end;
$$;

-- set_custom_puzzle_cover_sized(text, text[], text, integer[])
CREATE FUNCTION public.set_custom_puzzle_cover_sized(_share_id text, _emojis text[], _background text, _sizes integer[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _uid   uuid := public.rainbow_uid();
  _list  text[] := coalesce(_emojis, '{}'::text[]);
  _store smallint[];
  _out   jsonb;
begin
  if _uid is null then
    raise exception 'sign in to add a cover' using errcode = 'insufficient_privilege';
  end if;
  if _sizes is not null then
    if array_ndims(_sizes) > 1 or cardinality(_sizes) <> cardinality(_list) or array_position(_sizes, null) is not null then
      raise exception 'each emoji has one size' using errcode = 'invalid_parameter_value';
    end if;
    if exists (select 1 from unnest(_sizes) v where v < 50 or v > 250) then
      raise exception 'an emoji size is from 50%% to 250%%' using errcode = 'invalid_parameter_value';
    end if;
    -- All standard: stored as none, exactly like a cover saved before sizes.
    if not (100 = all (_sizes)) then
      _store := _sizes::smallint[];
    end if;
  end if;

  -- Every existing check (owner, keys, 1-3 distinct, background) and the write.
  _out := public.set_custom_puzzle_cover_emojis(_share_id, _emojis, _background);
  update public.custom_puzzles
     set cover_emoji_sizes = _store
   where share_id = _share_id and created_by = _uid;
  return _out || jsonb_build_object('cover_sizes', to_jsonb(_store));
end;
$$;

REVOKE ALL ON FUNCTION public.set_custom_puzzle_cover_sized(_share_id text, _emojis text[], _background text, _sizes integer[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_custom_puzzle_cover_sized(_share_id text, _emojis text[], _background text, _sizes integer[]) TO authenticated, service_role;
COMMENT ON FUNCTION public.set_custom_puzzle_cover_sized(_share_id text, _emojis text[], _background text, _sizes integer[]) IS 'The puzzle''s own creator sets or removes its cover: 1-3 distinct allowlisted emoji, one preset background and, per emoji, a whole-number size from 50 to 250 percent (null = standard).';

COMMIT;
