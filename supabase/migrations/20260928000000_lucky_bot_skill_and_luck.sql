-- Lucky Bot: a new Skill Score for the Full game, and a Luck Score.
--
-- APPLY ORDER. This file redefines public.skill_score, which is first
-- created by 20260927000000_puzzle_report.sql. Apply that file first (a
-- normal `db push` does, since it sorts earlier). Neither file has been
-- applied to production at the time of writing; both are forward-only and
-- safe to apply together.
--
-- Three pieces.
--
--   skill_score(...)        Same signature as before. A Mini keeps EXACTLY
--                           the 20260927000000 formula (its rules have not
--                           been designed yet); a Full game gets the new
--                           rules below. Mirrored in src/lib/skillScore.ts;
--                           src/test/skillScore.test.ts and the PGlite check
--                           in e2e/scripts/verify-db.ts pin the same fixtures
--                           on both sides.
--
--   luck_score_ceilings     A tiny settings table: which "1 in N" rarity
--                           counts as a Luck Score of 100. Keyed by the date
--                           a ceiling takes effect, so raising it later (a
--                           bigger audience) only affects puzzles dated on or
--                           after that day — an archived puzzle's score never
--                           drops just because the site grew.
--
--   get_luck_report(...)    For the CALLER's own first official attempt at a
--                           Full puzzle: how many eligible players finished
--                           it, and how many of them took the caller's exact
--                           path. Counts only; never returns anyone's path,
--                           words, or row. The browser turns the two counts
--                           into the score (src/lib/luckScore.ts), so the
--                           formula lives in exactly one place.
--
-- Full Skill Score, in words:
--   Won:  95 / 88 / 81 / 74 for 0 / 1 / 2 / 3 mistakes, plus the FIRST
--         normal category solved: Yellow +0, Green +1, Blue +2, Red +3 —
--         or +4 instead when the whole order was Red → Blue → Green → Yellow.
--   Lost: 50, plus each normal category actually solved: Yellow +4,
--         Green +6, Blue +8, Red +10. No order bonus.
--   Both: +1 if the Rainbow was found, mid-game or through the post-game
--         prompt alike. Capped at 100.
-- solve_order holds colour NAMES, written by the client at completion and
-- listing only categories the player actually submitted: orange (the
-- historical name of the Yellow slot) / green / blue / red.

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
  _name text;
begin
  if jsonb_typeof(_solve_order) = 'array' then
    select coalesce(array_agg(t.x order by t.ord), '{}')
      into _order
      from jsonb_array_elements_text(_solve_order) with ordinality as t(x, ord);
  end if;
  _solved := coalesce(array_length(_order, 1), 0);

  -- ---- Mini: unchanged from 20260927000000, line for line ---------------
  if coalesce(_format, 'full') = 'mini' then
    _reverse := array['red', 'blue', 'green'];

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
  end if;

  -- ---- Full ---------------------------------------------------------------
  if coalesce(_won, false) then
    _score := case least(greatest(coalesce(_mistakes, 0), 0), 3)
                when 0 then 95
                when 1 then 88
                when 2 then 81
                else 74
              end;
    if _order = array['red', 'blue', 'green', 'orange'] then
      _score := _score + 4;
    elsif _solved > 0 then
      _score := _score + case _order[1]
                           when 'green' then 1
                           when 'blue' then 2
                           when 'red' then 3
                           else 0
                         end;
    end if;
  else
    _score := 50;
    foreach _name in array _order loop
      _score := _score + case _name
                           when 'orange' then 4
                           when 'green' then 6
                           when 'blue' then 8
                           when 'red' then 10
                           else 0
                         end;
    end loop;
  end if;

  if coalesce(_found_rainbow, false) then
    _score := _score + 1;
  end if;

  return least(_score, 100);
end;
$$;

revoke all on function public.skill_score(boolean, integer, jsonb, boolean, text, text) from public;
grant execute on function public.skill_score(boolean, integer, jsonb, boolean, text, text) to anon, authenticated, service_role;

comment on function public.skill_score(boolean, integer, jsonb, boolean, text, text) is
  'Lucky Bot skill score for one finished session. Full: 74–100 for a win, 50+ for a loss. Mini: the original 50–99 formula, unchanged. Mirrors src/lib/skillScore.ts exactly; keep the two in step.';


-- ===========================================================================
-- Luck Score ceiling: the rarity that scores 100.
-- ===========================================================================

create table if not exists public.luck_score_ceilings (
  effective_from date primary key,
  ceiling        integer not null check (ceiling >= 2),
  note           text,
  created_at     timestamptz not null default now()
);

comment on table public.luck_score_ceilings is
  'Lucky Bot Luck Score ceiling ("1 in N" that scores 100). A puzzle uses the row with the latest effective_from on or before its own date, so adding a row later never changes an older puzzle''s score. Add rows; do not edit old ones.';

