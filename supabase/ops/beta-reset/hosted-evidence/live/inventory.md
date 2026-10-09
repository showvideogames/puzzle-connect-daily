# Hosted project inventory: live

Read from the hosted shared beta project on 2026-10-04T11:24:55.940Z by `npm run phase2:hosted -- inventory --label live`. Everything in `public`, every tenant.

## Summary

| Category | Count |
|---|---|
| Tables | 34 |
| Columns | 277 |
| Constraints | 120 |
| Indexes | 73 |
| Functions | 69 |
| Triggers | 5 |
| RLS policies | 46 |
| Enum types | 1 |
| Views | 0 |
| Sequences | 3 |
| Storage buckets | 2 |

## Enum types

- `app_role`: `admin`, `moderator`

## Tables

### `accounts`

> One row per Rainbow account. An auth.users row without a row here is not a Rainbow account and is treated as a guest by every Rainbow function (see rainbow_uid). Written only by ensure_account(), which copies global_user_id from the caller's custom:platform identity; global_user_id is the WorkOS user id, unique here, and never a key for gameplay rows.

RLS: enabled. Grants: service_role=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE

| Column | Type | Null | Default |
|---|---|---|---|
| `user_id` | uuid | not null |  |
| `global_user_id` | text | not null |  |
| `created_at` | timestamp with time zone | not null | `now()` |
| `last_seen_at` | timestamp with time zone | not null | `now()` |

Constraints:

- `accounts_global_user_id_format` CHECK ((global_user_id ~ '^user_[0-9A-Za-z]{10,64}$'::text))
- `accounts_global_user_id_key` UNIQUE (global_user_id)
- `accounts_pkey` PRIMARY KEY (user_id)
- `accounts_user_id_fkey` FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE

Indexes:

- `CREATE UNIQUE INDEX accounts_global_user_id_key ON public.accounts USING btree (global_user_id)`
- `CREATE UNIQUE INDEX accounts_pkey ON public.accounts USING btree (user_id)`

### `archive_access`

RLS: enabled. Grants: anon=DELETE/INSERT/SELECT/UPDATE, authenticated=DELETE/INSERT/SELECT/UPDATE, service_role=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | `gen_random_uuid()` |
| `user_id` | uuid | not null |  |
| `granted_by` | uuid | null |  |
| `granted_at` | timestamp with time zone | not null | `now()` |

Constraints:

- `archive_access_granted_by_fkey` FOREIGN KEY (granted_by) REFERENCES auth.users(id) ON DELETE SET NULL
- `archive_access_pkey` PRIMARY KEY (id)
- `archive_access_user_id_fkey` FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
- `archive_access_user_id_key` UNIQUE (user_id)

Indexes:

- `CREATE UNIQUE INDEX archive_access_pkey ON public.archive_access USING btree (id)`
- `CREATE UNIQUE INDEX archive_access_user_id_key ON public.archive_access USING btree (user_id)`

Policies:

- `Admins can manage archive access` — ALL to authenticated; using `has_role(rainbow_uid(), 'admin'::app_role)`
- `Users can check own archive access` — SELECT to authenticated; using `(rainbow_uid() = user_id)`

### `beta_feedback`

> Beta playtest feedback forms. No account required to submit -- validated and inserted only through submit_beta_feedback(). Read only by admins.

RLS: enabled. Grants: authenticated=SELECT, service_role=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | `gen_random_uuid()` |
| `puzzle_id` | uuid | not null |  |
| `puzzle_version_id` | uuid | not null |  |
| `playtest_id` | uuid | null |  |
| `tester_name` | text | null |  |
| `fun_rating` | smallint | not null |  |
| `difficulty_rating` | smallint | not null |  |
| `rainbow_fairness_rating` | smallint | null |  |
| `confusing_or_incorrect` | text | null |  |
| `additional_comments` | text | null |  |
| `would_play_again` | boolean | not null |  |
| `created_at` | timestamp with time zone | not null | `now()` |

Constraints:

- `beta_feedback_difficulty_rating_check` CHECK (((difficulty_rating >= 1) AND (difficulty_rating <= 5)))
- `beta_feedback_fun_rating_check` CHECK (((fun_rating >= 1) AND (fun_rating <= 5)))
- `beta_feedback_pkey` PRIMARY KEY (id)
- `beta_feedback_playtest_id_fkey` FOREIGN KEY (playtest_id) REFERENCES beta_playtests(id) ON DELETE SET NULL
- `beta_feedback_puzzle_id_fkey` FOREIGN KEY (puzzle_id) REFERENCES puzzles(id) ON DELETE CASCADE
- `beta_feedback_puzzle_version_id_fkey` FOREIGN KEY (puzzle_version_id) REFERENCES puzzle_versions(id) ON DELETE CASCADE
- `beta_feedback_rainbow_fairness_rating_check` CHECK (((rainbow_fairness_rating >= 1) AND (rainbow_fairness_rating <= 5)))

Indexes:

- `CREATE UNIQUE INDEX beta_feedback_pkey ON public.beta_feedback USING btree (id)`
- `CREATE INDEX beta_feedback_puzzle_id_idx ON public.beta_feedback USING btree (puzzle_id)`

Policies:

- `Admins can read beta feedback` — SELECT to public; using `has_role(rainbow_uid(), 'admin'::app_role)`

### `beta_playtests`

> Lightweight Beta-only playtest tracking. Never contributes to game_sessions/game_results/user_streaks/puzzle_aggregates. Written only through start_beta_playtest/complete_beta_playtest/reset_beta_playtest; read only by admins.

RLS: enabled. Grants: authenticated=SELECT, service_role=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | `gen_random_uuid()` |
| `puzzle_id` | uuid | not null |  |
| `puzzle_version_id` | uuid | not null |  |
| `device_id` | text | not null |  |
| `status` | text | not null | `'in_progress'::text` |
| `won` | boolean | null |  |
| `mistakes` | integer | not null | `0` |
| `hints_used` | boolean | not null | `false` |
| `is_reset` | boolean | not null | `false` |
| `started_at` | timestamp with time zone | not null | `now()` |
| `completed_at` | timestamp with time zone | null |  |
| `updated_at` | timestamp with time zone | not null | `now()` |

Constraints:

- `beta_playtests_device_id_fkey` FOREIGN KEY (device_id) REFERENCES device_identities(device_id)
- `beta_playtests_pkey` PRIMARY KEY (id)
- `beta_playtests_puzzle_id_fkey` FOREIGN KEY (puzzle_id) REFERENCES puzzles(id) ON DELETE CASCADE
- `beta_playtests_puzzle_version_id_fkey` FOREIGN KEY (puzzle_version_id) REFERENCES puzzle_versions(id) ON DELETE CASCADE
- `beta_playtests_status_check` CHECK ((status = ANY (ARRAY['in_progress'::text, 'completed'::text, 'abandoned'::text])))

Indexes:

- `CREATE INDEX beta_playtests_device_puzzle_idx ON public.beta_playtests USING btree (puzzle_id, device_id, started_at DESC)`
- `CREATE UNIQUE INDEX beta_playtests_pkey ON public.beta_playtests USING btree (id)`
- `CREATE INDEX beta_playtests_puzzle_id_idx ON public.beta_playtests USING btree (puzzle_id)`

Policies:

- `Admins can read beta playtests` — SELECT to public; using `has_role(rainbow_uid(), 'admin'::app_role)`

### `creator_profiles`

> Public creator identity for signed-in custom-puzzle authors: slug + the display name they already published. Created lazily by create_custom_puzzle. Read only through get_creator_profile.

RLS: enabled. Grants: service_role=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE

