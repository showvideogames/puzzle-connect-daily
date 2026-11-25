-- Community curation fix (PREVIEW; not applied to any hosted database).
--
-- 0006's admin_set_community_curation refused the WHOLE save whenever any
-- chosen puzzle was not in Community right now. So once a saved Pick (or the
-- Featured Puzzle) was unlisted by its creator, the admin couldn't save any
-- other edit (reorder, a new Featured Puzzle, another Pick) without first
-- removing it.
--
-- Now:
--   * a puzzle ALREADY in the saved curation may stay in it (in any slot) even
--     while it is not eligible. Explore still hides it, because every public
--     read re-checks eligibility (get_community_explore is unchanged), and it
--     reappears where the admin left it if its creator lists it again;
--   * it can still be removed or replaced explicitly, like any entry;
--   * a NEW addition must be in Community right now, exactly as before;
--   * every other 0006 rule is unchanged (admin only, at most six Picks, no
--     duplicates, the Featured Puzzle can't also be a Pick).
-- The eligibility check and the replace now run under the same advisory lock,
-- so "already saved" is read from the curation being replaced.
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_set_community_curation(_featured text, _picks text[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _uid   uuid := public.rainbow_uid();
  _picks_n text[] := coalesce(_picks, '{}'::text[]);
  _code  text;
  _id    uuid;
  _i     integer := 0;
begin
  if _uid is null or not public.has_role(_uid, 'admin') then
    raise exception 'admin role required' using errcode = 'insufficient_privilege';
  end if;
  if cardinality(_picks_n) > 6 then
    raise exception 'at most six Editor''s Picks' using errcode = 'invalid_parameter_value';
  end if;
  if (select count(distinct x) from unnest(_picks_n) x) <> cardinality(_picks_n) then
    raise exception 'a puzzle can only be picked once' using errcode = 'invalid_parameter_value';
  end if;
  if _featured is not null and _featured = any (_picks_n) then
    raise exception 'the Featured Puzzle can''t also be an Editor''s Pick' using errcode = 'invalid_parameter_value';
  end if;

  -- Two admins saving at once: the second waits, then replaces the first.
  perform pg_advisory_xact_lock(hashtext('public.community_curation'));

  foreach _code in array (case when _featured is null then _picks_n else array[_featured] || _picks_n end) loop
    select cp.id into _id from public.custom_puzzles cp where cp.short_code = _code;
    if _id is null then
      raise exception 'puzzle not found (%)', _code using errcode = 'invalid_parameter_value';
    end if;
    if not exists (select 1 from public.custom_puzzles cp where cp.id = _id and public.custom_puzzle_in_community(cp))
       and not exists (select 1 from public.community_curation c where c.custom_puzzle_id = _id) then
      raise exception 'only puzzles listed in Community can be added (%)', _code using errcode = 'invalid_parameter_value';
    end if;
  end loop;

  delete from public.community_curation where true;
  if _featured is not null then
    insert into public.community_curation (custom_puzzle_id, slot, "position", set_by)
    select cp.id, 'featured', 0, _uid from public.custom_puzzles cp where cp.short_code = _featured;
  end if;
  foreach _code in array _picks_n loop
    select id into _id from public.custom_puzzles where short_code = _code;
    insert into public.community_curation (custom_puzzle_id, slot, "position", set_by) values (_id, 'pick', _i, _uid);
    _i := _i + 1;
  end loop;

  return public.admin_get_community_curation();
end;
$$;

COMMENT ON FUNCTION public.admin_set_community_curation(_featured text, _picks text[]) IS 'Admin only. Replaces the whole curation. New additions must be listed in Community; entries already saved may stay while hidden (Explore re-checks on read) and can be removed or replaced.';

COMMIT;
