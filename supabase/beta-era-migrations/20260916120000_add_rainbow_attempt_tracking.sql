-- Persist Rainbow chronology and Rainbow-attempt tracking that today only
-- exist transiently in client state (useGame.ts's rainbowSolveIndex) or are
-- lost entirely (a failed "Spot the Rainbow" bonus attempt).

-- How many of the 4 normal categories were already solved when the Rainbow
-- was found. Only meaningful when found_rainbow = true.
--   0   = Rainbow found before any normal category (Rainbow -> Yellow -> Green -> Blue -> Red)
--   1-3 = Rainbow found after that many categories (Rainbow found in the middle)
--   4   = Rainbow found after all 4 categories, via the post-completion
--         "Spot the Rainbow" bonus prompt (Yellow -> Green -> Blue -> Red -> Rainbow)
--   NULL = unknown (historical rows saved before this column existed, or
--          found_rainbow = false / puzzle has no Rainbow). Never backfilled
--          or guessed from found_rainbow alone.
alter table public.game_sessions
  add column if not exists rainbow_solve_index smallint;

comment on column public.game_sessions.rainbow_solve_index is
  'Categories already solved when the Rainbow was found (0-4); NULL when unknown/not applicable. See useGame.ts GameState.rainbowSolveIndex, the authoritative source this value is copied from.';

-- Marks a guess_events row as a Rainbow attempt: either a submission from the
-- post-completion "Spot the Rainbow" bonus modal (success or failure), or an
-- in-game guess containing exactly one word from each of the 4 categories.
-- Independent of `correct` — failed attempts are recorded like any other
-- guess event. NULL for historical rows saved before this column existed.
alter table public.guess_events
  add column if not exists is_rainbow_attempt boolean;

comment on column public.guess_events.is_rainbow_attempt is
  'True when this guess was shaped like a Rainbow attempt (bonus modal submission, or an in-game guess with one word per category), regardless of success. NULL = not classified (historical rows).';
