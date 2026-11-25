-- Community Puzzles, part 3 (PREVIEW; not applied to any hosted database):
-- human curation for Explore (one Featured Puzzle, a few ordered Editor's
-- Picks) and a stable, keyset-paged Newest list. Additive on top of 0004/0005.
--
-- Curation is chosen by an admin, by hand. Nothing here ranks by popularity or
-- selects automatically, and nothing promises a daily rotation.
--
-- Eligibility is NEVER stored by curation: every public read re-checks 0004's
-- rule (custom_puzzle_in_community: listed, Public, active, account-owned), so
-- a curated puzzle that is unlisted, hidden by an admin, or whose creator's
-- account is gone simply vanishes from Explore while its curation row waits.
-- Curation never lists a puzzle, never changes its links, and is invisible to
-- creators and players beyond what Explore shows.
--
-- Newest is ordered by community_listed_at, the FIRST time the creator listed
-- the puzzle (0004 keeps it on unlist and re-list), so nothing moves back to the
-- top later. It is keyset-paged on (listed_at, short_code), so a puzzle listed
-- or unlisted between pages can neither repeat nor be skipped among the rest.
-- No editorial or popularity filtering applies to it.
BEGIN;

CREATE TABLE public.community_curation (
    -- One row per puzzle: the Featured Puzzle can never also be a Pick.
    custom_puzzle_id uuid NOT NULL,
    slot text NOT NULL,
    "position" smallint NOT NULL,
    set_by uuid,
    set_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT community_curation_pkey PRIMARY KEY (custom_puzzle_id),
    CONSTRAINT community_curation_slot_check CHECK ((slot = ANY (ARRAY['featured'::text, 'pick'::text]))),
    CONSTRAINT community_curation_position_check CHECK ((((slot = 'featured'::text) AND ("position" = 0)) OR ((slot = 'pick'::text) AND ("position" >= 0) AND ("position" <= 5)))),
    CONSTRAINT community_curation_custom_puzzle_id_fkey FOREIGN KEY (custom_puzzle_id) REFERENCES public.custom_puzzles(id) ON DELETE CASCADE,
    CONSTRAINT community_curation_set_by_fkey FOREIGN KEY (set_by) REFERENCES auth.users(id) ON DELETE SET NULL
);
-- At most one Featured Puzzle, and each Pick position used once (so at most six).
CREATE UNIQUE INDEX community_curation_one_featured ON public.community_curation USING btree (slot) WHERE (slot = 'featured'::text);
CREATE UNIQUE INDEX community_curation_pick_position ON public.community_curation USING btree ("position") WHERE (slot = 'pick'::text);
ALTER TABLE public.community_curation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.community_curation FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.community_curation TO service_role;

-- get_community_explore()
-- Explore's curated shelf for everyone: the Featured Puzzle and the Picks,
-- in order, card fields only, eligibility re-checked now.
CREATE FUNCTION public.get_community_explore() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select jsonb_build_object(
    'featured', (
      select public.custom_puzzle_card_json(cp)
        from public.community_curation c
        join public.custom_puzzles cp on cp.id = c.custom_puzzle_id
       where c.slot = 'featured' and public.custom_puzzle_in_community(cp)
    ),
    'picks', coalesce((
      select jsonb_agg(public.custom_puzzle_card_json(cp) order by c."position")
        from public.community_curation c
        join public.custom_puzzles cp on cp.id = c.custom_puzzle_id
       where c.slot = 'pick' and public.custom_puzzle_in_community(cp)
    ), '[]'::jsonb)
  )
$$;