| Column | Type | Null | Default |
|---|---|---|---|
| `user_id` | uuid | not null |  |
| `public_slug` | text | not null |  |
| `display_name` | text | not null |  |
| `created_at` | timestamp with time zone | not null | `now()` |

Constraints:

- `creator_profiles_pkey` PRIMARY KEY (user_id)
- `creator_profiles_public_slug_check` CHECK (((public_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text) AND ((length(public_slug) >= 3) AND (length(public_slug) <= 48))))
- `creator_profiles_public_slug_key` UNIQUE (public_slug)
- `creator_profiles_user_id_fkey` FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE

Indexes:

- `CREATE UNIQUE INDEX creator_profiles_pkey ON public.creator_profiles USING btree (user_id)`
- `CREATE UNIQUE INDEX creator_profiles_public_slug_key ON public.creator_profiles USING btree (public_slug)`

### `custom_puzzle_favorites`

> One row per (account, custom puzzle). No email or profile data. Written only by set_custom_puzzle_favorite (auth.uid() only); read only in aggregate or as the caller's own list.

RLS: enabled. Grants: service_role=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE

| Column | Type | Null | Default |
|---|---|---|---|
| `custom_puzzle_id` | uuid | not null |  |
| `user_id` | uuid | not null |  |
| `created_at` | timestamp with time zone | not null | `now()` |

Constraints:

- `custom_puzzle_favorites_custom_puzzle_id_fkey` FOREIGN KEY (custom_puzzle_id) REFERENCES custom_puzzles(id) ON DELETE CASCADE
- `custom_puzzle_favorites_pkey` PRIMARY KEY (custom_puzzle_id, user_id)
- `custom_puzzle_favorites_user_id_fkey` FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE

Indexes:

- `CREATE UNIQUE INDEX custom_puzzle_favorites_pkey ON public.custom_puzzle_favorites USING btree (custom_puzzle_id, user_id)`
- `CREATE INDEX custom_puzzle_favorites_user_idx ON public.custom_puzzle_favorites USING btree (user_id, created_at DESC)`

### `custom_puzzle_results`

> One row per (custom_puzzle, device) that finished a game. No guess/hint/tile-selection detail, no player-identifying data beyond the existing verified device id. Written only by submit_custom_puzzle_result; read only in aggregate, by get_custom_puzzle_stats.

RLS: enabled. Grants: service_role=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | `gen_random_uuid()` |
| `custom_puzzle_id` | uuid | not null |  |
| `device_id` | text | not null |  |
| `won` | boolean | not null |  |
| `total_guesses` | smallint | not null |  |
| `completed_at` | timestamp with time zone | not null | `now()` |
| `recent_run_ids` | uuid[] | not null | `'{}'::uuid[]` |

Constraints:

- `custom_puzzle_results_custom_puzzle_id_device_id_key` UNIQUE (custom_puzzle_id, device_id)
- `custom_puzzle_results_custom_puzzle_id_fkey` FOREIGN KEY (custom_puzzle_id) REFERENCES custom_puzzles(id) ON DELETE CASCADE
- `custom_puzzle_results_device_id_fkey` FOREIGN KEY (device_id) REFERENCES device_identities(device_id)
- `custom_puzzle_results_pkey` PRIMARY KEY (id)
- `custom_puzzle_results_total_guesses_check` CHECK (((total_guesses >= 0) AND (total_guesses <= 60)))

Indexes:

- `CREATE UNIQUE INDEX custom_puzzle_results_custom_puzzle_id_device_id_key ON public.custom_puzzle_results USING btree (custom_puzzle_id, device_id)`
- `CREATE UNIQUE INDEX custom_puzzle_results_pkey ON public.custom_puzzle_results USING btree (id)`
- `CREATE INDEX custom_puzzle_results_puzzle_idx ON public.custom_puzzle_results USING btree (custom_puzzle_id)`

### `custom_puzzle_stats`

> One fixed-size aggregate row per custom puzzle (wins, losses, five guess buckets). Written only by submit_custom_puzzle_result; read only by get_custom_puzzle_stats and get_creator_profile.

RLS: enabled. Grants: service_role=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE

| Column | Type | Null | Default |
|---|---|---|---|
| `custom_puzzle_id` | uuid | not null |  |
| `wins` | integer | not null | `0` |
| `losses` | integer | not null | `0` |
| `guesses_4` | integer | not null | `0` |
| `guesses_5` | integer | not null | `0` |
| `guesses_6` | integer | not null | `0` |
| `guesses_7` | integer | not null | `0` |
| `guesses_8_plus` | integer | not null | `0` |
| `win_guess_total` | bigint | not null | `0` |
| `updated_at` | timestamp with time zone | not null | `now()` |

Constraints:

- `custom_puzzle_stats_custom_puzzle_id_fkey` FOREIGN KEY (custom_puzzle_id) REFERENCES custom_puzzles(id) ON DELETE CASCADE
- `custom_puzzle_stats_guesses_4_check` CHECK ((guesses_4 >= 0))
- `custom_puzzle_stats_guesses_5_check` CHECK ((guesses_5 >= 0))
- `custom_puzzle_stats_guesses_6_check` CHECK ((guesses_6 >= 0))
- `custom_puzzle_stats_guesses_7_check` CHECK ((guesses_7 >= 0))
- `custom_puzzle_stats_guesses_8_plus_check` CHECK ((guesses_8_plus >= 0))
- `custom_puzzle_stats_losses_check` CHECK ((losses >= 0))
- `custom_puzzle_stats_pkey` PRIMARY KEY (custom_puzzle_id)
- `custom_puzzle_stats_win_guess_total_check` CHECK ((win_guess_total >= 0))
- `custom_puzzle_stats_wins_check` CHECK ((wins >= 0))

Indexes:

- `CREATE UNIQUE INDEX custom_puzzle_stats_pkey ON public.custom_puzzle_stats USING btree (custom_puzzle_id)`

### `custom_puzzles`

> Player-created puzzles (Phase 2, Full 4x4 only). Immutable after creation. Reachable only through create_custom_puzzle/get_custom_puzzle -- no direct grants to anon/authenticated.

RLS: enabled. Grants: service_role=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | `gen_random_uuid()` |
| `share_id` | text | not null |  |
| `visibility` | text | not null |  |
| `created_by` | uuid | null |  |
| `creator_name` | text | not null |  |
| `title` | text | not null |  |
| `moderation_status` | text | not null | `'active'::text` |
| `content` | jsonb | not null |  |
| `created_at` | timestamp with time zone | not null | `now()` |
| `short_code` | text | not null |  |

Constraints:

- `custom_puzzles_created_by_fkey` FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL
- `custom_puzzles_moderation_status_check` CHECK ((moderation_status = ANY (ARRAY['active'::text, 'hidden'::text])))
- `custom_puzzles_pkey` PRIMARY KEY (id)
- `custom_puzzles_share_id_key` UNIQUE (share_id)
- `custom_puzzles_short_code_format` CHECK ((short_code ~ '^[2-9A-HJKMNP-Za-hjkmnp-z]{8,12}$'::text))
- `custom_puzzles_visibility_check` CHECK ((visibility = ANY (ARRAY['public'::text, 'private'::text])))

Indexes:

- `CREATE INDEX custom_puzzles_created_by_idx ON public.custom_puzzles USING btree (created_by) WHERE (created_by IS NOT NULL)`
- `CREATE UNIQUE INDEX custom_puzzles_pkey ON public.custom_puzzles USING btree (id)`
- `CREATE INDEX custom_puzzles_public_by_creator_idx ON public.custom_puzzles USING btree (created_by, created_at DESC) WHERE ((visibility = 'public'::text) AND (moderation_status = 'active'::text) AND (created_by IS NOT NULL))`
- `CREATE INDEX custom_puzzles_share_id_idx ON public.custom_puzzles USING btree (share_id)`
- `CREATE UNIQUE INDEX custom_puzzles_share_id_key ON public.custom_puzzles USING btree (share_id)`
- `CREATE UNIQUE INDEX custom_puzzles_short_code_key ON public.custom_puzzles USING btree (short_code)`

