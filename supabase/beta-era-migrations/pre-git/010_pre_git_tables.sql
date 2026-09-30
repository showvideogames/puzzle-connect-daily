-- Tables that exist in production but were NEVER created by a migration in
-- this repository.
--
-- WHY THIS FILE EXISTS
-- --------------------
-- This project's schema started life inside Lovable's editor, which creates
-- tables directly. Six of them predate `supabase/migrations/` and are only
-- ever ALTERed by it, never created:
--
--     feedback   game_sessions   guess_events
--     puzzle_aggregates          puzzle_ratings   user_streaks
--
-- A clean database plus every repository migration is therefore NOT the
-- production schema — the very first migration that touches game_sessions
-- fails. `supabase/migrations/20260916150000` says as much in its own
-- comments ("These tables were created outside this repository, so the
-- migration history here does not describe the live policy set").
--
-- So the E2E environment applies this file first, and then every migration on
-- top of it, which is what makes "clean database → real schema" reproducible.
--
-- WHAT IS AND IS NOT HERE
-- -----------------------
-- Column shapes only, plus `enable row level security`. Policies are NOT set
-- here: for game_sessions and guess_events the migrations drop every existing
-- policy and define the full set themselves, and for user_streaks they revoke
-- all client access. The three tables no migration covers get their policies
-- in 030_pre_git_policies.sql, after the migrations, because those policies
-- call public.has_role() — which a migration creates.
--
-- This file is generated-shaped but hand-maintained: if a column is ever
-- added to one of these tables outside git again, add it here (or, better,
-- write a migration for it).

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamp with time zone default now(),
  type text not null,
  message text not null,
  email text,
  user_id uuid
);

create table if not exists public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  puzzle_id text not null,
  user_id uuid,
  device_id text,
  won boolean,
  mistakes integer not null,
  active_time_seconds integer,
  found_rainbow boolean default false,
  solve_order jsonb,
  completed_at timestamp with time zone,
  hints_used boolean default false,
  share_grid text,
  rainbow_solve_index smallint,
  status text not null default 'in_progress'::text,
  is_official boolean not null default false,
  entry_context text,
  started_at timestamp with time zone default now(),
  last_activity_at timestamp with time zone default now(),
  bonus_rainbow_attempted boolean not null default false,
  rainbow_source text,
  puzzle_version_id uuid,
  format text not null default 'full'::text
);

create table if not exists public.guess_events (
  id uuid primary key default gen_random_uuid(),
  game_session_id uuid not null,
  guess_number integer not null,
  words jsonb not null,
  correct boolean not null,
  group_name text,
  guessed_at timestamp with time zone default now(),
  is_rainbow_attempt boolean,
  is_one_away boolean,
  is_almost_rainbow boolean,
  active_time_seconds integer,
  groups_solved smallint,
  attempt_type text
);

create table if not exists public.puzzle_aggregates (
  puzzle_id text primary key,
  total_plays integer default 0,
  total_wins integer default 0,
  avg_mistakes numeric default 0,
  avg_time_seconds numeric default 0,
  most_common_first_solve text,
  updated_at timestamp with time zone default now()
);

create table if not exists public.puzzle_ratings (
  id uuid primary key default gen_random_uuid(),
  puzzle_id text not null,
  user_id uuid not null,
  rating integer not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.user_streaks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  device_id text,
  current_streak integer default 0,
  longest_streak integer default 0,
  last_played_date date,
  updated_at timestamp with time zone default now(),
  format text not null default 'full'::text
);

-- PuzzleRating.tsx upserts on (puzzle_id, user_id); without this the upsert's
-- ON CONFLICT has no matching constraint and fails at runtime.
create unique index if not exists puzzle_ratings_puzzle_user_key
  on public.puzzle_ratings (puzzle_id, user_id);

alter table public.feedback           enable row level security;
alter table public.game_sessions      enable row level security;
alter table public.guess_events       enable row level security;
alter table public.puzzle_aggregates  enable row level security;
alter table public.puzzle_ratings     enable row level security;
alter table public.user_streaks       enable row level security;
