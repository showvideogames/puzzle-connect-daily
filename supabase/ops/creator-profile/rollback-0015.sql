-- Undo 0015_listed_owner_creator_profile.sql: restores the 0004 listing
-- setter and the 0013 public-name setter, and drops the three new functions.
-- Creator pages it created stay (each is one owner's own public page, with
-- a stable slug that links may already point to). Afterwards:
--   npx supabase migration repair --status reverted 0015 --linked
BEGIN;

DROP FUNCTION IF EXISTS public.admin_ensure_puzzle_creator_profile(_short_code text);
DROP FUNCTION IF EXISTS public.ensure_my_creator_profile();

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
  return jsonb_build_object('outcome', 'saved', 'chosen', true, 'display_name', _clean,
    'next_change_at', _last_renamed_at + interval '720 hours');
end;
$$;

DROP FUNCTION IF EXISTS public.custom_ensure_listed_owner_profile(_uid uuid, _fallback text);

COMMIT;