Policies:

- `Admins can read custom puzzles` — SELECT to public; using `has_role(rainbow_uid(), 'admin'::app_role)`

### `cv_puzzles`

RLS: enabled. Grants: anon=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE, authenticated=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE, service_role=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | not null |  |
| `created_at` | timestamp with time zone | not null | `now()` |
| `date` | text | null |  |
| `title` | text | null |  |
| `author` | text | null |  |
| `difficulty` | text | null |  |
| `status` | text | null |  |
| `clues` | jsonb | null |  |
| `cards` | jsonb | null |  |
| `solution` | jsonb | null |  |

Constraints:

- `cv_puzzles_pkey` PRIMARY KEY (id)

Indexes:

- `CREATE UNIQUE INDEX cv_puzzles_pkey ON public.cv_puzzles USING btree (id)`

Policies:

- `Anyone can read published cv puzzles` — SELECT to public; using `(status = 'published'::text)`

### `cv_wordbank`

RLS: enabled. Grants: anon=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE, authenticated=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE, service_role=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | not null |  |
| `word` | text | not null |  |

Constraints:

- `cv_wordbank_pkey` PRIMARY KEY (id)
- `cv_wordbank_word_key` UNIQUE (word)

Indexes:

- `CREATE UNIQUE INDEX cv_wordbank_pkey ON public.cv_wordbank USING btree (id)`
- `CREATE UNIQUE INDEX cv_wordbank_word_key ON public.cv_wordbank USING btree (word)`

Policies:

- `Anyone can read cv wordbank` — SELECT to public; using `true`

### `device_identities`

> One row per anonymous browser identity. token_hash is sha256 of a token returned exactly once at creation and never stored in the clear. retired_at is permanent: a retired identity can never be verified, claimed or resumed, but its gameplay rows are never touched. Since the launch baseline it also records the one-time import decision: retired_reason imported|started_fresh, claimed_by the account that decided, decided_at when.

RLS: enabled. Grants: service_role=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE

| Column | Type | Null | Default |
|---|---|---|---|
| `device_id` | text | not null |  |
| `token_hash` | text | not null |  |
| `created_at` | timestamp with time zone | not null | `now()` |
| `retired_at` | timestamp with time zone | null |  |
| `retired_reason` | text | null |  |
| `claimed_by` | uuid | null |  |
| `decided_at` | timestamp with time zone | null |  |

Constraints:

- `device_identities_claimed_by_fkey` FOREIGN KEY (claimed_by) REFERENCES auth.users(id) ON DELETE SET NULL
- `device_identities_pkey` PRIMARY KEY (device_id)
- `device_identities_retired_pair_check` CHECK (((retired_at IS NULL) = (retired_reason IS NULL)))
- `device_identities_retired_reason_check` CHECK (((retired_reason IS NULL) OR (retired_reason = ANY (ARRAY['imported'::text, 'started_fresh'::text]))))

Indexes:

- `CREATE INDEX device_identities_claimed_by_idx ON public.device_identities USING btree (claimed_by) WHERE (claimed_by IS NOT NULL)`
- `CREATE UNIQUE INDEX device_identities_pkey ON public.device_identities USING btree (device_id)`

### `feedback`

RLS: enabled. Grants: anon=DELETE/INSERT/SELECT/UPDATE, authenticated=DELETE/INSERT/SELECT/UPDATE, service_role=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | `gen_random_uuid()` |
| `created_at` | timestamp with time zone | null | `now()` |
| `type` | text | not null |  |
| `message` | text | not null |  |
| `email` | text | null |  |
| `user_id` | uuid | null |  |

Constraints:

- `feedback_pkey` PRIMARY KEY (id)
- `feedback_user_id_fkey` FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL

Indexes:

- `CREATE UNIQUE INDEX feedback_pkey ON public.feedback USING btree (id)`

Policies:

- `Admins can read feedback` — SELECT to authenticated; using `has_role(rainbow_uid(), 'admin'::app_role)`

### `game_sessions`

RLS: enabled. Grants: anon=SELECT, authenticated=SELECT, service_role=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | `gen_random_uuid()` |
| `puzzle_id` | text | not null |  |
| `user_id` | uuid | null |  |
| `device_id` | text | null |  |
| `won` | boolean | null |  |
| `mistakes` | integer | not null |  |
| `active_time_seconds` | integer | null |  |
| `found_rainbow` | boolean | null | `false` |
| `solve_order` | jsonb | null |  |
| `completed_at` | timestamp with time zone | null |  |
| `hints_used` | boolean | null | `false` |
| `share_grid` | text | null |  |
| `rainbow_solve_index` | smallint | null |  |
| `status` | text | not null | `'in_progress'::text` |
| `is_official` | boolean | not null | `false` |
| `entry_context` | text | null |  |
| `started_at` | timestamp with time zone | null | `now()` |
| `last_activity_at` | timestamp with time zone | null | `now()` |
| `bonus_rainbow_attempted` | boolean | not null | `false` |
| `rainbow_source` | text | null |  |
| `puzzle_version_id` | uuid | null |  |
| `format` | text | not null | `'full'::text` |

Constraints:

- `game_sessions_device_id_fkey` FOREIGN KEY (device_id) REFERENCES device_identities(device_id)
- `game_sessions_format_check` CHECK ((format = ANY (ARRAY['full'::text, 'mini'::text])))
- `game_sessions_pkey` PRIMARY KEY (id)
- `game_sessions_rainbow_source_check` CHECK (((rainbow_source IS NULL) OR (rainbow_source = ANY (ARRAY['in_game'::text, 'post_game'::text]))))
- `game_sessions_status_check` CHECK ((status = ANY (ARRAY['in_progress'::text, 'won'::text, 'lost'::text])))
- `game_sessions_status_completed_at_check` CHECK (((status = 'in_progress'::text) = (completed_at IS NULL)))
- `game_sessions_status_won_check` CHECK ((((status = 'in_progress'::text) AND (won IS NULL)) OR ((status = 'won'::text) AND (won IS TRUE)) OR ((status = 'lost'::text) AND (won IS FALSE))))
- `game_sessions_user_id_fkey` FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL

Indexes:

- `CREATE INDEX game_sessions_format_device_idx ON public.game_sessions USING btree (format, device_id) WHERE (device_id IS NOT NULL)`
- `CREATE INDEX game_sessions_format_user_idx ON public.game_sessions USING btree (format, user_id) WHERE (user_id IS NOT NULL)`
- `CREATE INDEX game_sessions_in_progress_activity_idx ON public.game_sessions USING btree (last_activity_at) WHERE (status = 'in_progress'::text)`
- `CREATE UNIQUE INDEX game_sessions_one_official_per_device ON public.game_sessions USING btree (puzzle_id, device_id) WHERE (is_official AND (user_id IS NULL) AND (device_id IS NOT NULL) AND (device_id <> 'unknown'::text))`
- `CREATE UNIQUE INDEX game_sessions_one_official_per_user ON public.game_sessions USING btree (puzzle_id, user_id) WHERE (is_official AND (user_id IS NOT NULL))`
- `CREATE UNIQUE INDEX game_sessions_pkey ON public.game_sessions USING btree (id)`
- `CREATE INDEX game_sessions_puzzle_device_idx ON public.game_sessions USING btree (puzzle_id, device_id)`
- `CREATE INDEX game_sessions_puzzle_user_idx ON public.game_sessions USING btree (puzzle_id, user_id)`
- `CREATE INDEX game_sessions_puzzle_version_idx ON public.game_sessions USING btree (puzzle_version_id) WHERE (puzzle_version_id IS NOT NULL)`

