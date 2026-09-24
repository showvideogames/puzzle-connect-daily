-- Rainbow Bot: the post-game report.
--
-- Two functions.
--
--   skill_score(...)        A pure formula that turns one finished session
--                           into a 50–99 "skill score". Mirrored EXACTLY in
--                           src/lib/skillScore.ts, which computes the
--                           player's own score in the browser; this SQL
--                           copy exists so the SAME formula can be applied
--                           to every other player's session server-side,
--                           which is what makes "better than 62% of players"
--                           an honest comparison rather than two formulas
--                           drifting apart. Change one, change both, and the
--                           unit test in src/test/skillScore.test.ts plus the
--                           PGlite check in e2e/scripts/verify-db.ts pin the
--                           same fixtures on both sides.
--
--   get_puzzle_report(id)   Aggregate-only JSON for one puzzle: how many
--                           played, how many were perfect, where players
--                           started, how the Rainbow went, the distribution
--                           of skill scores, and the most common WRONG
--                           guesses (the part players actually want — "did
--                           everyone else fall for that too?"). Reads
--                           game_sessions and guess_events under SECURITY
--                           DEFINER, the same way get_puzzle_stats does, and
--                           never returns an individual row: every field is
--                           a count, a histogram, or a set of words with a
--                           player count attached.
--
-- The score formula, in words (max 99, min 50):
--   Won:   90 − 10 × mistakes            → 90 / 80 / 70 / 60
--   Lost:  50 + 4 × groups solved        → 50 / 54 / 58 / 62
--   + 4    Rainbow spotted mid-game (rainbow_source 'in_game', or a legacy
--          row with found_rainbow and no source recorded)
--   + 1    Rainbow spotted after the game, through the bonus prompt
--   + 2    the hardest (Red) category was solved first
--   + 3    every category solved hardest→easiest (a "reverse rainbow")
--   90 + 4 + 2 + 3 = 99: a perfect game, Red first, in reverse order, with
--   the Rainbow spotted mid-game, is the only way to hit the ceiling.

create or replace function public.skill_score(
  _won boolean,
  _mistakes integer,
  _solve_order jsonb,
  _found_rainbow boolean,
  _rainbow_source text,
  _format text
)
returns integer
language plpgsql
immutable
as $$
declare
  _order text[] := '{}';
  _reverse text[];
  _score integer;
  _solved integer;
begin
  if jsonb_typeof(_solve_order) = 'array' then
    select coalesce(array_agg(t.x order by t.ord), '{}')
      into _order
      from jsonb_array_elements_text(_solve_order) with ordinality as t(x, ord);
  end if;
  _solved := coalesce(array_length(_order, 1), 0);

  -- solve_order is written by the client as colour NAMES, easiest→hardest
  -- being orange/green/blue/red (see lib/puzzleFormat.ts SOLVE_ORDER_NAME —
  -- "orange" is the historical name of the Yellow slot). A Mini has no
  -- Yellow category, so its reverse order is three colours long.
  if coalesce(_format, 'full') = 'mini' then
    _reverse := array['red', 'blue', 'green'];
  else
    _reverse := array['red', 'blue', 'green', 'orange'];
  end if;

  if coalesce(_won, false) then
    _score := 90 - 10 * least(greatest(coalesce(_mistakes, 0), 0), 3);
  else
    _score := 50 + 4 * least(_solved, 3);
  end if;

  if coalesce(_found_rainbow, false) then
    if _rainbow_source = 'post_game' then
      _score := _score + 1;
    else
      _score := _score + 4;
    end if;
  end if;

  if _solved > 0 and _order[1] = 'red' then
    _score := _score + 2;
  end if;

  if _order = _reverse then
    _score := _score + 3;
  end if;

  return least(greatest(_score, 50), 99);
end;
$$;

revoke all on function public.skill_score(boolean, integer, jsonb, boolean, text, text) from public;
grant execute on function public.skill_score(boolean, integer, jsonb, boolean, text, text) to anon, authenticated, service_role;

comment on function public.skill_score(boolean, integer, jsonb, boolean, text, text) is
  'Rainbow Bot skill score (50–99) for one finished session. Mirrors src/lib/skillScore.ts exactly; keep the two in step.';


create or replace function public.get_puzzle_report(_puzzle_id uuid)
returns json
language sql
stable
security definer
set search_path = public
as $$
  with s as (
    select id, format, won, mistakes, found_rainbow, rainbow_source, solve_order
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
  -- Every incorrect NORMAL guess, keyed by its words sorted and upper-cased
  -- so the same four words in any order count as the same guess. Bonus-modal
  -- Rainbow attempts are excluded: they are a different question, answered
  -- by the rainbow_* counts below.
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
  top_wrong as (
    select key,
           count(distinct game_session_id)::int as players,
           bool_or(one_away) as one_away,
           bool_or(rainbow_attempt) as rainbow_attempt,
           bool_or(almost_rainbow) as almost_rainbow
      from wrong
     group by key
     order by players desc, key::text
     limit 3
  )
  select json_build_object(
    'total_players',            (select count(*) from scored)::int,
    'wins',                     (select count(*) filter (where won) from scored)::int,
    'perfect',                  (select count(*) filter (where won and mistakes = 0) from scored)::int,
    'players_with_wrong_guess', (select count(distinct game_session_id) from wrong)::int,
    'rainbow_in_game',          (select count(*) filter (where found_rainbow and coalesce(rainbow_source, 'in_game') = 'in_game') from scored)::int,
    'rainbow_post_game',        (select count(*) filter (where found_rainbow and rainbow_source = 'post_game') from scored)::int,
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
  )
$$;

revoke all on function public.get_puzzle_report(uuid) from public;
grant execute on function public.get_puzzle_report(uuid) to anon, authenticated, service_role;

comment on function public.get_puzzle_report(uuid) is
  'Aggregate-only Rainbow Bot report for one puzzle: player counts, perfect solves, first-solved histogram, Rainbow outcomes, skill-score histogram, and the three most common wrong guesses. Never exposes an individual session.';
