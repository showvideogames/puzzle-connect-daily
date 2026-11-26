-- Rainbow public creator name. Existing authored puzzle bylines are snapshots,
-- and are deliberately not rewritten. No changes to sign-in or shared social names.
BEGIN;

CREATE TABLE public.creator_name_choices (
  user_id uuid PRIMARY KEY REFERENCES public.accounts(user_id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (char_length(display_name) between 1 and 60),
  last_renamed_at timestamptz
);
ALTER TABLE public.creator_name_choices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.creator_name_choices FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.get_my_creator_name() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
declare
  _uid uuid := public.rainbow_uid();
  _name text;
  _at timestamptz;
  _chosen boolean;
begin
  if _uid is null then
    raise exception 'sign in to manage your public name' using errcode = 'insufficient_privilege';
  end if;
  select c.display_name, c.last_renamed_at into _name, _at from public.creator_name_choices c where c.user_id = _uid;
  _chosen := found;
  if not _chosen then
    select c.display_name into _name from public.creator_profiles c where c.user_id = _uid;
  end if;
  return jsonb_build_object('display_name', _name, 'next_change_at', _at + interval '720 hours', 'chosen', _chosen, 'outcome', 'ready');
end;
$$;

CREATE FUNCTION public.set_my_creator_name(_name text) RETURNS jsonb
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

REVOKE ALL ON FUNCTION public.get_my_creator_name(), public.set_my_creator_name(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_creator_name(), public.set_my_creator_name(text) TO authenticated;

-- Existing create RPC, with the chosen byline resolved on the server so old
-- clients, other devices, or a very old draft cannot silently override it.
CREATE OR REPLACE FUNCTION public.create_custom_puzzle(_creator_name text, _title text, _visibility text, _content jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _uid        uuid := public.rainbow_uid();
  _canonical  jsonb;
  _title_n    text;
  _creator_n  text;
  _share_id   text;
  _short_code text;
  _id         uuid;
  _tries      integer := 0;
  _initial_name boolean := false;
begin
  if _visibility not in ('public', 'private') then
    raise exception 'visibility must be public or private' using errcode = 'invalid_parameter_value';
  end if;

  _canonical := public.validate_custom_puzzle_content(_content);

  _title_n := nullif(btrim(coalesce(_title, '')), '');
  if _title_n is null then
    raise exception 'a puzzle needs a title' using errcode = 'invalid_parameter_value';
  end if;
  if length(_title_n) > 100 then
    raise exception 'title is too long (max 100 characters)' using errcode = 'invalid_parameter_value';
  end if;

  if _uid is not null then
    -- The same lock as set_my_creator_name serializes a concurrent change.
    perform 1 from public.accounts where user_id = _uid for update;
    if not found then
      raise exception 'sign in again to attach this puzzle to your account' using errcode = 'insufficient_privilege';
    end if;
    select c.display_name into _creator_n
      from public.creator_name_choices c where c.user_id = _uid;
    if not found then
      select c.display_name into _creator_n from public.creator_profiles c where c.user_id = _uid;
      _initial_name := not found;
    end if;
  end if;
  if _initial_name and (char_length(_creator_name) > 256 or _creator_name ~ '[[:cntrl:]@]' or
       _creator_name ~ U&'[\202A-\202E\2066-\2069]') then
    raise exception 'enter a username or name, not an email address' using errcode = 'invalid_parameter_value';
  end if;
  _creator_n := coalesce(_creator_n, nullif(btrim(case when _initial_name
    then regexp_replace(coalesce(_creator_name, ''), '[[:space:]]+', ' ', 'g')
    else coalesce(_creator_name, '') end), ''));
  if _creator_n is null then
    raise exception 'a designer name is required' using errcode = 'invalid_parameter_value';
  end if;
  if length(_creator_n) > 60 then
    raise exception 'designer name is too long (max 60 characters)' using errcode = 'invalid_parameter_value';
  end if;

  -- For a signed-in creator, the first published byline is the first
  -- choice (including an existing creator profile's name when available).
  -- Publishing again cannot bypass the rename cooldown; guests are unchanged.
  if _uid is not null then
    insert into public.creator_name_choices(user_id, display_name, last_renamed_at)
    values (_uid, _creator_n, null)
    on conflict (user_id) do nothing;
  end if;

  loop
    _share_id   := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    _short_code := public.custom_puzzle_new_short_code();
    begin
      insert into public.custom_puzzles (share_id, short_code, visibility, created_by, creator_name, title, content)
      values (_share_id, _short_code, _visibility, _uid, _creator_n, _title_n, _canonical)
      returning id into _id;
      exit;
    exception when unique_violation then
      -- share_id or short_code collided: draw both again.
      _tries := _tries + 1;
      if _tries >= 10 then raise; end if;
    end;
  end loop;

  perform public.custom_ensure_creator_profile(_uid, _creator_n);

  return jsonb_build_object('puzzle_id', _id, 'share_id', _share_id, 'short_code', _short_code);
end;
$$;

COMMIT;
