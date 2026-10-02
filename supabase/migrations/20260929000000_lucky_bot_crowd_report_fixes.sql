-- Lucky Bot crowd report: three corrections to get_puzzle_report.
--
-- 1. Finding the Rainbow is not a wrong guess. When a player submits the
--    hidden Rainbow's words during play, the game records that guess with
--    correct = false (the words are not one category) but, rightly, charges
--    no mistake. The report took every correct = false guess as "wrong", so
--    the Rainbow find was listed under "Most common wrong guesses" and its
--    finders were counted as having made a wrong guess. Guesses whose words
--    are exactly the puzzle's Rainbow (any order, any case) are now left out
--    of the wrong-guess list. Every other wrong guess is kept.
--
-- 2. "Made at least one wrong guess" and "perfect" now describe the same
--    finishers with the same measure, so they always add up. Perfect is a
--    win with no mistakes (unchanged); players_with_wrong_guess is every
--    other finisher — the mistake count the game itself kept — instead of a
--    count of guess rows, which also caught the Rainbow find (above) and
--    missed any game whose guesses were not all saved.
--
-- 3. Rainbow outcomes in plain terms, all out of the same total finishers:
--      rainbow_found   found the Rainbow at any point
--      rainbow_first   found it during play before solving any category
--      rainbow_last    found it through the post-game prompt
--    A find with no recorded source (older rows) counts as during play, as
--    elsewhere in Lucky Bot. rainbow_in_game and rainbow_post_game are kept
--    unchanged so the app version live before this change keeps working.
--
-- Mini still gets no report (null), exactly as before.

create or replace function public.get_puzzle_report(_puzzle_id uuid)
returns json
language sql
stable
security definer
set search_path = public
as $$
  with s as (
    select id, format, won, mistakes, found_rainbow, rainbow_source, rainbow_solve_index, solve_order
      from public.game_sessions
     where puzzle_id = _puzzle_id::text
       and is_official
       and status in ('won', 'lost')
  ),
  scored as (
    select s.*,
           case
             when jsonb_typeof(s.solve_order) = 'array' and jsonb_array_length(s.solve_order) > 0
               then s.solve_order ->> 0
           end as first_solved,
           public.skill_score(s.won, s.mistakes, s.solve_order, s.found_rainbow, s.rainbow_source, s.format) as score
      from s
  ),
  -- The puzzle's Rainbow words, keyed exactly as guesses are below.
  herring as (
    select (select jsonb_agg(upper(trim(h)) order by upper(trim(h)))
              from unnest(p.rainbow_herring) as h) as key
      from public.puzzles p
     where p.id = _puzzle_id
  ),
  -- Every incorrect NORMAL guess, keyed by its words sorted and upper-cased
  -- so the same four words in any order count as the same guess. Bonus-modal
  -- Rainbow attempts are excluded: they are a different question, answered
  -- by the rainbow_* counts below. So is the in-game Rainbow find itself.
  wrong as (
    select g.game_session_id,
           (select jsonb_agg(upper(trim(w)) order by upper(trim(w)))
              from jsonb_array_elements_text(g.words) as w) as key,
           coalesce(g.is_one_away, false) as one_away,
           coalesce(g.is_rainbow_attempt, false) as rainbow_attempt,
           coalesce(g.is_almost_rainbow, false) as almost_rainbow
      from public.guess_events g
      join s on s.id = g.game_session_id
     where g.correct = false
       and coalesce(g.attempt_type, 'normal') = 'normal'
       and jsonb_typeof(g.words) = 'array'
  ),
  real_wrong as (
    select w.*
      from wrong w
     where w.key is distinct from (select h.key from herring h)
  ),
  top_wrong as (
    select key,
           count(distinct game_session_id)::int as players,
           bool_or(one_away) as one_away,
           bool_or(rainbow_attempt) as rainbow_attempt,
           bool_or(almost_rainbow) as almost_rainbow
      from real_wrong
     group by key
     order by players desc, key::text
     limit 3
  )
  -- Full puzzles only. A Mini gets no report (null), exactly as when this
  -- function did not exist: its Lucky Bot card keeps showing "Comparison
  -- isn't available right now." until Mini's own rules are designed.
  select case
    when exists (select 1 from public.puzzles p where p.id = _puzzle_id and p.format = 'mini') then null
    else json_build_object(
    'total_players',            (select count(*) from scored)::int,
    'wins',                     (select count(*) filter (where won) from scored)::int,
    'perfect',                  (select count(*) filter (where won and mistakes = 0) from scored)::int,
    'players_with_wrong_guess', (select count(*) filter (where not (coalesce(won, false) and coalesce(mistakes, 0) = 0)) from scored)::int,
    'rainbow_in_game',          (select count(*) filter (where found_rainbow and coalesce(rainbow_source, 'in_game') = 'in_game') from scored)::int,
    'rainbow_post_game',        (select count(*) filter (where found_rainbow and rainbow_source = 'post_game') from scored)::int,
    'rainbow_found',            (select count(*) filter (where found_rainbow) from scored)::int,
    'rainbow_first',            (select count(*) filter (where found_rainbow
                                                           and coalesce(rainbow_source, 'in_game') = 'in_game'
                                                           and coalesce(rainbow_solve_index, 0) = 0) from scored)::int,
    'rainbow_last',             (select count(*) filter (where found_rainbow and rainbow_source = 'post_game') from scored)::int,
    'first_solved',             (select coalesce(json_object_agg(first_solved, n), '{}'::json)
                                   from (select first_solved, count(*)::int as n
                                           from scored
                                          where first_solved is not null
                                          group by first_solved) f),
    'score_counts',             (select coalesce(json_object_agg(score::text, n), '{}'::json)
                                   from (select score, count(*)::int as n
                                           from scored
                                          group by score) x),
    'common_wrong_guesses',     (select coalesce(json_agg(json_build_object(
                                          'words', key,
                                          'players', players,
                                          'one_away', one_away,
                                          'rainbow_attempt', rainbow_attempt,
                                          'almost_rainbow', almost_rainbow
                                        ) order by players desc, key::text), '[]'::json)
                                   from top_wrong)
  ) end
$$;

revoke all on function public.get_puzzle_report(uuid) from public;
grant execute on function public.get_puzzle_report(uuid) to anon, authenticated, service_role;

comment on function public.get_puzzle_report(uuid) is
  'Aggregate-only Lucky Bot report for one Full puzzle: player counts, perfect solves (and everyone else as having made a wrong guess), first-solved histogram, Rainbow found / found first / found last, skill-score histogram, and the three most common wrong guesses (never the Rainbow find itself). Never exposes an individual session. Returns null for a Mini puzzle.';
