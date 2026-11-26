-- A public creator page for an owner whose puzzle is in Community but who has
-- no creator profile (PREVIEW; not applied to any hosted database).
--
-- Why: a Community card links its byline to /creator/<slug>, and the slug
-- comes only from creator_profiles for the puzzle's owner (created_by). That
-- row is made by create_custom_puzzle. A legacy puzzle whose ownership was
-- later reassigned to another account (no app path does this; it was done by
-- hand) can be listed by an owner who never got a creator profile, so its
-- byline renders as plain text. The card's renderer is right: there is no
-- page to link to.
--
-- Fix, owner-safe and bounded to one owner at a time, never by name matching
-- and never as a bulk rewrite:
--   * custom_ensure_listed_owner_profile(uid, fallback): internal. If that
--     account has no creator profile AND owns at least one puzzle that is in
--     Community, creates its profile (a new stable slug) named with the
--     account's chosen public name, else the given byline, else its newest
--     listed puzzle's saved byline. Never renames or re-slugs an existing
--     profile, and never makes a page for someone with nothing listed.
--   * Called when an owner lists a puzzle and when they save a public name,
--     and by ensure_my_creator_profile() (the signed-in owner, from My
--     Puzzles).
--   * admin_ensure_puzzle_creator_profile(short_code): admin only, one
--     puzzle; resolves that puzzle's actual owner and does the same. For a
--     reported puzzle whose owner hasn't been back.
-- Ownership, titles, bylines, visibility, content and stats are untouched.
BEGIN;