Triggers:

- `CREATE TRIGGER game_sessions_sync_status_trigger BEFORE INSERT OR UPDATE ON public.game_sessions FOR EACH ROW EXECUTE FUNCTION game_sessions_sync_status()`

Policies:

- `Admins can read all game sessions` — SELECT to authenticated; using `has_role(rainbow_uid(), 'admin'::app_role)`
- `Users can read own game sessions` — SELECT to authenticated; using `(user_id = rainbow_uid())`

### `guess_events`

RLS: enabled. Grants: anon=SELECT, authenticated=SELECT, service_role=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | `gen_random_uuid()` |
| `game_session_id` | uuid | not null |  |
| `guess_number` | integer | not null |  |
| `words` | jsonb | not null |  |
| `correct` | boolean | not null |  |
| `group_name` | text | null |  |
| `guessed_at` | timestamp with time zone | null | `now()` |
| `is_rainbow_attempt` | boolean | null |  |
| `is_one_away` | boolean | null |  |
| `is_almost_rainbow` | boolean | null |  |
| `active_time_seconds` | integer | null |  |
| `groups_solved` | smallint | null |  |
| `attempt_type` | text | null |  |
| `server_numbered` | boolean | null |  |

Constraints:

- `guess_events_attempt_type_check` CHECK (((attempt_type IS NULL) OR (attempt_type = ANY (ARRAY['normal'::text, 'bonus_rainbow'::text]))))
- `guess_events_pkey` PRIMARY KEY (id)

Indexes:

- `CREATE INDEX guess_events_bonus_rainbow_idx ON public.guess_events USING btree (game_session_id) WHERE (attempt_type = 'bonus_rainbow'::text)`
- `CREATE UNIQUE INDEX guess_events_pkey ON public.guess_events USING btree (id)`
- `CREATE UNIQUE INDEX guess_events_session_guess_number_key ON public.guess_events USING btree (game_session_id, guess_number)`

Policies:

- `Admins can read all guess events` — SELECT to authenticated; using `has_role(rainbow_uid(), 'admin'::app_role)`
- `Users can read own guess events` — SELECT to authenticated; using `(EXISTS ( SELECT 1
   FROM game_sessions gs
  WHERE ((gs.id = guess_events.game_session_id) AND (gs.user_id = rainbow_uid()))))`

### `hint_events`

> One row per hint ACTUALLY REVEALED. Opening the hint modal or viewing options is deliberately not recorded. Idempotent on (game_session_id, hint_type).

RLS: enabled. Grants: anon=SELECT, authenticated=SELECT, service_role=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | `gen_random_uuid()` |
| `game_session_id` | uuid | not null |  |
| `hint_type` | text | not null |  |
| `revealed_at` | timestamp with time zone | not null | `now()` |
| `active_time_seconds` | integer | null |  |
| `guess_count` | smallint | null |  |
| `mistakes` | smallint | null |  |
| `groups_solved` | smallint | null |  |
| `rainbow_found` | boolean | null |  |

Constraints:

- `hint_events_game_session_id_fkey` FOREIGN KEY (game_session_id) REFERENCES game_sessions(id) ON DELETE CASCADE
- `hint_events_hint_type_check` CHECK ((hint_type = ANY (ARRAY['small'::text, 'full'::text])))
- `hint_events_one_per_type` UNIQUE (game_session_id, hint_type)
- `hint_events_pkey` PRIMARY KEY (id)

Indexes:

- `CREATE UNIQUE INDEX hint_events_one_per_type ON public.hint_events USING btree (game_session_id, hint_type)`
- `CREATE UNIQUE INDEX hint_events_pkey ON public.hint_events USING btree (id)`
- `CREATE INDEX hint_events_session_idx ON public.hint_events USING btree (game_session_id)`

Policies:

- `Admins can read all hint events` — SELECT to authenticated; using `has_role(rainbow_uid(), 'admin'::app_role)`
- `Users can read own hint events` — SELECT to authenticated; using `(EXISTS ( SELECT 1
   FROM game_sessions gs
  WHERE ((gs.id = hint_events.game_session_id) AND (gs.user_id = rainbow_uid()))))`

### `luck_score_ceilings`

> Lucky Bot Luck Score ceiling ("1 in N" that scores 100). A puzzle uses the row with the latest effective_from on or before its own date, so adding a row later never changes an older puzzle's score. Add rows; do not edit old ones.

RLS: enabled. Grants: service_role=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE

| Column | Type | Null | Default |
|---|---|---|---|
| `effective_from` | date | not null |  |
| `ceiling` | integer | not null |  |
| `note` | text | null |  |
| `created_at` | timestamp with time zone | not null | `now()` |

Constraints:

- `luck_score_ceilings_ceiling_check` CHECK ((ceiling >= 2))
- `luck_score_ceilings_pkey` PRIMARY KEY (effective_from)

Indexes:

- `CREATE UNIQUE INDEX luck_score_ceilings_pkey ON public.luck_score_ceilings USING btree (effective_from)`

### `puzzle_aggregates`

RLS: enabled. Grants: anon=DELETE/INSERT/SELECT/UPDATE, authenticated=DELETE/INSERT/SELECT/UPDATE, service_role=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE

| Column | Type | Null | Default |
|---|---|---|---|
| `puzzle_id` | text | not null |  |
| `total_plays` | integer | null | `0` |
| `total_wins` | integer | null | `0` |
| `avg_mistakes` | numeric | null | `0` |
| `avg_time_seconds` | numeric | null | `0` |
| `most_common_first_solve` | text | null |  |
| `updated_at` | timestamp with time zone | null | `now()` |

Constraints:

- `puzzle_aggregates_pkey` PRIMARY KEY (puzzle_id)

Indexes:

- `CREATE UNIQUE INDEX puzzle_aggregates_pkey ON public.puzzle_aggregates USING btree (puzzle_id)`

Policies:

- `Anyone can read puzzle aggregates` — SELECT to public; using `true`

### `puzzle_groups`

RLS: enabled. Grants: anon=DELETE/INSERT/SELECT/UPDATE, authenticated=DELETE/INSERT/SELECT/UPDATE, service_role=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | `gen_random_uuid()` |
| `puzzle_id` | uuid | not null |  |
| `category` | text | not null |  |
| `words` | text[] | not null |  |
| `difficulty` | integer | not null |  |
| `sort_order` | integer | not null | `0` |
| `hint_word` | text | null |  |
| `category_emoji` | text | null |  |
| `category_emoji_hint_only` | boolean | not null | `false` |

Constraints:

- `puzzle_groups_difficulty_check` CHECK (((difficulty >= 1) AND (difficulty <= 4)))
- `puzzle_groups_pkey` PRIMARY KEY (id)
- `puzzle_groups_puzzle_id_fkey` FOREIGN KEY (puzzle_id) REFERENCES puzzles(id) ON DELETE CASCADE

Indexes:

- `CREATE UNIQUE INDEX puzzle_groups_pkey ON public.puzzle_groups USING btree (id)`

Policies:

- `Admins can manage puzzle groups` — ALL to public; using `has_role(rainbow_uid(), 'admin'::app_role)`
- `Anyone can read published or beta puzzle groups` — SELECT to public; using `(EXISTS ( SELECT 1
   FROM puzzles
  WHERE ((puzzles.id = puzzle_groups.puzzle_id) AND ((puzzles.is_published = true) OR (puzzles.is_beta = true)))))`

### `puzzle_ratings`

