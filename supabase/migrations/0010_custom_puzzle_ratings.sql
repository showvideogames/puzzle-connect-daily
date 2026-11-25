-- Optional 1-5 star ratings for custom puzzles (PREVIEW; not applied to any
-- hosted database).
--
-- Offered only on a custom puzzle's Results screen, after the player has
-- finished it (won, or played to the end and lost). Checked by the server:
--   * a signed-in Rainbow account (rainbow_uid), never the puzzle's author;
--   * the puzzle exists and is active (not hidden by moderation);
--   * this player finished it: the existing finish record, a
--     custom_puzzle_results row for the device credential the browser holds
--     (verify_device), which submit_custom_puzzle_result writes only for a
--     completed run. An abandoned run never has one;
--   * a whole number from 1 to 5. One rating per account per puzzle; rating
--     again replaces it.
-- Private: no client can read the table, and the only read returns the
-- caller's own rating. No aggregate, count or rater identity is exposed
-- anywhere in this pass. Separate from favourites and the Most Liked sort.
-- Not the daily puzzles' puzzle_ratings, which is untouched.
BEGIN;

CREATE TABLE public.custom_puzzle_ratings (
    custom_puzzle_id uuid NOT NULL,
    user_id uuid NOT NULL,
    rating smallint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT custom_puzzle_ratings_pkey PRIMARY KEY (custom_puzzle_id, user_id),
    CONSTRAINT custom_puzzle_ratings_rating_check CHECK (((rating >= 1) AND (rating <= 5))),
    CONSTRAINT custom_puzzle_ratings_custom_puzzle_id_fkey FOREIGN KEY (custom_puzzle_id) REFERENCES public.custom_puzzles(id) ON DELETE CASCADE,
    CONSTRAINT custom_puzzle_ratings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
ALTER TABLE public.custom_puzzle_ratings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.custom_puzzle_ratings FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.custom_puzzle_ratings TO service_role;

-- set_custom_puzzle_rating(text, integer, text, text)
CREATE FUNCTION public.set_custom_puzzle_rating(_share_id text, _rating integer, _device_id text, _device_token text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _uid uuid := public.rainbow_uid();
  _p   public.custom_puzzles%rowtype;
begin
  if _uid is null then
    raise exception 'sign in to rate puzzles' using errcode = 'insufficient_privilege';
  end if;
  if _rating is null or _rating < 1 or _rating > 5 then
    raise exception 'a rating is a whole number from 1 to 5' using errcode = 'invalid_parameter_value';
  end if;
  select * into _p from public.custom_puzzles where share_id = _share_id and moderation_status = 'active';
  if _p.id is null then
    raise exception 'puzzle not found' using errcode = 'no_data_found';
  end if;
  if _p.created_by = _uid then
    raise exception 'you can''t rate your own puzzle' using errcode = 'insufficient_privilege';
  end if;
  if not public.verify_device(_device_id, _device_token)
     or not exists (select 1 from public.custom_puzzle_results r where r.custom_puzzle_id = _p.id and r.device_id = _device_id) then
    raise exception 'finish the puzzle to rate it' using errcode = 'insufficient_privilege';
  end if;

  insert into public.custom_puzzle_ratings (custom_puzzle_id, user_id, rating)
  values (_p.id, _uid, _rating)
  on conflict (custom_puzzle_id, user_id) do update set rating = excluded.rating, updated_at = now();
  return jsonb_build_object('rating', _rating);
end;
$$;

-- get_my_custom_puzzle_rating(text)
-- The caller's own rating of a puzzle, or null. Nobody else's, and no totals.
CREATE FUNCTION public.get_my_custom_puzzle_rating(_share_id text) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select jsonb_build_object('rating', (
    select r.rating from public.custom_puzzle_ratings r
      join public.custom_puzzles cp on cp.id = r.custom_puzzle_id
     where cp.share_id = _share_id and r.user_id = public.rainbow_uid()
  ))
$$;

REVOKE ALL ON FUNCTION public.set_custom_puzzle_rating(_share_id text, _rating integer, _device_id text, _device_token text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_custom_puzzle_rating(_share_id text, _rating integer, _device_id text, _device_token text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_my_custom_puzzle_rating(_share_id text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_custom_puzzle_rating(_share_id text) TO authenticated, service_role;
COMMENT ON TABLE public.custom_puzzle_ratings IS 'Optional 1-5 star ratings of custom puzzles by signed-in, non-author players who finished them. Private: no aggregate or rater identity is exposed.';

COMMIT;
