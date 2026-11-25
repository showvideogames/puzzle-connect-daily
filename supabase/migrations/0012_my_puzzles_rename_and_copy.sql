-- My Puzzles: Rename, and the owner's own content for Duplicate & Edit
-- (PREVIEW; not applied to any hosted database).
--
-- Additive: two functions and an updated table comment. No column, constraint
-- or data change.
--
-- rename_custom_puzzle changes ONLY the title of the caller's own puzzle. The
-- owner comes from the existing Rainbow identity (rainbow_uid()) on the server;
-- guests and every other account are refused. The title follows exactly the
-- rule create_custom_puzzle uses: trimmed, required, at most 100 characters.
-- Everything else stays as it was: the row (its id, so results, stats,
-- favourites, ratings, curation and the cover keep pointing at it), the share
-- id and short code (so every link keeps working), content, visibility,
-- Community listing and listing time, the designer name, moderation status and
-- the creation time. A puzzle hidden by moderators can't be renamed.
--
-- get_my_custom_puzzle_source returns the caller's OWN puzzle's builder
-- content, so My Puzzles can open a new local draft from it (Duplicate &
-- Edit). It is refused for guests, for every other account and for hidden
-- puzzles, so no one gets another creator's builder data through it. It only
-- reads: the copy is a draft in the creator's browser and becomes a puzzle,
-- with its own link and stats, only through create_custom_puzzle.
BEGIN;

-- rename_custom_puzzle(text, text)
CREATE FUNCTION public.rename_custom_puzzle(_share_id text, _title text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _uid     uuid := public.rainbow_uid();
  _p       public.custom_puzzles%rowtype;
  _title_n text;
begin
  if _uid is null then
    raise exception 'sign in to rename your puzzles' using errcode = 'insufficient_privilege';
  end if;

  -- The same rule as create_custom_puzzle.
  _title_n := nullif(btrim(coalesce(_title, '')), '');
  if _title_n is null then
    raise exception 'a puzzle needs a title' using errcode = 'invalid_parameter_value';
  end if;
  if length(_title_n) > 100 then
    raise exception 'title is too long (max 100 characters)' using errcode = 'invalid_parameter_value';
  end if;

  select * into _p from public.custom_puzzles where share_id = _share_id for update;
  if _p.id is null then
    raise exception 'puzzle not found' using errcode = 'no_data_found';
  end if;
  if _p.created_by is distinct from _uid then
    raise exception 'only the puzzle''s creator can rename it' using errcode = 'insufficient_privilege';
  end if;
  if _p.moderation_status <> 'active' then
    raise exception 'this puzzle can''t be renamed' using errcode = 'insufficient_privilege';
  end if;

  update public.custom_puzzles
     set title = _title_n
   where id = _p.id
     and created_by = _uid;

  return jsonb_build_object('title', _title_n);
end;
$$;

-- get_my_custom_puzzle_source(text)
CREATE FUNCTION public.get_my_custom_puzzle_source(_share_id text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _uid uuid := public.rainbow_uid();
  _p   public.custom_puzzles%rowtype;
begin
  if _uid is null then
    raise exception 'sign in to copy your puzzles' using errcode = 'insufficient_privilege';
  end if;
  select * into _p from public.custom_puzzles where share_id = _share_id;
  if _p.id is null then
    raise exception 'puzzle not found' using errcode = 'no_data_found';
  end if;
  if _p.created_by is distinct from _uid then
    raise exception 'only the puzzle''s creator can copy it' using errcode = 'insufficient_privilege';
  end if;
  if _p.moderation_status <> 'active' then
    raise exception 'this puzzle can''t be copied' using errcode = 'insufficient_privilege';
  end if;
  return jsonb_build_object(
    'title',        _p.title,
    'creator_name', _p.creator_name,
    'visibility',   _p.visibility,
    'content',      _p.content
  );
end;
$$;

REVOKE ALL ON FUNCTION public.rename_custom_puzzle(_share_id text, _title text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rename_custom_puzzle(_share_id text, _title text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_my_custom_puzzle_source(_share_id text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_custom_puzzle_source(_share_id text) TO authenticated, service_role;

COMMENT ON FUNCTION public.rename_custom_puzzle(_share_id text, _title text) IS 'My Puzzles: the signed-in creator renames their own active puzzle (owner from rainbow_uid()). Title only, same rule as create (trimmed, 1-100 characters). Links, content, visibility, listing, cover, results, favourites and ratings are unchanged.';
COMMENT ON FUNCTION public.get_my_custom_puzzle_source(_share_id text) IS 'My Puzzles, Duplicate & Edit: the caller''s own active puzzle''s title, designer name, visibility and builder content. Refused for guests, other accounts and hidden puzzles. Read-only.';
COMMENT ON TABLE public.custom_puzzles IS 'Player-created puzzles (Phase 2, Full 4x4 only). Content is immutable after creation; only the creator can rename (rename_custom_puzzle). Reachable only through create_custom_puzzle/get_custom_puzzle and the owner functions -- no direct grants to anon/authenticated.';

COMMIT;
