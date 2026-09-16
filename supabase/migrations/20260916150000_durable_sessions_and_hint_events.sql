-- ============================================================================
-- Durable session + live gameplay event foundation (Task #6)
--
-- Before this migration, the database only learned a normal game existed when
-- it reached formal completion: saveGameStats() INSERTed one fully-populated
-- game_sessions row at win/loss, and bulk-inserted every guess_events row at
-- the same moment. A player who played for eight minutes, used both hints and
-- solved three groups before giving up left NO durable trace at all.
--
-- After this migration the conceptual model is:
--
--   PLAYER/IDENTITY -> GAME SESSION -+-> GUESS EVENTS
--                                    +-> HINT EVENTS
--
-- A game_sessions row is created on the FIRST MEANINGFUL GAMEPLAY ACTION
-- (first submitted guess, or first actually-revealed hint -- never on a bare
-- page view), guess/hint events are written as they happen, and formal
-- completion UPDATEs that same row rather than inserting a second one.
--
-- This is deliberately NOT a generic event-sourcing framework. It is three
-- purpose-built tables with one lifecycle field.
--
-- ---------------------------------------------------------------------------
-- APPLY ORDER MATTERS. The application code on branch
-- feat/durable-session-and-live-events REQUIRES these columns. Apply this
-- migration BEFORE deploying that code, not after.
-- ---------------------------------------------------------------------------
--
-- PRE-APPLY CHECKS -- run these read-only queries first; both must return
-- zero rows, otherwise the unique indexes at the bottom will fail:
--
--   -- 1. duplicate guess numbers within a session (the old
--   --    recordRainbowAttempt() derived guess_number from a non-atomic
--   --    COUNT(*), so a race could in principle have produced one):
--   select game_session_id, guess_number, count(*)
--     from public.guess_events
--    group by 1,2 having count(*) > 1;
--
--   -- 2. duplicate official sessions per identity (see the bottom section):
--   select puzzle_id, user_id, count(*) from public.game_sessions
--    where user_id is not null group by 1,2 having count(*) > 1;
--   select puzzle_id, device_id, count(*) from public.game_sessions
--    where user_id is null and device_id is not null and device_id <> 'unknown'
--    group by 1,2 having count(*) > 1;
--
-- If (1) returns rows, resolve those duplicates before applying.
-- If (2) returns rows, apply everything EXCEPT the two indexes in the final
-- section and resolve the duplicates separately -- the rest of this migration
-- is independent of them.
-- ============================================================================


-- ===========================================================================
-- 1. game_sessions -- lifecycle, entry context, activity timestamps
-- ===========================================================================

-- Lifecycle status. ONE field, rather than layering more booleans on top of
-- the existing `won`:
--   'in_progress' = meaningful play began; the game has not formally ended.
--                   This is the state that makes abandonment visible at all.
--   'won'         = formally completed as a win.
--   'lost'        = formally completed as a loss (always mistakes = 4; the
--                   game ends the instant the 4th mistake lands).
--
-- `won` is intentionally NOT renamed or dropped -- every existing consumer
-- reads it, and it stays the authoritative outcome flag for completed rows.
-- `status` adds the one thing a boolean structurally cannot express: "this
-- game has not finished yet." `won` is made three-state below so it can say
-- the same thing honestly (NULL while in progress) instead of carrying a
-- placeholder, and the two are kept in lockstep by a CHECK constraint.
--
-- DEFAULT 'in_progress' is what makes the new create-early flow natural, but
-- it would silently mislabel an insert from an OLD cached client bundle (one
-- that still inserts a single fully-completed row and knows nothing about
-- this column) as an unfinished game, dropping a real result out of Stats.
-- The trigger in section 1b closes that gap.
alter table public.game_sessions
  add column if not exists status text not null default 'in_progress';

-- Backfill BEFORE adding the CHECK constraints below. Every one of the
-- existing rows is, by construction, a completed session: the only code path
-- that has ever inserted into this table is saveGameStats(), which runs at
-- formal win/loss. Their `won` boolean is therefore authoritative and this
-- backfill reads it rather than guessing. Non-destructive: it writes only the
-- new column and touches no historical gameplay data.
update public.game_sessions
   set status = case when won then 'won' else 'lost' end
 where status = 'in_progress';

alter table public.game_sessions
  drop constraint if exists game_sessions_status_check;
alter table public.game_sessions
  add constraint game_sessions_status_check
  check (status in ('in_progress', 'won', 'lost'));

-- The lifecycle invariant, enforced rather than merely intended: a session is
-- in progress exactly when it has no completion timestamp. This is what stops
-- a half-written completion from producing a row that is neither cleanly
-- unfinished nor cleanly finished.
alter table public.game_sessions
  drop constraint if exists game_sessions_status_completed_at_check;
alter table public.game_sessions
  add constraint game_sessions_status_completed_at_check
  check ((status = 'in_progress') = (completed_at is null));

comment on column public.game_sessions.status is
  'Lifecycle: in_progress | won | lost. in_progress <=> completed_at IS NULL and won IS NULL (both enforced). Player-facing Stats MUST filter to (won, lost) -- a row existing no longer implies a played game.';


-- ---------------------------------------------------------------------------
-- `won` becomes truthfully three-state.
--
--   status = in_progress -> won IS NULL   (not yet knowable)
--   status = won         -> won IS TRUE
--   status = lost        -> won IS FALSE
--
-- Previously `won` was NOT NULL, so a just-created session had to carry a
-- placeholder `false` — a row that read as "this player lost" to anything
-- that failed to check `status` first. NULL is the honest value for a game
-- that has not finished: not a loss, not a win, simply not yet determined.
--
-- Dropping NOT NULL cannot affect any existing row (all 256 have a real
-- boolean), and the CHECK below makes the three-state mapping an enforced
-- invariant rather than a convention, so `won` and `status` can never drift
-- apart in either direction.
alter table public.game_sessions
  alter column won drop not null;

alter table public.game_sessions
  drop constraint if exists game_sessions_status_won_check;
alter table public.game_sessions
  add constraint game_sessions_status_won_check
  check (
    (status = 'in_progress' and won is null)
    or (status = 'won' and won is true)
    or (status = 'lost' and won is false)
  );

comment on column public.game_sessions.won is
  'Three-state: NULL while in_progress (not yet knowable), TRUE when status=won, FALSE when status=lost. Enforced by game_sessions_status_won_check. Never read without filtering on status first.';


-- ---------------------------------------------------------------------------
-- completed_at loses its DEFAULT now().
--
-- That default predates sessions existing before completion, when every insert
-- WAS a completed game and stamping "now" was correct. It is now actively
-- misleading: the honest value for a session that has just started is NULL,
-- and the only thing standing between the default and a board full of games
-- marked finished the instant they began is every insert site remembering to
-- pass an explicit null. That is not an invariant, it is a habit.
--
-- After this, the truthful shape falls out on its own:
--   in-progress creation omits the column  -> NULL
--   completion supplies the real timestamp -> that timestamp
--
-- DROP DEFAULT changes no existing row; all 256 historical completion
-- timestamps are preserved exactly as they are. The biconditional CHECK added
-- above still enforces both directions:
--   in_progress  <-> completed_at IS NULL
--   won / lost   <-> completed_at IS NOT NULL
alter table public.game_sessions
  alter column completed_at drop default;

comment on column public.game_sessions.completed_at is
  'When the game formally ended. NULL while in_progress, a real timestamp on won/lost -- both directions enforced by game_sessions_status_completed_at_check. No column default: completion code supplies the value explicitly.';


-- Does this session own the permanent official result for its
-- (puzzle, identity)?
--
-- This is NOT redundant with `status`, and it is the one extra flag this
-- design adds. The two express genuinely different dimensions:
--   status      = what happened to THIS session (unfinished / won / lost)
--   is_official = does this session own the permanent record for this
--                 puzzle + identity
--
-- The case that forces it to exist: the product rule is "the FIRST completed
-- official attempt is permanent." A later replay that reaches completion
-- anyway must not create a second Played, must not re-run the streak, and
-- must not touch puzzle_aggregates -- but its session row still genuinely
-- finished, so parking it at 'in_progress' forever would be a lie that also
-- corrupts abandonment analytics. It is therefore finalized normally
-- (status = 'won'/'lost') with is_official = false, and every player-facing
-- stat filters on `is_official`.
--
-- It also gives future entry contexts a natural home: a Beta/playtest session
-- will insert with is_official = false and be excluded from official stats by
-- exactly this existing filter, with no further schema work.
--
-- Whether a session is official is only KNOWABLE at completion -- it depends
-- on whether an official result already existed at that moment. So a session
-- is created as NOT official and promoted to official when it completes and
-- wins the "first completed attempt" check. That also keeps the partial
-- unique indexes in section 5 containing only completed official rows, which
-- is what lets an in_progress replay coexist with an already-completed
-- official result for the same puzzle+identity.
--
-- The two-step default is deliberate, exactly as for started_at above:
-- ADD COLUMN ... DEFAULT true backfills every EXISTING row to true, which is
-- correct (under the old rule each was the single official row for its
-- puzzle+identity), and the subsequent SET DEFAULT false then applies to NEW
-- rows only.
alter table public.game_sessions
  add column if not exists is_official boolean not null default true;
alter table public.game_sessions
  alter column is_official set default false;

comment on column public.game_sessions.is_official is
  'True when this session owns the permanent official result for its puzzle+identity. Set at completion, not at creation: false while in progress, false for a replay that completed after an official result already existed, and (in future) for beta/playtest sessions. Player-facing Stats filter on this AND status.';


-- HOW the player entered this game -- not what kind of puzzle it is.
--
-- Deliberately NOT a proxy for puzzle attributes: is_emoji_puzzle /
-- is_free_puzzle / "has a Rainbow" are properties of the puzzle row and are
-- already stored there. Two players can reach the same puzzle through
-- different routes and that difference is what this column records.
--
-- Current values, each of which the live routing can actually distinguish:
--   'daily_home'        -- "/" , today's puzzle
--   'archive_calendar'  -- an Archive calendar day cell
--   'free_collection'   -- a Free Puzzles card on /archive
--   'emoji_collection'  -- an Emoji Puzzles card on /archive
--   'archive_direct'    -- /archive/:id reached WITHOUT in-app navigation
--                          context (deep link, bookmark, shared URL, or a
--                          reload in a fresh tab). An honest "we cannot tell
--                          which collection" rather than a guessed one.
--   'free_legacy_link'  -- the legacy /free/:id route
--
-- Intentionally NO check constraint and NO enum type: future values
-- ('beta', 'shared_link', 'custom_link', Mini, Mega) must be addable from the
-- client without a schema migration. The permitted set is expressed in
-- TypeScript (src/lib/entryContext.ts) where it can evolve cheaply.
--
-- NULL = unknown. Historical rows predate the concept and are never
-- backfilled with a guess.
alter table public.game_sessions
  add column if not exists entry_context text;

comment on column public.game_sessions.entry_context is
  'How the player entered this game (daily_home, archive_calendar, free_collection, emoji_collection, archive_direct, free_legacy_link; future: beta, shared_link, ...). NOT a puzzle attribute. NULL = unknown/historical. No CHECK constraint so future values need no migration.';


-- started_at / last_activity_at.
--
-- Added WITHOUT a default and then given one, rather than
-- "add column ... default now()". That shorthand evaluates now() once and
-- stamps every one of the existing historical rows with the migration's own
-- timestamp -- inventing a start time and a last-activity time that never
-- happened. Splitting it leaves historical rows NULL (truthfully unknown)
-- while every new row gets a real value.
alter table public.game_sessions
  add column if not exists started_at timestamptz;
alter table public.game_sessions
  alter column started_at set default now();

-- Heartbeat for the abandonment model. Deliberately NOT maintained via
-- beforeunload -- browsers make unload-time persistence unreliable enough
-- that a session marked "abandoned" there would be both frequently missed and
-- occasionally wrong. Instead an unfinished session simply STAYS
-- 'in_progress' and carries the time of its last meaningful action; analytics
-- can later classify a sufficiently stale in_progress session as abandoned,
-- without anyone pretending to know the exact moment the player gave up.
--
-- Updated only at meaningful moments (creation, guess, hint, completion) --
-- never from timer ticks, tile selections, shuffles, hovers, or visibility
-- changes.
alter table public.game_sessions
  add column if not exists last_activity_at timestamptz;
alter table public.game_sessions
  alter column last_activity_at set default now();

comment on column public.game_sessions.started_at is
  'When meaningful play began (first guess or first revealed hint) -- NOT page load. NULL for historical rows, which are never backfilled with a guessed value.';

-- ---------------------------------------------------------------------------
-- Rainbow outcome, resolvable at the session level.
--
-- For every COMPLETED normal puzzle (win or loss alike) analytics must be
-- able to separate three mutually exclusive outcomes:
--
--   A. NOT ATTEMPTED     found_rainbow = false AND bonus_rainbow_attempted = false
--   B. ATTEMPTED, FAILED found_rainbow = false AND bonus_rainbow_attempted = true
--   C. FOUND             found_rainbow = true
--
-- Two independent boolean facts, not a status enum: "did they find it" and
-- "did they explicitly try the post-game flow" are genuinely separate
-- questions, and encoding them separately keeps the three outcomes derivable
-- without a third field that could disagree with the other two.
--
-- PRODUCT RULE (firm): a Rainbow found through the post-game "Spot the
-- Rainbow" flow AFTER A FORMAL LOSS counts as found, and counts toward the
-- player's Rainbows Spotted. That post-loss opportunity is intentional --
-- failing the main puzzle does not forfeit the Rainbow. Nothing in this
-- schema or in the Stats queries requires a win.
--   "Found after a formal loss" is therefore simply:
--     found_rainbow = true AND status = 'lost'
alter table public.game_sessions
  add column if not exists bonus_rainbow_attempted boolean not null default false;

comment on column public.game_sessions.bonus_rainbow_attempted is
  'True when the player EXPLICITLY submitted the post-completion "Spot the Rainbow" modal at least once, correct or not. Session-level summary of guess_events.attempt_type = ''bonus_rainbow'' (same relationship hints_used has to hint_events). Never inferred from the Rainbow-SHAPE heuristic is_rainbow_attempt.';

-- How the Rainbow was found. NULL when it was not found at all, so this is
-- only ever read alongside found_rainbow = true.
--
--   'in_game'   -- found during normal play, by submitting the herring set as
--                  an ordinary guess
--   'post_game' -- found through the post-completion "Spot the Rainbow" flow
--                  (after a win OR after a formal loss)
--
-- A session summary rather than something derived per-query from the event
-- stream, deliberately. The alternative -- inferring it from
-- rainbow_solve_index = 4 -- happens to be correct today but is fragile
-- reasoning about an unrelated column, and it would silently break the moment
-- a Rainbow could be found in-game at position 4. This column states the fact
-- directly. It is set exactly once, by whichever path actually found the
-- Rainbow, so there is no second writer to disagree with.
alter table public.game_sessions
  add column if not exists rainbow_source text;

alter table public.game_sessions
  drop constraint if exists game_sessions_rainbow_source_check;
alter table public.game_sessions
  add constraint game_sessions_rainbow_source_check
  check (rainbow_source is null or rainbow_source in ('in_game', 'post_game'));

comment on column public.game_sessions.rainbow_source is
  'How the Rainbow was found: in_game | post_game. NULL when not found, and NULL for historical rows (never backfilled with a guess). Read only alongside found_rainbow = true.';
comment on column public.game_sessions.last_activity_at is
  'Time of the last meaningful action (creation, guess, hint, completion). Basis for classifying stale in_progress sessions as abandoned in later analysis. Never written from timer ticks or UI-only events. NULL for historical rows.';


-- ---------------------------------------------------------------------------
-- 1b. Stale-client safety net
--
-- After this ships, a browser may still be running a CACHED older bundle for
-- some time. That bundle inserts one fully-completed session in a single
-- write: it sets `won` to a real boolean, and it knows nothing about `status`
-- or about supplying `completed_at`.
--
-- Both of those are now hostile to it. `status` would land on DEFAULT
-- 'in_progress', and with the DEFAULT now() dropped `completed_at` would land
-- on NULL -- a combination the three-state CHECK rejects outright, so the
-- insert would FAIL and the player would lose a real, finished game. That is a
-- worse outcome than the one this trigger originally existed to prevent.
--
-- The reliable discriminator is `won`, not `completed_at`. The new client
-- never sends a non-null `won` on an in-progress insert -- it cannot, because
-- the outcome is not knowable yet -- so "status says unfinished but an outcome
-- is already present" is a contradiction only an old client can produce. This
-- resolves it from the row's own data and supplies the missing completion
-- timestamp.
--
-- It can never affect a correct row:
--   new in-progress insert  -> won IS NULL, so the guard fails;
--   completion UPDATE       -> status is already won/lost, so the guard fails.
-- And it runs BEFORE the CHECK constraints, so such a row is repaired rather
-- than rejected.
--
-- coalesce() on the timestamp means an old client that DID send one keeps its
-- own value; only a genuinely missing one falls back to now().
-- ---------------------------------------------------------------------------
create or replace function public.game_sessions_sync_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'in_progress' and new.won is not null then
    new.status := case when new.won then 'won' else 'lost' end;
    new.completed_at := coalesce(new.completed_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists game_sessions_sync_status_trigger on public.game_sessions;
create trigger game_sessions_sync_status_trigger
  before insert or update on public.game_sessions
  for each row execute function public.game_sessions_sync_status();


-- ===========================================================================
-- 2. guess_events -- context already known at guess time
--
-- These are all facts the client already computes in order to render the
-- guess; persisting them costs nothing extra to derive and makes
-- frustration/near-miss analysis possible without replaying game logic
-- server-side. All nullable: NULL = not recorded (every historical row).
--
-- NOTE on is_rainbow_attempt (added by an earlier migration, unchanged here):
-- it is inferred from SHAPE -- one selected word from each of the 4 normal
-- categories -- and does NOT prove the player consciously intended a Rainbow
-- guess. It is a heuristic and should be read as one. Name and behavior are
-- preserved for compatibility; this note exists so the metric is not later
-- mistaken for explicit user intent.
-- ===========================================================================

alter table public.guess_events
  add column if not exists is_one_away boolean;
alter table public.guess_events
  add column if not exists is_almost_rainbow boolean;
alter table public.guess_events
  add column if not exists active_time_seconds integer;
alter table public.guess_events
  add column if not exists groups_solved smallint;

comment on column public.guess_events.is_one_away is
  'Guess contained exactly 3 words of one unsolved category. NULL = not recorded (historical rows).';
comment on column public.guess_events.is_almost_rainbow is
  'Guess contained exactly 3 of the 4 Rainbow herring words. NULL = not recorded (historical rows).';
comment on column public.guess_events.active_time_seconds is
  'Cumulative ACTIVE play seconds at the moment of this guess (background-tab time already excluded). NULL = not recorded (historical rows).';
comment on column public.guess_events.groups_solved is
  'Normal categories already solved when this guess was submitted (0-4). NULL = not recorded (historical rows).';


-- What KIND of submission this event was. This is the field that carries
-- explicit player intent, and it exists because is_rainbow_attempt cannot.
--
--   'normal'        -- an ordinary in-game guess. Includes a guess that
--                      happens to be Rainbow-SHAPED, and includes the in-game
--                      find where the player submits the herring set as a
--                      normal guess. In every one of those cases the player
--                      was playing the board, not invoking a Rainbow flow.
--   'bonus_rainbow' -- an EXPLICIT submission of the post-completion "Spot
--                      the Rainbow" modal, correct or not. The player opened
--                      that flow and pressed Submit; there is no inference.
--
-- Do NOT use is_rainbow_attempt to answer "did the player try Spot the
-- Rainbow?". That column is a SHAPE heuristic -- one selected word from each
-- of the 4 categories -- and a player idly picking four unrelated words
-- satisfies it by accident. It stays as-is for compatibility and remains
-- useful as a shape signal, but it is not evidence of intent. attempt_type
-- is.
--
-- NULL for historical rows, which are never backfilled: the old data cannot
-- distinguish a bonus submission from a Rainbow-shaped normal guess, and
-- guessing would manufacture exactly the false intent signal this column
-- exists to prevent.
alter table public.guess_events
  add column if not exists attempt_type text;

alter table public.guess_events
  drop constraint if exists guess_events_attempt_type_check;
alter table public.guess_events
  add constraint guess_events_attempt_type_check
  check (attempt_type is null or attempt_type in ('normal', 'bonus_rainbow'));

comment on column public.guess_events.attempt_type is
  'normal | bonus_rainbow. The authoritative record of an EXPLICIT post-completion "Spot the Rainbow" submission. NULL = historical row (never backfilled). Use this, NOT the is_rainbow_attempt shape heuristic, to determine player intent.';


-- ===========================================================================
-- 3. hint_events
--
-- A row exists only when a hint was ACTUALLY REVEALED/CONSUMED. Opening the
-- hint modal and browsing the available options are explicitly NOT events --
-- they record intent to consider, not consumption, and conflating the two
-- would make every later "did hints help?" analysis wrong.
--
-- game_sessions.hints_used stays as-is: a convenient session-level summary
-- boolean. This table adds the WHICH and the WHEN that a boolean cannot
-- carry, without duplicating it.
-- ===========================================================================

create table if not exists public.hint_events (
  id uuid primary key default gen_random_uuid(),
  game_session_id uuid not null references public.game_sessions(id) on delete cascade,

  -- 'small' = Small Hint (one extra word per category)
  -- 'full'  = Full Hint
  hint_type text not null check (hint_type in ('small', 'full')),

  revealed_at timestamptz not null default now(),

  -- Snapshot of game state at reveal time -- this is what makes "when in a
  -- game do players reach for a hint, and what had gone wrong first?"
  -- answerable. Cumulative active seconds comes from the same single
  -- resume-safe timer that feeds game_sessions.active_time_seconds, so the
  -- two are directly comparable.
  active_time_seconds integer,
  -- Guesses already submitted when the hint was revealed; the next guess is
  -- therefore number guess_count + 1.
  guess_count smallint,
  mistakes smallint,
  groups_solved smallint,
  -- Had the Rainbow already been found at reveal time? NULL when the puzzle
  -- has no Rainbow at all, so "no Rainbow to find" is never recorded as
  -- "hadn't found it yet".
  rainbow_found boolean,

  -- Each hint type can be consumed at most once per game, so this is the
  -- natural idempotency key: a hint used before a refresh cannot produce a
  -- second event just because the page resumed. See the matching guard in
  -- src/lib/gameSession.ts (recordHintEvent).
  constraint hint_events_one_per_type unique (game_session_id, hint_type)
);

comment on table public.hint_events is
  'One row per hint ACTUALLY REVEALED. Opening the hint modal or viewing options is deliberately not recorded. Idempotent on (game_session_id, hint_type).';

alter table public.hint_events enable row level security;

-- Policies for this table are defined in section 6f, alongside those for
-- game_sessions and guess_events. They belong together: the correct policy
-- here depends entirely on what the PARENT table exposes, and writing them
-- apart is how the original version ended up inheriting a globally-readable
-- parent and calling it ownership.


-- ===========================================================================
-- 4. Indexes
-- ===========================================================================

-- Guess idempotency, enforced by the database rather than by trusting that
-- the client will not call twice. Refresh/resume/retry all recompute the same
-- guess_number from the same restored local history, so a repeated write
-- collides here and is discarded by the client's ON CONFLICT DO NOTHING
-- upsert instead of creating a duplicate event.
create unique index if not exists guess_events_session_guess_number_key
  on public.guess_events (game_session_id, guess_number);

-- Resume lookup: find this identity's session for a puzzle.
create index if not exists game_sessions_puzzle_user_idx
  on public.game_sessions (puzzle_id, user_id);
create index if not exists game_sessions_puzzle_device_idx
  on public.game_sessions (puzzle_id, device_id);

-- Abandonment analysis: stale in_progress sessions, without scanning
-- completed ones.
create index if not exists game_sessions_in_progress_activity_idx
  on public.game_sessions (last_activity_at)
  where status = 'in_progress';

create index if not exists hint_events_session_idx
  on public.hint_events (game_session_id);

-- Explicit bonus submissions are a small fraction of guess_events, so a
-- partial index keeps "which sessions actually tried Spot the Rainbow?" cheap
-- without carrying every ordinary guess.
create index if not exists guess_events_bonus_rainbow_idx
  on public.guess_events (game_session_id)
  where attempt_type = 'bonus_rainbow';


-- ===========================================================================
-- 4b. One-row historical correction, required before the indexes in section 5
--
-- Found by the pre-apply check at the top of this file: exactly one duplicate
-- official-session group exists in the current data.
--
--   puzzle 0776cd94-92cc-4e8c-879a-2e17a69b8e60 -- "Emoji Puzzle #4", 2026-05-19
--   user   589ce95b-e515-4b58-81f2-62f5439c3590
--
--   attempt 1  5a0aadb3-7990-47f9-b581-a9502f938c6c
--              completed 2026-05-19 20:01:53Z, won, 2 mistakes, 411s, 6 guesses
--   attempt 2  6dd52b7d-61d2-4071-960c-62e4c09d4c28
--              completed 2026-05-20 05:34:58Z, won, 0 mistakes,  71s, 4 guesses
--
-- A genuine replay: the same account, on two different device_ids, ~9.5 hours
-- apart. (Two devices is why the per-device pre-apply check came back clean
-- and only the per-user one did not.) Under the firm product rule the FIRST
-- completed attempt is the permanent official result, so attempt 1 stays
-- official and attempt 2 is demoted -- which is precisely the state
-- is_official exists to express.
--
-- This runs HERE, not earlier and not later, because it depends on the
-- is_official backfill in section 1 (which sets every historical row to true)
-- and must precede the partial unique indexes in section 5 (which that
-- duplicate would otherwise break).
--
-- NON-DESTRUCTIVE. The session row is preserved in full and its 4 guess_events
-- are untouched; only is_official changes. Nothing is deleted anywhere in this
-- migration.
-- ===========================================================================

update public.game_sessions
   set is_official = false
 where id = '6dd52b7d-61d2-4071-960c-62e4c09d4c28';


-- ---------------------------------------------------------------------------
-- Self-verifying guard.
--
-- Aborts BEFORE the indexes are created if any duplicate official-session
-- group still exists -- for the known row above, or for anything that landed
-- after the pre-apply check was run.
--
-- This is deliberately stronger than a manual checkpoint: it cannot be
-- skipped or forgotten, it re-checks the data as it actually is at apply
-- time, and because the whole migration runs in one transaction, raising here
-- rolls back every change in this file rather than leaving the schema half
-- applied. The two queries mirror the pre-apply checks at the top of the file
-- exactly, scoped to is_official as section 5's indexes are.
-- ---------------------------------------------------------------------------
do $$
declare
  n integer;
begin
  select count(*) into n from (
    select 1
      from public.game_sessions
     where is_official and user_id is not null
     group by puzzle_id, user_id
    having count(*) > 1
    union all
    select 1
      from public.game_sessions
     where is_official and user_id is null
       and device_id is not null and device_id <> 'unknown'
     group by puzzle_id, device_id
    having count(*) > 1
  ) d;

  if n > 0 then
    raise exception
      'Aborting: % duplicate official-session group(s) remain. Resolve them before the unique indexes in section 5 can be created.', n;
  end if;
end
$$;


-- ===========================================================================
-- 5. One official result per puzzle per identity -- OPTIONAL, see note
--
-- This replaces the broader version parked in
-- supabase/proposed-migrations/20260916140000_prevent_duplicate_official_game_sessions.sql.
-- That file was held back because it applied to EVERY game_sessions row by
-- (puzzle_id, identity), with no way to scope it -- which would have blocked
-- the unlimited replays that Beta/Mini/Mega are expected to want.
--
-- Two things changed that. First, `is_official` now exists, so the rule can
-- be scoped to exactly the rows it was always meant to cover. Second -- and
-- this is why the parked file must NOT simply be moved back as written --
-- sessions are now created BEFORE completion, so a single (puzzle, identity)
-- can legitimately have both a completed official row AND a later
-- in_progress replay row. The unscoped index would now reject that
-- legitimate state; the partial `where is_official` version does not.
--
-- This is defense in depth, not the primary protection. The application-level
-- guard in commitOfficialResult() (useGame.ts) remains the real mechanism;
-- these indexes only make it atomic across the race window between its
-- read and its write (two tabs finishing simultaneously).
--
-- The device_id <> 'unknown' exclusion is load-bearing: getDeviceId()
-- (gameStats.ts) returns the literal string 'unknown' when localStorage is
-- unavailable (private browsing, some in-app browsers, storage blocked by
-- policy). EVERY such player shares that one device_id, so without this
-- exclusion the first of them to finish a puzzle would permanently block
-- every other unrelated storage-blocked player from ever saving an official
-- result for it.
--
-- IF the pre-apply duplicate checks at the top of this file returned rows,
-- SKIP these two statements -- everything above is independent of them.
-- ===========================================================================

create unique index if not exists game_sessions_one_official_per_user
  on public.game_sessions (puzzle_id, user_id)
  where is_official and user_id is not null;

create unique index if not exists game_sessions_one_official_per_device
  on public.game_sessions (puzzle_id, device_id)
  where is_official and user_id is null and device_id is not null and device_id <> 'unknown';


-- ===========================================================================
-- 6. ACCESS CONTROL for the three gameplay tables
--
-- THE PROBLEM THIS FIXES
--
-- game_sessions currently allows anonymous SELECT of EVERY row: an
-- unauthenticated caller with nothing but the public anon key can page
-- through the whole table and enumerate every player's gameplay. That was
-- already true before this work, but this work makes it materially worse by
-- adding richer behavioural data (live mistake counts, activity timestamps,
-- entry context, hint timing, per-guess history), so it is fixed here rather
-- than deferred to the later security pass.
--
-- THE IDENTITY CONSTRAINT, STATED HONESTLY
--
-- An authenticated player has a trustworthy identity: auth.uid() comes from a
-- signed JWT the client cannot forge, so ownership for signed-in rows is
-- genuinely enforceable.
--
-- An ANONYMOUS player does not. device_id is a crypto.randomUUID() generated
-- and stored by the browser, sent as ordinary request data. No RLS policy can
-- verify that a caller "is" a given device_id, because there is nothing
-- signed to check it against. A policy like USING (device_id = <client
-- claim>) would therefore not be ownership enforcement at all -- it would let
-- any caller read any device's rows simply by claiming that device_id, while
-- looking secure.
--
-- So anonymous access is modelled for what it actually is: device_id is a
-- BEARER CAPABILITY. Knowing the 122 bits of a v4 UUID is what grants access
-- to that device's own rows, and it is not guessable or enumerable. The
-- meaningful distinction this buys us is exactly the one that matters:
--
--   * you can read the rows whose device_id you already possess;
--   * you CANNOT enumerate the table, so you cannot discover any device_id
--     you do not already have.
--
-- That is implemented by removing direct table SELECT for anonymous callers
-- entirely and routing the handful of lookups the app genuinely needs through
-- narrowly scoped SECURITY DEFINER functions, each of which requires the
-- caller to SUPPLY the device_id and returns only that device's rows. A
-- function cannot be used to browse; it answers one question.
--
-- Not solved here, and not solvable with the current identity model: a
-- player who loses their device_id loses access to their own anonymous
-- history, and anyone who obtains a device_id can read that device's
-- gameplay. Fixing that properly needs the real accounts/Player-ID work,
-- which is deliberately out of scope.
--
-- NO NEW PII: none of this adds IP logging, fingerprinting, geolocation or
-- any identifier beyond the device_id and auth user id that already existed.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 6a. Helper: does this session exist?
--
-- The child-event INSERT policies below need to check that the parent session
-- is real. A plain EXISTS subquery inside a policy runs as the INVOKING user
-- and is itself subject to RLS on game_sessions -- so once anonymous SELECT
-- is removed, such a check would evaluate to false for every anonymous player
-- and silently break all guess/hint writes. This SECURITY DEFINER helper
-- answers the existence question without granting any read access: it returns
-- a boolean and never a row.
-- ---------------------------------------------------------------------------
create or replace function public.game_session_exists(_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.game_sessions where id = _id)
$$;

revoke all on function public.game_session_exists(uuid) from public;
grant execute on function public.game_session_exists(uuid) to anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 6b. Session creation
--
-- Creation moves behind a function for two reasons.
--
-- First, necessity: the client needs the new row's id back, and
-- INSERT ... RETURNING is subject to the SELECT policy. With anonymous SELECT
-- removed, a direct insert would succeed and then fail to return the id,
-- leaving the client unable to attach any events to the session it just
-- created.
--
-- Second, hardening: user_id is taken from auth.uid() INSIDE the function and
-- the caller has no say in it, so a session cannot be stamped with someone
-- else's account id.
--
-- The row is created strictly in_progress. won and completed_at are left NULL
-- because the outcome is not knowable yet, and this function has no way to
-- complete a game -- completion is an UPDATE, guarded separately.
-- ---------------------------------------------------------------------------
create or replace function public.create_game_session(
  _puzzle_id text,
  _device_id text,
  _entry_context text,
  _active_time_seconds integer default 0,
  _mistakes integer default 0
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  _id uuid;
begin
  insert into public.game_sessions (
    puzzle_id, user_id, device_id, entry_context,
    status, won, completed_at, started_at, last_activity_at,
    active_time_seconds, mistakes, found_rainbow, hints_used
  ) values (
    _puzzle_id, auth.uid(), _device_id, _entry_context,
    'in_progress', null, null, now(), now(),
    coalesce(_active_time_seconds, 0), coalesce(_mistakes, 0), false, false
  )
  returning id into _id;
  return _id;
end;
$$;

revoke all on function public.create_game_session(text, text, text, integer, integer) from public;
grant execute on function public.create_game_session(text, text, text, integer, integer) to anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 6c. Own-data lookups
--
-- Each of these answers ONE question about the caller's own data. They are
-- the complete set of reads the application performs against game_sessions;
-- there is deliberately no general-purpose "fetch sessions" function, because
-- that would just reintroduce table-wide access through a different door.
--
-- The shared ownership predicate is the same in all three:
--     signed-in  -> user_id = auth.uid()          (trusted, from the JWT)
--     anonymous  -> device_id = the supplied id   (bearer capability)
--
-- device_id = 'unknown' is excluded everywhere. getDeviceId() returns that
-- literal when localStorage is unavailable (private browsing, some in-app
-- browsers, storage blocked by policy), so EVERY such player shares it. Left
-- in, it would be a single well-known key unlocking the pooled gameplay of
-- every storage-blocked player at once -- the one device_id that IS guessable.
-- Those players consequently cannot read their own history; they already
-- could not resume across a reload, so this takes nothing further away.
-- ---------------------------------------------------------------------------

-- Has this puzzle already been completed officially by this player?
-- Returns a bare boolean -- no ids, no row contents.
create or replace function public.has_official_result(
  _puzzle_id text,
  _device_id text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.game_sessions
     where puzzle_id = _puzzle_id
       and status in ('won', 'lost')
       and is_official
       and (
         (auth.uid() is not null and user_id = auth.uid())
         or (_device_id is not null and _device_id <> 'unknown' and device_id = _device_id)
       )
  )
$$;

revoke all on function public.has_official_result(text, text) from public;
grant execute on function public.has_official_result(text, text) to anon, authenticated, service_role;

-- The caller's own COMPLETED OFFICIAL sessions. Serves both My Stats and the
-- Archive calendar; the calendar simply uses a subset of the columns.
-- Returns only completed official rows, so an in-progress session can never
-- leak into a player-facing stat through this path either.
create or replace function public.get_own_completed_sessions(_device_id text)
returns table (
  puzzle_id text,
  won boolean,
  mistakes integer,
  found_rainbow boolean,
  solve_order jsonb,
  hints_used boolean,
  rainbow_solve_index smallint,
  rainbow_source text,
  bonus_rainbow_attempted boolean,
  status text
)
language sql
stable
security definer
set search_path = public
as $$
  select gs.puzzle_id, gs.won, gs.mistakes, gs.found_rainbow, gs.solve_order,
         gs.hints_used, gs.rainbow_solve_index, gs.rainbow_source,
         gs.bonus_rainbow_attempted, gs.status
    from public.game_sessions gs
   where gs.status in ('won', 'lost')
     and gs.is_official
     and (
       (auth.uid() is not null and gs.user_id = auth.uid())
       or (_device_id is not null and _device_id <> 'unknown' and gs.device_id = _device_id)
     )
$$;

revoke all on function public.get_own_completed_sessions(text) from public;
grant execute on function public.get_own_completed_sessions(text) to anon, authenticated, service_role;

-- How many completed sessions on this device are still unclaimed by any
-- account? Drives the "import your guest stats?" prompt, which needs a count
-- and nothing else.
create or replace function public.count_own_anonymous_sessions(_device_id text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
    from public.game_sessions
   where user_id is null
     and status in ('won', 'lost')
     and _device_id is not null
     and _device_id <> 'unknown'
     and device_id = _device_id
$$;

revoke all on function public.count_own_anonymous_sessions(text) from public;
grant execute on function public.count_own_anonymous_sessions(text) to anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 6d. game_sessions policies
--
-- Every existing policy is dropped first, by iterating pg_policies rather than
-- naming them. These tables were created outside this repository, so the
-- migration history here does not describe the live policy set and a
-- DROP POLICY IF EXISTS by guessed name could silently leave a permissive
-- policy in place -- policies are OR-ed, so one missed permissive SELECT would
-- undo this entire section. Iterating guarantees a known-good starting state.
-- ---------------------------------------------------------------------------
do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'game_sessions'
  loop
    execute format('drop policy %I on public.game_sessions', p.policyname);
  end loop;
end
$$;

alter table public.game_sessions enable row level security;

-- SELECT: signed-in players see their OWN sessions and nothing else.
-- Anonymous callers get no direct SELECT at all; their reads go through the
-- functions in 6c. This is what ends table-wide enumeration.
create policy "Users can read own game sessions"
on public.game_sessions
for select
to authenticated
using (user_id = auth.uid());

create policy "Admins can read all game sessions"
on public.game_sessions
for select
to authenticated
using (public.has_role(auth.uid(), 'admin'));

-- INSERT: kept for stale cached client bundles, which still insert a
-- completed session directly (see the trigger in 1b). The new client creates
-- sessions through create_game_session() instead. Unchanged in substance from
-- the previously tightened policy: a row may be stamped with the caller's own
-- account id, or left anonymous -- never with someone else's id.
create policy "Users can insert own or anonymous game sessions"
on public.game_sessions
for insert
to public
with check (user_id = auth.uid() or user_id is null);

-- UPDATE: completion, activity heartbeats, the bonus Rainbow result, and the
-- guest-stats claim. A signed-in player may update their own rows; anonymous
-- rows remain updatable by anonymous callers, because an anonymous player has
-- no verifiable identity to check against and their own game must still be
-- able to finish.
--
-- LIMITATION, STATED PLAINLY AND NOT PAPERED OVER: this does not stop a
-- determined anonymous caller from issuing an unfiltered UPDATE against
-- anonymous rows. RLS can restrict WHICH rows a policy exposes, but it cannot
-- require that a caller name a specific row, and there is no trustworthy
-- anonymous identity to scope by. Reads were the stated priority here and are
-- now closed; anonymous write scoping needs either authenticated-only writes
-- or a signed session token, which is a product decision, not a policy tweak.
-- Flagged for the dedicated security pass.
--
-- WITH CHECK blocks the one escalation that IS expressible: reassigning a row
-- to another account.
create policy "Players can update own or anonymous game sessions"
on public.game_sessions
for update
to public
using (user_id = auth.uid() or user_id is null)
with check (user_id = auth.uid() or user_id is null);

-- No DELETE policy: gameplay history is not client-erasable.


-- ---------------------------------------------------------------------------
-- 6e. guess_events policies
--
-- Same treatment, and the same starting-state guarantee.
--
-- Nothing in the application reads this table, so no read access is granted
-- to players at all beyond a signed-in player's own rows. In particular there
-- is no "parent session is anonymous, so anyone may read it" clause: that
-- would make every anonymous player's guess history world-readable, which is
-- precisely the shape of the problem being fixed.
-- ---------------------------------------------------------------------------
do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'guess_events'
  loop
    execute format('drop policy %I on public.guess_events', p.policyname);
  end loop;
end
$$;

alter table public.guess_events enable row level security;

create policy "Users can read own guess events"
on public.guess_events
for select
to authenticated
using (
  exists (
    select 1 from public.game_sessions gs
     where gs.id = game_session_id
       and gs.user_id = auth.uid()
  )
);

create policy "Admins can read all guess events"
on public.guess_events
for select
to authenticated
using (public.has_role(auth.uid(), 'admin'));

-- INSERT: anonymous play is first-class, so anonymous clients must be able to
-- write their own events. The only constraint expressible here is that the
-- parent session is real -- checked through the SECURITY DEFINER helper,
-- because a direct subquery would be blocked by game_sessions' own SELECT
-- policy for exactly the callers that need to write.
create policy "Anyone can insert guess events for a real session"
on public.guess_events
for insert
to public
with check (public.game_session_exists(game_session_id));

-- No UPDATE and no DELETE: a submitted guess is a historical fact.


-- ---------------------------------------------------------------------------
-- 6f. hint_events policies
--
-- Re-stated here rather than relying on what section 3 created, because those
-- policies were written against a globally-readable game_sessions and inherit
-- its weakness: "the parent session is visible to me" was a near-empty
-- constraint, and the SELECT policy's `or gs.user_id is null` clause made
-- every anonymous player's hint timing readable by anyone. Both are replaced.
-- ---------------------------------------------------------------------------
do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'hint_events'
  loop
    execute format('drop policy %I on public.hint_events', p.policyname);
  end loop;
end
$$;

alter table public.hint_events enable row level security;

create policy "Users can read own hint events"
on public.hint_events
for select
to authenticated
using (
  exists (
    select 1 from public.game_sessions gs
     where gs.id = game_session_id
       and gs.user_id = auth.uid()
  )
);

create policy "Admins can read all hint events"
on public.hint_events
for select
to authenticated
using (public.has_role(auth.uid(), 'admin'));

create policy "Anyone can insert hint events for a real session"
on public.hint_events
for insert
to public
with check (public.game_session_exists(game_session_id));

-- No UPDATE and no DELETE: a hint reveal is a historical fact.


-- ---------------------------------------------------------------------------
-- 6g. Post-apply verification
--
-- Run these against the live project AFTER applying, as the anon role, to
-- confirm the enumeration hole is actually closed. Each must return zero rows
-- (or an error), NOT a page of other players' gameplay:
--
--   set role anon;
--   select count(*) from public.game_sessions;   -- expect 0
--   select count(*) from public.guess_events;    -- expect 0
--   select count(*) from public.hint_events;     -- expect 0
--   reset role;
--
-- And confirm the legitimate anonymous paths still answer:
--
--   set role anon;
--   select public.has_official_result('<a real puzzle id>', '<a real device id>');
--   select count(*) from public.get_own_completed_sessions('<a real device id>');
--   select public.count_own_anonymous_sessions('<a real device id>');
--   -- and that a device id you do NOT own returns nothing:
--   select count(*) from public.get_own_completed_sessions(gen_random_uuid()::text);
--   reset role;
-- ---------------------------------------------------------------------------


-- ===========================================================================
-- 7. WRITE PATH: every session mutation goes through a scoped function
--
-- Section 6 closed anonymous READ access. This closes anonymous WRITE access,
-- which was the last thing RLS alone could not express.
--
-- The gap RLS leaves: a policy restricts WHICH ROWS are exposed to a
-- statement, but it cannot require that the caller NAME a specific row. With
-- a policy of USING (user_id is null), an anonymous caller could issue one
-- unfiltered UPDATE and rewrite every anonymous session in the table. There is
-- no anonymous identity to scope that by, so there is no policy that fixes it.
--
-- A function can require what a policy cannot. Each one below takes a specific
-- session id AND the device capability for it, verifies the pair, and touches
-- only the columns its own operation owns. The result is that
-- game_sessions has NO update policy at all -- for anonymous or authenticated
-- callers -- and every legitimate mutation still works.
--
-- OWNERSHIP, checked identically everywhere (see session_capability_ok):
--   authenticated session -> gs.user_id = auth.uid(), and a supplied device_id
--                            is IGNORED, so an anonymous caller can never
--                            reach an account-owned session;
--   anonymous session     -> gs.user_id IS NULL AND gs.device_id = the
--                            supplied device_id.
--
-- So a caller holding only a session id cannot mutate anything: they must also
-- hold the device_id that session was created with. Both live in the same
-- browser's localStorage, so a legitimate player always has both, and a leaked
-- session id on its own is inert.
--
-- None of these functions can change puzzle_id, user_id, device_id,
-- entry_context or started_at. Identity and provenance are fixed at creation.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 7a. The shared capability check.
--
-- One definition, used by every write function, so the rule cannot drift
-- between operations. SECURITY DEFINER because it reads game_sessions, which
-- the caller cannot.
-- ---------------------------------------------------------------------------
create or replace function public.session_capability_ok(
  _session_id uuid,
  _device_id text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.game_sessions gs
     where gs.id = _session_id
       and (
         -- Account-owned session: ownership comes from the signed JWT only.
         -- A device_id is deliberately not accepted as an alternative here,
         -- so possession of a device_id can never unlock an account's games.
         (gs.user_id is not null and gs.user_id = auth.uid())
         -- Anonymous session: the device_id it was created with is the
         -- capability. 'unknown' is excluded because every storage-blocked
         -- player shares that literal, making it the one guessable value.
         or (
           gs.user_id is null
           and _device_id is not null
           and _device_id <> 'unknown'
           and gs.device_id = _device_id
         )
       )
  )
$$;

revoke all on function public.session_capability_ok(uuid, text) from public;
grant execute on function public.session_capability_ok(uuid, text) to anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 7b. Activity heartbeat.
--
-- The only function that may touch the live counters, and it may touch
-- nothing else. Restricted to status = 'in_progress', so it can never
-- resurrect, extend or rewrite a finished game -- which also means a late
-- in-flight heartbeat arriving after completion is silently discarded rather
-- than corrupting the final solve time.
--
-- mistakes is the player's CURRENT real count, not a placeholder: 0 on a
-- fresh session, 2 after two wrong guesses, 4 at a formal loss.
-- ---------------------------------------------------------------------------
create or replace function public.touch_game_session(
  _session_id uuid,
  _device_id text,
  _active_time_seconds integer,
  _mistakes integer
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.session_capability_ok(_session_id, _device_id) then
    return false;
  end if;

  update public.game_sessions
     set last_activity_at = now(),
         active_time_seconds = coalesce(_active_time_seconds, active_time_seconds),
         mistakes = coalesce(_mistakes, mistakes)
   where id = _session_id
     and status = 'in_progress';

  return found;
end;
$$;

revoke all on function public.touch_game_session(uuid, text, integer, integer) from public;
grant execute on function public.touch_game_session(uuid, text, integer, integer) to anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 7c. Formal completion.
--
-- Decides is_official ITSELF rather than accepting it from the client. That
-- is the point: "the first completed official attempt is permanent" is a
-- product rule, and a rule enforced by whatever the client happens to send is
-- not enforced at all. Computing it here also makes the check atomic with the
-- write, closing the read-then-write race the application-level guard cannot.
--
-- Restricted to status = 'in_progress', so an already-completed session can
-- never be re-finalized -- not with a better result, a worse one, fewer
-- mistakes, a no-hint result or a Rainbow.
--
-- Returns whether THIS completion became the official one, so the caller
-- knows whether to run the streak and aggregate side effects. Returns NULL
-- when the capability check fails or the session was already finished.
--
-- won is written three-state by construction: this function only ever
-- produces 'won'/TRUE or 'lost'/FALSE, and only ever alongside a real
-- completed_at.
-- ---------------------------------------------------------------------------
create or replace function public.finalize_game_session(
  _session_id uuid,
  _device_id text,
  _won boolean,
  _mistakes integer,
  _active_time_seconds integer,
  _found_rainbow boolean,
  _rainbow_solve_index smallint,
  _solve_order jsonb,
  _hints_used boolean,
  _share_grid text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  _puzzle_id text;
  _user_id uuid;
  _session_device text;
  _is_official boolean;
  _completed_at timestamptz := now();
begin
  if _won is null then
    raise exception 'finalize_game_session requires a definite outcome';
  end if;

  if not public.session_capability_ok(_session_id, _device_id) then
    return null;
  end if;

  select gs.puzzle_id, gs.user_id, gs.device_id
    into _puzzle_id, _user_id, _session_device
    from public.game_sessions gs
   where gs.id = _session_id
     and gs.status = 'in_progress';

  -- Already finished, or gone. Nothing to do, and nothing to overwrite.
  if _puzzle_id is null then
    return null;
  end if;

  -- Does an official completed result already exist for this identity and
  -- puzzle? Read from the session's OWN stored identity, never from anything
  -- the caller supplied.
  _is_official := not exists (
    select 1
      from public.game_sessions other
     where other.puzzle_id = _puzzle_id
       and other.id <> _session_id
       and other.status in ('won', 'lost')
       and other.is_official
       and (
         (_user_id is not null and other.user_id = _user_id)
         or (
           _user_id is null
           and _session_device is not null
           and _session_device <> 'unknown'
           and other.device_id = _session_device
         )
       )
  );

  update public.game_sessions
     set status = case when _won then 'won' else 'lost' end,
         won = _won,
         completed_at = _completed_at,
         last_activity_at = _completed_at,
         is_official = _is_official,
         mistakes = coalesce(_mistakes, mistakes),
         active_time_seconds = coalesce(_active_time_seconds, active_time_seconds),
         found_rainbow = coalesce(_found_rainbow, found_rainbow),
         rainbow_solve_index = coalesce(_rainbow_solve_index, rainbow_solve_index),
         -- At completion a found Rainbow can only have been found in normal
         -- play; the post-game prompt has not been shown yet. The post_game
         -- value is written solely by record_bonus_rainbow, so there is
         -- exactly one writer per outcome.
         rainbow_source = case
                            when coalesce(_found_rainbow, false) then 'in_game'
                            else rainbow_source
                          end,
         solve_order = coalesce(_solve_order, solve_order),
         hints_used = coalesce(_hints_used, hints_used),
         share_grid = coalesce(_share_grid, share_grid)
   where id = _session_id
     and status = 'in_progress';

  return _is_official;
end;
$$;

revoke all on function public.finalize_game_session(uuid, text, boolean, integer, integer, boolean, smallint, jsonb, boolean, text) from public;
grant execute on function public.finalize_game_session(uuid, text, boolean, integer, integer, boolean, smallint, jsonb, boolean, text) to anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 7d. Guess events.
--
-- One function for both the live single write and the completion-time
-- backfill, taking an array so the two share one code path and one set of
-- rules.
--
-- FORCES attempt_type = 'normal'. A client cannot claim 'bonus_rainbow'
-- through this path at all, which is what makes that value trustworthy as an
-- intent signal: it can only originate from record_bonus_rainbow below, i.e.
-- from a genuine post-completion submission. The is_rainbow_attempt SHAPE
-- heuristic stays caller-supplied, because it is only ever a shape signal.
--
-- ON CONFLICT DO NOTHING preserves the existing idempotency guarantee exactly:
-- the same guess recomputes the same guess_number on every mount, so refresh,
-- resume and retry all collide harmlessly instead of duplicating.
-- ---------------------------------------------------------------------------
create or replace function public.record_guess_events(
  _session_id uuid,
  _device_id text,
  _events jsonb
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  _inserted integer;
begin
  if not public.session_capability_ok(_session_id, _device_id) then
    return null;
  end if;

  with rows as (
    insert into public.guess_events (
      game_session_id, guess_number, words, correct, group_name, guessed_at,
      is_rainbow_attempt, attempt_type, is_one_away, is_almost_rainbow,
      active_time_seconds, groups_solved
    )
    select
      _session_id,
      (e ->> 'guess_number')::integer,
      e -> 'words',
      (e ->> 'correct')::boolean,
      e ->> 'group_name',
      (e ->> 'guessed_at')::timestamptz,
      (e ->> 'is_rainbow_attempt')::boolean,
      'normal',
      (e ->> 'is_one_away')::boolean,
      (e ->> 'is_almost_rainbow')::boolean,
      (e ->> 'active_time_seconds')::integer,
      (e ->> 'groups_solved')::smallint
      from jsonb_array_elements(_events) as e
    on conflict (game_session_id, guess_number) do nothing
    returning 1
  )
  select count(*)::integer into _inserted from rows;

  return _inserted;
end;
$$;

revoke all on function public.record_guess_events(uuid, text, jsonb) from public;
grant execute on function public.record_guess_events(uuid, text, jsonb) to anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 7e. Hint events.
--
-- Idempotent on (game_session_id, hint_type), the same natural key as before:
-- a hint used before a refresh cannot produce a second event because the page
-- resumed.
-- ---------------------------------------------------------------------------
create or replace function public.record_hint_event(
  _session_id uuid,
  _device_id text,
  _hint_type text,
  _revealed_at timestamptz,
  _active_time_seconds integer,
  _guess_count smallint,
  _mistakes smallint,
  _groups_solved smallint,
  _rainbow_found boolean
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.session_capability_ok(_session_id, _device_id) then
    return false;
  end if;

  insert into public.hint_events (
    game_session_id, hint_type, revealed_at, active_time_seconds,
    guess_count, mistakes, groups_solved, rainbow_found
  ) values (
    _session_id, _hint_type, coalesce(_revealed_at, now()), _active_time_seconds,
    _guess_count, _mistakes, _groups_solved, _rainbow_found
  )
  on conflict (game_session_id, hint_type) do nothing;

  return true;
end;
$$;

revoke all on function public.record_hint_event(uuid, text, text, timestamptz, integer, smallint, smallint, smallint, boolean) from public;
grant execute on function public.record_hint_event(uuid, text, text, timestamptz, integer, smallint, smallint, smallint, boolean) to anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 7f. The post-completion "Spot the Rainbow" bonus.
--
-- The ONLY producer of attempt_type = 'bonus_rainbow' anywhere in the system.
-- Combined with record_guess_events forcing 'normal', that makes the column a
-- trustworthy record of explicit player intent rather than something a client
-- can assert.
--
-- Runs only against a COMPLETED session, because the prompt only exists after
-- the board is finished -- and deliberately after a formal LOSS as much as
-- after a win. That post-loss opportunity is intentional product behaviour:
-- failing the main puzzle does not forfeit the Rainbow, and a find there
-- counts as found_rainbow and toward Rainbows Spotted.
--
-- The found_rainbow guard means a session that already found the Rainbow in
-- normal play cannot have its rainbow_source rewritten from in_game to
-- post_game. bonus_rainbow_attempted is set regardless of outcome, which is
-- precisely what separates "attempted and failed" from "never attempted" --
-- the two are otherwise identical rows.
--
-- The solve timer stopped at completion, so active_time_seconds is passed
-- through to the event only and the session's own total is never touched: a
-- bonus round cannot inflate a recorded solve time.
-- ---------------------------------------------------------------------------
create or replace function public.record_bonus_rainbow(
  _session_id uuid,
  _device_id text,
  _guess_number integer,
  _words jsonb,
  _correct boolean,
  _guessed_at timestamptz,
  _active_time_seconds integer,
  _groups_solved smallint
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if not public.session_capability_ok(_session_id, _device_id) then
    return false;
  end if;

  if not exists (
    select 1 from public.game_sessions
     where id = _session_id and status in ('won', 'lost')
  ) then
    return false;
  end if;

  insert into public.guess_events (
    game_session_id, guess_number, words, correct, group_name,
    is_rainbow_attempt, attempt_type, guessed_at, active_time_seconds,
    groups_solved
  ) values (
    _session_id, _guess_number, _words, _correct, null,
    -- A bonus submission is one word per category by construction, so the
    -- shape flag is true -- but it is attempt_type that records the intent.
    true, 'bonus_rainbow', coalesce(_guessed_at, now()), _active_time_seconds,
    _groups_solved
  )
  on conflict (game_session_id, guess_number) do nothing;

  update public.game_sessions
     set bonus_rainbow_attempted = true,
         found_rainbow = case when _correct then true else found_rainbow end,
         rainbow_source = case when _correct then 'post_game' else rainbow_source end,
         rainbow_solve_index = case when _correct then 4::smallint else rainbow_solve_index end
   where id = _session_id
     and status in ('won', 'lost')
     and not coalesce(found_rainbow, false);

  return true;
end;
$$;

revoke all on function public.record_bonus_rainbow(uuid, text, integer, jsonb, boolean, timestamptz, integer, smallint) from public;
grant execute on function public.record_bonus_rainbow(uuid, text, integer, jsonb, boolean, timestamptz, integer, smallint) to anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 7g. Claiming guest sessions on sign-in.
--
-- The "import your guest stats?" flow, and the one write that intentionally
-- changes ownership. It is therefore the most tightly constrained: it can only
-- ever move rows FROM anonymous TO the caller's own account, never between
-- accounts and never back to anonymous.
--
-- Requires an authenticated caller, so there is no anonymous path to it at
-- all. Returns how many sessions were claimed.
-- ---------------------------------------------------------------------------
create or replace function public.claim_anonymous_sessions(_device_id text)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  _claimed integer;
begin
  if auth.uid() is null then
    return 0;
  end if;
  if _device_id is null or _device_id = 'unknown' then
    return 0;
  end if;

  update public.game_sessions
     set user_id = auth.uid()
   where device_id = _device_id
     and user_id is null;

  get diagnostics _claimed = row_count;
  return _claimed;
end;
$$;

revoke all on function public.claim_anonymous_sessions(text) from public;
grant execute on function public.claim_anonymous_sessions(text) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 7h. Remove the direct write policies these functions replace.
--
-- After this, game_sessions has NO update policy, and the child tables have no
-- insert policy, for any non-privileged role. Every write goes through a
-- function above that verifies the session capability first.
--
-- The game_sessions INSERT policy is deliberately KEPT, for one reason: a
-- browser running a CACHED older bundle still inserts a completed session
-- directly, and the trigger in section 1b exists to accept it. Dropping this
-- would make those players lose real finished games until their cache turns
-- over. It is narrow (a row may be stamped with the caller's own account id or
-- left anonymous, never someone else's) and it can be dropped once cached
-- bundles have aged out:
--
--   drop policy "Users can insert own or anonymous game sessions"
--     on public.game_sessions;
--
-- Those same stale clients also bulk-insert guess_events, which will now fail.
-- That is the accepted trade: the SESSION is what carries the player's result
-- and it still saves; only the per-guess detail of an old client's game is
-- lost, and only until its cache turns over.
-- ---------------------------------------------------------------------------
drop policy if exists "Players can update own or anonymous game sessions" on public.game_sessions;
drop policy if exists "Anyone can insert guess events for a real session" on public.guess_events;
drop policy if exists "Anyone can insert hint events for a real session" on public.hint_events;

-- game_session_exists() existed only to let those child INSERT policies check
-- their parent without tripping over game_sessions' own RLS. The policies are
-- gone, so the helper has no remaining caller.
drop function if exists public.game_session_exists(uuid);


-- ---------------------------------------------------------------------------
-- 7i. Post-apply verification for the write path
--
-- As the anon role, each of these must fail or affect zero rows:
--
--   set role anon;
--   update public.game_sessions set mistakes = 0;                  -- expect 0 rows / denied
--   update public.game_sessions set won = true where id = '<known id>';
--   insert into public.guess_events (game_session_id, guess_number, words, correct)
--     values ('<known id>', 99, '[]'::jsonb, true);                -- expect denied
--
--   -- and a session id WITHOUT its device capability must be inert:
--   select public.touch_game_session('<known session id>', 'not-the-device-id', 10, 1);
--   -- expect false, and the row unchanged
--   reset role;
-- ---------------------------------------------------------------------------