RLS: enabled. Grants: anon=DELETE/INSERT/SELECT/UPDATE, authenticated=DELETE/INSERT/SELECT/UPDATE, service_role=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | `gen_random_uuid()` |
| `puzzle_id` | text | not null |  |
| `user_id` | uuid | not null |  |
| `rating` | integer | not null |  |
| `created_at` | timestamp with time zone | null | `now()` |

Constraints:

- `puzzle_ratings_pkey` PRIMARY KEY (id)
- `puzzle_ratings_user_id_fkey` FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE

Indexes:

- `CREATE UNIQUE INDEX puzzle_ratings_pkey ON public.puzzle_ratings USING btree (id)`
- `CREATE UNIQUE INDEX puzzle_ratings_puzzle_user_key ON public.puzzle_ratings USING btree (puzzle_id, user_id)`

Policies:

- `Admins can read all ratings` — SELECT to authenticated; using `has_role(rainbow_uid(), 'admin'::app_role)`
- `Users can change own rating` — UPDATE to authenticated; using `(user_id = rainbow_uid())`; with check `(user_id = rainbow_uid())`
- `Users can rate as themselves` — INSERT to authenticated; with check `(user_id = rainbow_uid())`
- `Users can read own rating` — SELECT to authenticated; using `(user_id = rainbow_uid())`

### `puzzle_versions`

> Immutable gameplay-content snapshots of a puzzle. Never updated, never deleted except by cascade when the puzzle itself is deleted. A game_sessions row pins the exact snapshot that player is playing.

RLS: enabled. Grants: anon=SELECT, authenticated=SELECT, service_role=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | `gen_random_uuid()` |
| `puzzle_id` | uuid | not null |  |
| `version_number` | integer | not null |  |
| `content` | jsonb | not null |  |
| `created_at` | timestamp with time zone | not null | `now()` |
| `created_by` | uuid | null |  |

Constraints:

- `puzzle_versions_created_by_fkey` FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL
- `puzzle_versions_pkey` PRIMARY KEY (id)
- `puzzle_versions_puzzle_id_fkey` FOREIGN KEY (puzzle_id) REFERENCES puzzles(id) ON DELETE CASCADE
- `puzzle_versions_puzzle_id_version_number_key` UNIQUE (puzzle_id, version_number)
- `puzzle_versions_version_number_check` CHECK ((version_number >= 1))

Indexes:

- `CREATE UNIQUE INDEX puzzle_versions_pkey ON public.puzzle_versions USING btree (id)`
- `CREATE UNIQUE INDEX puzzle_versions_puzzle_id_version_number_key ON public.puzzle_versions USING btree (puzzle_id, version_number)`
- `CREATE INDEX puzzle_versions_puzzle_idx ON public.puzzle_versions USING btree (puzzle_id, version_number DESC)`

Triggers:

- `CREATE TRIGGER puzzle_versions_immutable BEFORE UPDATE ON public.puzzle_versions FOR EACH ROW EXECUTE FUNCTION puzzle_versions_block_update()`

Policies:

- `Admins can read all puzzle versions` — SELECT to authenticated; using `has_role(rainbow_uid(), 'admin'::app_role)`
- `Anyone can read published puzzle versions` — SELECT to public; using `(EXISTS ( SELECT 1
   FROM puzzles p
  WHERE ((p.id = puzzle_versions.puzzle_id) AND (p.is_published = true))))`

### `puzzles`

RLS: enabled. Grants: anon=SELECT, authenticated=DELETE/INSERT/SELECT/UPDATE, service_role=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | `gen_random_uuid()` |
| `date` | date | not null |  |
| `title` | text | null |  |
| `is_published` | boolean | not null | `false` |
| `created_by` | uuid | null |  |
| `created_at` | timestamp with time zone | not null | `now()` |
| `updated_at` | timestamp with time zone | not null | `now()` |
| `word_order` | text[] | null |  |
| `rainbow_herring` | text[] | null |  |
| `theme` | text | null |  |
| `emoji_puzzle_icon` | text | null |  |
| `rainbow_category_name` | text | null |  |
| `is_emoji_puzzle` | boolean | null | `false` |
| `is_free_puzzle` | boolean | null | `false` |
| `free_puzzle_order` | integer | null |  |
| `rainbow_hint_word` | text | null |  |
| `current_version_id` | uuid | null |  |
| `is_beta` | boolean | not null | `false` |
| `designer_name` | text | not null | `'Sam West'::text` |
| `alphabetize_completed` | boolean | not null | `true` |
| `rainbow_category_emoji` | text | null |  |
| `format` | text | not null | `'full'::text` |
| `rainbow_category_emoji_hint_only` | boolean | not null | `false` |

Constraints:

- `puzzles_created_by_fkey` FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL
- `puzzles_format_check` CHECK ((format = ANY (ARRAY['full'::text, 'mini'::text])))
- `puzzles_not_beta_and_published` CHECK ((NOT (is_published AND is_beta)))
- `puzzles_pkey` PRIMARY KEY (id)

Indexes:

- `CREATE UNIQUE INDEX puzzles_date_format_key ON public.puzzles USING btree (date, format)`
- `CREATE UNIQUE INDEX puzzles_pkey ON public.puzzles USING btree (id)`

Triggers:

- `CREATE TRIGGER puzzles_current_version_check BEFORE INSERT OR UPDATE OF current_version_id ON public.puzzles FOR EACH ROW EXECUTE FUNCTION puzzles_check_current_version()`
- `CREATE TRIGGER update_puzzles_updated_at BEFORE UPDATE ON public.puzzles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`

Policies:

- `Admins can manage puzzles` — ALL to public; using `has_role(rainbow_uid(), 'admin'::app_role)`
- `Anyone can read published or beta puzzles` — SELECT to public; using `((is_published = true) OR (is_beta = true))`

### `user_roles`

RLS: enabled. Grants: anon=DELETE/INSERT/SELECT/UPDATE, authenticated=DELETE/INSERT/SELECT/UPDATE, service_role=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | `gen_random_uuid()` |
| `user_id` | uuid | not null |  |
| `role` | app_role | not null |  |
| `created_at` | timestamp with time zone | not null | `now()` |

Constraints:

- `user_roles_pkey` PRIMARY KEY (id)
- `user_roles_user_id_fkey` FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
- `user_roles_user_id_role_key` UNIQUE (user_id, role)

Indexes:

- `CREATE UNIQUE INDEX user_roles_pkey ON public.user_roles USING btree (id)`
- `CREATE UNIQUE INDEX user_roles_user_id_role_key ON public.user_roles USING btree (user_id, role)`

Policies:

- `Admins can manage roles` — ALL to public; using `has_role(rainbow_uid(), 'admin'::app_role)`
- `Users can view own roles` — SELECT to public; using `(rainbow_uid() = user_id)`

### `user_streaks`

RLS: enabled. Grants: service_role=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | `gen_random_uuid()` |
| `user_id` | uuid | null |  |
| `device_id` | text | null |  |
| `current_streak` | integer | null | `0` |
| `longest_streak` | integer | null | `0` |
| `last_played_date` | date | null |  |
| `updated_at` | timestamp with time zone | null | `now()` |
| `format` | text | not null | `'full'::text` |

Constraints:

- `user_streaks_device_id_fkey` FOREIGN KEY (device_id) REFERENCES device_identities(device_id)
- `user_streaks_format_check` CHECK ((format = ANY (ARRAY['full'::text, 'mini'::text])))
- `user_streaks_pkey` PRIMARY KEY (id)
- `user_streaks_user_id_fkey` FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE

Indexes:

