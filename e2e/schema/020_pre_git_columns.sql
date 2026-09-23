-- Columns added to migration-owned tables OUTSIDE the repository's
-- migrations (Lovable-side edits), which later migrations then depend on.
--
-- Same problem as 010_pre_git_tables.sql, one level down: `puzzles` and
-- `puzzle_groups` ARE created by a migration, but eight of their columns are
-- not. `20260917120000_puzzle_content_versioning.sql` reads
-- puzzles.rainbow_category_name, is_beta, current_version_id and friends, so
-- they have to exist by the time it runs.
--
-- Applied by e2e/scripts/apply-schema.ts immediately before the first
-- migration whose filename sorts at or after APPLY_BEFORE_MIGRATION
-- (20260917120000) — not at the start, because the tables themselves do not
-- exist until the first migration has run.
--
-- The list was originally derived by diffing the schema the migrations
-- produce against the live one.

alter table public.puzzles       add column if not exists rainbow_category_name text;
alter table public.puzzles       add column if not exists is_emoji_puzzle boolean default false;
alter table public.puzzles       add column if not exists is_free_puzzle boolean default false;
alter table public.puzzles       add column if not exists free_puzzle_order integer;
alter table public.puzzles       add column if not exists rainbow_hint_word text;
alter table public.puzzles       add column if not exists current_version_id uuid;
alter table public.puzzles       add column if not exists is_beta boolean not null default false;
alter table public.puzzle_groups add column if not exists hint_word text;
