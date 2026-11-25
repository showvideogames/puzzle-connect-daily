-- My Puzzles: the signed-in creator's own library (PREVIEW; not applied to
-- any hosted database).
--
-- Additive only: one read function, no table, column or data change.
--
-- list_my_custom_puzzles returns ONLY the caller's own puzzles. The owner is
-- resolved on the server from the existing Rainbow identity (rainbow_uid());
-- there is no user id parameter, so no caller can ask for anyone else's.
-- It covers every puzzle the account created: older ones made before
-- Community existed (never listed, no cover), Public link-only ones, listed
-- ones, Private ones and any an admin hid. Guest-made puzzles
-- (created_by is null) belong to no account and never appear.
--
-- Each row carries only what the library shows and what the existing owner
-- actions need: title, the designer name the owner typed (the cover
-- preview's byline), Classic/Rainbow, the share codes for Open / Copy Link
-- and for the existing cover and listing calls, visibility, whether it is
-- hidden, listed and listable, the cover keys and the creation time. Never
-- content (categories, words, hints, answers), the internal id, created_by
-- or any account field.
--
-- Reading changes nothing: listing, visibility and covers still change only
-- through set_custom_puzzle_community_listing and set_custom_puzzle_cover_emojis.
-- Bounded: at most 48 rows per page, offset at most 10000. Newest first.
BEGIN;

-- list_my_custom_puzzles(integer, integer)
CREATE FUNCTION public.list_my_custom_puzzles(_limit integer DEFAULT 24, _offset integer DEFAULT 0) RETURNS jsonb
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

-- The owner's library is read newest first; this keeps it an index scan.
CREATE INDEX custom_puzzles_owner_newest_idx ON public.custom_puzzles USING btree (created_by, created_at DESC, short_code)
  WHERE (created_by IS NOT NULL);

REVOKE ALL ON FUNCTION public.list_my_custom_puzzles(_limit integer, _offset integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_my_custom_puzzles(_limit integer, _offset integer) TO authenticated, service_role;
COMMENT ON FUNCTION public.list_my_custom_puzzles(_limit integer, _offset integer) IS 'My Puzzles: the signed-in caller''s own custom puzzles (owner from rainbow_uid(), no id parameter), newest first, bounded (<=48 per page, offset <=10000). Library fields only: never content, internal id, created_by or account data. Read-only.';

COMMIT;