- `CREATE UNIQUE INDEX user_streaks_one_per_device_format ON public.user_streaks USING btree (device_id, format) WHERE ((user_id IS NULL) AND (device_id IS NOT NULL))`
- `CREATE UNIQUE INDEX user_streaks_one_per_user_format ON public.user_streaks USING btree (user_id, format) WHERE (user_id IS NOT NULL)`
- `CREATE UNIQUE INDEX user_streaks_pkey ON public.user_streaks USING btree (id)`

### `wtf_game_records`

RLS: enabled. Grants: anon=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE, authenticated=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE, service_role=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | bigint | not null |  |
| `player_id` | uuid | not null |  |
| `game_date` | text | not null |  |
| `theme_title` | text | null |  |
| `score` | integer | not null | `0` |
| `total_questions` | integer | not null | `0` |
| `answers` | jsonb | not null | `'[]'::jsonb` |
| `completed` | boolean | not null | `false` |
| `started_at` | timestamp with time zone | null | `now()` |
| `completed_at` | timestamp with time zone | null |  |

Constraints:

- `wtf_game_records_pkey` PRIMARY KEY (id)
- `wtf_game_records_player_id_fkey` FOREIGN KEY (player_id) REFERENCES wtf_players(id) ON DELETE CASCADE

Indexes:

- `CREATE UNIQUE INDEX wtf_game_records_pkey ON public.wtf_game_records USING btree (id)`

Policies:

- `Players can insert own wtf records` — INSERT to public; with check `(player_id = auth.uid())`
- `Players can read own wtf records` — SELECT to public; using `(player_id = auth.uid())`
- `Players can update own wtf records` — UPDATE to public; using `(player_id = auth.uid())`

### `wtf_games`

RLS: enabled. Grants: anon=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE, authenticated=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE, service_role=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | text | not null |  |
| `date` | text | not null |  |
| `theme_title` | text | not null |  |
| `category_a` | text | not null |  |
| `category_b` | text | not null |  |
| `category_a_color` | text | null |  |
| `category_b_color` | text | null |  |
| `category_a_image` | text | null |  |
| `category_b_image` | text | null |  |
| `header_image` | text | null |  |
| `status` | text | not null | `'draft'::text` |
| `questions` | jsonb | not null | `'[]'::jsonb` |
| `created_at` | timestamp with time zone | null | `now()` |
| `updated_at` | timestamp with time zone | null | `now()` |

Constraints:

- `wtf_games_pkey` PRIMARY KEY (id)

Indexes:

- `CREATE UNIQUE INDEX wtf_games_pkey ON public.wtf_games USING btree (id)`

Policies:

- `Anyone can read published wtf games` — SELECT to public; using `(status = 'published'::text)`

### `wtf_player_stats`

RLS: enabled. Grants: anon=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE, authenticated=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE, service_role=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE

| Column | Type | Null | Default |
|---|---|---|---|
| `player_id` | uuid | not null |  |
| `current_streak` | integer | not null | `0` |
| `longest_streak` | integer | not null | `0` |
| `last_played_date` | text | null |  |
| `total_played` | integer | not null | `0` |
| `total_correct` | integer | not null | `0` |
| `total_questions` | integer | not null | `0` |
| `best_combo` | integer | not null | `0` |
| `updated_at` | timestamp with time zone | null | `now()` |

Constraints:

- `wtf_player_stats_pkey` PRIMARY KEY (player_id)
- `wtf_player_stats_player_id_fkey` FOREIGN KEY (player_id) REFERENCES wtf_players(id) ON DELETE CASCADE

Indexes:

- `CREATE UNIQUE INDEX wtf_player_stats_pkey ON public.wtf_player_stats USING btree (player_id)`

Policies:

- `Players can insert own wtf stats` — INSERT to public; with check `(player_id = auth.uid())`
- `Players can read own wtf stats` — SELECT to public; using `(player_id = auth.uid())`
- `Players can update own wtf stats` — UPDATE to public; using `(player_id = auth.uid())`

### `wtf_players`

RLS: enabled. Grants: anon=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE, authenticated=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE, service_role=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null |  |
| `created_at` | timestamp with time zone | null | `now()` |
| `email` | text | null |  |
| `is_guest` | boolean | not null | `true` |
| `last_seen_at` | timestamp with time zone | not null | `now()` |

Constraints:

- `wtf_players_pkey` PRIMARY KEY (id)

Indexes:

- `CREATE UNIQUE INDEX wtf_players_pkey ON public.wtf_players USING btree (id)`

Policies:

- `Players can insert own wtf profile` — INSERT to public; with check `(id = auth.uid())`
- `Players can read own wtf profile` — SELECT to public; using `(id = auth.uid())`
- `Players can update own wtf profile` — UPDATE to public; using `(id = auth.uid())`

### `wtf_puzzle_stats`

RLS: enabled. Grants: anon=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE, authenticated=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE, service_role=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE

| Column | Type | Null | Default |
|---|---|---|---|
| `game_date` | date | not null |  |
| `total_finished` | integer | not null | `0` |
| `total_score` | integer | not null | `0` |
| `perfect_count` | integer | not null | `0` |
| `total_questions` | integer | not null | `0` |
| `question_correct_counts` | jsonb | not null | `'[]'::jsonb` |
| `question_answer_counts` | jsonb | not null | `'[]'::jsonb` |
| `score_histogram` | jsonb | not null | `'{}'::jsonb` |
| `updated_at` | timestamp with time zone | not null | `now()` |

Constraints:

- `wtf_puzzle_stats_pkey` PRIMARY KEY (game_date)

Indexes:

- `CREATE UNIQUE INDEX wtf_puzzle_stats_pkey ON public.wtf_puzzle_stats USING btree (game_date)`

Policies:

- `Anyone can read wtf puzzle stats` — SELECT to public; using `true`

### `xw_admins`

RLS: enabled. Grants: anon=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE, authenticated=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE, service_role=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE

| Column | Type | Null | Default |
|---|---|---|---|
| `user_id` | uuid | not null |  |
| `created_at` | timestamp with time zone | not null | `now()` |

Constraints:

- `xw_admins_pkey` PRIMARY KEY (user_id)
- `xw_admins_user_id_fkey` FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE

Indexes:

- `CREATE UNIQUE INDEX xw_admins_pkey ON public.xw_admins USING btree (user_id)`

Policies:

- `xw admins see themselves` — SELECT to public; using `(user_id = auth.uid())`

### `xw_joke_reactions`

RLS: enabled. Grants: service_role=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE

| Column | Type | Null | Default |
|---|---|---|---|
| `puzzle_id` | uuid | not null |  |
| `player_key` | uuid | not null |  |
| `reaction` | text | not null |  |
| `created_at` | timestamp with time zone | not null | `now()` |
| `updated_at` | timestamp with time zone | not null | `now()` |

Constraints:

- `xw_joke_reactions_pkey` PRIMARY KEY (puzzle_id, player_key)
- `xw_joke_reactions_puzzle_id_fkey` FOREIGN KEY (puzzle_id) REFERENCES xw_puzzles(id) ON DELETE CASCADE
- `xw_joke_reactions_reaction_check` CHECK ((reaction = ANY (ARRAY['haha'::text, 'boo'::text, 'what'::text, 'hehe'::text, 'speechless'::text])))

Indexes:

- `CREATE UNIQUE INDEX xw_joke_reactions_pkey ON public.xw_joke_reactions USING btree (puzzle_id, player_key)`

### `xw_puzzles`

RLS: enabled. Grants: anon=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE, authenticated=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE, service_role=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | `gen_random_uuid()` |
| `publish_date` | date | not null |  |
| `size` | text | not null |  |
| `title` | text | not null |  |
| `author` | text | not null | `''::text` |
| `width` | integer | not null |  |
| `height` | integer | not null |  |
| `data` | jsonb | not null |  |
| `created_at` | timestamp with time zone | not null | `now()` |
| `updated_at` | timestamp with time zone | not null | `now()` |

