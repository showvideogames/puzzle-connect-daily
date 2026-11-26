-- Emergency rollback restores the pre-0013 create behavior and hides both RPCs.
-- Keep selected names, existing public creator names, and all puzzle rows intact.
-- Re-enable by restoring the 0013 functions using CREATE OR REPLACE and regranting;
-- do not re-run the migration or delete the table. Roll back the frontend first.
BEGIN;
REVOKE EXECUTE ON FUNCTION public.get_my_creator_name(), public.set_my_creator_name(text) FROM authenticated;
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

  _creator_n := nullif(btrim(coalesce(_creator_name, '')), '');
  if _creator_n is null then
    raise exception 'a designer name is required' using errcode = 'invalid_parameter_value';
  end if;
  if length(_creator_n) > 60 then
    raise exception 'designer name is too long (max 60 characters)' using errcode = 'invalid_parameter_value';
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
