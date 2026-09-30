-- ===========================================================================
-- RAINBOW CATEGORIES + MINI CATEGORIES: DATABASE BASELINE
-- ===========================================================================
--
-- This one file turns a completely blank Supabase project into the Rainbow /
-- Mini backend: every table, column, constraint, index, function, trigger,
-- row-level-security policy and grant Rainbow owns. (The storage bucket and
-- its policies are in 0002_rainbow_storage.sql, kept separate because
-- storage is not part of every local backend.)
--
-- HOW IT WAS MADE
--   The 32 beta-era migrations (now under supabase/beta-era-migrations/,
--   kept for their reasoning) plus the four hand-reconstructed pre-git files
--   were applied to a blank local stack, the result was dumped from
--   pg_catalog, reordered into the sections below, and then the launch-time
--   account layer was applied by hand:
--     * public.accounts and rainbow_uid(): a Rainbow account is an auth user
--       WITH an accounts row, created only by ensure_account() from a
--       custom:platform (WorkOS) identity. Every function and policy that
--       used auth.uid() now uses rainbow_uid(), so an auth user that is not
--       a Rainbow account (another tenant's admin, a stray signup) is a
--       guest to every Rainbow RPC.
--     * the guest-history import decision moved from once-per-ACCOUNT
--       (account_onboarding, removed) to once-per-DEVICE, recorded on
--       device_identities itself (claimed_by / retired_reason).
--     * game_results (a legacy duplicate of game_sessions) is gone, and the
--       gameplay tables gained the foreign keys and uniqueness the pre-git
--       tables never had.
--     * account deletion is a database property: delete_local_account().
--
-- HOW IT IS KEPT HONEST
--   supabase/rainbow-owned-objects.json is generated from a database built
--   from this file alone (`npm run db:manifest`), and CI fails when the two
--   disagree (`npm run db:manifest -- --check`). The scoped teardown for the
--   shared beta project is generated from that manifest, never written by
--   hand. See supabase/RAINBOW-OWNED-OBJECTS.md.
--
-- WHAT THIS FILE NEVER TOUCHES
--   Anything that is not Rainbow's. While Rainbow shares a project with other
--   games, their objects (xw_*, cv_*, wtf_*) are not named here and are not
--   referenced by anything here. The only objects outside `public` this file
--   relies on are GoTrue's auth.users, auth.identities and auth.uid().
--
-- Object names are fully qualified and no search_path is assumed, so the file
-- runs identically through `supabase db push`, the SQL editor, the local e2e
-- harness and PGlite.
-- ===========================================================================

-- ===========================================================================
-- 1. Types
-- ===========================================================================

-- app_role
CREATE TYPE public.app_role AS ENUM (
    'admin',
    'moderator'
);


-- ===========================================================================
-- 2. Tables
-- ===========================================================================

-- custom_puzzles
CREATE TABLE public.custom_puzzles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    share_id text NOT NULL,
    visibility text NOT NULL,
    created_by uuid,
    creator_name text NOT NULL,
    title text NOT NULL,
    moderation_status text DEFAULT 'active'::text NOT NULL,
    content jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    short_code text NOT NULL,
    CONSTRAINT custom_puzzles_moderation_status_check CHECK ((moderation_status = ANY (ARRAY['active'::text, 'hidden'::text]))),
    CONSTRAINT custom_puzzles_short_code_format CHECK ((short_code ~ '^[2-9A-HJKMNP-Za-hjkmnp-z]{8,12}$'::text)),
    CONSTRAINT custom_puzzles_visibility_check CHECK ((visibility = ANY (ARRAY['public'::text, 'private'::text])))
);

-- archive_access
CREATE TABLE public.archive_access (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    granted_by uuid,
    granted_at timestamp with time zone DEFAULT now() NOT NULL
);

-- beta_feedback
CREATE TABLE public.beta_feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    puzzle_id uuid NOT NULL,
    puzzle_version_id uuid NOT NULL,
    playtest_id uuid,
    tester_name text,
    fun_rating smallint NOT NULL,
    difficulty_rating smallint NOT NULL,
    rainbow_fairness_rating smallint,
    confusing_or_incorrect text,
    additional_comments text,
    would_play_again boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT beta_feedback_difficulty_rating_check CHECK (((difficulty_rating >= 1) AND (difficulty_rating <= 5))),
    CONSTRAINT beta_feedback_fun_rating_check CHECK (((fun_rating >= 1) AND (fun_rating <= 5))),
    CONSTRAINT beta_feedback_rainbow_fairness_rating_check CHECK (((rainbow_fairness_rating >= 1) AND (rainbow_fairness_rating <= 5)))
);

-- beta_playtests
CREATE TABLE public.beta_playtests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    puzzle_id uuid NOT NULL,
    puzzle_version_id uuid NOT NULL,
    device_id text NOT NULL,
    status text DEFAULT 'in_progress'::text NOT NULL,
    won boolean,
    mistakes integer DEFAULT 0 NOT NULL,
    hints_used boolean DEFAULT false NOT NULL,
    is_reset boolean DEFAULT false NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT beta_playtests_status_check CHECK ((status = ANY (ARRAY['in_progress'::text, 'completed'::text, 'abandoned'::text])))
);

-- creator_profiles
CREATE TABLE public.creator_profiles (
    user_id uuid NOT NULL,
    public_slug text NOT NULL,
    display_name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT creator_profiles_public_slug_check CHECK (((public_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text) AND ((length(public_slug) >= 3) AND (length(public_slug) <= 48))))
);

-- custom_puzzle_favorites
CREATE TABLE public.custom_puzzle_favorites (
    custom_puzzle_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- custom_puzzle_results
CREATE TABLE public.custom_puzzle_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    custom_puzzle_id uuid NOT NULL,
    device_id text NOT NULL,
    won boolean NOT NULL,
    total_guesses smallint NOT NULL,
    completed_at timestamp with time zone DEFAULT now() NOT NULL,
    recent_run_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    CONSTRAINT custom_puzzle_results_total_guesses_check CHECK (((total_guesses >= 0) AND (total_guesses <= 60)))
);

-- custom_puzzle_stats
CREATE TABLE public.custom_puzzle_stats (
    custom_puzzle_id uuid NOT NULL,
    wins integer DEFAULT 0 NOT NULL,
    losses integer DEFAULT 0 NOT NULL,
    guesses_4 integer DEFAULT 0 NOT NULL,
    guesses_5 integer DEFAULT 0 NOT NULL,
    guesses_6 integer DEFAULT 0 NOT NULL,
    guesses_7 integer DEFAULT 0 NOT NULL,
    guesses_8_plus integer DEFAULT 0 NOT NULL,
    win_guess_total bigint DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT custom_puzzle_stats_guesses_4_check CHECK ((guesses_4 >= 0)),
    CONSTRAINT custom_puzzle_stats_guesses_5_check CHECK ((guesses_5 >= 0)),
    CONSTRAINT custom_puzzle_stats_guesses_6_check CHECK ((guesses_6 >= 0)),
    CONSTRAINT custom_puzzle_stats_guesses_7_check CHECK ((guesses_7 >= 0)),
    CONSTRAINT custom_puzzle_stats_guesses_8_plus_check CHECK ((guesses_8_plus >= 0)),
    CONSTRAINT custom_puzzle_stats_losses_check CHECK ((losses >= 0)),
    CONSTRAINT custom_puzzle_stats_win_guess_total_check CHECK ((win_guess_total >= 0)),
    CONSTRAINT custom_puzzle_stats_wins_check CHECK ((wins >= 0))
);

-- accounts
-- THE RAINBOW ACCOUNT. An auth.users row is a Rainbow account only when it
-- has a row here, and the only writer is ensure_account(), which copies the
-- WorkOS user id out of the caller's custom:platform identity. global_user_id
-- is the link to the shared identity; it is never a key for gameplay rows
-- (those use user_id, Rainbow's own local id) and never client-supplied.
CREATE TABLE public.accounts (
    user_id uuid NOT NULL,
    global_user_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT accounts_global_user_id_format CHECK ((global_user_id ~ '^user_[0-9A-Za-z]{10,64}$'::text))
);

-- device_identities
-- The guest identity, and (since the launch baseline) the record of the
-- one-time "bring your progress?" decision: a device is retired exactly once,
-- by the account that imported or declined it (claimed_by), and a retired
-- device can never be verified again.
CREATE TABLE public.device_identities (
    device_id text NOT NULL,
    token_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    retired_at timestamp with time zone,
    retired_reason text,
    claimed_by uuid,
    decided_at timestamp with time zone,
    CONSTRAINT device_identities_retired_reason_check CHECK (((retired_reason IS NULL) OR (retired_reason = ANY (ARRAY['imported'::text, 'started_fresh'::text])))),
    CONSTRAINT device_identities_retired_pair_check CHECK (((retired_at IS NULL) = (retired_reason IS NULL)))
);

-- feedback
CREATE TABLE public.feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    type text NOT NULL,
    message text NOT NULL,
    email text,
    user_id uuid
);

-- game_sessions
CREATE TABLE public.game_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    puzzle_id text NOT NULL,
    user_id uuid,
    device_id text,
    won boolean,
    mistakes integer NOT NULL,
    active_time_seconds integer,
    found_rainbow boolean DEFAULT false,
    solve_order jsonb,
    completed_at timestamp with time zone,
    hints_used boolean DEFAULT false,
    share_grid text,
    rainbow_solve_index smallint,
    status text DEFAULT 'in_progress'::text NOT NULL,
    is_official boolean DEFAULT false NOT NULL,
    entry_context text,
    started_at timestamp with time zone DEFAULT now(),
    last_activity_at timestamp with time zone DEFAULT now(),
    bonus_rainbow_attempted boolean DEFAULT false NOT NULL,
    rainbow_source text,
    puzzle_version_id uuid,
    format text DEFAULT 'full'::text NOT NULL,
    CONSTRAINT game_sessions_format_check CHECK ((format = ANY (ARRAY['full'::text, 'mini'::text]))),
    CONSTRAINT game_sessions_rainbow_source_check CHECK (((rainbow_source IS NULL) OR (rainbow_source = ANY (ARRAY['in_game'::text, 'post_game'::text])))),
    CONSTRAINT game_sessions_status_check CHECK ((status = ANY (ARRAY['in_progress'::text, 'won'::text, 'lost'::text]))),
    CONSTRAINT game_sessions_status_completed_at_check CHECK (((status = 'in_progress'::text) = (completed_at IS NULL))),
    CONSTRAINT game_sessions_status_won_check CHECK ((((status = 'in_progress'::text) AND (won IS NULL)) OR ((status = 'won'::text) AND (won IS TRUE)) OR ((status = 'lost'::text) AND (won IS FALSE))))
);

-- guess_events
CREATE TABLE public.guess_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    game_session_id uuid NOT NULL,
    guess_number integer NOT NULL,
    words jsonb NOT NULL,
    correct boolean NOT NULL,
    group_name text,
    guessed_at timestamp with time zone DEFAULT now(),
    is_rainbow_attempt boolean,
    is_one_away boolean,
    is_almost_rainbow boolean,
    active_time_seconds integer,
    groups_solved smallint,
    attempt_type text,
    server_numbered boolean,
    CONSTRAINT guess_events_attempt_type_check CHECK (((attempt_type IS NULL) OR (attempt_type = ANY (ARRAY['normal'::text, 'bonus_rainbow'::text]))))
);

-- hint_events
CREATE TABLE public.hint_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    game_session_id uuid NOT NULL,
    hint_type text NOT NULL,
    revealed_at timestamp with time zone DEFAULT now() NOT NULL,
    active_time_seconds integer,
    guess_count smallint,
    mistakes smallint,
    groups_solved smallint,
    rainbow_found boolean,
    CONSTRAINT hint_events_hint_type_check CHECK ((hint_type = ANY (ARRAY['small'::text, 'full'::text])))
);

-- luck_score_ceilings
CREATE TABLE public.luck_score_ceilings (
    effective_from date NOT NULL,
    ceiling integer NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT luck_score_ceilings_ceiling_check CHECK ((ceiling >= 2))
);

-- puzzle_aggregates
CREATE TABLE public.puzzle_aggregates (
    puzzle_id text NOT NULL,
    total_plays integer DEFAULT 0,
    total_wins integer DEFAULT 0,
    avg_mistakes numeric DEFAULT 0,
    avg_time_seconds numeric DEFAULT 0,
    most_common_first_solve text,
    updated_at timestamp with time zone DEFAULT now()
);

-- puzzle_groups
CREATE TABLE public.puzzle_groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    puzzle_id uuid NOT NULL,
    category text NOT NULL,
    words text[] NOT NULL,
    difficulty integer NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    hint_word text,
    category_emoji text,
    category_emoji_hint_only boolean DEFAULT false NOT NULL,
    CONSTRAINT puzzle_groups_difficulty_check CHECK (((difficulty >= 1) AND (difficulty <= 4)))
);

-- puzzle_ratings
CREATE TABLE public.puzzle_ratings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    puzzle_id text NOT NULL,
    user_id uuid NOT NULL,
    rating integer NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

-- puzzle_versions
CREATE TABLE public.puzzle_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    puzzle_id uuid NOT NULL,
    version_number integer NOT NULL,
    content jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    CONSTRAINT puzzle_versions_version_number_check CHECK ((version_number >= 1))
);

-- puzzles
CREATE TABLE public.puzzles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    date date NOT NULL,
    title text,
    is_published boolean DEFAULT false NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    word_order text[],
    rainbow_herring text[],
    theme text,
    emoji_puzzle_icon text,
    rainbow_category_name text,
    is_emoji_puzzle boolean DEFAULT false,
    is_free_puzzle boolean DEFAULT false,
    free_puzzle_order integer,
    rainbow_hint_word text,
    current_version_id uuid,
    is_beta boolean DEFAULT false NOT NULL,
    designer_name text DEFAULT 'Sam West'::text NOT NULL,
    alphabetize_completed boolean DEFAULT true NOT NULL,
    rainbow_category_emoji text,
    format text DEFAULT 'full'::text NOT NULL,
    rainbow_category_emoji_hint_only boolean DEFAULT false NOT NULL,
    CONSTRAINT puzzles_format_check CHECK ((format = ANY (ARRAY['full'::text, 'mini'::text]))),
    CONSTRAINT puzzles_not_beta_and_published CHECK ((NOT (is_published AND is_beta)))
);

-- user_roles
CREATE TABLE public.user_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role public.app_role NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- user_streaks
CREATE TABLE public.user_streaks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    device_id text,
    current_streak integer DEFAULT 0,
    longest_streak integer DEFAULT 0,
    last_played_date date,
    updated_at timestamp with time zone DEFAULT now(),
    format text DEFAULT 'full'::text NOT NULL,
    CONSTRAINT user_streaks_format_check CHECK ((format = ANY (ARRAY['full'::text, 'mini'::text])))
);


-- ===========================================================================
-- 3. Primary keys, unique and check constraints
-- ===========================================================================

-- accounts accounts_pkey
ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (user_id);

-- accounts accounts_global_user_id_key
ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_global_user_id_key UNIQUE (global_user_id);

-- archive_access archive_access_pkey
ALTER TABLE ONLY public.archive_access
    ADD CONSTRAINT archive_access_pkey PRIMARY KEY (id);

-- archive_access archive_access_user_id_key
ALTER TABLE ONLY public.archive_access
    ADD CONSTRAINT archive_access_user_id_key UNIQUE (user_id);

-- beta_feedback beta_feedback_pkey
ALTER TABLE ONLY public.beta_feedback
    ADD CONSTRAINT beta_feedback_pkey PRIMARY KEY (id);

-- beta_playtests beta_playtests_pkey
ALTER TABLE ONLY public.beta_playtests
    ADD CONSTRAINT beta_playtests_pkey PRIMARY KEY (id);

-- creator_profiles creator_profiles_pkey
ALTER TABLE ONLY public.creator_profiles
    ADD CONSTRAINT creator_profiles_pkey PRIMARY KEY (user_id);

-- creator_profiles creator_profiles_public_slug_key
ALTER TABLE ONLY public.creator_profiles
    ADD CONSTRAINT creator_profiles_public_slug_key UNIQUE (public_slug);

-- custom_puzzle_favorites custom_puzzle_favorites_pkey
ALTER TABLE ONLY public.custom_puzzle_favorites
    ADD CONSTRAINT custom_puzzle_favorites_pkey PRIMARY KEY (custom_puzzle_id, user_id);

-- custom_puzzle_results custom_puzzle_results_custom_puzzle_id_device_id_key
ALTER TABLE ONLY public.custom_puzzle_results
    ADD CONSTRAINT custom_puzzle_results_custom_puzzle_id_device_id_key UNIQUE (custom_puzzle_id, device_id);

-- custom_puzzle_results custom_puzzle_results_pkey
ALTER TABLE ONLY public.custom_puzzle_results
    ADD CONSTRAINT custom_puzzle_results_pkey PRIMARY KEY (id);

-- custom_puzzle_stats custom_puzzle_stats_pkey
ALTER TABLE ONLY public.custom_puzzle_stats
    ADD CONSTRAINT custom_puzzle_stats_pkey PRIMARY KEY (custom_puzzle_id);

-- custom_puzzles custom_puzzles_pkey
ALTER TABLE ONLY public.custom_puzzles
    ADD CONSTRAINT custom_puzzles_pkey PRIMARY KEY (id);

-- custom_puzzles custom_puzzles_share_id_key
ALTER TABLE ONLY public.custom_puzzles
    ADD CONSTRAINT custom_puzzles_share_id_key UNIQUE (share_id);

-- device_identities device_identities_pkey
ALTER TABLE ONLY public.device_identities
    ADD CONSTRAINT device_identities_pkey PRIMARY KEY (device_id);

-- feedback feedback_pkey
ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_pkey PRIMARY KEY (id);

-- game_sessions game_sessions_pkey
ALTER TABLE ONLY public.game_sessions
    ADD CONSTRAINT game_sessions_pkey PRIMARY KEY (id);

-- guess_events guess_events_pkey
ALTER TABLE ONLY public.guess_events
    ADD CONSTRAINT guess_events_pkey PRIMARY KEY (id);

-- hint_events hint_events_one_per_type
ALTER TABLE ONLY public.hint_events
    ADD CONSTRAINT hint_events_one_per_type UNIQUE (game_session_id, hint_type);

-- hint_events hint_events_pkey
ALTER TABLE ONLY public.hint_events
    ADD CONSTRAINT hint_events_pkey PRIMARY KEY (id);

-- luck_score_ceilings luck_score_ceilings_pkey
ALTER TABLE ONLY public.luck_score_ceilings
    ADD CONSTRAINT luck_score_ceilings_pkey PRIMARY KEY (effective_from);

-- puzzle_aggregates puzzle_aggregates_pkey
ALTER TABLE ONLY public.puzzle_aggregates
    ADD CONSTRAINT puzzle_aggregates_pkey PRIMARY KEY (puzzle_id);

-- puzzle_groups puzzle_groups_pkey
ALTER TABLE ONLY public.puzzle_groups
    ADD CONSTRAINT puzzle_groups_pkey PRIMARY KEY (id);

-- puzzle_ratings puzzle_ratings_pkey
ALTER TABLE ONLY public.puzzle_ratings
    ADD CONSTRAINT puzzle_ratings_pkey PRIMARY KEY (id);

-- puzzle_versions puzzle_versions_pkey
ALTER TABLE ONLY public.puzzle_versions
    ADD CONSTRAINT puzzle_versions_pkey PRIMARY KEY (id);

-- puzzle_versions puzzle_versions_puzzle_id_version_number_key
ALTER TABLE ONLY public.puzzle_versions
    ADD CONSTRAINT puzzle_versions_puzzle_id_version_number_key UNIQUE (puzzle_id, version_number);

-- puzzles puzzles_pkey
ALTER TABLE ONLY public.puzzles
    ADD CONSTRAINT puzzles_pkey PRIMARY KEY (id);

-- user_roles user_roles_pkey
ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);

-- user_roles user_roles_user_id_role_key
ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);

-- user_streaks user_streaks_pkey
ALTER TABLE ONLY public.user_streaks
    ADD CONSTRAINT user_streaks_pkey PRIMARY KEY (id);


-- ===========================================================================
-- 4. Foreign keys
-- ===========================================================================