Constraints:

- `xw_puzzles_height_check` CHECK (((height >= 2) AND (height <= 40)))
- `xw_puzzles_pkey` PRIMARY KEY (id)
- `xw_puzzles_publish_date_size_key` UNIQUE (publish_date, size)
- `xw_puzzles_size_check` CHECK ((size = ANY (ARRAY['mini'::text, 'midi'::text, 'full'::text])))
- `xw_puzzles_width_check` CHECK (((width >= 2) AND (width <= 40)))

Indexes:

- `CREATE UNIQUE INDEX xw_puzzles_pkey ON public.xw_puzzles USING btree (id)`
- `CREATE INDEX xw_puzzles_publish_date_idx ON public.xw_puzzles USING btree (publish_date DESC)`
- `CREATE UNIQUE INDEX xw_puzzles_publish_date_size_key ON public.xw_puzzles USING btree (publish_date, size)`

Triggers:

- `CREATE TRIGGER xw_puzzles_touch_updated_at BEFORE UPDATE ON public.xw_puzzles FOR EACH ROW EXECUTE FUNCTION xw_touch_updated_at()`

Policies:

- `xw admins delete puzzles` — DELETE to public; using `xw_is_admin()`
- `xw admins insert puzzles` — INSERT to public; with check `xw_is_admin()`
- `xw admins update puzzles` — UPDATE to public; using `xw_is_admin()`; with check `xw_is_admin()`
- `xw anyone reads published puzzles` — SELECT to public; using `((publish_date <= xw_today_local()) OR xw_is_admin())`

### `xw_times`

RLS: enabled. Grants: anon=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE, authenticated=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE, service_role=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | `gen_random_uuid()` |
| `puzzle_id` | uuid | not null |  |
| `player_key` | uuid | not null |  |
| `name` | text | not null |  |
| `seconds` | integer | not null |  |
| `created_at` | timestamp with time zone | not null | `now()` |

Constraints:

- `xw_times_name_check` CHECK (((char_length(btrim(name)) >= 1) AND (char_length(btrim(name)) <= 24)))
- `xw_times_pkey` PRIMARY KEY (id)
- `xw_times_puzzle_id_fkey` FOREIGN KEY (puzzle_id) REFERENCES xw_puzzles(id) ON DELETE CASCADE
- `xw_times_puzzle_id_player_key_key` UNIQUE (puzzle_id, player_key)
- `xw_times_seconds_check` CHECK (((seconds >= 1) AND (seconds <= 86400)))

Indexes:

- `CREATE INDEX xw_times_board_idx ON public.xw_times USING btree (puzzle_id, seconds, created_at)`
- `CREATE UNIQUE INDEX xw_times_pkey ON public.xw_times USING btree (id)`
- `CREATE UNIQUE INDEX xw_times_puzzle_id_player_key_key ON public.xw_times USING btree (puzzle_id, player_key)`

Policies:

- `xw admins delete times` — DELETE to public; using `xw_is_admin()`
- `xw anyone posts a time` — INSERT to public; with check `(EXISTS ( SELECT 1
   FROM xw_puzzles p
  WHERE ((p.id = xw_times.puzzle_id) AND (p.publish_date <= xw_today_local()))))`
- `xw anyone reads times` — SELECT to public; using `true`

### `xw_votes`

RLS: enabled. Grants: service_role=DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE

| Column | Type | Null | Default |
|---|---|---|---|
| `puzzle_id` | uuid | not null |  |
| `player_key` | uuid | not null |  |
| `clue_key` | text | not null |  |
| `created_at` | timestamp with time zone | not null | `now()` |
| `updated_at` | timestamp with time zone | not null | `now()` |

Constraints:

- `xw_votes_clue_key_check` CHECK ((clue_key ~ '^[0-9]{1,3}[AD]$'::text))
- `xw_votes_pkey` PRIMARY KEY (puzzle_id, player_key)
- `xw_votes_puzzle_id_fkey` FOREIGN KEY (puzzle_id) REFERENCES xw_puzzles(id) ON DELETE CASCADE

Indexes:

- `CREATE UNIQUE INDEX xw_votes_pkey ON public.xw_votes USING btree (puzzle_id, player_key)`

## Functions