-- list_community_newest(integer, timestamp with time zone, text)
-- Every puzzle in Community now, by first listing time, newest first.
-- Pass the last item's listed_at and short_code to get the next page.
CREATE FUNCTION public.list_community_newest(_limit integer DEFAULT 24, _before_listed_at timestamp with time zone DEFAULT NULL::timestamp with time zone, _before_short_code text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _lim integer := least(greatest(coalesce(_limit, 24), 1), 48);
  _out jsonb;
begin
  with page as (
    select cp as c, cp.community_listed_at as at, cp.short_code as code
      from public.custom_puzzles cp
     where public.custom_puzzle_in_community(cp)
       and (_before_listed_at is null
            or cp.community_listed_at < _before_listed_at
            or (cp.community_listed_at = _before_listed_at and cp.short_code > coalesce(_before_short_code, '')))
     order by cp.community_listed_at desc, cp.short_code
     limit _lim + 1
  ), numbered as (
    select p.*, row_number() over (order by p.at desc, p.code) as rn from page p
  )
  select jsonb_build_object(
           'items', coalesce(jsonb_agg(public.custom_puzzle_card_json(n.c) order by n.rn) filter (where n.rn <= _lim), '[]'::jsonb),
           'has_more', count(*) > _lim,
           'limit', _lim)
    into _out
    from numbered n;
  return _out;
end;
$$;

-- admin_get_community_curation()
-- The admin's view: every curated row, including ones Explore is currently
-- hiding, with the reason, so they can be replaced or removed.
CREATE FUNCTION public.admin_get_community_curation() RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if public.rainbow_uid() is null or not public.has_role(public.rainbow_uid(), 'admin') then
    raise exception 'admin role required' using errcode = 'insufficient_privilege';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'slot',        c.slot,
             'position',    c."position",
             'short_code',  cp.short_code,
             'title',       cp.title,
             'creator_name', cp.creator_name,
             'shown',       public.custom_puzzle_in_community(cp),
             'hidden_reason', case
                 when cp.moderation_status <> 'active' then 'hidden by moderation'
                 when cp.created_by is null then 'creator account removed'
                 when not cp.community_listed then 'unlisted by its creator'
                 when cp.visibility <> 'public' then 'not public'
                 else null end,
             'set_at',      c.set_at)
           order by (c.slot = 'pick'), c."position")
      from public.community_curation c
      join public.custom_puzzles cp on cp.id = c.custom_puzzle_id
  ), '[]'::jsonb);
end;
$$;

-- admin_set_community_curation(text, text[])
-- Replaces the whole curation in one step: the Featured Puzzle (null for none)
-- and the ordered Picks (empty for none, at most six). Every chosen puzzle must
-- be in Community right now; the Featured Puzzle can't also be a Pick.
CREATE FUNCTION public.admin_set_community_curation(_featured text, _picks text[]) RETURNS jsonb
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
  foreach _code in array (case when _featured is null then _picks_n else array[_featured] || _picks_n end) loop
    if not exists (select 1 from public.custom_puzzles cp where cp.short_code = _code and public.custom_puzzle_in_community(cp)) then
      raise exception 'only puzzles listed in Community can be curated (%)', _code using errcode = 'invalid_parameter_value';
    end if;
  end loop;

  -- Two admins saving at once: the second waits, then replaces the first.
  perform pg_advisory_xact_lock(hashtext('public.community_curation'));
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

REVOKE ALL ON FUNCTION public.get_community_explore() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_community_explore() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.list_community_newest(_limit integer, _before_listed_at timestamp with time zone, _before_short_code text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_community_newest(_limit integer, _before_listed_at timestamp with time zone, _before_short_code text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_get_community_curation() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_community_curation() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_set_community_curation(_featured text, _picks text[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_community_curation(_featured text, _picks text[]) TO authenticated, service_role;

COMMENT ON TABLE public.community_curation IS 'Admin-chosen Featured Puzzle (one) and ordered Editor''s Picks (up to six) for Community Explore. Public reads re-check eligibility every time.';
COMMENT ON FUNCTION public.get_community_explore() IS 'Featured Puzzle and Editor''s Picks for Explore: only puzzles in Community right now, card fields only.';
COMMENT ON FUNCTION public.list_community_newest(_limit integer, _before_listed_at timestamp with time zone, _before_short_code text) IS 'Every puzzle in Community, by first listing time newest first, keyset-paged. No editorial or popularity filtering.';

COMMIT;