-- accounts accounts_user_id_fkey
ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- device_identities device_identities_claimed_by_fkey
ALTER TABLE ONLY public.device_identities
    ADD CONSTRAINT device_identities_claimed_by_fkey FOREIGN KEY (claimed_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- game_sessions game_sessions_user_id_fkey
-- Deleting an account never deletes gameplay rows (site-wide aggregates keep
-- counting them); it anonymises them. delete_local_account() also clears
-- device_id, so an anonymised row is reachable by nobody.
ALTER TABLE ONLY public.game_sessions
    ADD CONSTRAINT game_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- game_sessions game_sessions_device_id_fkey
ALTER TABLE ONLY public.game_sessions
    ADD CONSTRAINT game_sessions_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.device_identities(device_id);

-- user_streaks user_streaks_user_id_fkey
ALTER TABLE ONLY public.user_streaks
    ADD CONSTRAINT user_streaks_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- user_streaks user_streaks_device_id_fkey
ALTER TABLE ONLY public.user_streaks
    ADD CONSTRAINT user_streaks_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.device_identities(device_id);

-- puzzle_ratings puzzle_ratings_user_id_fkey
ALTER TABLE ONLY public.puzzle_ratings
    ADD CONSTRAINT puzzle_ratings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- feedback feedback_user_id_fkey
ALTER TABLE ONLY public.feedback
    ADD CONSTRAINT feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- custom_puzzle_results custom_puzzle_results_device_id_fkey
ALTER TABLE ONLY public.custom_puzzle_results
    ADD CONSTRAINT custom_puzzle_results_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.device_identities(device_id);

-- beta_playtests beta_playtests_device_id_fkey
ALTER TABLE ONLY public.beta_playtests
    ADD CONSTRAINT beta_playtests_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.device_identities(device_id);

-- archive_access archive_access_granted_by_fkey
ALTER TABLE ONLY public.archive_access
    ADD CONSTRAINT archive_access_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- archive_access archive_access_user_id_fkey
ALTER TABLE ONLY public.archive_access
    ADD CONSTRAINT archive_access_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- beta_feedback beta_feedback_playtest_id_fkey
ALTER TABLE ONLY public.beta_feedback
    ADD CONSTRAINT beta_feedback_playtest_id_fkey FOREIGN KEY (playtest_id) REFERENCES public.beta_playtests(id) ON DELETE SET NULL;

-- beta_feedback beta_feedback_puzzle_id_fkey
ALTER TABLE ONLY public.beta_feedback
    ADD CONSTRAINT beta_feedback_puzzle_id_fkey FOREIGN KEY (puzzle_id) REFERENCES public.puzzles(id) ON DELETE CASCADE;

-- beta_feedback beta_feedback_puzzle_version_id_fkey
ALTER TABLE ONLY public.beta_feedback
    ADD CONSTRAINT beta_feedback_puzzle_version_id_fkey FOREIGN KEY (puzzle_version_id) REFERENCES public.puzzle_versions(id) ON DELETE CASCADE;

-- beta_playtests beta_playtests_puzzle_id_fkey
ALTER TABLE ONLY public.beta_playtests
    ADD CONSTRAINT beta_playtests_puzzle_id_fkey FOREIGN KEY (puzzle_id) REFERENCES public.puzzles(id) ON DELETE CASCADE;

-- beta_playtests beta_playtests_puzzle_version_id_fkey
ALTER TABLE ONLY public.beta_playtests
    ADD CONSTRAINT beta_playtests_puzzle_version_id_fkey FOREIGN KEY (puzzle_version_id) REFERENCES public.puzzle_versions(id) ON DELETE CASCADE;

-- creator_profiles creator_profiles_user_id_fkey
ALTER TABLE ONLY public.creator_profiles
    ADD CONSTRAINT creator_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- custom_puzzle_favorites custom_puzzle_favorites_custom_puzzle_id_fkey
ALTER TABLE ONLY public.custom_puzzle_favorites
    ADD CONSTRAINT custom_puzzle_favorites_custom_puzzle_id_fkey FOREIGN KEY (custom_puzzle_id) REFERENCES public.custom_puzzles(id) ON DELETE CASCADE;

-- custom_puzzle_favorites custom_puzzle_favorites_user_id_fkey
ALTER TABLE ONLY public.custom_puzzle_favorites
    ADD CONSTRAINT custom_puzzle_favorites_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- custom_puzzle_results custom_puzzle_results_custom_puzzle_id_fkey
ALTER TABLE ONLY public.custom_puzzle_results
    ADD CONSTRAINT custom_puzzle_results_custom_puzzle_id_fkey FOREIGN KEY (custom_puzzle_id) REFERENCES public.custom_puzzles(id) ON DELETE CASCADE;

-- custom_puzzle_stats custom_puzzle_stats_custom_puzzle_id_fkey
ALTER TABLE ONLY public.custom_puzzle_stats
    ADD CONSTRAINT custom_puzzle_stats_custom_puzzle_id_fkey FOREIGN KEY (custom_puzzle_id) REFERENCES public.custom_puzzles(id) ON DELETE CASCADE;

-- custom_puzzles custom_puzzles_created_by_fkey
ALTER TABLE ONLY public.custom_puzzles
    ADD CONSTRAINT custom_puzzles_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- hint_events hint_events_game_session_id_fkey
ALTER TABLE ONLY public.hint_events
    ADD CONSTRAINT hint_events_game_session_id_fkey FOREIGN KEY (game_session_id) REFERENCES public.game_sessions(id) ON DELETE CASCADE;

-- puzzle_groups puzzle_groups_puzzle_id_fkey
ALTER TABLE ONLY public.puzzle_groups
    ADD CONSTRAINT puzzle_groups_puzzle_id_fkey FOREIGN KEY (puzzle_id) REFERENCES public.puzzles(id) ON DELETE CASCADE;

-- puzzle_versions puzzle_versions_created_by_fkey
ALTER TABLE ONLY public.puzzle_versions
    ADD CONSTRAINT puzzle_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- puzzle_versions puzzle_versions_puzzle_id_fkey
ALTER TABLE ONLY public.puzzle_versions
    ADD CONSTRAINT puzzle_versions_puzzle_id_fkey FOREIGN KEY (puzzle_id) REFERENCES public.puzzles(id) ON DELETE CASCADE;

-- puzzles puzzles_created_by_fkey
ALTER TABLE ONLY public.puzzles
    ADD CONSTRAINT puzzles_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- user_roles user_roles_user_id_fkey
ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


-- ===========================================================================
-- 5. Indexes
-- ===========================================================================

-- beta_feedback_puzzle_id_idx
CREATE INDEX beta_feedback_puzzle_id_idx ON public.beta_feedback USING btree (puzzle_id);

-- beta_playtests_device_puzzle_idx
CREATE INDEX beta_playtests_device_puzzle_idx ON public.beta_playtests USING btree (puzzle_id, device_id, started_at DESC);

-- beta_playtests_puzzle_id_idx
CREATE INDEX beta_playtests_puzzle_id_idx ON public.beta_playtests USING btree (puzzle_id);

-- custom_puzzle_favorites_user_idx
CREATE INDEX custom_puzzle_favorites_user_idx ON public.custom_puzzle_favorites USING btree (user_id, created_at DESC);

-- custom_puzzle_results_puzzle_idx
CREATE INDEX custom_puzzle_results_puzzle_idx ON public.custom_puzzle_results USING btree (custom_puzzle_id);

-- custom_puzzles_created_by_idx
CREATE INDEX custom_puzzles_created_by_idx ON public.custom_puzzles USING btree (created_by) WHERE (created_by IS NOT NULL);

-- custom_puzzles_public_by_creator_idx
CREATE INDEX custom_puzzles_public_by_creator_idx ON public.custom_puzzles USING btree (created_by, created_at DESC) WHERE ((visibility = 'public'::text) AND (moderation_status = 'active'::text) AND (created_by IS NOT NULL));

-- custom_puzzles_share_id_idx
CREATE INDEX custom_puzzles_share_id_idx ON public.custom_puzzles USING btree (share_id);

-- custom_puzzles_short_code_key
CREATE UNIQUE INDEX custom_puzzles_short_code_key ON public.custom_puzzles USING btree (short_code);

-- game_sessions_format_device_idx
CREATE INDEX game_sessions_format_device_idx ON public.game_sessions USING btree (format, device_id) WHERE (device_id IS NOT NULL);

-- game_sessions_format_user_idx
CREATE INDEX game_sessions_format_user_idx ON public.game_sessions USING btree (format, user_id) WHERE (user_id IS NOT NULL);

-- game_sessions_in_progress_activity_idx
CREATE INDEX game_sessions_in_progress_activity_idx ON public.game_sessions USING btree (last_activity_at) WHERE (status = 'in_progress'::text);

-- game_sessions_one_official_per_device
CREATE UNIQUE INDEX game_sessions_one_official_per_device ON public.game_sessions USING btree (puzzle_id, device_id) WHERE (is_official AND (user_id IS NULL) AND (device_id IS NOT NULL) AND (device_id <> 'unknown'::text));

-- game_sessions_one_official_per_user
CREATE UNIQUE INDEX game_sessions_one_official_per_user ON public.game_sessions USING btree (puzzle_id, user_id) WHERE (is_official AND (user_id IS NOT NULL));

-- game_sessions_puzzle_device_idx
CREATE INDEX game_sessions_puzzle_device_idx ON public.game_sessions USING btree (puzzle_id, device_id);

-- game_sessions_puzzle_user_idx
CREATE INDEX game_sessions_puzzle_user_idx ON public.game_sessions USING btree (puzzle_id, user_id);

-- game_sessions_puzzle_version_idx
CREATE INDEX game_sessions_puzzle_version_idx ON public.game_sessions USING btree (puzzle_version_id) WHERE (puzzle_version_id IS NOT NULL);

-- guess_events_bonus_rainbow_idx
CREATE INDEX guess_events_bonus_rainbow_idx ON public.guess_events USING btree (game_session_id) WHERE (attempt_type = 'bonus_rainbow'::text);

-- guess_events_session_guess_number_key
CREATE UNIQUE INDEX guess_events_session_guess_number_key ON public.guess_events USING btree (game_session_id, guess_number);

-- hint_events_session_idx
CREATE INDEX hint_events_session_idx ON public.hint_events USING btree (game_session_id);

-- puzzle_ratings_puzzle_user_key
CREATE UNIQUE INDEX puzzle_ratings_puzzle_user_key ON public.puzzle_ratings USING btree (puzzle_id, user_id);

-- puzzle_versions_puzzle_idx
CREATE INDEX puzzle_versions_puzzle_idx ON public.puzzle_versions USING btree (puzzle_id, version_number DESC);

-- puzzles_date_format_key
CREATE UNIQUE INDEX puzzles_date_format_key ON public.puzzles USING btree (date, format);

-- device_identities_claimed_by_idx
CREATE INDEX device_identities_claimed_by_idx ON public.device_identities USING btree (claimed_by) WHERE (claimed_by IS NOT NULL);

-- user_streaks_one_per_device_format
-- One streak row per guest device per format, and one per account per
-- format. The beta schema had only non-unique indexes here and production
-- accumulated duplicate rows that every reader then had to disambiguate.
CREATE UNIQUE INDEX user_streaks_one_per_device_format ON public.user_streaks USING btree (device_id, format) WHERE ((user_id IS NULL) AND (device_id IS NOT NULL));

-- user_streaks_one_per_user_format
CREATE UNIQUE INDEX user_streaks_one_per_user_format ON public.user_streaks USING btree (user_id, format) WHERE (user_id IS NOT NULL);


-- ===========================================================================
-- 6. Functions
-- ===========================================================================

set check_function_bodies = off;

-- admin_save_puzzle(uuid, jsonb, jsonb)
CREATE FUNCTION public.admin_save_puzzle(_puzzle_id uuid, _metadata jsonb, _content jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _uid           uuid := public.rainbow_uid();
  _canonical     jsonb;
  _current       jsonb;
  _next          integer;
  _vid           uuid;
  _created       boolean := false;
  _pid           uuid := _puzzle_id;
  _date          date;
  _designer_name text;
  _format        text;
begin
  if _uid is null or not public.has_role(_uid, 'admin') then
    raise exception 'admin role required to save puzzles' using errcode = 'insufficient_privilege';
  end if;

  _canonical := public.validate_puzzle_content(_content);
  _format := coalesce(_canonical ->> 'format', 'full');

  _date := nullif(_metadata ->> 'date', '')::date;
  if _date is null then
    raise exception 'a puzzle needs a date' using errcode = 'invalid_parameter_value';
  end if;

  -- A puzzle's format is fixed for life. Its stored groups, its players'
  -- pinned boards and its statistics all assume one shape, so re-shaping an
  -- existing puzzle in place would invalidate all three at once.
  if _pid is not null then
    if exists (select 1 from public.puzzles p where p.id = _pid and p.format <> _format) then
      raise exception 'a puzzle cannot change format after it is created'
        using errcode = 'invalid_parameter_value';
    end if;
  end if;

  _designer_name := coalesce(nullif(btrim(coalesce(_metadata ->> 'designer_name', '')), ''), 'Sam West');

  if _pid is null then
    insert into public.puzzles (
      date, title, is_published, is_beta, created_by, designer_name,
      word_order, rainbow_herring, rainbow_category_name, rainbow_hint_word,
      theme, is_emoji_puzzle, emoji_puzzle_icon, is_free_puzzle, free_puzzle_order,
      alphabetize_completed, rainbow_category_emoji, rainbow_category_emoji_hint_only, format
    ) values (
      _date,
      nullif(btrim(coalesce(_metadata ->> 'title', '')), ''),
      coalesce((_metadata ->> 'is_published')::boolean, false),
      coalesce((_metadata ->> 'is_beta')::boolean, false),
      _uid,
      _designer_name,
      case when _canonical -> 'word_order' = 'null'::jsonb then null
           else array(select jsonb_array_elements_text(_canonical -> 'word_order')) end,
      case when _canonical -> 'rainbow_herring' = 'null'::jsonb then null
           else array(select jsonb_array_elements_text(_canonical -> 'rainbow_herring')) end,
      _canonical ->> 'rainbow_category_name',
      _canonical ->> 'rainbow_hint_word',
      _canonical ->> 'theme',
      (_canonical ->> 'is_emoji_puzzle')::boolean,
      nullif(btrim(coalesce(_metadata ->> 'emoji_puzzle_icon', '')), ''),
      coalesce((_metadata ->> 'is_free_puzzle')::boolean, false),
      nullif(_metadata ->> 'free_puzzle_order', '')::int,
      (_canonical ->> 'alphabetize_completed')::boolean,
      _canonical ->> 'rainbow_category_emoji',
      coalesce((_canonical ->> 'rainbow_category_emoji_hint_only')::boolean, false),
      _format
    )
    returning id into _pid;
  else
    perform 1 from public.puzzles where id = _pid for update;
    if not found then
      raise exception 'puzzle % does not exist', _pid using errcode = 'no_data_found';
    end if;

    update public.puzzles
       set date                  = _date,
           title                 = nullif(btrim(coalesce(_metadata ->> 'title', '')), ''),
           is_published          = coalesce((_metadata ->> 'is_published')::boolean, false),
           is_beta               = coalesce((_metadata ->> 'is_beta')::boolean, false),
           designer_name         = _designer_name,
           word_order            = case when _canonical -> 'word_order' = 'null'::jsonb then null
                                        else array(select jsonb_array_elements_text(_canonical -> 'word_order')) end,
           rainbow_herring       = case when _canonical -> 'rainbow_herring' = 'null'::jsonb then null
                                        else array(select jsonb_array_elements_text(_canonical -> 'rainbow_herring')) end,
           rainbow_category_name = _canonical ->> 'rainbow_category_name',
           rainbow_hint_word     = _canonical ->> 'rainbow_hint_word',
           theme                 = _canonical ->> 'theme',
           is_emoji_puzzle       = (_canonical ->> 'is_emoji_puzzle')::boolean,
           emoji_puzzle_icon     = nullif(btrim(coalesce(_metadata ->> 'emoji_puzzle_icon', '')), ''),
           is_free_puzzle        = coalesce((_metadata ->> 'is_free_puzzle')::boolean, false),
           free_puzzle_order     = nullif(_metadata ->> 'free_puzzle_order', '')::int,
           alphabetize_completed = (_canonical ->> 'alphabetize_completed')::boolean,
           rainbow_category_emoji = _canonical ->> 'rainbow_category_emoji',
           rainbow_category_emoji_hint_only = coalesce((_canonical ->> 'rainbow_category_emoji_hint_only')::boolean, false),
           format                = _format
     where id = _pid;
  end if;

  select pv.content, pv.id
    into _current, _vid
    from public.puzzle_versions pv
    join public.puzzles p on p.current_version_id = pv.id
   where p.id = _pid;

  if _current is null or _current <> _canonical then
    select coalesce(max(pv.version_number), 0) + 1
      into _next
      from public.puzzle_versions pv
     where pv.puzzle_id = _pid;

    insert into public.puzzle_versions (puzzle_id, version_number, content, created_by)
    values (_pid, _next, _canonical, _uid)
    returning id into _vid;

    update public.puzzles set current_version_id = _vid where id = _pid;
    _created := true;
  end if;

  delete from public.puzzle_groups where puzzle_id = _pid;

  insert into public.puzzle_groups (puzzle_id, category, words, difficulty, sort_order, hint_word, category_emoji, category_emoji_hint_only)
  select _pid,
         g ->> 'category',
         array(select jsonb_array_elements_text(g -> 'words')),
         (g ->> 'difficulty')::int,
         (g ->> 'sort_order')::int,
         g ->> 'hint_word',
         g ->> 'category_emoji',
         -- The canonical form omits this key unless it is true, and the
         -- column is NOT NULL DEFAULT false, so an absent key lands as a real
         -- false on the live read path.
         coalesce((g ->> 'category_emoji_hint_only')::boolean, false)
    from jsonb_array_elements(_canonical -> 'groups') g;

  select pv.version_number
    into _next
    from public.puzzle_versions pv
   where pv.id = _vid;

  return jsonb_build_object(
    'puzzle_id',       _pid,
    'version_id',      _vid,
    'version_number',  _next,
    'created_version', _created,
    'format',          _format
  );
end;
$$;

-- admin_set_custom_puzzle_status(uuid, text)
CREATE FUNCTION public.admin_set_custom_puzzle_status(_puzzle_id uuid, _status text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  did_update boolean;
begin
  if public.rainbow_uid() is null or not public.has_role(public.rainbow_uid(), 'admin') then
    raise exception 'admin role required' using errcode = 'insufficient_privilege';
  end if;
  if _status not in ('active', 'hidden') then
    raise exception 'status must be active or hidden' using errcode = 'invalid_parameter_value';
  end if;

  update public.custom_puzzles set moderation_status = _status where id = _puzzle_id;
  get diagnostics did_update = row_count;
  return did_update;
end;
$$;

-- complete_beta_playtest(uuid, text, text, boolean, integer, boolean)
CREATE FUNCTION public.complete_beta_playtest(_playtest_id uuid, _device_id text, _device_token text, _won boolean, _mistakes integer, _hints_used boolean) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  did_update boolean;
begin
  if not public.verify_device(_device_id, _device_token) then
    return false;
  end if;

  update public.beta_playtests
     set status       = 'completed',
         won          = _won,
         mistakes     = coalesce(_mistakes, mistakes),
         hints_used   = coalesce(_hints_used, hints_used),
         completed_at = now(),
         updated_at   = now()
   where id = _playtest_id
     and device_id = _device_id
     and status = 'in_progress';

  get diagnostics did_update = row_count;
  return did_update;
end;
$$;

-- create_custom_puzzle(text, text, text, jsonb)
CREATE FUNCTION public.create_custom_puzzle(_creator_name text, _title text, _visibility text, _content jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _uid        uuid := public.rainbow_uid();
  _canonical  jsonb;
  _title_n    text;
  _creator_n  text;
  _share_id   text;
  _short_code text;
  _id         uuid;
  _tries      integer := 0;
begin
  if _visibility not in ('public', 'private') then
    raise exception 'visibility must be public or private' using errcode = 'invalid_parameter_value';
  end if;

  _canonical := public.validate_custom_puzzle_content(_content);

  _title_n := nullif(btrim(coalesce(_title, '')), '');
  if _title_n is null then
    raise exception 'a puzzle needs a title' using errcode = 'invalid_parameter_value';
  end if;
  if length(_title_n) > 100 then
    raise exception 'title is too long (max 100 characters)' using errcode = 'invalid_parameter_value';
  end if;

  _creator_n := nullif(btrim(coalesce(_creator_name, '')), '');
  if _creator_n is null then
    raise exception 'a designer name is required' using errcode = 'invalid_parameter_value';
  end if;
  if length(_creator_n) > 60 then
    raise exception 'designer name is too long (max 60 characters)' using errcode = 'invalid_parameter_value';
  end if;

  loop
    _share_id   := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    _short_code := public.custom_puzzle_new_short_code();
    begin
      insert into public.custom_puzzles (share_id, short_code, visibility, created_by, creator_name, title, content)
      values (_share_id, _short_code, _visibility, _uid, _creator_n, _title_n, _canonical)
      returning id into _id;
      exit;
    exception when unique_violation then
      -- share_id or short_code collided: draw both again.
      _tries := _tries + 1;
      if _tries >= 10 then raise; end if;
    end;
  end loop;

  perform public.custom_ensure_creator_profile(_uid, _creator_n);

  return jsonb_build_object('puzzle_id', _id, 'share_id', _share_id, 'short_code', _short_code);
end;
$$;

-- create_device_identity()
CREATE FUNCTION public.create_device_identity() RETURNS TABLE(device_id text, device_token text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _id    text := gen_random_uuid()::text;
  _token text := replace(gen_random_uuid()::text, '-', '')
              || replace(gen_random_uuid()::text, '-', '');
begin
  insert into public.device_identities (device_id, token_hash)
  values (_id, encode(sha256(convert_to(_token, 'UTF8')), 'hex'));

  device_id := _id;
  device_token := _token;
  return next;
end;
$$;

-- create_game_session(text, text, text, text, integer, integer, uuid)
CREATE FUNCTION public.create_game_session(_puzzle_id text, _device_id text, _device_token text, _entry_context text, _active_time_seconds integer DEFAULT 0, _mistakes integer DEFAULT 0, _puzzle_version_id uuid DEFAULT NULL::uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _id      uuid;
  _uid     uuid := public.rainbow_uid();
  _version uuid := _puzzle_version_id;
  _format  text;
begin
  if not public.verify_device(_device_id, _device_token) then
    return null;
  end if;

  -- Compared as text for the same reason the version check below does:
  -- game_sessions.puzzle_id is text, not guaranteed to be a parseable uuid,
  -- and casting IT would raise instead of simply failing the check. Casting
  -- puzzles.id (a real uuid) to text is always safe.
  select p.format
    into _format
    from public.puzzles p
   where p.id::text = _puzzle_id
     and p.is_published = true;

  if _format is null then
    return null;
  end if;

  -- The import gate, per DEVICE: a Rainbow account may not start playing on
  -- a browser that still holds undecided guest history, because the account
  -- would begin accumulating its own sessions and streak before the import it
  -- is about to be offered. verify_device() above already refused a retired
  -- device, so "live device with anonymous history" is exactly "decision
  -- still owed". resolve_device_import() is how the client finds out.
  if _uid is not null and public.device_has_importable_history(_device_id) then
    return null;
  end if;

  if _version is not null then
    if not exists (
      select 1 from public.puzzle_versions pv
       where pv.id = _version
         and pv.puzzle_id::text = _puzzle_id
    ) then
      raise exception 'puzzle version % does not belong to puzzle %', _version, _puzzle_id
        using errcode = 'foreign_key_violation';
    end if;
  end if;

  insert into public.game_sessions (
    puzzle_id, puzzle_version_id, user_id, device_id, entry_context,
    status, won, completed_at, started_at, last_activity_at,
    active_time_seconds, mistakes, found_rainbow, hints_used, format
  ) values (
    _puzzle_id, _version, _uid, _device_id, _entry_context,
    'in_progress', null, null, now(), now(),
    coalesce(_active_time_seconds, 0), coalesce(_mistakes, 0), false, false, _format
  )
  returning id into _id;

  return _id;
end;
$$;

-- custom_creator_new_slug(text)
CREATE FUNCTION public.custom_creator_new_slug(_name text) RETURNS text
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  _base text;
begin
  _base := btrim(regexp_replace(lower(btrim(coalesce(_name, ''))), '[^a-z0-9]+', '-', 'g'), '-');
  _base := btrim(left(_base, 30), '-');
  if length(_base) < 2 then
    _base := 'creator';
  end if;
  return _base || '-' || public.custom_random_string('23456789abcdefghjkmnpqrstuvwxyz', 4);
end;
$$;

-- custom_ensure_creator_profile(uuid, text)
CREATE FUNCTION public.custom_ensure_creator_profile(_uid uuid, _name text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _tries integer := 0;
begin
  if _uid is null or exists (select 1 from public.creator_profiles where user_id = _uid) then
    return;
  end if;
  loop
    begin
      insert into public.creator_profiles (user_id, public_slug, display_name)
      values (_uid, public.custom_creator_new_slug(_name), left(btrim(_name), 60))
      on conflict (user_id) do nothing;
      exit;
    exception when unique_violation then
      _tries := _tries + 1;      -- slug collision: draw a new suffix
      if _tries >= 10 then raise; end if;
    end;
  end loop;
end;
$$;

-- custom_puzzle_new_short_code()
CREATE FUNCTION public.custom_puzzle_new_short_code() RETURNS text
    LANGUAGE sql
    SET search_path TO 'public'
    AS $$
  select public.custom_random_string(
    '23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz', 10)
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

-- custom_puzzle_public_json(public.custom_puzzles)
CREATE FUNCTION public.custom_puzzle_public_json(_p public.custom_puzzles) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select jsonb_build_object(
    'id',              _p.id,
    'share_id',        _p.share_id,
    'short_code',      _p.short_code,
    'title',           _p.title,
    'creator_name',    _p.creator_name,
    'visibility',      _p.visibility,
    'content',         _p.content,
    -- Only a signed-in creator has a profile; anonymous puzzles stay unlinked.
    'creator_slug',    (select cp.public_slug from public.creator_profiles cp where cp.user_id = _p.created_by),
    'favorite_count',  (select count(*) from public.custom_puzzle_favorites f where f.custom_puzzle_id = _p.id),
    'favorited_by_me', exists (
      select 1 from public.custom_puzzle_favorites f
       where f.custom_puzzle_id = _p.id and f.user_id = public.rainbow_uid()
    )
  )
$$;

-- custom_random_string(text, integer)
CREATE FUNCTION public.custom_random_string(_alphabet text, _len integer) RETURNS text
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  _n     integer := length(_alphabet);
  _limit integer := 256 - (256 % _n);   -- reject the biased tail
  _out   text := '';
  _bytes bytea;
  _b     integer;
  _i     integer;
begin
  while length(_out) < _len loop
    _bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    for _i in 0 .. 15 loop
      -- bytes 6 and 8 carry the fixed UUID version/variant bits: not uniform.
      continue when _i in (6, 8);
      _b := get_byte(_bytes, _i);
      if _b < _limit then
        _out := _out || substr(_alphabet, (_b % _n) + 1, 1);
        exit when length(_out) = _len;
      end if;
    end loop;
  end loop;
  return _out;
end;
$$;

-- device_has_importable_history(text)
CREATE FUNCTION public.device_has_importable_history(_device_id text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1
      from public.game_sessions gs
     where gs.device_id = _device_id
       and gs.user_id is null
       and (
            gs.status in ('won', 'lost')
         or exists (select 1 from public.guess_events ge where ge.game_session_id = gs.id)
         or exists (select 1 from public.hint_events he where he.game_session_id = gs.id)
         or coalesce(gs.mistakes, 0) > 0
       )
  )
  or exists (
    select 1
      from public.user_streaks us
     where us.device_id = _device_id
       and us.user_id is null
       and (
            coalesce(us.current_streak, 0) > 0
         or coalesce(us.longest_streak, 0) > 0
         or us.last_played_date is not null
       )
  )
$$;

-- finalize_game_session(uuid, text, text, boolean, integer, integer, boolean, smallint, jsonb, boolean, text, boolean, text)
CREATE FUNCTION public.finalize_game_session(_session_id uuid, _device_id text, _device_token text, _won boolean, _mistakes integer, _active_time_seconds integer, _found_rainbow boolean, _rainbow_solve_index smallint, _solve_order jsonb, _hints_used boolean, _share_grid text, _skip_streak boolean DEFAULT false, _local_date text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  _puzzle_id      text;
  _user_id        uuid;
  _session_device text;
  _session_format text;
  _is_official    boolean;
  _completed_at   timestamptz := now();
  _rows           integer;
  _first_solve    text := _solve_order ->> 0;
  _t              integer;
  _w              integer;
  _am             numeric;
  _at             numeric;
begin
  if _won is null then
    raise exception 'finalize_game_session requires a definite outcome';
  end if;

  if not public.session_capability_ok(_session_id, _device_id, _device_token) then
    return null;
  end if;

  select gs.puzzle_id, gs.user_id, gs.device_id, gs.format
    into _puzzle_id, _user_id, _session_device, _session_format
    from public.game_sessions gs
   where gs.id = _session_id
     and gs.status = 'in_progress';

  if _puzzle_id is null then
    return null;
  end if;

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
         rainbow_source = case
                            when coalesce(_found_rainbow, false) then 'in_game'
                            else rainbow_source
                          end,
         solve_order = coalesce(_solve_order, solve_order),
         hints_used = coalesce(_hints_used, hints_used),
         share_grid = coalesce(_share_grid, share_grid)
   where id = _session_id
     and status = 'in_progress';

  get diagnostics _rows = row_count;

  -- Someone else finalized this session between the read above and here.
  -- Claiming the transition we did not make is exactly how a play gets
  -- counted twice, so stop.
  if _rows = 0 then
    return null;
  end if;

  if not _is_official then
    return false;
  end if;

  -- ---- required effect 1: site-wide aggregates --------------------------
  -- Keyed on puzzle_id, which is already format-specific (a puzzle belongs to
  -- exactly one format), so these need no format handling of their own.
  perform pg_advisory_xact_lock(hashtextextended('puzzle_aggregate:' || _puzzle_id, 0));

  select pa.total_plays, pa.total_wins, pa.avg_mistakes, pa.avg_time_seconds
    into _t, _w, _am, _at
    from public.puzzle_aggregates pa
   where pa.puzzle_id = _puzzle_id;

  if found then
    _t := _t + 1;
    _w := _w + (case when _won then 1 else 0 end);
    _am := ((coalesce(_am, 0) * (_t - 1)) + coalesce(_mistakes, 0)) / _t;
    _at := ((coalesce(_at, 0) * (_t - 1)) + coalesce(_active_time_seconds, 0)) / _t;

    update public.puzzle_aggregates
       set total_plays = _t,
           total_wins = _w,
           avg_mistakes = _am,
           avg_time_seconds = _at,
           most_common_first_solve = coalesce(_first_solve, most_common_first_solve),
           updated_at = now()
     where puzzle_id = _puzzle_id;
  else
    insert into public.puzzle_aggregates (
      puzzle_id, total_plays, total_wins, avg_mistakes, avg_time_seconds,
      most_common_first_solve, updated_at
    ) values (
      _puzzle_id, 1, (case when _won then 1 else 0 end),
      coalesce(_mistakes, 0), coalesce(_active_time_seconds, 0),
      _first_solve, now()
    );
  end if;

  -- (The beta-era game_results mirror that used to be written here is gone:
  -- game_sessions is the single record of a play.)

  -- ---- required effect 3: streak ----------------------------------------
  -- Archive games still do not touch streaks. The format comes from the
  -- SESSION, so a Mini completion can only ever move the Mini streak.
  if not coalesce(_skip_streak, false) then
    perform public.record_streak(_user_id, _session_device, _won, _local_date, coalesce(_session_format, 'full'));
  end if;

  return true;
end;
$_$;

-- game_sessions_sync_status()
CREATE FUNCTION public.game_sessions_sync_status() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _identity text;
begin
  -- Unchanged: a legacy client sends won/lost with no status, because status
  -- did not exist when its bundle was built. Repair rather than reject.
  if new.status = 'in_progress' and new.won is not null then
    new.status := case when new.won then 'won' else 'lost' end;
    new.completed_at := coalesce(new.completed_at, now());
  end if;

  if tg_op = 'INSERT' then
    if new.status in ('won', 'lost') then
      if new.user_id is not null then
        _identity := 'u:' || new.user_id::text;
      elsif new.device_id is not null and new.device_id <> 'unknown' then
        _identity := 'd:' || new.device_id;
      else
        -- No usable identity. Such a row can never be anybody's permanent
        -- result, so it must not occupy the official slot.
        _identity := null;
      end if;

      if _identity is null then
        new.is_official := false;
      else
        perform pg_advisory_xact_lock(
          hashtextextended(coalesce(new.puzzle_id, '') || '|' || _identity, 0)
        );

        -- Note this OVERWRITES whatever the client supplied. A caller cannot
        -- assert its own completion is official.
        new.is_official := not exists (
          select 1
            from public.game_sessions gs
           where gs.puzzle_id = new.puzzle_id
             and gs.status in ('won', 'lost')
             and gs.is_official
             and gs.id is distinct from new.id
             and (
               (new.user_id is not null and gs.user_id = new.user_id)
               or (new.user_id is null
                   and gs.user_id is null
                   and gs.device_id = new.device_id)
             )
        );
      end if;
    else
      -- An unfinished session is not a result. Pinning this to false also
      -- closes a squatting hole: the partial unique indexes key on
      -- is_official without regard to status, so an in_progress row inserted
      -- with is_official = true would have blocked the real completion for
      -- that puzzle + identity.
      new.is_official := false;
    end if;
  end if;

  return new;
end;
$$;

-- get_archive_puzzles()
CREATE FUNCTION public.get_archive_puzzles() RETURNS TABLE(id uuid, date date, title text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT p.id, p.date, p.title
  FROM public.puzzles p
  WHERE p.is_published = true
  ORDER BY p.date DESC
$$;

-- get_creator_profile(text, text)
CREATE FUNCTION public.get_creator_profile(_slug text, _sort text DEFAULT 'newest'::text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _uid   uuid;
  _name  text;
  _s     text := case when _sort in ('newest', 'plays', 'favorites') then _sort else 'newest' end;
begin
  select user_id, display_name into _uid, _name
    from public.creator_profiles
   where public_slug = _slug;
  if _uid is null then
    return null;
  end if;

  return (
    with pub as (
      select cp.title,
             cp.content ->> 'mode' as mode,
             cp.short_code,
             (select coalesce(s.wins + s.losses, 0) from public.custom_puzzle_stats s where s.custom_puzzle_id = cp.id) as plays,
             (select count(*) from public.custom_puzzle_favorites f where f.custom_puzzle_id = cp.id) as favs,
             cp.created_at
        from public.custom_puzzles cp
       where cp.created_by = _uid
         and cp.visibility = 'public'
         and cp.moderation_status = 'active'
    )
    select jsonb_build_object(
      'display_name',    _name,
      'public_slug',     _slug,
      'puzzle_count',    (select count(*) from pub),
      'total_plays',     (select coalesce(sum(plays), 0) from pub),
      'total_favorites', (select coalesce(sum(favs), 0) from pub),
      'puzzles',         coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'title',          q.title,
                   'mode',           q.mode,
                   'short_code',     q.short_code,
                   'finished_plays', q.plays,
                   'favorite_count', q.favs,
                   'created_at',     q.created_at
                 )
                 order by (case _s when 'plays' then q.plays end) desc nulls last,
                          (case _s when 'favorites' then q.favs end) desc nulls last,
                          q.created_at desc)
          from (select * from pub
                 order by (case _s when 'plays' then plays end) desc nulls last,
                          (case _s when 'favorites' then favs end) desc nulls last,
                          created_at desc
                 limit 100) q
      ), '[]'::jsonb)
    )
  );
end;
$$;

-- get_custom_puzzle(text)
CREATE FUNCTION public.get_custom_puzzle(_share_id text) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select public.custom_puzzle_public_json(cp)
    from public.custom_puzzles cp
   where cp.share_id = _share_id
     and cp.moderation_status = 'active'
$$;

-- get_custom_puzzle_by_short_code(text)
CREATE FUNCTION public.get_custom_puzzle_by_short_code(_short_code text) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select public.custom_puzzle_public_json(cp)
    from public.custom_puzzles cp
   where cp.short_code = _short_code          -- exact, case-sensitive
     and cp.moderation_status = 'active'
$$;

-- get_custom_puzzle_stats(text)
CREATE FUNCTION public.get_custom_puzzle_stats(_share_id text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _cpid uuid;
  s     public.custom_puzzle_stats%rowtype;
begin
  select id into _cpid
    from public.custom_puzzles
   where share_id = _share_id
     and moderation_status = 'active';

  if _cpid is null then
    return null;
  end if;

  select * into s from public.custom_puzzle_stats where custom_puzzle_id = _cpid;

  return jsonb_build_object(
    'completed_plays', coalesce(s.wins, 0) + coalesce(s.losses, 0),
    'finished_plays',  coalesce(s.wins, 0) + coalesce(s.losses, 0),
    'wins',            coalesce(s.wins, 0),
    'losses',          coalesce(s.losses, 0),
    'avg_guesses',     case when coalesce(s.wins, 0) > 0
                            then round(s.win_guess_total::numeric / s.wins, 2)
                            else 0 end,
    'guess_distribution', jsonb_build_object(
      '4',  coalesce(s.guesses_4, 0),
      '5',  coalesce(s.guesses_5, 0),
      '6',  coalesce(s.guesses_6, 0),
      '7',  coalesce(s.guesses_7, 0),
      '8+', coalesce(s.guesses_8_plus, 0)
    )
  );
end;
$$;

-- get_luck_report(uuid, text, text)
CREATE FUNCTION public.get_luck_report(_puzzle_id uuid, _device_id text DEFAULT NULL::text, _device_token text DEFAULT NULL::text) RETURNS json
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _pid      text := _puzzle_id::text;
  _format   text;
  _is_beta  boolean;
  _date     date;
  _uid      uuid := public.rainbow_uid();
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

-- get_my_favorites()
CREATE FUNCTION public.get_my_favorites() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select coalesce(jsonb_agg(q.item order by q.favorited_at desc), '[]'::jsonb)
    from (
      select f.created_at as favorited_at,
             jsonb_build_object(
               'title',          cp.title,
               'creator_name',   cp.creator_name,
               'creator_slug',   (select p.public_slug from public.creator_profiles p where p.user_id = cp.created_by),
               'mode',           cp.content ->> 'mode',
               'short_code',     cp.short_code,
               'favorite_count', (select count(*) from public.custom_puzzle_favorites x where x.custom_puzzle_id = cp.id),
               'favorited_at',   f.created_at
             ) as item
        from public.custom_puzzle_favorites f
        join public.custom_puzzles cp on cp.id = f.custom_puzzle_id
       where f.user_id = public.rainbow_uid()
         and cp.moderation_status = 'active'
       order by f.created_at desc
       limit 200
    ) q
$$;

-- get_own_completed_sessions(text, text, text)
CREATE FUNCTION public.get_own_completed_sessions(_device_id text DEFAULT NULL::text, _device_token text DEFAULT NULL::text, _format text DEFAULT 'full'::text) RETURNS TABLE(puzzle_id text, won boolean, mistakes integer, found_rainbow boolean, solve_order jsonb, hints_used boolean, rainbow_solve_index smallint, rainbow_source text, bonus_rainbow_attempted boolean, status text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select gs.puzzle_id, gs.won, gs.mistakes, gs.found_rainbow, gs.solve_order,
         gs.hints_used, gs.rainbow_solve_index, gs.rainbow_source,
         gs.bonus_rainbow_attempted, gs.status
    from public.game_sessions gs
   where gs.status in ('won', 'lost')
     and gs.is_official
     and gs.format = coalesce(nullif(btrim(coalesce(_format, '')), ''), 'full')
     and (
       (public.rainbow_uid() is not null and gs.user_id = public.rainbow_uid())
       or (
         gs.user_id is null
         and gs.device_id = _device_id
         and public.verify_device(_device_id, _device_token)
       )
     )
$$;

-- get_own_streak(text, text, text)
CREATE FUNCTION public.get_own_streak(_device_id text DEFAULT NULL::text, _device_token text DEFAULT NULL::text, _format text DEFAULT 'full'::text) RETURNS TABLE(current_streak integer, longest_streak integer, last_played_date text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _uid uuid := public.rainbow_uid();
  _fmt text := coalesce(nullif(btrim(coalesce(_format, '')), ''), 'full');
begin
  if _uid is not null then
    select coalesce(us.current_streak, 0), coalesce(us.longest_streak, 0), us.last_played_date::text
      into current_streak, longest_streak, last_played_date
      from public.user_streaks us
     where us.user_id = _uid
       and us.format = _fmt
     order by coalesce(us.longest_streak, 0) desc
     limit 1;
    if found then
      return next;
    end if;
    return;
  end if;

  if _device_id is null or _device_token is null
     or not public.verify_device(_device_id, _device_token) then
    return;
  end if;

  select coalesce(us.current_streak, 0), coalesce(us.longest_streak, 0), us.last_played_date::text
    into current_streak, longest_streak, last_played_date
    from public.user_streaks us
   where us.device_id = _device_id
     and us.user_id is null
     and us.format = _fmt
   order by coalesce(us.longest_streak, 0) desc
   limit 1;
  if found then
    return next;
  end if;
  return;
end;
$$;

-- get_puzzle_report(uuid)
CREATE FUNCTION public.get_puzzle_report(_puzzle_id uuid) RETURNS json
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

-- get_puzzle_stats(uuid)
CREATE FUNCTION public.get_puzzle_stats(_puzzle_id uuid) RETURNS json
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select json_build_object(
    'total_players', count(*)::int,
    'wins', count(*) filter (where won)::int,
    'losses', count(*) filter (where not won)::int,
    'guess_distribution', json_build_object(
      '0', count(*) filter (where won and mistakes = 0)::int,
      '1', count(*) filter (where won and mistakes = 1)::int,
      '2', count(*) filter (where won and mistakes = 2)::int,
      '3', count(*) filter (where won and mistakes = 3)::int
    )
  )
  from public.game_sessions
  where puzzle_id = _puzzle_id::text
    and is_official
    and status in ('won', 'lost')
$$;

-- get_streak_admin_summary()
CREATE FUNCTION public.get_streak_admin_summary() RETURNS TABLE(accounts_with_streaks integer, max_current_streak integer, max_longest_streak integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select
    (select count(*)::integer from public.user_streaks where user_id is not null),
    (select coalesce(max(current_streak), 0)::integer from public.user_streaks),
    (select coalesce(max(longest_streak), 0)::integer from public.user_streaks)
  where public.has_role(public.rainbow_uid(), 'admin')
$$;

-- has_archive_access(uuid)
CREATE FUNCTION public.has_archive_access(_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.archive_access WHERE user_id = _user_id
  ) OR EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'admin'
  )
$$;

-- has_official_result(text, text, text)
CREATE FUNCTION public.has_official_result(_puzzle_id text, _device_id text, _device_token text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1
      from public.game_sessions
     where puzzle_id = _puzzle_id
       and status in ('won', 'lost')
       and is_official
       and (
         (public.rainbow_uid() is not null and user_id = public.rainbow_uid())
         or (
           user_id is null
           and device_id = _device_id
           and public.verify_device(_device_id, _device_token)
         )
       )
  )
$$;

-- has_role(uuid, public.app_role)
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- luck_eligible_paths(text)
CREATE FUNCTION public.luck_eligible_paths(_puzzle_id text) RETURNS TABLE(session_id uuid, user_id uuid, device_id text, path jsonb)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
           coalesce(g.server_numbered, false) as server_numbered,
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
           count(*) as all_events,
           max(e.guess_number) as last_event,
           count(*) filter (where e.attempt_type = 'bonus_rainbow' and not e.server_numbered) as unreliable_bonus,
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
  select c.id, c.user_id, c.device_id, s.events_path
    from cand c
    join summary s on s.game_session_id = c.id
   where s.untyped = 0
     and s.normals > 0
     and s.bad_shape = 0
     and s.first_normal = 1
     and s.last_normal = s.normals
     and s.last_event = s.all_events
     and s.unreliable_bonus = 0
     and (
       not coalesce(c.found_rainbow, false)
       or c.rainbow_source is distinct from 'post_game'
       or coalesce(s.bonus_found, false)
     )
     and (not c.won or s.correct_normals = 4)
     -- A genuine loss solved at most two categories: with three solved,
     -- the only words left are the last category, so the next submission
     -- is necessarily correct. A "loss" with three or more is misrecorded.
     and (c.won or s.correct_normals <= 2)
     and s.wrong_normals >= coalesce(c.mistakes, 0)
$$;

-- puzzle_versions_block_update()
CREATE FUNCTION public.puzzle_versions_block_update() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  raise exception
    'puzzle_versions rows are immutable; save a new version instead (puzzle_id=%, version_number=%)',
    old.puzzle_id, old.version_number
    using errcode = 'restrict_violation';
end;
$$;

-- puzzles_check_current_version()
CREATE FUNCTION public.puzzles_check_current_version() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  _owner uuid;
begin
  if new.current_version_id is null then
    return new;
  end if;

  select pv.puzzle_id into _owner
    from public.puzzle_versions pv
   where pv.id = new.current_version_id;

  if _owner is null then
    raise exception 'current_version_id % does not exist', new.current_version_id
      using errcode = 'foreign_key_violation';
  end if;

  -- The cross-puzzle guard: puzzle A can never point at a snapshot of
  -- puzzle B, so "the current version of this puzzle" is always content that
  -- was actually written for this puzzle.
  if _owner <> new.id then
    raise exception 'current_version_id % belongs to puzzle %, not %',
      new.current_version_id, _owner, new.id
      using errcode = 'foreign_key_violation';
  end if;

  return new;
end;
$$;

-- record_bonus_rainbow(uuid, text, text, integer, jsonb, boolean, timestamp with time zone, integer, smallint)
CREATE FUNCTION public.record_bonus_rainbow(_session_id uuid, _device_id text, _device_token text, _guess_number integer, _words jsonb, _correct boolean, _guessed_at timestamp with time zone, _active_time_seconds integer, _groups_solved smallint) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _n        integer;
  _format   text;
  _answered boolean;
begin
  if not public.session_capability_ok(_session_id, _device_id, _device_token) then
    return false;
  end if;

  -- Lock the session row: serializes concurrent prompt submissions for it.
  select coalesce(gs.format, 'full'),
         coalesce(gs.bonus_rainbow_attempted, false) or coalesce(gs.found_rainbow, false)
    into _format, _answered
    from public.game_sessions gs
   where gs.id = _session_id
     and gs.status in ('won', 'lost')
     for update;
  if not found then
    return false;
  end if;

  -- Mini: exactly the 20260917000000 behaviour, unchanged (the browser's
  -- guess number, a clash silently ignored, no server_numbered mark, no
  -- one-answer rule) until Mini's own rules are designed.
  if _format = 'mini' then
    insert into public.guess_events (
      game_session_id, guess_number, words, correct, group_name,
      is_rainbow_attempt, attempt_type, guessed_at, active_time_seconds,
      groups_solved
    ) values (
      _session_id, _guess_number, _words, _correct, null,
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
  end if;

  -- A retry of a submission that is already saved.
  if _guessed_at is not null and exists (
    select 1
      from public.guess_events g
     where g.game_session_id = _session_id
       and g.attempt_type = 'bonus_rainbow'
       and g.guessed_at = _guessed_at
       and g.words = _words
       and g.correct is not distinct from _correct
  ) then
    return true;
  end if;

  -- One answer per Full game.
  if _format = 'full' and _answered then
    return false;
  end if;

  select greatest(coalesce(_guess_number, 1), coalesce(max(g.guess_number), 0) + 1)
    into _n
    from public.guess_events g
   where g.game_session_id = _session_id;

  insert into public.guess_events (
    game_session_id, guess_number, words, correct, group_name,
    is_rainbow_attempt, attempt_type, guessed_at, active_time_seconds,
    groups_solved, server_numbered
  ) values (
    _session_id, _n, _words, _correct, null,
    true, 'bonus_rainbow', coalesce(_guessed_at, now()), _active_time_seconds,
    _groups_solved, true
  );

  update public.game_sessions
     set bonus_rainbow_attempted = true,
         found_rainbow = case when _correct then true else found_rainbow end,
         rainbow_source = case when _correct then 'post_game' else rainbow_source end,
         rainbow_solve_index = case when _correct then 4::smallint else rainbow_solve_index end
   where id = _session_id
     and not coalesce(found_rainbow, false);

  return true;
end;
$$;

-- record_guess_events(uuid, text, text, jsonb)
CREATE FUNCTION public.record_guess_events(_session_id uuid, _device_id text, _device_token text, _events jsonb) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _inserted integer;
begin
  if not public.session_capability_ok(_session_id, _device_id, _device_token) then
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

-- record_hint_event(uuid, text, text, text, timestamp with time zone, integer, smallint, smallint, smallint, boolean)
CREATE FUNCTION public.record_hint_event(_session_id uuid, _device_id text, _device_token text, _hint_type text, _revealed_at timestamp with time zone, _active_time_seconds integer, _guess_count smallint, _mistakes smallint, _groups_solved smallint, _rainbow_found boolean) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if not public.session_capability_ok(_session_id, _device_id, _device_token) then
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

-- record_streak(uuid, text, boolean, text, text)
CREATE FUNCTION public.record_streak(_user_id uuid, _device_id text, _won boolean, _local_date text, _format text DEFAULT 'full'::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _today       date;
  _row         public.user_streaks%rowtype;
  _new_streak  integer;
  _new_longest integer;
  _fmt         text := coalesce(nullif(btrim(coalesce(_format, '')), ''), 'full');
begin
  begin
    _today := coalesce(nullif(btrim(coalesce(_local_date, '')), '')::date, current_date);
  exception when others then
    _today := current_date;
  end;

  if _user_id is not null then
    select * into _row
      from public.user_streaks
     where user_id = _user_id
       and format = _fmt
     order by updated_at desc nulls last
     limit 1;
  elsif _device_id is not null and _device_id <> 'unknown' and btrim(_device_id) <> '' then
    select * into _row
      from public.user_streaks
     where device_id = _device_id and user_id is null
       and format = _fmt
     order by updated_at desc nulls last
     limit 1;
  else
    return;
  end if;

  if _row.id is null then
    insert into public.user_streaks (user_id, device_id, current_streak, longest_streak, last_played_date, format)
    values (_user_id, _device_id, 1, 1, _today, _fmt);
    return;
  end if;

  -- Already counted today. Per format: finishing the Mini after the Full on
  -- the same day must still advance the Mini streak.
  if _row.last_played_date = _today then
    return;
  end if;

  _new_streak := case
                   when _won then
                     case when _row.last_played_date = (_today - 1)
                          then coalesce(_row.current_streak, 0) + 1
                          else 1 end
                   else 0
                 end;
  _new_longest := greatest(_new_streak, coalesce(_row.longest_streak, 0));

  update public.user_streaks
     set current_streak = _new_streak,
         longest_streak = _new_longest,
         last_played_date = _today,
         updated_at = now()
   where id = _row.id;
end;
$$;

-- reset_beta_playtest(uuid, text, text)
CREATE FUNCTION public.reset_beta_playtest(_puzzle_id uuid, _device_id text, _device_token text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _row_id uuid;
begin
  if not public.verify_device(_device_id, _device_token) then
    return false;
  end if;

  select id into _row_id
    from public.beta_playtests
   where puzzle_id = _puzzle_id
     and device_id = _device_id
   order by started_at desc
   limit 1;

  if _row_id is null then
    return false;
  end if;

  update public.beta_playtests
     set is_reset     = true,
         status       = case when status = 'in_progress' then 'abandoned' else status end,
         completed_at = coalesce(completed_at, now()),
         updated_at   = now()
   where id = _row_id;

  return true;
end;
$$;

-- session_capability_ok(uuid, text, text)
CREATE FUNCTION public.session_capability_ok(_session_id uuid, _device_id text, _device_token text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1
      from public.game_sessions gs
     where gs.id = _session_id
       and (
         (gs.user_id is not null and gs.user_id = public.rainbow_uid())
         or (
           gs.user_id is null
           and gs.device_id = _device_id
           and public.verify_device(_device_id, _device_token)
         )
       )
  )
$$;

-- set_custom_puzzle_favorite(text, boolean)
CREATE FUNCTION public.set_custom_puzzle_favorite(_share_id text, _favorite boolean) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _uid uuid := public.rainbow_uid();
  _pid uuid;
begin
  if _uid is null then
    return null;
  end if;
  if _favorite is null then
    raise exception 'favorite is required' using errcode = 'invalid_parameter_value';
  end if;

  select id into _pid
    from public.custom_puzzles
   where share_id = _share_id
     and moderation_status = 'active';
  if _pid is null then
    return null;
  end if;

  if _favorite then
    insert into public.custom_puzzle_favorites (custom_puzzle_id, user_id)
    values (_pid, _uid)
    on conflict (custom_puzzle_id, user_id) do nothing;
  else
    -- Scoped to the caller's own row by public.rainbow_uid(): never another user's.
    delete from public.custom_puzzle_favorites
     where custom_puzzle_id = _pid and user_id = _uid;
  end if;

  return jsonb_build_object(
    'favorited', exists (select 1 from public.custom_puzzle_favorites where custom_puzzle_id = _pid and user_id = _uid),
    'favorite_count', (select count(*) from public.custom_puzzle_favorites where custom_puzzle_id = _pid)
  );
end;
$$;

-- skill_score(boolean, integer, jsonb, boolean, text, text)
CREATE FUNCTION public.skill_score(_won boolean, _mistakes integer, _solve_order jsonb, _found_rainbow boolean, _rainbow_source text, _format text) RETURNS integer
    LANGUAGE plpgsql IMMUTABLE
    AS $$
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

-- start_beta_playtest(uuid, uuid, text, text)
CREATE FUNCTION public.start_beta_playtest(_puzzle_id uuid, _puzzle_version_id uuid, _device_id text, _device_token text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _id uuid;
begin
  if not public.verify_device(_device_id, _device_token) then
    return null;
  end if;

  if not exists (select 1 from public.puzzles where id = _puzzle_id and is_beta = true) then
    return null;
  end if;

  if not exists (
    select 1 from public.puzzle_versions
     where id = _puzzle_version_id and puzzle_id = _puzzle_id
  ) then
    return null;
  end if;

  insert into public.beta_playtests (puzzle_id, puzzle_version_id, device_id)
  values (_puzzle_id, _puzzle_version_id, _device_id)
  returning id into _id;

  return _id;
end;
$$;

-- submit_beta_feedback(uuid, uuid, uuid, text, smallint, smallint, smallint, text, text, boolean)
CREATE FUNCTION public.submit_beta_feedback(_puzzle_id uuid, _puzzle_version_id uuid, _playtest_id uuid, _tester_name text, _fun_rating smallint, _difficulty_rating smallint, _rainbow_fairness_rating smallint, _confusing_or_incorrect text, _additional_comments text, _would_play_again boolean) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _id uuid;
begin
  if not exists (select 1 from public.puzzles where id = _puzzle_id and is_beta = true) then
    return null;
  end if;

  if not exists (
    select 1 from public.puzzle_versions
     where id = _puzzle_version_id and puzzle_id = _puzzle_id
  ) then
    return null;
  end if;

  if _playtest_id is not null and not exists (
    select 1 from public.beta_playtests where id = _playtest_id and puzzle_id = _puzzle_id
  ) then
    _playtest_id := null;
  end if;

  if _fun_rating is null or _fun_rating < 1 or _fun_rating > 5 then
    raise exception 'fun rating must be between 1 and 5' using errcode = 'invalid_parameter_value';
  end if;
  if _difficulty_rating is null or _difficulty_rating < 1 or _difficulty_rating > 5 then
    raise exception 'difficulty rating must be between 1 and 5' using errcode = 'invalid_parameter_value';
  end if;
  if _rainbow_fairness_rating is not null and (_rainbow_fairness_rating < 1 or _rainbow_fairness_rating > 5) then
    raise exception 'rainbow fairness rating must be between 1 and 5' using errcode = 'invalid_parameter_value';
  end if;
  if _would_play_again is null then
    raise exception 'would_play_again is required' using errcode = 'invalid_parameter_value';
  end if;
  if _tester_name is not null and length(_tester_name) > 80 then
    raise exception 'tester name is too long' using errcode = 'invalid_parameter_value';
  end if;
  if _confusing_or_incorrect is not null and length(_confusing_or_incorrect) > 2000 then
    raise exception 'response is too long' using errcode = 'invalid_parameter_value';
  end if;
  if _additional_comments is not null and length(_additional_comments) > 2000 then
    raise exception 'response is too long' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.beta_feedback (
    puzzle_id, puzzle_version_id, playtest_id, tester_name,
    fun_rating, difficulty_rating, rainbow_fairness_rating,
    confusing_or_incorrect, additional_comments, would_play_again
  ) values (
    _puzzle_id, _puzzle_version_id, _playtest_id,
    nullif(btrim(coalesce(_tester_name, '')), ''),
    _fun_rating, _difficulty_rating, _rainbow_fairness_rating,
    nullif(btrim(coalesce(_confusing_or_incorrect, '')), ''),
    nullif(btrim(coalesce(_additional_comments, '')), ''),
    _would_play_again
  )
  returning id into _id;

  return _id;
end;
$$;

-- submit_custom_puzzle_result(text, text, text, boolean, smallint, uuid)
CREATE FUNCTION public.submit_custom_puzzle_result(_share_id text, _device_id text, _device_token text, _won boolean, _total_guesses smallint, _run_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _cpid    uuid;
  _rows    integer;
begin
  if not public.verify_device(_device_id, _device_token) then
    return false;
  end if;

  if _won is null then
    raise exception 'won is required' using errcode = 'invalid_parameter_value';
  end if;
  if _total_guesses is null or _total_guesses < 0 or _total_guesses > 60 then
    raise exception 'total_guesses out of range' using errcode = 'invalid_parameter_value';
  end if;
  if _run_id is null then
    raise exception 'run_id is required' using errcode = 'invalid_parameter_value';
  end if;

  select id into _cpid
    from public.custom_puzzles
   where share_id = _share_id
     and moderation_status = 'active';

  if _cpid is null then
    return false;
  end if;

  -- First result from this device: the row is created holding this run id.
  insert into public.custom_puzzle_results (custom_puzzle_id, device_id, won, total_guesses, recent_run_ids)
  values (_cpid, _device_id, _won, _total_guesses, array[_run_id])
  on conflict (custom_puzzle_id, device_id) do nothing;
  get diagnostics _rows = row_count;

  if _rows = 0 then
    -- Existing device row: count this run only if its id is not already in the
    -- window. The UPDATE re-checks the predicate under the row lock, so two
    -- simultaneous submissions of one run count once.
    update public.custom_puzzle_results
       set recent_run_ids = (array[_run_id] || recent_run_ids)[1:10]
     where custom_puzzle_id = _cpid
       and device_id = _device_id
       and not (_run_id = any (recent_run_ids));
    get diagnostics _rows = row_count;
  end if;

  if _rows > 0 then
    insert into public.custom_puzzle_stats as s
      (custom_puzzle_id, wins, losses, guesses_4, guesses_5, guesses_6, guesses_7, guesses_8_plus, win_guess_total)
    values (
      _cpid,
      case when _won then 1 else 0 end,
      case when _won then 0 else 1 end,
      case when _won and _total_guesses <= 4 then 1 else 0 end,
      case when _won and _total_guesses = 5 then 1 else 0 end,
      case when _won and _total_guesses = 6 then 1 else 0 end,
      case when _won and _total_guesses = 7 then 1 else 0 end,
      case when _won and _total_guesses >= 8 then 1 else 0 end,
      case when _won then _total_guesses else 0 end
    )
    on conflict (custom_puzzle_id) do update
      set wins            = s.wins + excluded.wins,
          losses          = s.losses + excluded.losses,
          guesses_4       = s.guesses_4 + excluded.guesses_4,
          guesses_5       = s.guesses_5 + excluded.guesses_5,
          guesses_6       = s.guesses_6 + excluded.guesses_6,
          guesses_7       = s.guesses_7 + excluded.guesses_7,
          guesses_8_plus  = s.guesses_8_plus + excluded.guesses_8_plus,
          win_guess_total = s.win_guess_total + excluded.win_guess_total,
          updated_at      = now();
  end if;

  return true;
end;
$$;

-- touch_game_session(uuid, text, text, integer, integer)
CREATE FUNCTION public.touch_game_session(_session_id uuid, _device_id text, _device_token text, _active_time_seconds integer, _mistakes integer) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  found boolean;
begin
  if not public.session_capability_ok(_session_id, _device_id, _device_token) then
    return false;
  end if;

  update public.game_sessions
     set last_activity_at = now(),
         active_time_seconds = coalesce(_active_time_seconds, active_time_seconds),
         mistakes = coalesce(_mistakes, mistakes)
   where id = _session_id
     and status = 'in_progress';

  get diagnostics found = row_count;
  return found;
end;
$$;

-- update_updated_at_column()
CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- validate_custom_puzzle_content(jsonb)
CREATE FUNCTION public.validate_custom_puzzle_content(_content jsonb) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'public'
    AS $$
declare
  _format      text;
  _mode        text;
  _groups      jsonb;
  _g           jsonb;
  _words       jsonb;
  _all         text[] := '{}';
  _hints       text[];
  _out         jsonb := '[]'::jsonb;
  _herring     jsonb;
  _order       jsonb;
  _i           integer;
  _w           text;
  _hint        text;
  _emoji       text;
  _hint_only   boolean;
  _herring_words text[];
  _hits        integer;
  _cats        integer;
  _per         integer;
  _tiles       integer;
  _has_rainbow boolean;
begin
  if _content is null or jsonb_typeof(_content) <> 'object' then
    raise exception 'puzzle content must be a JSON object' using errcode = 'invalid_parameter_value';
  end if;

  -- Absent/null format means Full — see the section header.
  _format := coalesce(nullif(btrim(coalesce(_content ->> 'format', '')), ''), 'full');
  if _format not in ('full', 'mini') then
    raise exception 'unknown puzzle format "%"', _format using errcode = 'invalid_parameter_value';
  end if;

  if _format = 'mini' then
    _cats := 3; _per := 3; _tiles := 9; _has_rainbow := false;
  else
    _cats := 4; _per := 4; _tiles := 16; _has_rainbow := true;
  end if;
  _hints := array_fill(null::text, array[_cats]);

  _mode := _content ->> 'mode';
  if _mode not in ('classic', 'rainbow') then
    raise exception 'mode must be classic or rainbow' using errcode = 'invalid_parameter_value';
  end if;
  -- A format with no bonus category cannot be in Rainbow mode. Rejected, not
  -- coerced: the creator must be told, not silently given a different puzzle.
  if _mode = 'rainbow' and not _has_rainbow then
    raise exception 'a % puzzle cannot be a Rainbow puzzle', _format using errcode = 'invalid_parameter_value';
  end if;

  _groups := _content -> 'groups';
  if _groups is null or jsonb_typeof(_groups) <> 'array' or jsonb_array_length(_groups) <> _cats then
    raise exception 'a % puzzle must contain exactly % groups', _format, _cats using errcode = 'invalid_parameter_value';
  end if;

  for _i in 0 .. _cats - 1 loop
    _g := _groups -> _i;
    if jsonb_typeof(_g) <> 'object' then
      raise exception 'group % must be an object', _i + 1 using errcode = 'invalid_parameter_value';
    end if;

    if coalesce(btrim(_g ->> 'category'), '') = '' then
      raise exception 'group % needs a category name', _i + 1 using errcode = 'invalid_parameter_value';
    end if;
    if length(btrim(_g ->> 'category')) > 80 then
      raise exception 'group % category name is too long (max 80 characters)', _i + 1 using errcode = 'invalid_parameter_value';
    end if;

    _words := _g -> 'words';
    if _words is null or jsonb_typeof(_words) <> 'array' or jsonb_array_length(_words) <> _per then
      raise exception 'group % needs exactly % answers', _i + 1, _per using errcode = 'invalid_parameter_value';
    end if;

    for _w in select jsonb_array_elements_text(_words) loop
      if coalesce(btrim(_w), '') = '' then
        raise exception 'group % contains an empty answer', _i + 1 using errcode = 'invalid_parameter_value';
      end if;
      if length(_w) > 40 then
        raise exception 'group % has an answer that is too long (max 40 characters)', _i + 1 using errcode = 'invalid_parameter_value';
      end if;
      _all := _all || _w;
    end loop;

    -- Length-checked here, but NOT checked for duplication yet: _all only
    -- holds groups 0..i so far, and a hint must be compared against all board
    -- answers, including groups that haven't been processed yet (see the
    -- dedicated pass below, once _all is complete) -- unchanged from the
    -- 20260919000000 cross-group Small Hint fix.
    _hint := nullif(btrim(coalesce(_g ->> 'hint_word', '')), '');
    if _hint is not null and length(_hint) > 40 then
      raise exception 'group % Small Hint is too long (max 40 characters)', _i + 1 using errcode = 'invalid_parameter_value';
    end if;
    _hints[_i + 1] := _hint;

    _emoji := nullif(btrim(coalesce(_g ->> 'category_emoji', '')), '');
    if _emoji is not null and length(_emoji) > 40 then
      raise exception 'group % Category Emoji is too long (max 40 characters)', _i + 1 using errcode = 'invalid_parameter_value';
    end if;

    -- Hint Only, exactly as validate_puzzle_content handles it: emitted only
    -- when true AND there is an emoji for it to withhold.
    _hint_only := coalesce((_g ->> 'category_emoji_hint_only')::boolean, false);

    _out := _out || jsonb_build_array(jsonb_build_object(
      'category',   btrim(_g ->> 'category'),
      'words',      _words,
      'hint_word',  _hint,
      'sort_order', _i
    ) || case when _emoji is null then '{}'::jsonb else jsonb_build_object('category_emoji', _emoji) end
      || case when _emoji is null or not _hint_only then '{}'::jsonb else jsonb_build_object('category_emoji_hint_only', true) end);
  end loop;

  if (select count(distinct upper(w)) from unnest(_all) w) <> _tiles then
    raise exception 'a % puzzle needs % unique answers', _format, _tiles using errcode = 'invalid_parameter_value';
  end if;

  -- Now that _all holds every board answer, check every group's hint
  -- against the COMPLETE board -- not just the groups seen before it.
  for _i in 1 .. _cats loop
    if _hints[_i] is not null and upper(_hints[_i]) = any (select upper(x) from unnest(_all) x) then
      raise exception 'group % Small Hint cannot duplicate a board answer', _i using errcode = 'invalid_parameter_value';
    end if;
  end loop;

  -- Rainbow: 'classic' must carry none at all; 'rainbow' must select EXACTLY
  -- one answer from EACH group (not merely N-of-board anywhere in the puzzle).
  _herring := _content -> 'rainbow_herring';
  _herring := case when _herring is null or jsonb_typeof(_herring) = 'null' then null else _herring end;

  if _mode = 'classic' then
    if _herring is not null then
      raise exception 'classic puzzles cannot include a Rainbow selection' using errcode = 'invalid_parameter_value';
    end if;
  else
    if _herring is null or jsonb_typeof(_herring) <> 'array' or jsonb_array_length(_herring) <> _cats then
      raise exception 'a Rainbow puzzle needs exactly one selected answer from each of the % groups', _cats using errcode = 'invalid_parameter_value';
    end if;
    _herring_words := array(select jsonb_array_elements_text(_herring));
    for _i in 1 .. _cats loop
      -- Re-derived directly from _groups (still in scope) instead of the
      -- removed _group_words 2-D array -- see the 20260919020000 migration
      -- header for why that construct never worked in Postgres.
      _hits := (
        select count(*)
          from unnest(_herring_words) hw
         where upper(hw) = any (
           select upper(gw) from jsonb_array_elements_text(_groups -> (_i - 1) -> 'words') gw
         )
      );
      if _hits <> 1 then
        raise exception 'group % must contribute exactly one Rainbow answer (got %)', _i, _hits
          using errcode = 'invalid_parameter_value';
      end if;
    end loop;
  end if;

  -- The starting tile layout: must be a permutation of this puzzle's own
  -- answers, exactly like validate_puzzle_content's word_order check.
  _order := _content -> 'word_order';
  if _order is not null and jsonb_typeof(_order) <> 'null' then
    if jsonb_typeof(_order) <> 'array' or jsonb_array_length(_order) <> _tiles then
      raise exception 'the starting board must list all % answers', _tiles using errcode = 'invalid_parameter_value';
    end if;
    for _w in select jsonb_array_elements_text(_order) loop
      if not (upper(_w) = any (select upper(x) from unnest(_all) x)) then
        raise exception 'starting board answer "%" is not one of this puzzle''s % answers', _w, _tiles
          using errcode = 'invalid_parameter_value';
      end if;
    end loop;
  else
    raise exception 'a starting board order is required' using errcode = 'invalid_parameter_value';
  end if;

  if _content ->> 'rainbow_category_name' is not null and length(btrim(_content ->> 'rainbow_category_name')) > 80 then
    raise exception 'Rainbow category name is too long (max 80 characters)' using errcode = 'invalid_parameter_value';
  end if;
  if _content ->> 'rainbow_hint_word' is not null and length(btrim(_content ->> 'rainbow_hint_word')) > 40 then
    raise exception 'Rainbow Small Hint is too long (max 40 characters)' using errcode = 'invalid_parameter_value';
  end if;

  if length(coalesce(nullif(btrim(coalesce(_content ->> 'rainbow_category_emoji', '')), ''), '')) > 40 then
    raise exception 'Rainbow Category Emoji is too long (max 40 characters)' using errcode = 'invalid_parameter_value';
  end if;

  return
    -- Full emits no format key, so every custom puzzle already stored
    -- canonicalises byte-identically to what it is today.
    (case when _format = 'full' then '{}'::jsonb else jsonb_build_object('format', _format) end)
    || jsonb_build_object(
      'mode',                   _mode,
      'groups',                 _out,
      'word_order',             _order,
      'rainbow_herring',        _herring,
      'rainbow_category_name',  nullif(btrim(coalesce(_content ->> 'rainbow_category_name', '')), ''),
      'rainbow_hint_word',      nullif(btrim(coalesce(_content ->> 'rainbow_hint_word', '')), ''),
      'alphabetize_completed',  coalesce((_content ->> 'alphabetize_completed')::boolean, true)
    )
    || case when nullif(btrim(coalesce(_content ->> 'rainbow_category_emoji', '')), '') is null then '{}'::jsonb else jsonb_build_object('rainbow_category_emoji', nullif(btrim(coalesce(_content ->> 'rainbow_category_emoji', '')), '')) end
    -- A classic puzzle has no Rainbow at all, so it can never carry the flag.
    || case when _mode <> 'rainbow'
              or nullif(btrim(coalesce(_content ->> 'rainbow_category_emoji', '')), '') is null
              or not coalesce((_content ->> 'rainbow_category_emoji_hint_only')::boolean, false)
             then '{}'::jsonb
             else jsonb_build_object('rainbow_category_emoji_hint_only', true) end;
end;
$$;

-- validate_puzzle_content(jsonb)
CREATE FUNCTION public.validate_puzzle_content(_content jsonb) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'public'
    AS $_$
declare
  _format      text;
  _groups      jsonb;
  _g           jsonb;
  _words       jsonb;
  _all         text[] := '{}';
  _out         jsonb := '[]'::jsonb;
  _herring     jsonb;
  _order       jsonb;
  _i           integer;
  _w           text;
  _emoji       text;
  -- Hint Only for this group's Category Emoji -- see the header.
  _hint_only   boolean;
  _cats        integer;   -- categories in this format
  _per         integer;   -- answers per category
  _tiles       integer;   -- total answers on the board
  _first_diff  integer;   -- difficulty of the EASIEST category
  _diffs       integer[] := '{}';
  _has_rainbow boolean;
  -- Does this format require the Rainbow to take exactly one answer from
  -- each category? See the header: Mini does, Full keeps its original rule.
  _rainbow_one_per_category boolean;
  _herring_words text[];
  _hits        integer;
begin
  if _content is null or jsonb_typeof(_content) <> 'object' then
    raise exception 'puzzle content must be a JSON object' using errcode = 'invalid_parameter_value';
  end if;

  -- Absent/null format means Full. That single line is what keeps every
  -- puzzle, draft and payload written before Mini valid and unchanged.
  _format := coalesce(nullif(btrim(coalesce(_content ->> 'format', '')), ''), 'full');
  if _format not in ('full', 'mini') then
    raise exception 'unknown puzzle format "%"', _format using errcode = 'invalid_parameter_value';
  end if;

  if _format = 'mini' then
    -- A Mini CAN now carry a Rainbow: three answers, one per category.
    _cats := 3; _per := 3; _tiles := 9; _first_diff := 2;
    _has_rainbow := true; _rainbow_one_per_category := true;
  else
    _cats := 4; _per := 4; _tiles := 16; _first_diff := 1;
    _has_rainbow := true; _rainbow_one_per_category := false;
  end if;

  _groups := _content -> 'groups';
  if _groups is null or jsonb_typeof(_groups) <> 'array' or jsonb_array_length(_groups) <> _cats then
    raise exception 'a % puzzle must contain exactly % groups', _format, _cats using errcode = 'invalid_parameter_value';
  end if;

  for _i in 0 .. _cats - 1 loop
    _g := _groups -> _i;
    if jsonb_typeof(_g) <> 'object' then
      raise exception 'group % must be an object', _i + 1 using errcode = 'invalid_parameter_value';
    end if;

    if coalesce(btrim(_g ->> 'category'), '') = '' then
      raise exception 'group % needs a category name', _i + 1 using errcode = 'invalid_parameter_value';
    end if;

    if (_g ->> 'difficulty') is null
       or (_g ->> 'difficulty') !~ '^[1-4]$' then
      raise exception 'group % needs a difficulty between 1 and 4', _i + 1 using errcode = 'invalid_parameter_value';
    end if;

    -- A format restricted to a SUBSET of the difficulty ladder must use only
    -- its own colours. Mini is Green/Blue/Red = 2, 3, 4, so a Mini can never
    -- be stored claiming Yellow.
    --
    -- Applied only where the format actually restricts the range. Full keeps
    -- its original rule -- any difficulty 1-4, in any group order -- exactly
    -- as it has always been, because reordering a Full puzzle's difficulties
    -- without reordering its groups is a save an admin can legitimately make
    -- and has always been able to make.
    if _first_diff > 1 and (_g ->> 'difficulty')::int not between _first_diff and _first_diff + _cats - 1 then
      raise exception 'a % puzzle needs difficulties between % and % (group % has %)',
        _format, _first_diff, _first_diff + _cats - 1, _i + 1, (_g ->> 'difficulty')::int
        using errcode = 'invalid_parameter_value';
    end if;
    _diffs := _diffs || (_g ->> 'difficulty')::int;

    _words := _g -> 'words';
    if _words is null or jsonb_typeof(_words) <> 'array' or jsonb_array_length(_words) <> _per then
      raise exception 'group % needs exactly % words', _i + 1, _per using errcode = 'invalid_parameter_value';
    end if;

    for _w in select jsonb_array_elements_text(_words) loop
      if coalesce(btrim(_w), '') = '' then
        raise exception 'group % contains an empty word', _i + 1 using errcode = 'invalid_parameter_value';
      end if;
      _all := _all || _w;
    end loop;

    _emoji := nullif(btrim(coalesce(_g ->> 'category_emoji', '')), '');
    if _emoji is not null and length(_emoji) > 40 then
      raise exception 'group % Category Emoji is too long (max 40 characters)', _i + 1 using errcode = 'invalid_parameter_value';
    end if;

    -- Hint Only rides on the Category Emoji and is emitted ONLY when true AND
    -- there is an emoji for it to withhold. A flag with no emoji has no
    -- meaning, so it is dropped rather than stored: it can never make an
    -- otherwise-unchanged puzzle canonicalise differently, and can never be
    -- silently resurrected later by someone typing an emoji into that field.
    _hint_only := coalesce((_g ->> 'category_emoji_hint_only')::boolean, false);

    _out := _out || jsonb_build_array(jsonb_build_object(
      'category',   btrim(_g ->> 'category'),
      'words',      _words,
      'difficulty', (_g ->> 'difficulty')::int,
      'hint_word',  nullif(btrim(coalesce(_g ->> 'hint_word', '')), ''),
      'sort_order', _i
    ) || case when _emoji is null then '{}'::jsonb else jsonb_build_object('category_emoji', _emoji) end
      || case when _emoji is null or not _hint_only then '{}'::jsonb else jsonb_build_object('category_emoji_hint_only', true) end);
  end loop;

  if (select count(distinct w) from unnest(_all) w) <> _tiles then
    raise exception 'a % puzzle needs % unique words', _format, _tiles using errcode = 'invalid_parameter_value';
  end if;

  -- Two categories sharing a colour is meaningless on any board. Enforced
  -- only for a restricted-range format, for the same "do not change Full"
  -- reason as the range check above.
  if _first_diff > 1 and (select count(distinct d) from unnest(_diffs) d) <> _cats then
    raise exception 'a % puzzle needs one category per colour', _format using errcode = 'invalid_parameter_value';
  end if;

  _herring := _content -> 'rainbow_herring';
  if _herring is not null and jsonb_typeof(_herring) <> 'null' then
    -- Kept for shape: both shipped formats can carry a Rainbow today, so this
    -- never fires. It stays so that adding a format that genuinely cannot
    -- (a future size, a themed variant) is a one-line change here and not a
    -- silently accepted Rainbow on a board that has nowhere to show it.
    if not _has_rainbow then
      raise exception 'a % puzzle cannot have a Rainbow category', _format using errcode = 'invalid_parameter_value';
    end if;
    if jsonb_typeof(_herring) <> 'array' or jsonb_array_length(_herring) <> _cats then
      raise exception 'rainbow_herring must have exactly % words', _cats using errcode = 'invalid_parameter_value';
    end if;
    for _w in select jsonb_array_elements_text(_herring) loop
      if not (_w = any (_all)) then
        raise exception 'rainbow_herring word "%" is not one of this puzzle''s % words', _w, _tiles
          using errcode = 'invalid_parameter_value';
      end if;
    end loop;

    -- ONE ANSWER PER CATEGORY (Mini). The length check above only proves the
    -- Rainbow has the right NUMBER of board answers; without this, three
    -- answers all taken from the Red category would pass, and the resulting
    -- puzzle would be unsolvable as a Rainbow while looking valid.
    --
    -- Counted by re-deriving each group's words from _groups, exactly as
    -- validate_custom_puzzle_content does -- see 20260919020000 on why the
    -- 2-D text array approach does not work in Postgres.
    if _rainbow_one_per_category then
      _herring_words := array(select jsonb_array_elements_text(_herring));
      for _i in 1 .. _cats loop
        _hits := (
          select count(*)
            from unnest(_herring_words) hw
           where hw = any (
             select gw from jsonb_array_elements_text(_groups -> (_i - 1) -> 'words') gw
           )
        );
        if _hits <> 1 then
          raise exception 'group % must contribute exactly one Rainbow answer (got %)', _i, _hits
            using errcode = 'invalid_parameter_value';
        end if;
      end loop;
    end if;
  else
    _herring := null;
  end if;

  if not _has_rainbow
     and (nullif(btrim(coalesce(_content ->> 'rainbow_category_name', '')), '') is not null
          or nullif(btrim(coalesce(_content ->> 'rainbow_hint_word', '')), '') is not null
          or nullif(btrim(coalesce(_content ->> 'rainbow_category_emoji', '')), '') is not null) then
    raise exception 'a % puzzle cannot have Rainbow category details', _format using errcode = 'invalid_parameter_value';
  end if;

  _order := _content -> 'word_order';
  if _order is not null and jsonb_typeof(_order) <> 'null' then
    if jsonb_typeof(_order) <> 'array' or jsonb_array_length(_order) <> _tiles then
      raise exception 'word_order must list all % words', _tiles using errcode = 'invalid_parameter_value';
    end if;
    for _w in select jsonb_array_elements_text(_order) loop
      if not (_w = any (_all)) then
        raise exception 'word_order word "%" is not one of this puzzle''s % words', _w, _tiles
          using errcode = 'invalid_parameter_value';
      end if;
    end loop;
  else
    _order := null;
  end if;

  if length(coalesce(nullif(btrim(coalesce(_content ->> 'rainbow_category_emoji', '')), ''), '')) > 40 then
    raise exception 'Rainbow Category Emoji is too long (max 40 characters)' using errcode = 'invalid_parameter_value';
  end if;

  return
    -- A Full puzzle emits NO format key, so its canonical content is
    -- byte-identical to what it has always been and re-saving it unchanged
    -- creates no new version. A Mini says what it is.
    (case when _format = 'full' then '{}'::jsonb else jsonb_build_object('format', _format) end)
    || jsonb_build_object(
      'groups',                _out,
      'word_order',            _order,
      'rainbow_herring',       _herring,
      'rainbow_category_name', nullif(btrim(coalesce(_content ->> 'rainbow_category_name', '')), ''),
      'rainbow_hint_word',     nullif(btrim(coalesce(_content ->> 'rainbow_hint_word', '')), ''),
      'theme',                 nullif(btrim(coalesce(_content ->> 'theme', '')), ''),
      'is_emoji_puzzle',       coalesce((_content ->> 'is_emoji_puzzle')::boolean, false),
      'alphabetize_completed', coalesce((_content ->> 'alphabetize_completed')::boolean, true)
    )
    || case when nullif(btrim(coalesce(_content ->> 'rainbow_category_emoji', '')), '') is null then '{}'::jsonb else jsonb_build_object('rainbow_category_emoji', nullif(btrim(coalesce(_content ->> 'rainbow_category_emoji', '')), '')) end
    -- Same rule as the per-group flag above: only when true, and only when
    -- there is a Rainbow Category Emoji for it to withhold.
    || case when nullif(btrim(coalesce(_content ->> 'rainbow_category_emoji', '')), '') is null
              or not coalesce((_content ->> 'rainbow_category_emoji_hint_only')::boolean, false)
             then '{}'::jsonb
             else jsonb_build_object('rainbow_category_emoji_hint_only', true) end;
end;
$_$;

-- verify_device(text, text)
CREATE FUNCTION public.verify_device(_device_id text, _device_token text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1
      from public.device_identities di
     where di.device_id = _device_id
       and di.retired_at is null
       and di.token_hash is not null
       and _device_token is not null
       and di.token_hash = encode(sha256(convert_to(_device_token, 'UTF8')), 'hex')
  )
$$;

-- ---------------------------------------------------------------------------
-- The account layer (launch baseline)
--
-- A Rainbow account = an auth.users row + a public.accounts row. The accounts
-- row exists only because ensure_account() found a custom:platform (WorkOS)
-- identity on the caller. rainbow_uid() is the ONE place every other Rainbow
-- function and policy asks "who is calling?"; it answers NULL for a guest and
-- for any auth user that is not a Rainbow account, so sharing the auth pool
-- with another tenant during beta changes nothing about Rainbow's behaviour.
-- ---------------------------------------------------------------------------

-- rainbow_uid()
CREATE FUNCTION public.rainbow_uid() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select a.user_id
    from public.accounts a
   where a.user_id = auth.uid()
$$;

-- account_email(uuid)
CREATE FUNCTION public.account_email(_user_id uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  -- The ONE source of a Rainbow account's current email address.
  --
  -- The shared identity provider owns the address, and GoTrue mirrors it into
  -- auth.identities.identity_data on every sign-in but writes auth.users.email
  -- only once, when the auth user is created (observed in the Staging smoke
  -- test, case S6: after an email change at the provider the identity said
  -- the new address and the user row still said the old one). So for a
  -- WorkOS-linked account the identity is authoritative and auth.users.email
  -- is only the fallback for an account that somehow has no identity row.
  -- The permanent key is accounts.global_user_id; the email is display and
  -- lookup only, never identity. Both reads resolve through the account
  -- boundary: a user id that is not a Rainbow account gets NULL.
  select coalesce(
    (select nullif(btrim(i.identity_data ->> 'email'), '')
       from public.accounts a
       join auth.identities i on i.user_id = a.user_id
      where a.user_id = _user_id
        and i.provider = 'custom:platform'
      order by i.created_at
      limit 1),
    (select u.email::text
       from public.accounts a
       join auth.users u on u.id = a.user_id
      where a.user_id = _user_id)
  )
$$;

-- ensure_account()
CREATE FUNCTION public.ensure_account() RETURNS TABLE(outcome text, user_id uuid, global_user_id text, email text, created_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
-- The output columns share names with accounts' columns; an unqualified
-- name in the SQL below means the COLUMN, never the output variable.
#variable_conflict use_column
declare
  _uid uuid := auth.uid();
  _gid text;
begin
  -- Outcomes are ordinary rows, not exceptions: "not a Rainbow account" is a
  -- normal answer in a shared project, and it must not surface as a failed
  -- request in the browser.
  if _uid is null then
    return query select 'not_signed_in'::text, null::uuid, null::text, null::text, null::timestamptz;
    return;
  end if;

  -- The link is read from GoTrue's own identity table on the server, never
  -- from user_metadata (which a player can edit) and never from the client.
  select i.provider_id
    into _gid
    from auth.identities i
   where i.user_id = _uid
     and i.provider = 'custom:platform'
   order by i.created_at
   limit 1;

  if _gid is null then
    -- An auth user that did not come through the shared sign-in. In the
    -- shared beta project that is another tenant's admin or a stray signup;
    -- either way it is not, and never becomes, a Rainbow account.
    return query select 'not_platform_linked'::text, null::uuid, null::text, null::text, null::timestamptz;
    return;
  end if;

  insert into public.accounts (user_id, global_user_id)
  values (_uid, _gid)
  on conflict (user_id) do update
    set last_seen_at = now();

  return query
    select 'ok'::text, a.user_id, a.global_user_id, public.account_email(a.user_id), a.created_at
      from public.accounts a
     where a.user_id = _uid;
end;
$$;

-- my_account()
CREATE FUNCTION public.my_account() RETURNS TABLE(user_id uuid, global_user_id text, email text, created_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select a.user_id, a.global_user_id, public.account_email(a.user_id), a.created_at
    from public.accounts a
   where a.user_id = auth.uid()
$$;

-- ping()
CREATE FUNCTION public.ping() RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select true
$$;

-- resolve_device_import(text, text)
CREATE FUNCTION public.resolve_device_import(_device_id text DEFAULT NULL::text, _device_token text DEFAULT NULL::text) RETURNS TABLE(outcome text, games_played integer, current_streak integer, longest_streak integer)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _uid uuid := public.rainbow_uid();
  _retired boolean;
begin
  outcome := 'unauthenticated';
  games_played := 0;
  current_streak := 0;
  longest_streak := 0;

  if _uid is null then
    return next;
    return;
  end if;

  -- A browser with no identity at all cannot be holding guest history.
  if _device_id is null or _device_token is null
     or btrim(_device_id) = '' or _device_id = 'unknown' then
    outcome := 'no_guest_history';
    return next;
    return;
  end if;

  select (di.retired_at is not null)
    into _retired
    from public.device_identities di
   where di.device_id = _device_id;

  if _retired then
    -- Decided already (by this account or another). Nothing to ask.
    outcome := 'already_decided';
    return next;
    return;
  end if;

  if not public.verify_device(_device_id, _device_token) then
    -- Unknown device or wrong token. Fails closed: says nothing about
    -- whether history exists, and consumes nothing.
    outcome := 'credential_invalid';
    return next;
    return;
  end if;

  if not public.device_has_importable_history(_device_id) then
    outcome := 'no_guest_history';
    return next;
    return;
  end if;

  outcome := 'import_available';

  select count(*)::integer into games_played
    from public.game_sessions gs
   where gs.device_id = _device_id
     and gs.user_id is null
     and gs.status in ('won', 'lost');

  select coalesce(us.current_streak, 0), coalesce(us.longest_streak, 0)
    into current_streak, longest_streak
    from public.user_streaks us
   where us.device_id = _device_id
     and us.user_id is null
   order by coalesce(us.longest_streak, 0) desc, coalesce(us.current_streak, 0) desc
   limit 1;

  current_streak := coalesce(current_streak, 0);
  longest_streak := coalesce(longest_streak, 0);
  return next;
end;
$$;

-- import_guest_history(text, text)
CREATE FUNCTION public.import_guest_history(_device_id text, _device_token text) RETURNS TABLE(outcome text, sessions_claimed integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _uid  uuid := public.rainbow_uid();
  _rows integer;
  _s    record;
begin
  outcome := 'unauthenticated';
  sessions_claimed := 0;

  if _uid is null then
    return next;
    return;
  end if;

  -- verify_device() is false for an unknown device, a wrong token AND a
  -- retired device, so a second import of the same device cannot get past
  -- this line even before the lock.
  if _device_id is null or _device_token is null
     or not public.verify_device(_device_id, _device_token) then
    outcome := 'credential_invalid';
    return next;
    return;
  end if;

  -- One decision per device, ever. The lock serialises two tabs; the
  -- compare-and-swap on retired_at makes the loser a no-op, not a duplicate.
  perform pg_advisory_xact_lock(hashtextextended('device:' || _device_id, 0));

  update public.device_identities
     set retired_at = now(),
         retired_reason = 'imported',
         claimed_by = _uid,
         decided_at = now()
   where device_id = _device_id
     and retired_at is null;
  get diagnostics _rows = row_count;
  if _rows = 0 then
    outcome := 'already_decided';
    return next;
    return;
  end if;

  -- Ownership transfer IN PLACE: same rows, same ids, nothing created.
  -- Never overrides an existing official result: a claimed row that would
  -- collide with one the account already owns is demoted, never deleted.
  update public.game_sessions gs
     set user_id = _uid,
         is_official = case
           when gs.is_official and exists (
             select 1
               from public.game_sessions existing
              where existing.puzzle_id = gs.puzzle_id
                and existing.user_id = _uid
                and existing.status in ('won', 'lost')
                and existing.is_official
           )
           then false
           else gs.is_official
         end
   where gs.device_id = _device_id
     and gs.user_id is null;
  get diagnostics sessions_claimed = row_count;

  -- The streak record changes owner per FORMAT, and only where the account
  -- has none yet: an account's existing Full streak is never overwritten by
  -- a device's Full streak, but a device's Mini streak still comes across.
  -- Streaks are never summed.
  for _s in
    select us.id, us.format
      from public.user_streaks us
     where us.device_id = _device_id
       and us.user_id is null
     order by coalesce(us.longest_streak, 0) desc, coalesce(us.current_streak, 0) desc
  loop
    if not exists (
      select 1 from public.user_streaks own
       where own.user_id = _uid and own.format = _s.format
    ) then
      update public.user_streaks set user_id = _uid where id = _s.id;
    end if;
  end loop;

  outcome := 'imported';
  return next;
end;
$$;

-- decline_guest_history(text, text)
CREATE FUNCTION public.decline_guest_history(_device_id text DEFAULT NULL::text, _device_token text DEFAULT NULL::text) RETURNS TABLE(outcome text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _uid  uuid := public.rainbow_uid();
  _rows integer;
begin
  outcome := 'unauthenticated';
  if _uid is null then
    return next;
    return;
  end if;

  -- Declining imports nothing and deletes nothing: the guest rows stay
  -- exactly where they are, still counted site-wide, and the device is
  -- retired so this browser's next play is a genuinely separate guest.
  --
  -- A device that cannot be verified (unknown, wrong token) is left alone:
  -- there is nothing to retire, and the client mints a fresh identity next.
  if _device_id is not null and _device_token is not null
     and public.verify_device(_device_id, _device_token) then
    perform pg_advisory_xact_lock(hashtextextended('device:' || _device_id, 0));
    update public.device_identities
       set retired_at = now(),
           retired_reason = 'started_fresh',
           claimed_by = _uid,
           decided_at = now()
     where device_id = _device_id
       and retired_at is null;
    get diagnostics _rows = row_count;
    if _rows = 0 then
      outcome := 'already_decided';
      return next;
      return;
    end if;
  end if;

  outcome := 'started_fresh';
  return next;
end;
$$;

-- delete_local_account(uuid)
CREATE FUNCTION public.delete_local_account(_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  if _user_id is null then
    return;
  end if;

  -- Gameplay rows are anonymised, not deleted: site-wide aggregates keep
  -- counting them, but with both owner columns cleared nobody can reach them
  -- again (not even a device that is still live in some browser).
  update public.game_sessions
     set user_id = null,
         device_id = null
   where user_id = _user_id;

  delete from public.user_streaks where user_id = _user_id;
  delete from public.puzzle_ratings where user_id = _user_id;
  update public.feedback set user_id = null where user_id = _user_id;
  update public.device_identities set claimed_by = null where claimed_by = _user_id;
  delete from public.accounts where user_id = _user_id;

  -- The auth user itself. GoTrue's own cascades remove identities, sessions
  -- and refresh tokens; Rainbow's cascades remove roles, archive access, the
  -- creator profile and favourites, and clear created_by on puzzles.
  delete from auth.users where id = _user_id;
end;
$$;

-- delete_my_account()
CREATE FUNCTION public.delete_my_account() RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  _uid uuid := public.rainbow_uid();
begin
  if _uid is null then
    return false;
  end if;
  perform public.delete_local_account(_uid);
  return true;
end;
$$;

-- admin_find_account(text)
CREATE FUNCTION public.admin_find_account(_email text) RETURNS TABLE(user_id uuid, email text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  -- Looks only among Rainbow ACCOUNTS, never across every auth user in the
  -- project, so a Rainbow admin cannot see another tenant's users. The email
  -- is a lookup key for a human typing it in, not an identity key, and it is
  -- the CURRENT address (account_email: the provider identity, not the stale
  -- auth.users.email).
  select a.user_id, public.account_email(a.user_id)
    from public.accounts a
   where public.has_role(public.rainbow_uid(), 'admin'::public.app_role)
     and lower(public.account_email(a.user_id)) = lower(btrim(_email))
$$;

set check_function_bodies = on;


-- ===========================================================================
-- 7. Triggers
-- ===========================================================================

-- game_sessions game_sessions_sync_status_trigger
CREATE TRIGGER game_sessions_sync_status_trigger BEFORE INSERT OR UPDATE ON public.game_sessions FOR EACH ROW EXECUTE FUNCTION public.game_sessions_sync_status();

-- puzzle_versions puzzle_versions_immutable
CREATE TRIGGER puzzle_versions_immutable BEFORE UPDATE ON public.puzzle_versions FOR EACH ROW EXECUTE FUNCTION public.puzzle_versions_block_update();

-- puzzles puzzles_current_version_check
CREATE TRIGGER puzzles_current_version_check BEFORE INSERT OR UPDATE OF current_version_id ON public.puzzles FOR EACH ROW EXECUTE FUNCTION public.puzzles_check_current_version();

-- puzzles update_puzzles_updated_at
CREATE TRIGGER update_puzzles_updated_at BEFORE UPDATE ON public.puzzles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- ===========================================================================
-- 8. Row level security
-- ===========================================================================

-- archive_access
ALTER TABLE public.archive_access ENABLE ROW LEVEL SECURITY;

-- beta_feedback
ALTER TABLE public.beta_feedback ENABLE ROW LEVEL SECURITY;

-- beta_playtests
ALTER TABLE public.beta_playtests ENABLE ROW LEVEL SECURITY;

-- creator_profiles
ALTER TABLE public.creator_profiles ENABLE ROW LEVEL SECURITY;

-- custom_puzzle_favorites
ALTER TABLE public.custom_puzzle_favorites ENABLE ROW LEVEL SECURITY;

-- custom_puzzle_results
ALTER TABLE public.custom_puzzle_results ENABLE ROW LEVEL SECURITY;

-- custom_puzzle_stats
ALTER TABLE public.custom_puzzle_stats ENABLE ROW LEVEL SECURITY;

-- custom_puzzles
ALTER TABLE public.custom_puzzles ENABLE ROW LEVEL SECURITY;

-- accounts
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;

-- device_identities
ALTER TABLE public.device_identities ENABLE ROW LEVEL SECURITY;

-- feedback
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- game_sessions
ALTER TABLE public.game_sessions ENABLE ROW LEVEL SECURITY;

-- guess_events
ALTER TABLE public.guess_events ENABLE ROW LEVEL SECURITY;

-- hint_events
ALTER TABLE public.hint_events ENABLE ROW LEVEL SECURITY;

-- luck_score_ceilings
ALTER TABLE public.luck_score_ceilings ENABLE ROW LEVEL SECURITY;

-- puzzle_aggregates
ALTER TABLE public.puzzle_aggregates ENABLE ROW LEVEL SECURITY;

-- puzzle_groups
ALTER TABLE public.puzzle_groups ENABLE ROW LEVEL SECURITY;

-- puzzle_ratings
ALTER TABLE public.puzzle_ratings ENABLE ROW LEVEL SECURITY;

-- puzzle_versions
ALTER TABLE public.puzzle_versions ENABLE ROW LEVEL SECURITY;

-- puzzles
ALTER TABLE public.puzzles ENABLE ROW LEVEL SECURITY;

-- user_roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- user_streaks
ALTER TABLE public.user_streaks ENABLE ROW LEVEL SECURITY;


-- ===========================================================================
-- 9. Policies
-- ===========================================================================

-- archive_access Admins can manage archive access
CREATE POLICY "Admins can manage archive access" ON public.archive_access TO authenticated USING (public.has_role(public.rainbow_uid(), 'admin'::public.app_role));

-- puzzle_groups Admins can manage puzzle groups
CREATE POLICY "Admins can manage puzzle groups" ON public.puzzle_groups USING (public.has_role(public.rainbow_uid(), 'admin'::public.app_role));

-- puzzles Admins can manage puzzles
CREATE POLICY "Admins can manage puzzles" ON public.puzzles USING (public.has_role(public.rainbow_uid(), 'admin'::public.app_role));

-- user_roles Admins can manage roles
CREATE POLICY "Admins can manage roles" ON public.user_roles USING (public.has_role(public.rainbow_uid(), 'admin'::public.app_role));

-- game_sessions Admins can read all game sessions
CREATE POLICY "Admins can read all game sessions" ON public.game_sessions FOR SELECT TO authenticated USING (public.has_role(public.rainbow_uid(), 'admin'::public.app_role));

-- guess_events Admins can read all guess events
CREATE POLICY "Admins can read all guess events" ON public.guess_events FOR SELECT TO authenticated USING (public.has_role(public.rainbow_uid(), 'admin'::public.app_role));

-- hint_events Admins can read all hint events
CREATE POLICY "Admins can read all hint events" ON public.hint_events FOR SELECT TO authenticated USING (public.has_role(public.rainbow_uid(), 'admin'::public.app_role));

-- puzzle_versions Admins can read all puzzle versions
CREATE POLICY "Admins can read all puzzle versions" ON public.puzzle_versions FOR SELECT TO authenticated USING (public.has_role(public.rainbow_uid(), 'admin'::public.app_role));

-- puzzle_ratings Admins can read all ratings
CREATE POLICY "Admins can read all ratings" ON public.puzzle_ratings FOR SELECT TO authenticated USING (public.has_role(public.rainbow_uid(), 'admin'::public.app_role));

-- beta_feedback Admins can read beta feedback
CREATE POLICY "Admins can read beta feedback" ON public.beta_feedback FOR SELECT USING (public.has_role(public.rainbow_uid(), 'admin'::public.app_role));

-- beta_playtests Admins can read beta playtests
CREATE POLICY "Admins can read beta playtests" ON public.beta_playtests FOR SELECT USING (public.has_role(public.rainbow_uid(), 'admin'::public.app_role));

-- custom_puzzles Admins can read custom puzzles
CREATE POLICY "Admins can read custom puzzles" ON public.custom_puzzles FOR SELECT USING (public.has_role(public.rainbow_uid(), 'admin'::public.app_role));

-- feedback Admins can read feedback
CREATE POLICY "Admins can read feedback" ON public.feedback FOR SELECT TO authenticated USING (public.has_role(public.rainbow_uid(), 'admin'::public.app_role));

-- puzzle_groups Anyone can read published or beta puzzle groups
CREATE POLICY "Anyone can read published or beta puzzle groups" ON public.puzzle_groups FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.puzzles
  WHERE ((puzzles.id = puzzle_groups.puzzle_id) AND ((puzzles.is_published = true) OR (puzzles.is_beta = true))))));

-- puzzles Anyone can read published or beta puzzles
CREATE POLICY "Anyone can read published or beta puzzles" ON public.puzzles FOR SELECT USING (((is_published = true) OR (is_beta = true)));

-- puzzle_versions Anyone can read published puzzle versions
CREATE POLICY "Anyone can read published puzzle versions" ON public.puzzle_versions FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.puzzles p
  WHERE ((p.id = puzzle_versions.puzzle_id) AND (p.is_published = true)))));

-- puzzle_aggregates Anyone can read puzzle aggregates
CREATE POLICY "Anyone can read puzzle aggregates" ON public.puzzle_aggregates FOR SELECT USING (true);

-- puzzle_ratings Users can change own rating
CREATE POLICY "Users can change own rating" ON public.puzzle_ratings FOR UPDATE TO authenticated USING ((user_id = public.rainbow_uid())) WITH CHECK ((user_id = public.rainbow_uid()));

-- archive_access Users can check own archive access
CREATE POLICY "Users can check own archive access" ON public.archive_access FOR SELECT TO authenticated USING ((public.rainbow_uid() = user_id));

-- puzzle_ratings Users can rate as themselves
CREATE POLICY "Users can rate as themselves" ON public.puzzle_ratings FOR INSERT TO authenticated WITH CHECK ((user_id = public.rainbow_uid()));

-- game_sessions Users can read own game sessions
CREATE POLICY "Users can read own game sessions" ON public.game_sessions FOR SELECT TO authenticated USING ((user_id = public.rainbow_uid()));

-- guess_events Users can read own guess events
CREATE POLICY "Users can read own guess events" ON public.guess_events FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.game_sessions gs
  WHERE ((gs.id = guess_events.game_session_id) AND (gs.user_id = public.rainbow_uid())))));

-- hint_events Users can read own hint events
CREATE POLICY "Users can read own hint events" ON public.hint_events FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.game_sessions gs
  WHERE ((gs.id = hint_events.game_session_id) AND (gs.user_id = public.rainbow_uid())))));

-- puzzle_ratings Users can read own rating
CREATE POLICY "Users can read own rating" ON public.puzzle_ratings FOR SELECT TO authenticated USING ((user_id = public.rainbow_uid()));

-- user_roles Users can view own roles
CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT USING ((public.rainbow_uid() = user_id));


-- ===========================================================================
-- 10. Grants
-- ===========================================================================

-- SCHEMA public
REVOKE USAGE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;

-- ---- tables ----------------------------------------------------------
-- Explicit per table. anon/authenticated get exactly the DML the beta schema
-- allowed (row-level security then narrows it further); TRUNCATE, REFERENCES
-- and TRIGGER, which RLS does not govern and which had leaked in through
-- default privileges, are never granted to client roles. service_role keeps
-- everything, as on every Supabase project.

-- TABLE accounts
REVOKE ALL ON TABLE public.accounts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.accounts TO service_role;

-- TABLE archive_access
REVOKE ALL ON TABLE public.archive_access FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.archive_access TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.archive_access TO authenticated;
GRANT ALL ON TABLE public.archive_access TO service_role;

-- TABLE beta_feedback
REVOKE ALL ON TABLE public.beta_feedback FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.beta_feedback TO authenticated;
GRANT ALL ON TABLE public.beta_feedback TO service_role;

-- TABLE beta_playtests
REVOKE ALL ON TABLE public.beta_playtests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.beta_playtests TO authenticated;
GRANT ALL ON TABLE public.beta_playtests TO service_role;

-- TABLE creator_profiles
REVOKE ALL ON TABLE public.creator_profiles FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.creator_profiles TO service_role;

-- TABLE custom_puzzle_favorites
REVOKE ALL ON TABLE public.custom_puzzle_favorites FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.custom_puzzle_favorites TO service_role;

-- TABLE custom_puzzle_results
REVOKE ALL ON TABLE public.custom_puzzle_results FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.custom_puzzle_results TO service_role;

-- TABLE custom_puzzle_stats
REVOKE ALL ON TABLE public.custom_puzzle_stats FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.custom_puzzle_stats TO service_role;

-- TABLE custom_puzzles
REVOKE ALL ON TABLE public.custom_puzzles FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.custom_puzzles TO service_role;

-- TABLE device_identities
REVOKE ALL ON TABLE public.device_identities FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.device_identities TO service_role;

-- TABLE feedback
REVOKE ALL ON TABLE public.feedback FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.feedback TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.feedback TO authenticated;
GRANT ALL ON TABLE public.feedback TO service_role;

-- TABLE game_sessions
REVOKE ALL ON TABLE public.game_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.game_sessions TO anon;
GRANT SELECT ON TABLE public.game_sessions TO authenticated;
GRANT ALL ON TABLE public.game_sessions TO service_role;

-- TABLE guess_events
REVOKE ALL ON TABLE public.guess_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.guess_events TO anon;
GRANT SELECT ON TABLE public.guess_events TO authenticated;
GRANT ALL ON TABLE public.guess_events TO service_role;

-- TABLE hint_events
REVOKE ALL ON TABLE public.hint_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.hint_events TO anon;
GRANT SELECT ON TABLE public.hint_events TO authenticated;
GRANT ALL ON TABLE public.hint_events TO service_role;

-- TABLE luck_score_ceilings
REVOKE ALL ON TABLE public.luck_score_ceilings FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.luck_score_ceilings TO service_role;

-- TABLE puzzle_aggregates
REVOKE ALL ON TABLE public.puzzle_aggregates FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.puzzle_aggregates TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.puzzle_aggregates TO authenticated;
GRANT ALL ON TABLE public.puzzle_aggregates TO service_role;

-- TABLE puzzle_groups
REVOKE ALL ON TABLE public.puzzle_groups FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.puzzle_groups TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.puzzle_groups TO authenticated;
GRANT ALL ON TABLE public.puzzle_groups TO service_role;

-- TABLE puzzle_ratings
REVOKE ALL ON TABLE public.puzzle_ratings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.puzzle_ratings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.puzzle_ratings TO authenticated;
GRANT ALL ON TABLE public.puzzle_ratings TO service_role;

-- TABLE puzzle_versions
REVOKE ALL ON TABLE public.puzzle_versions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.puzzle_versions TO anon;
GRANT SELECT ON TABLE public.puzzle_versions TO authenticated;
GRANT ALL ON TABLE public.puzzle_versions TO service_role;

-- TABLE puzzles
REVOKE ALL ON TABLE public.puzzles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.puzzles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.puzzles TO authenticated;
GRANT ALL ON TABLE public.puzzles TO service_role;

-- TABLE user_roles
REVOKE ALL ON TABLE public.user_roles FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_roles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_roles TO authenticated;
GRANT ALL ON TABLE public.user_roles TO service_role;

-- TABLE user_streaks
REVOKE ALL ON TABLE public.user_streaks FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.user_streaks TO service_role;

-- ---- functions --------------------------------------------------------
-- Every function gets an EXPLICIT grant set. Supabase's default privileges
-- make a new function executable by anon and authenticated unless it is
-- revoked from those roles by name -- revoking from PUBLIC alone (what the
-- beta chain did) leaves them in place. Internal helpers such as
-- record_streak, verify_device and delete_local_account must never be
-- client-callable, so this section revokes first and grants only what each
-- function is for.

-- FUNCTION account_email(_user_id uuid)
REVOKE ALL ON FUNCTION public.account_email(_user_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.account_email(_user_id uuid) TO service_role;

-- FUNCTION admin_find_account(_email text)
REVOKE ALL ON FUNCTION public.admin_find_account(_email text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_find_account(_email text) TO authenticated, service_role;

-- FUNCTION admin_save_puzzle(_puzzle_id uuid, _metadata jsonb, _content jsonb)
REVOKE ALL ON FUNCTION public.admin_save_puzzle(_puzzle_id uuid, _metadata jsonb, _content jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_save_puzzle(_puzzle_id uuid, _metadata jsonb, _content jsonb) TO authenticated, service_role;

-- FUNCTION admin_set_custom_puzzle_status(_puzzle_id uuid, _status text)
REVOKE ALL ON FUNCTION public.admin_set_custom_puzzle_status(_puzzle_id uuid, _status text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_custom_puzzle_status(_puzzle_id uuid, _status text) TO authenticated, service_role;

-- FUNCTION complete_beta_playtest(_playtest_id uuid, _device_id text, _device_token text, _won boolean, _mistakes integer, _hints_used boolean)
REVOKE ALL ON FUNCTION public.complete_beta_playtest(_playtest_id uuid, _device_id text, _device_token text, _won boolean, _mistakes integer, _hints_used boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_beta_playtest(_playtest_id uuid, _device_id text, _device_token text, _won boolean, _mistakes integer, _hints_used boolean) TO anon, authenticated, service_role;

-- FUNCTION create_custom_puzzle(_creator_name text, _title text, _visibility text, _content jsonb)
REVOKE ALL ON FUNCTION public.create_custom_puzzle(_creator_name text, _title text, _visibility text, _content jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_custom_puzzle(_creator_name text, _title text, _visibility text, _content jsonb) TO anon, authenticated, service_role;

-- FUNCTION create_device_identity()
REVOKE ALL ON FUNCTION public.create_device_identity() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_device_identity() TO anon, authenticated, service_role;

-- FUNCTION create_game_session(_puzzle_id text, _device_id text, _device_token text, _entry_context text, _active_time_seconds integer, _mistakes integer, _puzzle_version_id uuid)
REVOKE ALL ON FUNCTION public.create_game_session(_puzzle_id text, _device_id text, _device_token text, _entry_context text, _active_time_seconds integer, _mistakes integer, _puzzle_version_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_game_session(_puzzle_id text, _device_id text, _device_token text, _entry_context text, _active_time_seconds integer, _mistakes integer, _puzzle_version_id uuid) TO anon, authenticated, service_role;

-- FUNCTION custom_creator_new_slug(_name text)
REVOKE ALL ON FUNCTION public.custom_creator_new_slug(_name text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.custom_creator_new_slug(_name text) TO service_role;

-- FUNCTION custom_ensure_creator_profile(_uid uuid, _name text)
REVOKE ALL ON FUNCTION public.custom_ensure_creator_profile(_uid uuid, _name text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.custom_ensure_creator_profile(_uid uuid, _name text) TO service_role;

-- FUNCTION custom_puzzle_new_short_code()
REVOKE ALL ON FUNCTION public.custom_puzzle_new_short_code() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.custom_puzzle_new_short_code() TO service_role;

-- FUNCTION custom_puzzle_public_json(_p custom_puzzles)
REVOKE ALL ON FUNCTION public.custom_puzzle_public_json(_p custom_puzzles) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.custom_puzzle_public_json(_p custom_puzzles) TO service_role;

-- FUNCTION custom_random_string(_alphabet text, _len integer)
REVOKE ALL ON FUNCTION public.custom_random_string(_alphabet text, _len integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.custom_random_string(_alphabet text, _len integer) TO service_role;

-- FUNCTION decline_guest_history(_device_id text, _device_token text)
REVOKE ALL ON FUNCTION public.decline_guest_history(_device_id text, _device_token text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decline_guest_history(_device_id text, _device_token text) TO authenticated, service_role;

-- FUNCTION delete_local_account(_user_id uuid)
REVOKE ALL ON FUNCTION public.delete_local_account(_user_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_local_account(_user_id uuid) TO service_role;

-- FUNCTION delete_my_account()
REVOKE ALL ON FUNCTION public.delete_my_account() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated, service_role;

-- FUNCTION device_has_importable_history(_device_id text)
REVOKE ALL ON FUNCTION public.device_has_importable_history(_device_id text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.device_has_importable_history(_device_id text) TO service_role;

-- FUNCTION ensure_account()
REVOKE ALL ON FUNCTION public.ensure_account() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ensure_account() TO authenticated, service_role;

-- FUNCTION finalize_game_session(_session_id uuid, _device_id text, _device_token text, _won boolean, _mistakes integer, _active_time_seconds integer, _found_rainbow boolean, _rainbow_solve_index smallint, _solve_order jsonb, _hints_used boolean, _share_grid text, _skip_streak boolean, _local_date text)
REVOKE ALL ON FUNCTION public.finalize_game_session(_session_id uuid, _device_id text, _device_token text, _won boolean, _mistakes integer, _active_time_seconds integer, _found_rainbow boolean, _rainbow_solve_index smallint, _solve_order jsonb, _hints_used boolean, _share_grid text, _skip_streak boolean, _local_date text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_game_session(_session_id uuid, _device_id text, _device_token text, _won boolean, _mistakes integer, _active_time_seconds integer, _found_rainbow boolean, _rainbow_solve_index smallint, _solve_order jsonb, _hints_used boolean, _share_grid text, _skip_streak boolean, _local_date text) TO anon, authenticated, service_role;

-- FUNCTION game_sessions_sync_status()
REVOKE ALL ON FUNCTION public.game_sessions_sync_status() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.game_sessions_sync_status() TO anon, authenticated, service_role;

-- FUNCTION get_archive_puzzles()
REVOKE ALL ON FUNCTION public.get_archive_puzzles() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_archive_puzzles() TO anon, authenticated, service_role;

-- FUNCTION get_creator_profile(_slug text, _sort text)
REVOKE ALL ON FUNCTION public.get_creator_profile(_slug text, _sort text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_creator_profile(_slug text, _sort text) TO anon, authenticated, service_role;

-- FUNCTION get_custom_puzzle(_share_id text)
REVOKE ALL ON FUNCTION public.get_custom_puzzle(_share_id text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_custom_puzzle(_share_id text) TO anon, authenticated, service_role;

-- FUNCTION get_custom_puzzle_by_short_code(_short_code text)
REVOKE ALL ON FUNCTION public.get_custom_puzzle_by_short_code(_short_code text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_custom_puzzle_by_short_code(_short_code text) TO anon, authenticated, service_role;

-- FUNCTION get_custom_puzzle_stats(_share_id text)
REVOKE ALL ON FUNCTION public.get_custom_puzzle_stats(_share_id text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_custom_puzzle_stats(_share_id text) TO anon, authenticated, service_role;

-- FUNCTION get_luck_report(_puzzle_id uuid, _device_id text, _device_token text)
REVOKE ALL ON FUNCTION public.get_luck_report(_puzzle_id uuid, _device_id text, _device_token text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_luck_report(_puzzle_id uuid, _device_id text, _device_token text) TO anon, authenticated, service_role;

-- FUNCTION get_my_favorites()
REVOKE ALL ON FUNCTION public.get_my_favorites() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_favorites() TO authenticated, service_role;

-- FUNCTION get_own_completed_sessions(_device_id text, _device_token text, _format text)
REVOKE ALL ON FUNCTION public.get_own_completed_sessions(_device_id text, _device_token text, _format text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_own_completed_sessions(_device_id text, _device_token text, _format text) TO anon, authenticated, service_role;

-- FUNCTION get_own_streak(_device_id text, _device_token text, _format text)
REVOKE ALL ON FUNCTION public.get_own_streak(_device_id text, _device_token text, _format text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_own_streak(_device_id text, _device_token text, _format text) TO anon, authenticated, service_role;

-- FUNCTION get_puzzle_report(_puzzle_id uuid)
REVOKE ALL ON FUNCTION public.get_puzzle_report(_puzzle_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_puzzle_report(_puzzle_id uuid) TO anon, authenticated, service_role;

-- FUNCTION get_puzzle_stats(_puzzle_id uuid)
REVOKE ALL ON FUNCTION public.get_puzzle_stats(_puzzle_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_puzzle_stats(_puzzle_id uuid) TO anon, authenticated, service_role;

-- FUNCTION get_streak_admin_summary()
REVOKE ALL ON FUNCTION public.get_streak_admin_summary() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_streak_admin_summary() TO authenticated, service_role;

-- FUNCTION has_archive_access(_user_id uuid)
REVOKE ALL ON FUNCTION public.has_archive_access(_user_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_archive_access(_user_id uuid) TO anon, authenticated, service_role;

-- FUNCTION has_official_result(_puzzle_id text, _device_id text, _device_token text)
REVOKE ALL ON FUNCTION public.has_official_result(_puzzle_id text, _device_id text, _device_token text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_official_result(_puzzle_id text, _device_id text, _device_token text) TO anon, authenticated, service_role;

-- FUNCTION has_role(_user_id uuid, _role app_role)
REVOKE ALL ON FUNCTION public.has_role(_user_id uuid, _role app_role) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_role(_user_id uuid, _role app_role) TO anon, authenticated, service_role;

-- FUNCTION import_guest_history(_device_id text, _device_token text)
REVOKE ALL ON FUNCTION public.import_guest_history(_device_id text, _device_token text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.import_guest_history(_device_id text, _device_token text) TO authenticated, service_role;

-- FUNCTION luck_eligible_paths(_puzzle_id text)
REVOKE ALL ON FUNCTION public.luck_eligible_paths(_puzzle_id text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.luck_eligible_paths(_puzzle_id text) TO service_role;

-- FUNCTION my_account()
REVOKE ALL ON FUNCTION public.my_account() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_account() TO authenticated, service_role;

-- FUNCTION ping()
REVOKE ALL ON FUNCTION public.ping() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ping() TO anon, authenticated, service_role;

-- FUNCTION puzzle_versions_block_update()
REVOKE ALL ON FUNCTION public.puzzle_versions_block_update() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.puzzle_versions_block_update() TO anon, authenticated, service_role;

-- FUNCTION puzzles_check_current_version()
REVOKE ALL ON FUNCTION public.puzzles_check_current_version() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.puzzles_check_current_version() TO anon, authenticated, service_role;

-- FUNCTION rainbow_uid()
REVOKE ALL ON FUNCTION public.rainbow_uid() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rainbow_uid() TO anon, authenticated, service_role;

-- FUNCTION record_bonus_rainbow(_session_id uuid, _device_id text, _device_token text, _guess_number integer, _words jsonb, _correct boolean, _guessed_at timestamp with time zone, _active_time_seconds integer, _groups_solved smallint)
REVOKE ALL ON FUNCTION public.record_bonus_rainbow(_session_id uuid, _device_id text, _device_token text, _guess_number integer, _words jsonb, _correct boolean, _guessed_at timestamp with time zone, _active_time_seconds integer, _groups_solved smallint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_bonus_rainbow(_session_id uuid, _device_id text, _device_token text, _guess_number integer, _words jsonb, _correct boolean, _guessed_at timestamp with time zone, _active_time_seconds integer, _groups_solved smallint) TO anon, authenticated, service_role;

-- FUNCTION record_guess_events(_session_id uuid, _device_id text, _device_token text, _events jsonb)
REVOKE ALL ON FUNCTION public.record_guess_events(_session_id uuid, _device_id text, _device_token text, _events jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_guess_events(_session_id uuid, _device_id text, _device_token text, _events jsonb) TO anon, authenticated, service_role;

-- FUNCTION record_hint_event(_session_id uuid, _device_id text, _device_token text, _hint_type text, _revealed_at timestamp with time zone, _active_time_seconds integer, _guess_count smallint, _mistakes smallint, _groups_solved smallint, _rainbow_found boolean)
REVOKE ALL ON FUNCTION public.record_hint_event(_session_id uuid, _device_id text, _device_token text, _hint_type text, _revealed_at timestamp with time zone, _active_time_seconds integer, _guess_count smallint, _mistakes smallint, _groups_solved smallint, _rainbow_found boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_hint_event(_session_id uuid, _device_id text, _device_token text, _hint_type text, _revealed_at timestamp with time zone, _active_time_seconds integer, _guess_count smallint, _mistakes smallint, _groups_solved smallint, _rainbow_found boolean) TO anon, authenticated, service_role;

-- FUNCTION record_streak(_user_id uuid, _device_id text, _won boolean, _local_date text, _format text)
REVOKE ALL ON FUNCTION public.record_streak(_user_id uuid, _device_id text, _won boolean, _local_date text, _format text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_streak(_user_id uuid, _device_id text, _won boolean, _local_date text, _format text) TO service_role;

-- FUNCTION reset_beta_playtest(_puzzle_id uuid, _device_id text, _device_token text)
REVOKE ALL ON FUNCTION public.reset_beta_playtest(_puzzle_id uuid, _device_id text, _device_token text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reset_beta_playtest(_puzzle_id uuid, _device_id text, _device_token text) TO anon, authenticated, service_role;

-- FUNCTION resolve_device_import(_device_id text, _device_token text)
REVOKE ALL ON FUNCTION public.resolve_device_import(_device_id text, _device_token text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_device_import(_device_id text, _device_token text) TO authenticated, service_role;

-- FUNCTION session_capability_ok(_session_id uuid, _device_id text, _device_token text)
REVOKE ALL ON FUNCTION public.session_capability_ok(_session_id uuid, _device_id text, _device_token text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.session_capability_ok(_session_id uuid, _device_id text, _device_token text) TO anon, authenticated, service_role;

-- FUNCTION set_custom_puzzle_favorite(_share_id text, _favorite boolean)
REVOKE ALL ON FUNCTION public.set_custom_puzzle_favorite(_share_id text, _favorite boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_custom_puzzle_favorite(_share_id text, _favorite boolean) TO authenticated, service_role;

-- FUNCTION skill_score(_won boolean, _mistakes integer, _solve_order jsonb, _found_rainbow boolean, _rainbow_source text, _format text)
REVOKE ALL ON FUNCTION public.skill_score(_won boolean, _mistakes integer, _solve_order jsonb, _found_rainbow boolean, _rainbow_source text, _format text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.skill_score(_won boolean, _mistakes integer, _solve_order jsonb, _found_rainbow boolean, _rainbow_source text, _format text) TO anon, authenticated, service_role;

-- FUNCTION start_beta_playtest(_puzzle_id uuid, _puzzle_version_id uuid, _device_id text, _device_token text)
REVOKE ALL ON FUNCTION public.start_beta_playtest(_puzzle_id uuid, _puzzle_version_id uuid, _device_id text, _device_token text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.start_beta_playtest(_puzzle_id uuid, _puzzle_version_id uuid, _device_id text, _device_token text) TO anon, authenticated, service_role;

-- FUNCTION submit_beta_feedback(_puzzle_id uuid, _puzzle_version_id uuid, _playtest_id uuid, _tester_name text, _fun_rating smallint, _difficulty_rating smallint, _rainbow_fairness_rating smallint, _confusing_or_incorrect text, _additional_comments text, _would_play_again boolean)
REVOKE ALL ON FUNCTION public.submit_beta_feedback(_puzzle_id uuid, _puzzle_version_id uuid, _playtest_id uuid, _tester_name text, _fun_rating smallint, _difficulty_rating smallint, _rainbow_fairness_rating smallint, _confusing_or_incorrect text, _additional_comments text, _would_play_again boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_beta_feedback(_puzzle_id uuid, _puzzle_version_id uuid, _playtest_id uuid, _tester_name text, _fun_rating smallint, _difficulty_rating smallint, _rainbow_fairness_rating smallint, _confusing_or_incorrect text, _additional_comments text, _would_play_again boolean) TO anon, authenticated, service_role;

-- FUNCTION submit_custom_puzzle_result(_share_id text, _device_id text, _device_token text, _won boolean, _total_guesses smallint, _run_id uuid)
REVOKE ALL ON FUNCTION public.submit_custom_puzzle_result(_share_id text, _device_id text, _device_token text, _won boolean, _total_guesses smallint, _run_id uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_custom_puzzle_result(_share_id text, _device_id text, _device_token text, _won boolean, _total_guesses smallint, _run_id uuid) TO anon, authenticated, service_role;

-- FUNCTION touch_game_session(_session_id uuid, _device_id text, _device_token text, _active_time_seconds integer, _mistakes integer)
REVOKE ALL ON FUNCTION public.touch_game_session(_session_id uuid, _device_id text, _device_token text, _active_time_seconds integer, _mistakes integer) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.touch_game_session(_session_id uuid, _device_id text, _device_token text, _active_time_seconds integer, _mistakes integer) TO anon, authenticated, service_role;

-- FUNCTION update_updated_at_column()
REVOKE ALL ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_updated_at_column() TO anon, authenticated, service_role;

-- FUNCTION validate_custom_puzzle_content(_content jsonb)
REVOKE ALL ON FUNCTION public.validate_custom_puzzle_content(_content jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.validate_custom_puzzle_content(_content jsonb) TO anon, authenticated, service_role;

-- FUNCTION validate_puzzle_content(_content jsonb)
REVOKE ALL ON FUNCTION public.validate_puzzle_content(_content jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.validate_puzzle_content(_content jsonb) TO authenticated, service_role;

-- FUNCTION verify_device(_device_id text, _device_token text)
REVOKE ALL ON FUNCTION public.verify_device(_device_id text, _device_token text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.verify_device(_device_id text, _device_token text) TO service_role;

-- ===========================================================================
-- 11. Comments
-- ===========================================================================

-- FUNCTION admin_save_puzzle(_puzzle_id uuid, _metadata jsonb, _content jsonb)
COMMENT ON FUNCTION public.admin_save_puzzle(_puzzle_id uuid, _metadata jsonb, _content jsonb) IS 'Atomically creates or updates a puzzle, including its Draft/Beta/Published status. Creates and promotes a new immutable version only when canonical gameplay content actually changed; metadata-only saves (status, designer_name) and no-op saves create none. Admin role required, checked inside the function.';

-- FUNCTION admin_set_custom_puzzle_status(_puzzle_id uuid, _status text)
COMMENT ON FUNCTION public.admin_set_custom_puzzle_status(_puzzle_id uuid, _status text) IS 'Admin-only moderation switch for a custom puzzle. No UI in this phase -- exists so a follow-up moderation dashboard needs no schema change.';

-- FUNCTION create_custom_puzzle(_creator_name text, _title text, _visibility text, _content jsonb)
COMMENT ON FUNCTION public.create_custom_puzzle(_creator_name text, _title text, _visibility text, _content jsonb) IS 'Creates an immutable player custom puzzle for anon or authenticated callers. created_by comes only from auth.uid(); share_id and short_code are generated server-side (collision-retried); a signed-in creator gets a public creator profile lazily.';

-- FUNCTION create_game_session(_puzzle_id text, _device_id text, _device_token text, _entry_context text, _active_time_seconds integer, _mistakes integer, _puzzle_version_id uuid)
COMMENT ON FUNCTION public.create_game_session(_puzzle_id text, _device_id text, _device_token text, _entry_context text, _active_time_seconds integer, _mistakes integer, _puzzle_version_id uuid) IS 'Creates an in_progress official session, pinned to the puzzle version the player''s board was built from. Refuses (returns NULL) for a device that cannot be verified, a puzzle that is not currently Published (covers Draft and Beta alike), or a Rainbow account playing on a device that still holds undecided guest history (see resolve_device_import). A session already created while its puzzle WAS published is never retroactively affected by a later status change -- only creation is gated here.';

-- TABLE custom_puzzles
COMMENT ON TABLE public.custom_puzzles IS 'Player-created puzzles (Phase 2, Full 4x4 only). Immutable after creation. Reachable only through create_custom_puzzle/get_custom_puzzle -- no direct grants to anon/authenticated.';

-- COLUMN custom_puzzles.content
COMMENT ON COLUMN public.custom_puzzles.content IS 'Canonical gameplay content, shape enforced by validate_custom_puzzle_content(): {mode: classic|rainbow, groups:[{category,words[4],hint_word}]x4, word_order[16], rainbow_herring[4]|null, rainbow_category_name, rainbow_hint_word, alphabetize_completed}.';

-- COLUMN custom_puzzles.short_code
COMMENT ON COLUMN public.custom_puzzles.short_code IS 'Permanent random URL-safe code for /p/:shortCode. Case-sensitive, unique. Possession is the access mechanism for a Private puzzle, exactly like share_id.';

-- FUNCTION game_sessions_sync_status()
COMMENT ON FUNCTION public.game_sessions_sync_status() IS 'BEFORE INSERT/UPDATE on game_sessions. Repairs status/completed_at for cached pre-Task-6 clients that predate the status column, and on INSERT decides is_official by the same first-completed-result rule finalize_game_session applies on the RPC path.';

-- FUNCTION get_creator_profile(_slug text, _sort text)
COMMENT ON FUNCTION public.get_creator_profile(_slug text, _sort text) IS 'Public creator page data: display name, totals and the creator''s Public, non-moderated puzzles only (sort: newest | plays | favorites). Returns only explicitly listed safe fields.';

-- FUNCTION get_custom_puzzle(_share_id text)
COMMENT ON FUNCTION public.get_custom_puzzle(_share_id text) IS 'Fetches one custom puzzle by its share_id, or null if it does not exist or has been hidden by moderation. Public and Private puzzles are fetched identically -- Private''s only protection is the unguessable share_id itself.';

-- FUNCTION get_custom_puzzle_by_short_code(_short_code text)
COMMENT ON FUNCTION public.get_custom_puzzle_by_short_code(_short_code text) IS 'Fetches one custom puzzle by short_code (Public and Private alike; the code is the access mechanism). Same shape as get_custom_puzzle. Null if unknown or hidden by moderation.';

-- FUNCTION get_custom_puzzle_stats(_share_id text)
COMMENT ON FUNCTION public.get_custom_puzzle_stats(_share_id text) IS 'Aggregate completed-play stats for one custom puzzle (by share_id, so Private stats require possessing the link): completed plays, wins, losses, average guesses over wins, and the fixed 4/5/6/7/8+ distribution. Never returns anything row-level.';

-- FUNCTION get_luck_report(_puzzle_id uuid, _device_id text, _device_token text)
COMMENT ON FUNCTION public.get_luck_report(_puzzle_id uuid, _device_id text, _device_token text) IS 'Lucky Bot Luck numbers for the caller''s own first official attempt at a Full puzzle: eligible player count, how many took the same exact guess path, and the puzzle''s ceiling. Counts only; never exposes another player''s path or session.';

-- FUNCTION get_puzzle_report(_puzzle_id uuid)
COMMENT ON FUNCTION public.get_puzzle_report(_puzzle_id uuid) IS 'Aggregate-only Lucky Bot report for one Full puzzle: player counts, perfect solves (and everyone else as having made a wrong guess), first-solved histogram, Rainbow found / found first / found last, skill-score histogram, and the three most common wrong guesses (never the Rainbow find itself). Never exposes an individual session. Returns null for a Mini puzzle.';

-- FUNCTION get_puzzle_stats(_puzzle_id uuid)
COMMENT ON FUNCTION public.get_puzzle_stats(_puzzle_id uuid) IS 'Aggregate-only per-puzzle stats for the "Global Stats" UI: every official completed session (anonymous + signed-in, wins + losses), across game_sessions. Never exposes individual rows.';

-- FUNCTION luck_eligible_paths(_puzzle_id text)
COMMENT ON FUNCTION public.luck_eligible_paths(_puzzle_id text) IS 'Internal. Every Luck-eligible session for one Full puzzle with its normalized ordered guess path. Never granted to clients: get_luck_report returns counts only.';

-- FUNCTION skill_score(_won boolean, _mistakes integer, _solve_order jsonb, _found_rainbow boolean, _rainbow_source text, _format text)
COMMENT ON FUNCTION public.skill_score(_won boolean, _mistakes integer, _solve_order jsonb, _found_rainbow boolean, _rainbow_source text, _format text) IS 'Lucky Bot skill score for one finished session. Full: 74–100 for a win, 50+ for a loss. Mini: the original 50–99 formula, unchanged. Mirrors src/lib/skillScore.ts exactly; keep the two in step.';

-- FUNCTION submit_custom_puzzle_result(_share_id text, _device_id text, _device_token text, _won boolean, _total_guesses smallint, _run_id uuid)
COMMENT ON FUNCTION public.submit_custom_puzzle_result(_share_id text, _device_id text, _device_token text, _won boolean, _total_guesses smallint, _run_id uuid) IS 'Counts one completed run (identified by _run_id) for (custom_puzzle, device). A repeat of the same run is a no-op that still returns true; a completed replay has a new run id and counts once more. Never writes to any official or Beta table.';

-- FUNCTION validate_custom_puzzle_content(_content jsonb)
COMMENT ON FUNCTION public.validate_custom_puzzle_content(_content jsonb) IS 'Validates and canonicalises a player-submitted custom puzzle. Unlike validate_puzzle_content, enforces one-Rainbow-answer-per-group (not just 4-of-16) and rejects any Rainbow content on a classic puzzle.';

-- FUNCTION validate_puzzle_content(_content jsonb)
COMMENT ON FUNCTION public.validate_puzzle_content(_content jsonb) IS 'Canonicalises and validates official puzzle content for its format (absent format = full). Full: 4 groups of 4, difficulties 1-4, optional 4-word Rainbow. Mini: 3 groups of 3, difficulties 2-4, optional 3-word Rainbow taking exactly one answer from each category. A Category Emoji may be flagged Hint Only, which is emitted only alongside an emoji.';

-- TABLE beta_feedback
COMMENT ON TABLE public.beta_feedback IS 'Beta playtest feedback forms. No account required to submit -- validated and inserted only through submit_beta_feedback(). Read only by admins.';

-- TABLE beta_playtests
COMMENT ON TABLE public.beta_playtests IS 'Lightweight Beta-only playtest tracking. Never contributes to game_sessions/game_results/user_streaks/puzzle_aggregates. Written only through start_beta_playtest/complete_beta_playtest/reset_beta_playtest; read only by admins.';

-- TABLE creator_profiles
COMMENT ON TABLE public.creator_profiles IS 'Public creator identity for signed-in custom-puzzle authors: slug + the display name they already published. Created lazily by create_custom_puzzle. Read only through get_creator_profile.';

-- TABLE custom_puzzle_favorites
COMMENT ON TABLE public.custom_puzzle_favorites IS 'One row per (account, custom puzzle). No email or profile data. Written only by set_custom_puzzle_favorite (auth.uid() only); read only in aggregate or as the caller''s own list.';

-- TABLE custom_puzzle_results
COMMENT ON TABLE public.custom_puzzle_results IS 'One row per (custom_puzzle, device) that finished a game. No guess/hint/tile-selection detail, no player-identifying data beyond the existing verified device id. Written only by submit_custom_puzzle_result; read only in aggregate, by get_custom_puzzle_stats.';

-- COLUMN custom_puzzle_results.recent_run_ids
COMMENT ON COLUMN public.custom_puzzle_results.recent_run_ids IS 'The last 10 run ids this device has had counted for this puzzle (newest first). Bounded idempotency window; see submit_custom_puzzle_result.';

-- TABLE custom_puzzle_stats
COMMENT ON TABLE public.custom_puzzle_stats IS 'One fixed-size aggregate row per custom puzzle (wins, losses, five guess buckets). Written only by submit_custom_puzzle_result; read only by get_custom_puzzle_stats and get_creator_profile.';

-- TABLE accounts
COMMENT ON TABLE public.accounts IS 'One row per Rainbow account. An auth.users row without a row here is not a Rainbow account and is treated as a guest by every Rainbow function (see rainbow_uid). Written only by ensure_account(), which copies global_user_id from the caller''s custom:platform identity; global_user_id is the WorkOS user id, unique here, and never a key for gameplay rows.';

-- COLUMN accounts.global_user_id
COMMENT ON COLUMN public.accounts.global_user_id IS 'The shared (WorkOS) identity this local account is linked to: auth.identities.provider_id for provider custom:platform. Text, not uuid; the reserved join key for future entitlements.';

-- TABLE device_identities
COMMENT ON TABLE public.device_identities IS 'One row per anonymous browser identity. token_hash is sha256 of a token returned exactly once at creation and never stored in the clear. retired_at is permanent: a retired identity can never be verified, claimed or resumed, but its gameplay rows are never touched. Since the launch baseline it also records the one-time import decision: retired_reason imported|started_fresh, claimed_by the account that decided, decided_at when.';

-- FUNCTION account_email(_user_id uuid)
COMMENT ON FUNCTION public.account_email(_user_id uuid) IS 'The account''s CURRENT email: the custom:platform identity''s address (which GoTrue refreshes on every sign-in), falling back to auth.users.email (which GoTrue sets once, at creation, and never refreshes). The only place Rainbow reads an email from; accounts.global_user_id is the identity key.';

-- FUNCTION rainbow_uid()
COMMENT ON FUNCTION public.rainbow_uid() IS 'The caller''s Rainbow account id, or NULL for a guest and for any auth user without a public.accounts row. Every Rainbow function and policy uses this where it once used auth.uid(); it is the tenant boundary while the auth pool is shared.';

-- FUNCTION ensure_account()
COMMENT ON FUNCTION public.ensure_account() IS 'Called by the client after every sign-in. Creates the caller''s accounts row from their custom:platform identity (or bumps last_seen_at) and returns it with outcome ok. Answers not_platform_linked (no account row) for an auth user with no such identity, which the client treats as "not a Rainbow account": local sign-out, stay a guest. Never raises.';

-- FUNCTION resolve_device_import(_device_id text, _device_token text)
COMMENT ON FUNCTION public.resolve_device_import(_device_id text, _device_token text) IS 'Asked on every signed-in load: does THIS device still owe the one-time import decision? unauthenticated | no_guest_history | already_decided | credential_invalid | import_available (+ counts). Never writes.';

-- FUNCTION delete_local_account(_user_id uuid)
COMMENT ON FUNCTION public.delete_local_account(_user_id uuid) IS 'Removes a Rainbow account: anonymises its game_sessions (user_id and device_id cleared; rows stay for site-wide aggregates), deletes its streaks and ratings, then deletes the auth user so GoTrue and Rainbow cascades finish the job. Touches only Rainbow objects and that one auth user.';

-- FUNCTION delete_my_account()
COMMENT ON FUNCTION public.delete_my_account() IS 'Self-service deletion for the signed-in Rainbow account. The shared (WorkOS) identity is untouched; signing in again creates a fresh, empty Rainbow account.';

-- FUNCTION admin_find_account(_email text)
COMMENT ON FUNCTION public.admin_find_account(_email text) IS 'Admin-only lookup of a Rainbow ACCOUNT by email (for granting archive access). Searches accounts, not the project''s whole auth user pool.';

-- COLUMN device_identities.claimed_by
COMMENT ON COLUMN public.device_identities.claimed_by IS 'The Rainbow account that imported or declined this device''s guest history. NULL while the device is live or if that account was later deleted.';

-- COLUMN game_sessions.won
COMMENT ON COLUMN public.game_sessions.won IS 'Three-state: NULL while in_progress (not yet knowable), TRUE when status=won, FALSE when status=lost. Enforced by game_sessions_status_won_check. Never read without filtering on status first.';

-- COLUMN game_sessions.completed_at
COMMENT ON COLUMN public.game_sessions.completed_at IS 'When the game formally ended. NULL while in_progress, a real timestamp on won/lost -- both directions enforced by game_sessions_status_completed_at_check. No column default: completion code supplies the value explicitly.';

-- COLUMN game_sessions.rainbow_solve_index
COMMENT ON COLUMN public.game_sessions.rainbow_solve_index IS 'Categories already solved when the Rainbow was found (0-4); NULL when unknown/not applicable. See useGame.ts GameState.rainbowSolveIndex, the authoritative source this value is copied from.';

-- COLUMN game_sessions.status
COMMENT ON COLUMN public.game_sessions.status IS 'Lifecycle: in_progress | won | lost. in_progress <=> completed_at IS NULL and won IS NULL (both enforced). Player-facing Stats MUST filter to (won, lost) -- a row existing no longer implies a played game.';

-- COLUMN game_sessions.is_official
COMMENT ON COLUMN public.game_sessions.is_official IS 'True when this session owns the permanent official result for its puzzle+identity. Set at completion, not at creation: false while in progress, false for a replay that completed after an official result already existed, and (in future) for beta/playtest sessions. Player-facing Stats filter on this AND status.';

-- COLUMN game_sessions.entry_context
COMMENT ON COLUMN public.game_sessions.entry_context IS 'How the player entered this game (daily_home, archive_calendar, free_collection, emoji_collection, archive_direct, free_legacy_link; future: beta, shared_link, ...). NOT a puzzle attribute. NULL = unknown/historical. No CHECK constraint so future values need no migration.';

-- COLUMN game_sessions.started_at
COMMENT ON COLUMN public.game_sessions.started_at IS 'When meaningful play began (first guess or first revealed hint) -- NOT page load. NULL for historical rows, which are never backfilled with a guessed value.';

-- COLUMN game_sessions.last_activity_at
COMMENT ON COLUMN public.game_sessions.last_activity_at IS 'Time of the last meaningful action (creation, guess, hint, completion). Basis for classifying stale in_progress sessions as abandoned in later analysis. Never written from timer ticks or UI-only events. NULL for historical rows.';

-- COLUMN game_sessions.bonus_rainbow_attempted
COMMENT ON COLUMN public.game_sessions.bonus_rainbow_attempted IS 'True when the player EXPLICITLY submitted the post-completion "Spot the Rainbow" modal at least once, correct or not. Session-level summary of guess_events.attempt_type = ''bonus_rainbow'' (same relationship hints_used has to hint_events). Never inferred from the Rainbow-SHAPE heuristic is_rainbow_attempt.';

-- COLUMN game_sessions.rainbow_source
COMMENT ON COLUMN public.game_sessions.rainbow_source IS 'How the Rainbow was found: in_game | post_game. NULL when not found, and NULL for historical rows (never backfilled with a guess). Read only alongside found_rainbow = true.';

-- COLUMN game_sessions.puzzle_version_id
COMMENT ON COLUMN public.game_sessions.puzzle_version_id IS 'The puzzle_versions snapshot this session is playing. NULL = unknown (legacy session predating versioning, or a client that did not pin one) -- never backfilled or guessed. Stats key on puzzle_id, NOT on this column: every version is the same puzzle.';

-- COLUMN game_sessions.format
COMMENT ON COLUMN public.game_sessions.format IS 'The board format this play belongs to, copied from the puzzle at session creation. Existing sessions default to ''full'', which is what every one of them is.';

-- COLUMN guess_events.is_rainbow_attempt
COMMENT ON COLUMN public.guess_events.is_rainbow_attempt IS 'True when this guess was shaped like a Rainbow attempt (bonus modal submission, or an in-game guess with one word per category), regardless of success. NULL = not classified (historical rows).';

-- COLUMN guess_events.is_one_away
COMMENT ON COLUMN public.guess_events.is_one_away IS 'Guess contained exactly 3 words of one unsolved category. NULL = not recorded (historical rows).';

-- COLUMN guess_events.is_almost_rainbow
COMMENT ON COLUMN public.guess_events.is_almost_rainbow IS 'Guess contained exactly 3 of the 4 Rainbow herring words. NULL = not recorded (historical rows).';

-- COLUMN guess_events.active_time_seconds
COMMENT ON COLUMN public.guess_events.active_time_seconds IS 'Cumulative ACTIVE play seconds at the moment of this guess (background-tab time already excluded). NULL = not recorded (historical rows).';

-- COLUMN guess_events.groups_solved
COMMENT ON COLUMN public.guess_events.groups_solved IS 'Normal categories already solved when this guess was submitted (0-4). NULL = not recorded (historical rows).';

-- COLUMN guess_events.attempt_type
COMMENT ON COLUMN public.guess_events.attempt_type IS 'normal | bonus_rainbow. The authoritative record of an EXPLICIT post-completion "Spot the Rainbow" submission. NULL = historical row (never backfilled). Use this, NOT the is_rainbow_attempt shape heuristic, to determine player intent.';

-- COLUMN guess_events.server_numbered
COMMENT ON COLUMN public.guess_events.server_numbered IS 'True when a post-game Rainbow submission was numbered by record_bonus_rainbow itself (20260928000000), which never drops a submission. NULL on older rows, whose prompt history may be missing an attempt.';

-- TABLE hint_events
COMMENT ON TABLE public.hint_events IS 'One row per hint ACTUALLY REVEALED. Opening the hint modal or viewing options is deliberately not recorded. Idempotent on (game_session_id, hint_type).';

-- TABLE luck_score_ceilings
COMMENT ON TABLE public.luck_score_ceilings IS 'Lucky Bot Luck Score ceiling ("1 in N" that scores 100). A puzzle uses the row with the latest effective_from on or before its own date, so adding a row later never changes an older puzzle''s score. Add rows; do not edit old ones.';

-- COLUMN puzzle_groups.category_emoji
COMMENT ON COLUMN public.puzzle_groups.category_emoji IS 'Optional explicit category visual, stored literally (e.g. ''___ 💬'', '':caveman:''). NULL = fall back to the emoji at the end of the category title (older puzzles).';

-- COLUMN puzzle_groups.category_emoji_hint_only
COMMENT ON COLUMN public.puzzle_groups.category_emoji_hint_only IS 'When true, this category''s Category Emoji appears in the Full Hint but is NOT appended to the category name on the solved bar. Never alters the category name itself. Meaningless without a category_emoji, and never stored as true in that case.';

-- TABLE puzzle_versions
COMMENT ON TABLE public.puzzle_versions IS 'Immutable gameplay-content snapshots of a puzzle. Never updated, never deleted except by cascade when the puzzle itself is deleted. A game_sessions row pins the exact snapshot that player is playing.';

-- COLUMN puzzle_versions.content
COMMENT ON COLUMN public.puzzle_versions.content IS 'Canonical gameplay content: {groups:[{category,words[4],difficulty,hint_word,sort_order}] x4, word_order, rainbow_herring, rainbow_category_name, rainbow_hint_word, theme, is_emoji_puzzle}. Shape enforced by validate_puzzle_content().';

-- COLUMN puzzles.current_version_id
COMMENT ON COLUMN public.puzzles.current_version_id IS 'The newest puzzle_versions row for this puzzle: the canonical current definition. Enforced to belong to this same puzzle. Written only by admin_save_puzzle().';

-- COLUMN puzzles.is_beta
COMMENT ON COLUMN public.puzzles.is_beta IS 'Unlisted playtest status. Mutually exclusive with is_published (see puzzles_not_beta_and_published). Metadata, not gameplay content -- never versioned.';

-- COLUMN puzzles.designer_name
COMMENT ON COLUMN public.puzzles.designer_name IS 'Display name shown in the puzzle header as "by <designer_name>". Metadata, not gameplay content -- never versioned. Trimmed and defaulted to ''Sam West'' by admin_save_puzzle() when blank.';

-- COLUMN puzzles.alphabetize_completed
COMMENT ON COLUMN public.puzzles.alphabetize_completed IS 'Whether this puzzle''s solved-category bar shows its answers alphabetically (true) or in the creator''s authored comma-separated order (false). Gameplay content, versioned like any other field in validate_puzzle_content(). Default true.';

-- COLUMN puzzles.rainbow_category_emoji
COMMENT ON COLUMN public.puzzles.rainbow_category_emoji IS 'Optional explicit Rainbow category visual, stored literally. NULL = fall back to the emoji at the end of rainbow_category_name.';

-- COLUMN puzzles.format
COMMENT ON COLUMN public.puzzles.format IS 'Board format: ''full'' (4x4, 4 categories of 4) or ''mini'' (3x3, 3 categories of 3). Every puzzle that predates Mini is ''full'' by default.';

-- COLUMN puzzles.rainbow_category_emoji_hint_only
COMMENT ON COLUMN public.puzzles.rainbow_category_emoji_hint_only IS 'When true, the Rainbow''s Category Emoji appears in the Full Hint but is NOT appended to its name on the solved bar. Never alters rainbow_category_name.';

-- COLUMN user_streaks.format
COMMENT ON COLUMN public.user_streaks.format IS 'Which game this streak counts. Existing rows default to ''full'' — every streak recorded before Mini is a Full streak.';

-- INDEX puzzles_date_format_key
COMMENT ON INDEX public.puzzles_date_format_key IS 'One puzzle per date PER FORMAT. Replaces the original single-column UNIQUE on date, which made a Mini Daily and a Full Daily on the same date impossible.';