| Function | Returns | Definer | Volatility | Executable by |
|---|---|---|---|---|
| `account_email(_user_id uuid)` | text | yes | stable | service_role |
| `admin_find_account(_email text)` | TABLE(user_id uuid, email text) | yes | stable | authenticated, service_role |
| `admin_save_puzzle(_puzzle_id uuid, _metadata jsonb, _content jsonb)` | jsonb | yes | volatile | authenticated, service_role |
| `admin_set_custom_puzzle_status(_puzzle_id uuid, _status text)` | boolean | yes | volatile | authenticated, service_role |
| `complete_beta_playtest(_playtest_id uuid, _device_id text, _device_token text, _won boolean, _mistakes integer, _hints_used boolean)` | boolean | yes | volatile | anon, authenticated, service_role |
| `create_custom_puzzle(_creator_name text, _title text, _visibility text, _content jsonb)` | jsonb | yes | volatile | anon, authenticated, service_role |
| `create_device_identity()` | TABLE(device_id text, device_token text) | yes | volatile | anon, authenticated, service_role |
| `create_game_session(_puzzle_id text, _device_id text, _device_token text, _entry_context text, _active_time_seconds integer, _mistakes integer, _puzzle_version_id uuid)` | uuid | yes | volatile | anon, authenticated, service_role |
| `custom_creator_new_slug(_name text)` | text | no | volatile | service_role |
| `custom_ensure_creator_profile(_uid uuid, _name text)` | void | yes | volatile | service_role |
| `custom_puzzle_new_short_code()` | text | no | volatile | service_role |
| `custom_puzzle_public_json(_p custom_puzzles)` | jsonb | yes | stable | service_role |
| `custom_random_string(_alphabet text, _len integer)` | text | no | volatile | service_role |
| `decline_guest_history(_device_id text, _device_token text)` | TABLE(outcome text) | yes | volatile | authenticated, service_role |
| `delete_local_account(_user_id uuid)` | void | yes | volatile | service_role |
| `delete_my_account()` | boolean | yes | volatile | authenticated, service_role |
| `device_has_importable_history(_device_id text)` | boolean | yes | stable | service_role |
| `ensure_account()` | TABLE(outcome text, user_id uuid, global_user_id text, email text, created_at timestamp with time zone) | yes | volatile | authenticated, service_role |
| `finalize_game_session(_session_id uuid, _device_id text, _device_token text, _won boolean, _mistakes integer, _active_time_seconds integer, _found_rainbow boolean, _rainbow_solve_index smallint, _solve_order jsonb, _hints_used boolean, _share_grid text, _skip_streak boolean, _local_date text)` | boolean | yes | volatile | anon, authenticated, service_role |
| `game_sessions_sync_status()` | trigger | yes | volatile | anon, authenticated, service_role |
| `get_archive_puzzles()` | TABLE(id uuid, date date, title text) | yes | stable | anon, authenticated, service_role |
| `get_creator_profile(_slug text, _sort text)` | jsonb | yes | stable | anon, authenticated, service_role |
| `get_custom_puzzle(_share_id text)` | jsonb | yes | stable | anon, authenticated, service_role |
| `get_custom_puzzle_by_short_code(_short_code text)` | jsonb | yes | stable | anon, authenticated, service_role |
| `get_custom_puzzle_stats(_share_id text)` | jsonb | yes | stable | anon, authenticated, service_role |
| `get_luck_report(_puzzle_id uuid, _device_id text, _device_token text)` | json | yes | stable | anon, authenticated, service_role |
| `get_my_favorites()` | jsonb | yes | stable | authenticated, service_role |
| `get_own_completed_sessions(_device_id text, _device_token text, _format text)` | TABLE(puzzle_id text, won boolean, mistakes integer, found_rainbow boolean, solve_order jsonb, hints_used boolean, rainbow_solve_index smallint, rainbow_source text, bonus_rainbow_attempted boolean, status text) | yes | stable | anon, authenticated, service_role |
| `get_own_streak(_device_id text, _device_token text, _format text)` | TABLE(current_streak integer, longest_streak integer, last_played_date text) | yes | stable | anon, authenticated, service_role |
| `get_puzzle_report(_puzzle_id uuid)` | json | yes | stable | anon, authenticated, service_role |
| `get_puzzle_stats(_puzzle_id uuid)` | json | yes | stable | anon, authenticated, service_role |
| `get_streak_admin_summary()` | TABLE(accounts_with_streaks integer, max_current_streak integer, max_longest_streak integer) | yes | stable | authenticated, service_role |
| `has_archive_access(_user_id uuid)` | boolean | yes | stable | anon, authenticated, service_role |
| `has_official_result(_puzzle_id text, _device_id text, _device_token text)` | boolean | yes | stable | anon, authenticated, service_role |
| `has_role(_user_id uuid, _role app_role)` | boolean | yes | stable | anon, authenticated, service_role |
| `import_guest_history(_device_id text, _device_token text)` | TABLE(outcome text, sessions_claimed integer) | yes | volatile | authenticated, service_role |
| `luck_eligible_paths(_puzzle_id text)` | TABLE(session_id uuid, user_id uuid, device_id text, path jsonb) | yes | stable | service_role |
| `my_account()` | TABLE(user_id uuid, global_user_id text, email text, created_at timestamp with time zone) | yes | stable | authenticated, service_role |
| `ping()` | boolean | no | stable | anon, authenticated, service_role |
| `puzzle_versions_block_update()` | trigger | no | volatile | anon, authenticated, service_role |
| `puzzles_check_current_version()` | trigger | no | volatile | anon, authenticated, service_role |
| `rainbow_uid()` | uuid | yes | stable | anon, authenticated, service_role |
| `record_bonus_rainbow(_session_id uuid, _device_id text, _device_token text, _guess_number integer, _words jsonb, _correct boolean, _guessed_at timestamp with time zone, _active_time_seconds integer, _groups_solved smallint)` | boolean | yes | volatile | anon, authenticated, service_role |
| `record_guess_events(_session_id uuid, _device_id text, _device_token text, _events jsonb)` | integer | yes | volatile | anon, authenticated, service_role |
| `record_hint_event(_session_id uuid, _device_id text, _device_token text, _hint_type text, _revealed_at timestamp with time zone, _active_time_seconds integer, _guess_count smallint, _mistakes smallint, _groups_solved smallint, _rainbow_found boolean)` | boolean | yes | volatile | anon, authenticated, service_role |
| `record_streak(_user_id uuid, _device_id text, _won boolean, _local_date text, _format text)` | void | yes | volatile | service_role |
| `reset_beta_playtest(_puzzle_id uuid, _device_id text, _device_token text)` | boolean | yes | volatile | anon, authenticated, service_role |
| `resolve_device_import(_device_id text, _device_token text)` | TABLE(outcome text, games_played integer, current_streak integer, longest_streak integer) | yes | stable | authenticated, service_role |
| `rls_auto_enable()` | event_trigger | yes | volatile | anon, authenticated, service_role |
| `session_capability_ok(_session_id uuid, _device_id text, _device_token text)` | boolean | yes | stable | anon, authenticated, service_role |
| `set_custom_puzzle_favorite(_share_id text, _favorite boolean)` | jsonb | yes | volatile | authenticated, service_role |
| `skill_score(_won boolean, _mistakes integer, _solve_order jsonb, _found_rainbow boolean, _rainbow_source text, _format text)` | integer | no | immutable | anon, authenticated, service_role |
| `start_beta_playtest(_puzzle_id uuid, _puzzle_version_id uuid, _device_id text, _device_token text)` | uuid | yes | volatile | anon, authenticated, service_role |
| `submit_beta_feedback(_puzzle_id uuid, _puzzle_version_id uuid, _playtest_id uuid, _tester_name text, _fun_rating smallint, _difficulty_rating smallint, _rainbow_fairness_rating smallint, _confusing_or_incorrect text, _additional_comments text, _would_play_again boolean)` | uuid | yes | volatile | anon, authenticated, service_role |
| `submit_custom_puzzle_result(_share_id text, _device_id text, _device_token text, _won boolean, _total_guesses smallint, _run_id uuid)` | boolean | yes | volatile | anon, authenticated, service_role |
| `touch_game_session(_session_id uuid, _device_id text, _device_token text, _active_time_seconds integer, _mistakes integer)` | boolean | yes | volatile | anon, authenticated, service_role |
| `update_updated_at_column()` | trigger | no | volatile | anon, authenticated, service_role |
| `validate_custom_puzzle_content(_content jsonb)` | jsonb | no | immutable | anon, authenticated, service_role |
| `validate_puzzle_content(_content jsonb)` | jsonb | no | immutable | authenticated, service_role |
| `verify_device(_device_id text, _device_token text)` | boolean | yes | stable | service_role |
| `xw_app_timezone()` | text | no | immutable | anon, authenticated, service_role |
| `xw_cast_vote(p_puzzle uuid, p_player uuid, p_clue text)` | void | yes | volatile | anon, authenticated, service_role |
| `xw_is_admin()` | boolean | yes | stable | anon, authenticated, service_role |
| `xw_react(p_puzzle uuid, p_player uuid, p_reaction text)` | void | yes | volatile | anon, authenticated, service_role |
| `xw_reaction_counts(p_puzzle uuid)` | TABLE(reaction text, total integer) | yes | stable | anon, authenticated, service_role |
| `xw_today_local()` | date | no | stable | anon, authenticated, service_role |
| `xw_touch_updated_at()` | trigger | no | volatile | anon, authenticated, service_role |
| `xw_unreact(p_puzzle uuid, p_player uuid)` | void | yes | volatile | anon, authenticated, service_role |
| `xw_vote_counts(p_puzzle uuid)` | TABLE(clue_key text, votes integer) | yes | stable | anon, authenticated, service_role |

## Storage

- bucket `custom-emoji` (public)
- bucket `custom-emoji-backup-20260918` (private)
- policy `custom-emoji: admins can delete` on storage.objects — DELETE to authenticated; using `((bucket_id = 'custom-emoji'::text) AND has_role(rainbow_uid(), 'admin'::app_role))`
- policy `custom-emoji: admins can replace` on storage.objects — UPDATE to authenticated; using `((bucket_id = 'custom-emoji'::text) AND has_role(rainbow_uid(), 'admin'::app_role))`; with check `((bucket_id = 'custom-emoji'::text) AND has_role(rainbow_uid(), 'admin'::app_role))`
- policy `custom-emoji: admins can upload` on storage.objects — INSERT to authenticated; with check `((bucket_id = 'custom-emoji'::text) AND has_role(rainbow_uid(), 'admin'::app_role))`
- policy `custom-emoji: anyone can read` on storage.objects — SELECT to public; using `(bucket_id = 'custom-emoji'::text)`

## Extensions present on the database this was read from

Rainbow requires none beyond what every Supabase project ships with; listed for completeness.

- `pg_stat_statements` (extensions)
- `pgcrypto` (extensions)
- `plpgsql` (pg_catalog)
- `supabase_vault` (vault)
- `uuid-ossp` (extensions)