-- custom_ensure_listed_owner_profile(uuid, text)
CREATE FUNCTION public.custom_ensure_listed_owner_profile(_uid uuid, _fallback text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _slug text;
  _name text;
begin
  if _uid is null then
    return null;
  end if;
  select public_slug into _slug from public.creator_profiles where user_id = _uid;
  if _slug is not null then
    return _slug;
  end if;
  -- Only an owner with something in Community gets a public page this way.
  if not exists (select 1 from public.custom_puzzles cp where cp.created_by = _uid and public.custom_puzzle_in_community(cp)) then
    return null;
  end if;
  select c.display_name into _name from public.creator_name_choices c where c.user_id = _uid;
  _name := coalesce(
    nullif(btrim(_name), ''),
    nullif(btrim(_fallback), ''),
    (select cp.creator_name from public.custom_puzzles cp
      where cp.created_by = _uid and public.custom_puzzle_in_community(cp)
      order by cp.community_listed_at desc nulls last, cp.short_code
      limit 1));
  perform public.custom_ensure_creator_profile(_uid, _name);
  select public_slug into _slug from public.creator_profiles where user_id = _uid;
  return _slug;
end;
$$;

CREATE OR REPLACE FUNCTION public.set_custom_puzzle_community_listing(_share_id text, _listed boolean) RETURNS jsonb
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

  -- Listed: make sure the owner has a public creator page (0015).
  if _listed then
    perform public.custom_ensure_listed_owner_profile(_uid, _p.creator_name);
  end if;

  return jsonb_build_object('listed', _listed);
end;
$$;

CREATE OR REPLACE FUNCTION public.set_my_creator_name(_name text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
declare
  _uid uuid := public.rainbow_uid();
  _clean text;
  _prior public.creator_name_choices%rowtype;
  _now timestamptz;
  _previous_name text;
  _last_renamed_at timestamptz;
begin
  if _uid is null then
    raise exception 'sign in to manage your public name' using errcode = 'insufficient_privilege';
  end if;

  -- Permit a nickname, spaces, accents, or first and last name. Do not carry
  -- ASCII controls, bidi formatting marks, or a pasted email into a public field.
  if _name is null or char_length(_name) > 256 or _name ~ '[[:cntrl:]@]' or
     _name ~ U&'[\202A-\202E\2066-\2069]' then
    return jsonb_build_object('outcome', 'invalid');
  end if;
  _clean := btrim(regexp_replace(_name, '[[:space:]]+', ' ', 'g'));
  if not (char_length(_clean) between 1 and 60) then
    return jsonb_build_object('outcome', 'invalid');
  end if;

  -- Locks even on first save; separate devices share the same server cooldown.
  perform 1 from public.accounts where user_id = _uid for update;
  if not found then
    raise exception 'sign in to manage your public name' using errcode = 'insufficient_privilege';
  end if;
  select * into _prior from public.creator_name_choices where user_id = _uid;
  _previous_name := _prior.display_name;
  if not found then
    select c.display_name into _previous_name from public.creator_profiles c where c.user_id = _uid;
  end if;
  _now := clock_timestamp();
  if _prior.display_name = _clean then
    return jsonb_build_object('outcome', 'unchanged', 'chosen', true, 'display_name', _prior.display_name,
      'next_change_at', _prior.last_renamed_at + interval '720 hours');
  end if;
  if _prior.last_renamed_at + interval '720 hours' > _now then
    return jsonb_build_object('outcome', 'cooldown', 'chosen', true, 'display_name', _prior.display_name,
      'next_change_at', _prior.last_renamed_at + interval '720 hours');
  end if;

  -- A first choice, or adopting an existing inferred byline as-is, does
  -- not start the clock. Only changing an already-established name does.
  _last_renamed_at := case when _previous_name is not null and _previous_name <> _clean then _now else _prior.last_renamed_at end;
  insert into public.creator_name_choices(user_id, display_name, last_renamed_at)
  values (_uid, _clean, _last_renamed_at)
  on conflict (user_id) do update
    set display_name = excluded.display_name, last_renamed_at = excluded.last_renamed_at;

  -- Update the existing creator page, but do not generate a public page for
  -- someone who has never made a puzzle. Never change an existing public slug.
  update public.creator_profiles set display_name = _clean where user_id = _uid;
  -- An owner with a puzzle in Community but no creator page gets one (0015).
  perform public.custom_ensure_listed_owner_profile(_uid, _clean);
  return jsonb_build_object('outcome', 'saved', 'chosen', true, 'display_name', _clean,
    'next_change_at', _last_renamed_at + interval '720 hours');
end;
$$;

-- ensure_my_creator_profile()
CREATE FUNCTION public.ensure_my_creator_profile() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _uid uuid := public.rainbow_uid();
begin
  if _uid is null then
    raise exception 'sign in to manage your puzzles' using errcode = 'insufficient_privilege';
  end if;
  return jsonb_build_object('public_slug', public.custom_ensure_listed_owner_profile(_uid, null));
end;
$$;

-- admin_ensure_puzzle_creator_profile(text)
CREATE FUNCTION public.admin_ensure_puzzle_creator_profile(_short_code text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _p public.custom_puzzles%rowtype;
begin
  if public.rainbow_uid() is null or not public.has_role(public.rainbow_uid(), 'admin'::public.app_role) then
    raise exception 'admins only' using errcode = 'insufficient_privilege';
  end if;
  select * into _p from public.custom_puzzles where short_code = _short_code;
  if _p.id is null then
    raise exception 'puzzle not found' using errcode = 'no_data_found';
  end if;
  if _p.created_by is null then
    return jsonb_build_object('public_slug', null, 'reason', 'no_owner');
  end if;
  if not public.custom_puzzle_in_community(_p) then
    return jsonb_build_object('public_slug', null, 'reason', 'not_in_community');
  end if;
  return jsonb_build_object('public_slug', public.custom_ensure_listed_owner_profile(_p.created_by, _p.creator_name));
end;
$$;

REVOKE ALL ON FUNCTION public.custom_ensure_listed_owner_profile(_uid uuid, _fallback text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.custom_ensure_listed_owner_profile(_uid uuid, _fallback text) TO service_role;
REVOKE ALL ON FUNCTION public.ensure_my_creator_profile() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ensure_my_creator_profile() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_ensure_puzzle_creator_profile(_short_code text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_ensure_puzzle_creator_profile(_short_code text) TO authenticated, service_role;
COMMENT ON FUNCTION public.ensure_my_creator_profile() IS 'The signed-in owner: if they have a puzzle in Community but no creator page, creates it (stable slug; chosen public name, else their listed byline). Returns their slug or null. Changes nothing else.';
COMMENT ON FUNCTION public.admin_ensure_puzzle_creator_profile(_short_code text) IS 'Admin only, one puzzle: gives that listed puzzle''s actual owner a creator page if they have none. Never matches by name; changes no puzzle.';

COMMIT;