alter table public.luck_score_ceilings enable row level security;
-- No policies and no grants: read only through get_luck_report below.
revoke all on table public.luck_score_ceilings from anon, authenticated;

insert into public.luck_score_ceilings (effective_from, ceiling, note)
values ('2000-01-01', 5000, 'Launch ceiling: 1 in 5,000 scores 100.')
on conflict (effective_from) do nothing;


-- ===========================================================================
-- Eligible sessions and their paths, for one puzzle. Internal.
--
-- ELIGIBLE means all of:
--   * the session owns the permanent official result for its identity
--     (is_official — the FIRST completed attempt; replays and duplicates are
--     never official), and it finished (won or lost);
--   * the puzzle is a published-format Full puzzle and not a beta playtest
--     (custom puzzles never create game_sessions rows at all);
--   * the identity can be told apart from other players: a signed-in
--     account, or an anonymous device other than the shared 'unknown'
--     fallback (every storage-blocked browser shares that one id, so its
--     rows cannot be deduplicated);
--   * the account is not an admin (admin playthroughs are testing);
--   * its saved guesses form a COMPLETE, trustworthy record. Every event
--     carries attempt_type (written only since the durable-events
--     migration 20260916150000; older rows cannot tell a board guess from
--     a post-game Rainbow attempt, so no path is invented for them), the
--     board guesses are numbered 1..n with no gaps, a win has all four
--     categories, and there are at least as many wrong board guesses as
--     recorded mistakes. A session that fails any of these is left out of
--     BOTH the player count and the path counts, rather than guessed at.
--
-- THE PATH is every submitted guess in the order it was made:
--   * a board guess is its four words, trimmed, upper-cased and sorted, so
--     the order words were tapped in does not matter but the order of
--     guesses does. Correct, wrong, One Away and an in-game Rainbow guess
--     are all just "these four words";
--   * a post-game Rainbow prompt submission is {"bonus": "found"} when it
--     was right and {"bonus": [its words]} when it was wrong. A right answer
--     is always the same four words, so "found" loses nothing;
--   * if the session says the Rainbow was found through the prompt but no
--     correct prompt event survived (a retry after a refresh can collide
--     with an earlier attempt's guess number and be dropped), one
--     {"bonus": "found"} is appended — the session row is the proof it
--     happened.
-- ===========================================================================

create or replace function public.luck_eligible_paths(_puzzle_id text)
returns table (session_id uuid, user_id uuid, device_id text, path jsonb)
language sql
stable
security definer
set search_path = public
as $$
  with cand as (
    select gs.id, gs.user_id, gs.device_id, gs.won, gs.mistakes,
           gs.found_rainbow, gs.rainbow_source
      from public.game_sessions gs
      join public.puzzles p on p.id::text = gs.puzzle_id
     where gs.puzzle_id = _puzzle_id
       and gs.is_official
       and gs.status in ('won', 'lost')
       and coalesce(gs.format, 'full') = 'full'
       and p.format = 'full'
       and not coalesce(p.is_beta, false)
       and (
         (gs.user_id is not null and not public.has_role(gs.user_id, 'admin'))
         or (gs.user_id is null and gs.device_id is not null and gs.device_id <> 'unknown')
       )
  ),
  ev as (
    select g.game_session_id,
           g.guess_number,
           g.attempt_type,
           coalesce(g.correct, false) as correct,
           (select coalesce(jsonb_agg(upper(btrim(w)) order by upper(btrim(w))), '[]'::jsonb)
              from jsonb_array_elements_text(
                     case when jsonb_typeof(g.words) = 'array' then g.words else '[]'::jsonb end
                   ) as w) as words
      from public.guess_events g
      join cand c on c.id = g.game_session_id
  ),
  summary as (
    select e.game_session_id,
           count(*) filter (where e.attempt_type is null) as untyped,
           count(*) filter (where e.attempt_type = 'normal') as normals,
           min(e.guess_number) filter (where e.attempt_type = 'normal') as first_normal,
           max(e.guess_number) filter (where e.attempt_type = 'normal') as last_normal,
           count(*) filter (where e.attempt_type = 'normal' and e.correct) as correct_normals,
           count(*) filter (where e.attempt_type = 'normal' and not e.correct) as wrong_normals,
           count(*) filter (where e.attempt_type = 'normal' and jsonb_array_length(e.words) <> 4) as bad_shape,
           bool_or(e.attempt_type = 'bonus_rainbow' and e.correct) as bonus_found,
           jsonb_agg(
             case
               when e.attempt_type = 'bonus_rainbow' and e.correct then jsonb_build_object('bonus', 'found')
               when e.attempt_type = 'bonus_rainbow' then jsonb_build_object('bonus', e.words)
               else e.words
             end
             order by e.guess_number
           ) as events_path
      from ev e
     group by e.game_session_id
  )
  select c.id, c.user_id, c.device_id,
         case
           when coalesce(c.found_rainbow, false)
                and c.rainbow_source = 'post_game'
                and not coalesce(s.bonus_found, false)
             then s.events_path || jsonb_build_array(jsonb_build_object('bonus', 'found'))
           else s.events_path
         end
    from cand c
    join summary s on s.game_session_id = c.id
   where s.untyped = 0
     and s.normals > 0
     and s.bad_shape = 0
     and s.first_normal = 1
     and s.last_normal = s.normals
     and (not c.won or s.correct_normals = 4)
     and (c.won or s.correct_normals < 4)
     and s.wrong_normals >= coalesce(c.mistakes, 0)
$$;

revoke all on function public.luck_eligible_paths(text) from public, anon, authenticated;

comment on function public.luck_eligible_paths(text) is
  'Internal. Every Luck-eligible session for one Full puzzle with its normalized ordered guess path. Never granted to clients: get_luck_report returns counts only.';


-- ===========================================================================
-- get_luck_report — the caller's own Luck numbers for one puzzle.
--
-- Finds the caller's official completed session for the puzzle with the
-- same identity rule as has_official_result (signed in: auth.uid(); guest:
-- a verified device id + token), so it answers for the player's FIRST
-- official attempt even if they are looking at a later replay.
--
-- Returns JSON:
--   status            'ok' | 'no_session' | 'not_eligible' | 'unsupported'
--   reason            for not_eligible: 'admin' | 'incomplete_history'
--   eligible_players  eligible completed first attempts on this puzzle
--   same_path         how many of those took the caller's exact path
--                     (includes the caller)
--   ceiling           the rarity that scores 100 for THIS puzzle
--   min_players       eligible players needed before a number is shown
-- ===========================================================================

create or replace function public.get_luck_report(
  _puzzle_id uuid,
  _device_id text default null,
  _device_token text default null
)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  _pid      text := _puzzle_id::text;
  _format   text;
  _is_beta  boolean;
  _date     date;
  _uid      uuid := auth.uid();
  _mine     uuid;
  _mine_uid uuid;
  _path     jsonb;
  _total    integer;
  _same     integer;
  _ceiling  integer;
  _min      constant integer := 500;
begin
  select p.format, coalesce(p.is_beta, false), p.date
    into _format, _is_beta, _date
    from public.puzzles p
   where p.id = _puzzle_id;

  if _format is distinct from 'full' or _is_beta then
    return json_build_object('status', 'unsupported');
  end if;

  select gs.id, gs.user_id
    into _mine, _mine_uid
    from public.game_sessions gs
   where gs.puzzle_id = _pid
     and gs.status in ('won', 'lost')
     and gs.is_official
     and (
       (_uid is not null and gs.user_id = _uid)
       or (
         gs.user_id is null
         and _device_id is not null
         and gs.device_id = _device_id
         and public.verify_device(_device_id, _device_token)
       )
     )
   order by gs.completed_at nulls last
   limit 1;

  if _mine is null then
    return json_build_object('status', 'no_session');
  end if;

  if _mine_uid is not null and public.has_role(_mine_uid, 'admin') then
    return json_build_object('status', 'not_eligible', 'reason', 'admin');
  end if;

  -- One pass over the puzzle's eligible paths: find the caller's own, then
  -- count everyone and everyone who matches it. A single query rather than
  -- a temp table because this function is STABLE (PostgREST may run it in
  -- a read-only transaction).
  with lp as (
    select e.session_id, e.path from public.luck_eligible_paths(_pid) e
  ),
  mine as (
    select lp.path from lp where lp.session_id = _mine
  )
  select (select m.path from mine m),
         count(*)::int,
         count(*) filter (where lp.path = (select m.path from mine m))::int
    into _path, _total, _same
    from lp;

  if _path is null then
    return json_build_object('status', 'not_eligible', 'reason', 'incomplete_history');
  end if;

  select c.ceiling
    into _ceiling
    from public.luck_score_ceilings c
   where c.effective_from <= coalesce(_date, current_date)
   order by c.effective_from desc
   limit 1;

  return json_build_object(
    'status', 'ok',
    'eligible_players', _total,
    'same_path', _same,
    'ceiling', coalesce(_ceiling, 5000),
    'min_players', _min
  );
end;
$$;

revoke all on function public.get_luck_report(uuid, text, text) from public;
grant execute on function public.get_luck_report(uuid, text, text) to anon, authenticated, service_role;

comment on function public.get_luck_report(uuid, text, text) is
  'Lucky Bot Luck numbers for the caller''s own first official attempt at a Full puzzle: eligible player count, how many took the same exact guess path, and the puzzle''s ceiling. Counts only; never exposes another player''s path or session.';
