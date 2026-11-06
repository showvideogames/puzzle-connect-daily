-- Test-only source definitions copied verbatim from CrossPuns eb238dd migrations.
-- Auth scaffolding is provided by the disposable test. No production installation.

-- Source: 0001_init.sql
create table if not exists public.xw_puzzles (
  id uuid primary key default gen_random_uuid(),
  publish_date date not null,
  size text not null check (size in ('mini', 'midi', 'full')),
  title text not null,
  author text not null default '',
  width int not null check (width between 2 and 40),
  height int not null check (height between 2 and 40),
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (publish_date, size)
);

-- Source: 0002_leaderboard.sql
create table if not exists public.xw_times (
  id uuid primary key default gen_random_uuid(),
  puzzle_id uuid not null references public.xw_puzzles (id) on delete cascade,
  player_key uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 24),
  seconds int not null check (seconds between 1 and 86400),
  created_at timestamptz not null default now(),
  unique (puzzle_id, player_key)
);

-- Source: 0007_accounts.sql
create table if not exists public.xw_accounts (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users (id) on delete set null,
  global_user_id text not null unique,
  -- The key the account's leaderboard times, clue votes and joke reactions are
  -- filed under (xw_times / xw_votes / xw_joke_reactions.player_key). Shared
  -- with no one; a signed-in browser uses it instead of its own guest key.
  player_key uuid not null unique default gen_random_uuid(),
  role text not null default 'player',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint xw_accounts_global_user_id_format check (global_user_id ~ '^user_[0-9A-Za-z]{10,64}$'),
  constraint xw_accounts_role_check check (role in ('player', 'admin'))
);

-- Source: 0007_accounts.sql
create table if not exists public.xw_solves (
  account_id uuid not null references public.xw_accounts (id) on delete cascade,
  puzzle_id uuid not null references public.xw_puzzles (id) on delete cascade,
  seconds int not null check (seconds between 1 and 86400),
  used_help boolean not null default false,
  solved_at timestamptz not null default now(),
  source text not null default 'play' check (source in ('play', 'import')),
  primary key (account_id, puzzle_id)
);

-- Source: 0014_local_midnight.sql
create or replace function public.xw_today_local()
returns date
language sql
stable
as $$ select (now() at time zone 'Pacific/Kiritimati')::date $$;
