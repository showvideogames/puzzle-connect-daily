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
