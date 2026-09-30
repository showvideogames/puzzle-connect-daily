# Beta-era Rainbow schema (reference)

GENERATED once, on 2026-09-30, by applying the 32 beta-era migrations plus the four pre-git reconstruction files to a blank in-process Postgres. This is what Rainbow's objects looked like in the shared beta project before the launch baseline; the scoped teardown (`npm run db:teardown-sql`) and the Phase 2 change preview are derived from the difference between this and `supabase/rainbow-owned-objects.json`. Not regenerated: the beta-era chain is frozen.

## Summary

| Category | Count |
|---|---|
| Tables | 23 |
| Columns | 195 |
| Constraints | 203 |
| Indexes | 56 |
| Functions | 53 |
| Triggers | 4 |
| RLS policies | 27 |
| Enum types | 1 |
| Views | 0 |
| Sequences | 0 |
| Storage buckets | n/a (no storage on this backend) |

## Enum types

- `app_role`: `admin`, `moderator`

## Tables

### `account_onboarding`

> One row per account. status=pending means a genuinely new account with an unresolved import decision, and gameplay is refused until it resolves. Terminal states are never re-entered. Rows are created lazily by resolve_onboarding; every account existing at cutover was backfilled as legacy.

RLS: enabled. Grants: none for anon/authenticated/service_role

| Column | Type | Null | Default |
|---|---|---|---|
| `user_id` | uuid | not null |  |
| `status` | text | not null |  |
| `source_device_id` | text | null |  |
| `decided_at` | timestamp with time zone | null |  |
| `created_at` | timestamp with time zone | not null | `now()` |

Constraints:

- `account_onboarding_created_at_not_null` NOT NULL created_at
- `account_onboarding_pkey` PRIMARY KEY (user_id)
- `account_onboarding_status_check` CHECK ((status = ANY (ARRAY['pending'::text, 'no_guest_history'::text, 'imported'::text, 'started_fresh'::text, 'legacy'::text])))
- `account_onboarding_status_not_null` NOT NULL status
- `account_onboarding_user_id_fkey` FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
- `account_onboarding_user_id_not_null` NOT NULL user_id

Indexes:

- `CREATE UNIQUE INDEX account_onboarding_pkey ON public.account_onboarding USING btree (user_id)`

### `archive_access`

RLS: enabled. Grants: none for anon/authenticated/service_role

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | `gen_random_uuid()` |
| `user_id` | uuid | not null |  |
| `granted_by` | uuid | null |  |
| `granted_at` | timestamp with time zone | not null | `now()` |

Constraints:

- `archive_access_granted_at_not_null` NOT NULL granted_at
- `archive_access_granted_by_fkey` FOREIGN KEY (granted_by) REFERENCES auth.users(id) ON DELETE SET NULL
- `archive_access_id_not_null` NOT NULL id
- `archive_access_pkey` PRIMARY KEY (id)
- `archive_access_user_id_fkey` FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
- `archive_access_user_id_key` UNIQUE (user_id)
- `archive_access_user_id_not_null` NOT NULL user_id

Indexes:

- `CREATE UNIQUE INDEX archive_access_pkey ON public.archive_access USING btree (id)`
- `CREATE UNIQUE INDEX archive_access_user_id_key ON public.archive_access USING btree (user_id)`

Policies:

- `Admins can manage archive access` — ALL to authenticated; using `has_role(auth.uid(), 'admin'::app_role)`
- `Users can check own archive access` — SELECT to authenticated; using `(auth.uid() = user_id)`

### `beta_feedback`

> Beta playtest feedback forms. No account required to submit -- validated and inserted only through submit_beta_feedback(). Read only by admins.

RLS: enabled. Grants: authenticated=SELECT

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

- `beta_feedback_created_at_not_null` NOT NULL created_at
- `beta_feedback_difficulty_rating_check` CHECK (((difficulty_rating >= 1) AND (difficulty_rating <= 5)))
- `beta_feedback_difficulty_rating_not_null` NOT NULL difficulty_rating
- `beta_feedback_fun_rating_check` CHECK (((fun_rating >= 1) AND (fun_rating <= 5)))
- `beta_feedback_fun_rating_not_null` NOT NULL fun_rating
- `beta_feedback_id_not_null` NOT NULL id
- `beta_feedback_pkey` PRIMARY KEY (id)
- `beta_feedback_playtest_id_fkey` FOREIGN KEY (playtest_id) REFERENCES beta_playtests(id) ON DELETE SET NULL
- `beta_feedback_puzzle_id_fkey` FOREIGN KEY (puzzle_id) REFERENCES puzzles(id) ON DELETE CASCADE
- `beta_feedback_puzzle_id_not_null` NOT NULL puzzle_id
- `beta_feedback_puzzle_version_id_fkey` FOREIGN KEY (puzzle_version_id) REFERENCES puzzle_versions(id) ON DELETE CASCADE
- `beta_feedback_puzzle_version_id_not_null` NOT NULL puzzle_version_id
- `beta_feedback_rainbow_fairness_rating_check` CHECK (((rainbow_fairness_rating >= 1) AND (rainbow_fairness_rating <= 5)))
- `beta_feedback_would_play_again_not_null` NOT NULL would_play_again

Indexes:

- `CREATE UNIQUE INDEX beta_feedback_pkey ON public.beta_feedback USING btree (id)`
- `CREATE INDEX beta_feedback_puzzle_id_idx ON public.beta_feedback USING btree (puzzle_id)`

Policies:

- `Admins can read beta feedback` — SELECT to public; using `has_role(auth.uid(), 'admin'::app_role)`

### `beta_playtests`

> Lightweight Beta-only playtest tracking. Never contributes to game_sessions/game_results/user_streaks/puzzle_aggregates. Written only through start_beta_playtest/complete_beta_playtest/reset_beta_playtest; read only by admins.

RLS: enabled. Grants: authenticated=SELECT

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

- `beta_playtests_device_id_not_null` NOT NULL device_id
- `beta_playtests_hints_used_not_null` NOT NULL hints_used
- `beta_playtests_id_not_null` NOT NULL id
- `beta_playtests_is_reset_not_null` NOT NULL is_reset
- `beta_playtests_mistakes_not_null` NOT NULL mistakes
- `beta_playtests_pkey` PRIMARY KEY (id)
- `beta_playtests_puzzle_id_fkey` FOREIGN KEY (puzzle_id) REFERENCES puzzles(id) ON DELETE CASCADE
- `beta_playtests_puzzle_id_not_null` NOT NULL puzzle_id
- `beta_playtests_puzzle_version_id_fkey` FOREIGN KEY (puzzle_version_id) REFERENCES puzzle_versions(id) ON DELETE CASCADE
- `beta_playtests_puzzle_version_id_not_null` NOT NULL puzzle_version_id
- `beta_playtests_started_at_not_null` NOT NULL started_at
- `beta_playtests_status_check` CHECK ((status = ANY (ARRAY['in_progress'::text, 'completed'::text, 'abandoned'::text])))
- `beta_playtests_status_not_null` NOT NULL status
- `beta_playtests_updated_at_not_null` NOT NULL updated_at

Indexes:

- `CREATE INDEX beta_playtests_device_puzzle_idx ON public.beta_playtests USING btree (puzzle_id, device_id, started_at DESC)`
- `CREATE UNIQUE INDEX beta_playtests_pkey ON public.beta_playtests USING btree (id)`
- `CREATE INDEX beta_playtests_puzzle_id_idx ON public.beta_playtests USING btree (puzzle_id)`

Policies:

- `Admins can read beta playtests` — SELECT to public; using `has_role(auth.uid(), 'admin'::app_role)`

### `creator_profiles`

> Public creator identity for signed-in custom-puzzle authors: slug + the display name they already published. Created lazily by create_custom_puzzle. Read only through get_creator_profile.

RLS: enabled. Grants: none for anon/authenticated/service_role

| Column | Type | Null | Default |
|---|---|---|---|
| `user_id` | uuid | not null |  |
| `public_slug` | text | not null |  |
| `display_name` | text | not null |  |
| `created_at` | timestamp with time zone | not null | `now()` |

Constraints:

- `creator_profiles_created_at_not_null` NOT NULL created_at
- `creator_profiles_display_name_not_null` NOT NULL display_name
- `creator_profiles_pkey` PRIMARY KEY (user_id)
- `creator_profiles_public_slug_check` CHECK (((public_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text) AND ((length(public_slug) >= 3) AND (length(public_slug) <= 48))))
- `creator_profiles_public_slug_key` UNIQUE (public_slug)
- `creator_profiles_public_slug_not_null` NOT NULL public_slug
- `creator_profiles_user_id_fkey` FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
- `creator_profiles_user_id_not_null` NOT NULL user_id

Indexes:

- `CREATE UNIQUE INDEX creator_profiles_pkey ON public.creator_profiles USING btree (user_id)`
- `CREATE UNIQUE INDEX creator_profiles_public_slug_key ON public.creator_profiles USING btree (public_slug)`

### `custom_puzzle_favorites`

> One row per (account, custom puzzle). No email or profile data. Written only by set_custom_puzzle_favorite (auth.uid() only); read only in aggregate or as the caller's own list.

RLS: enabled. Grants: none for anon/authenticated/service_role

| Column | Type | Null | Default |
|---|---|---|---|
| `custom_puzzle_id` | uuid | not null |  |
| `user_id` | uuid | not null |  |
| `created_at` | timestamp with time zone | not null | `now()` |

Constraints:

- `custom_puzzle_favorites_created_at_not_null` NOT NULL created_at
- `custom_puzzle_favorites_custom_puzzle_id_fkey` FOREIGN KEY (custom_puzzle_id) REFERENCES custom_puzzles(id) ON DELETE CASCADE
- `custom_puzzle_favorites_custom_puzzle_id_not_null` NOT NULL custom_puzzle_id
- `custom_puzzle_favorites_pkey` PRIMARY KEY (custom_puzzle_id, user_id)
- `custom_puzzle_favorites_user_id_fkey` FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
- `custom_puzzle_favorites_user_id_not_null` NOT NULL user_id

Indexes:

- `CREATE UNIQUE INDEX custom_puzzle_favorites_pkey ON public.custom_puzzle_favorites USING btree (custom_puzzle_id, user_id)`
- `CREATE INDEX custom_puzzle_favorites_user_idx ON public.custom_puzzle_favorites USING btree (user_id, created_at DESC)`

### `custom_puzzle_results`

> One row per (custom_puzzle, device) that finished a game. No guess/hint/tile-selection detail, no player-identifying data beyond the existing verified device id. Written only by submit_custom_puzzle_result; read only in aggregate, by get_custom_puzzle_stats.

RLS: enabled. Grants: none for anon/authenticated/service_role

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

- `custom_puzzle_results_completed_at_not_null` NOT NULL completed_at
- `custom_puzzle_results_custom_puzzle_id_device_id_key` UNIQUE (custom_puzzle_id, device_id)
- `custom_puzzle_results_custom_puzzle_id_fkey` FOREIGN KEY (custom_puzzle_id) REFERENCES custom_puzzles(id) ON DELETE CASCADE
- `custom_puzzle_results_custom_puzzle_id_not_null` NOT NULL custom_puzzle_id
- `custom_puzzle_results_device_id_not_null` NOT NULL device_id
- `custom_puzzle_results_id_not_null` NOT NULL id
- `custom_puzzle_results_pkey` PRIMARY KEY (id)
- `custom_puzzle_results_recent_run_ids_not_null` NOT NULL recent_run_ids
- `custom_puzzle_results_total_guesses_check` CHECK (((total_guesses >= 0) AND (total_guesses <= 60)))
- `custom_puzzle_results_total_guesses_not_null` NOT NULL total_guesses
- `custom_puzzle_results_won_not_null` NOT NULL won

Indexes:

- `CREATE UNIQUE INDEX custom_puzzle_results_custom_puzzle_id_device_id_key ON public.custom_puzzle_results USING btree (custom_puzzle_id, device_id)`
- `CREATE UNIQUE INDEX custom_puzzle_results_pkey ON public.custom_puzzle_results USING btree (id)`
- `CREATE INDEX custom_puzzle_results_puzzle_idx ON public.custom_puzzle_results USING btree (custom_puzzle_id)`

### `custom_puzzle_stats`

> One fixed-size aggregate row per custom puzzle (wins, losses, five guess buckets). Written only by submit_custom_puzzle_result; read only by get_custom_puzzle_stats and get_creator_profile.

RLS: enabled. Grants: none for anon/authenticated/service_role

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
- `custom_puzzle_stats_custom_puzzle_id_not_null` NOT NULL custom_puzzle_id
- `custom_puzzle_stats_guesses_4_check` CHECK ((guesses_4 >= 0))
- `custom_puzzle_stats_guesses_4_not_null` NOT NULL guesses_4
- `custom_puzzle_stats_guesses_5_check` CHECK ((guesses_5 >= 0))
- `custom_puzzle_stats_guesses_5_not_null` NOT NULL guesses_5
- `custom_puzzle_stats_guesses_6_check` CHECK ((guesses_6 >= 0))
- `custom_puzzle_stats_guesses_6_not_null` NOT NULL guesses_6
- `custom_puzzle_stats_guesses_7_check` CHECK ((guesses_7 >= 0))
- `custom_puzzle_stats_guesses_7_not_null` NOT NULL guesses_7
- `custom_puzzle_stats_guesses_8_plus_check` CHECK ((guesses_8_plus >= 0))
- `custom_puzzle_stats_guesses_8_plus_not_null` NOT NULL guesses_8_plus
- `custom_puzzle_stats_losses_check` CHECK ((losses >= 0))
- `custom_puzzle_stats_losses_not_null` NOT NULL losses
- `custom_puzzle_stats_pkey` PRIMARY KEY (custom_puzzle_id)
- `custom_puzzle_stats_updated_at_not_null` NOT NULL updated_at
- `custom_puzzle_stats_win_guess_total_check` CHECK ((win_guess_total >= 0))
- `custom_puzzle_stats_win_guess_total_not_null` NOT NULL win_guess_total
- `custom_puzzle_stats_wins_check` CHECK ((wins >= 0))
- `custom_puzzle_stats_wins_not_null` NOT NULL wins

Indexes:

- `CREATE UNIQUE INDEX custom_puzzle_stats_pkey ON public.custom_puzzle_stats USING btree (custom_puzzle_id)`

### `custom_puzzles`

> Player-created puzzles (Phase 2, Full 4x4 only). Immutable after creation. Reachable only through create_custom_puzzle/get_custom_puzzle -- no direct grants to anon/authenticated.

RLS: enabled. Grants: none for anon/authenticated/service_role

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

- `custom_puzzles_content_not_null` NOT NULL content
- `custom_puzzles_created_at_not_null` NOT NULL created_at
- `custom_puzzles_created_by_fkey` FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL
- `custom_puzzles_creator_name_not_null` NOT NULL creator_name
- `custom_puzzles_id_not_null` NOT NULL id
- `custom_puzzles_moderation_status_check` CHECK ((moderation_status = ANY (ARRAY['active'::text, 'hidden'::text])))
- `custom_puzzles_moderation_status_not_null` NOT NULL moderation_status
- `custom_puzzles_pkey` PRIMARY KEY (id)
- `custom_puzzles_share_id_key` UNIQUE (share_id)
- `custom_puzzles_share_id_not_null` NOT NULL share_id
- `custom_puzzles_short_code_format` CHECK ((short_code ~ '^[2-9A-HJKMNP-Za-hjkmnp-z]{8,12}$'::text))
- `custom_puzzles_short_code_not_null` NOT NULL short_code
- `custom_puzzles_title_not_null` NOT NULL title
- `custom_puzzles_visibility_check` CHECK ((visibility = ANY (ARRAY['public'::text, 'private'::text])))
- `custom_puzzles_visibility_not_null` NOT NULL visibility

Indexes:

- `CREATE INDEX custom_puzzles_created_by_idx ON public.custom_puzzles USING btree (created_by) WHERE (created_by IS NOT NULL)`
- `CREATE UNIQUE INDEX custom_puzzles_pkey ON public.custom_puzzles USING btree (id)`
- `CREATE INDEX custom_puzzles_public_by_creator_idx ON public.custom_puzzles USING btree (created_by, created_at DESC) WHERE ((visibility = 'public'::text) AND (moderation_status = 'active'::text) AND (created_by IS NOT NULL))`
- `CREATE INDEX custom_puzzles_share_id_idx ON public.custom_puzzles USING btree (share_id)`
- `CREATE UNIQUE INDEX custom_puzzles_share_id_key ON public.custom_puzzles USING btree (share_id)`
- `CREATE UNIQUE INDEX custom_puzzles_short_code_key ON public.custom_puzzles USING btree (short_code)`

Policies:

- `Admins can read custom puzzles` — SELECT to public; using `has_role(auth.uid(), 'admin'::app_role)`

### `device_identities`

> One row per anonymous browser identity. token_hash is sha256 of a token returned exactly once at creation and never stored in the clear. retired_at is permanent: a retired identity can never be verified, claimed or resumed, but its gameplay rows are never touched.

RLS: enabled. Grants: none for anon/authenticated/service_role

| Column | Type | Null | Default |
|---|---|---|---|
| `device_id` | text | not null |  |
| `token_hash` | text | null |  |
| `created_at` | timestamp with time zone | not null | `now()` |
| `retired_at` | timestamp with time zone | null |  |
| `retired_reason` | text | null |  |

Constraints:

- `device_identities_created_at_not_null` NOT NULL created_at
- `device_identities_device_id_not_null` NOT NULL device_id
- `device_identities_pkey` PRIMARY KEY (device_id)

Indexes:

- `CREATE UNIQUE INDEX device_identities_pkey ON public.device_identities USING btree (device_id)`

### `feedback`

RLS: enabled. Grants: none for anon/authenticated/service_role

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | `gen_random_uuid()` |
| `created_at` | timestamp with time zone | null | `now()` |
| `type` | text | not null |  |
| `message` | text | not null |  |
| `email` | text | null |  |
| `user_id` | uuid | null |  |

Constraints:

- `feedback_id_not_null` NOT NULL id
- `feedback_message_not_null` NOT NULL message
- `feedback_pkey` PRIMARY KEY (id)
- `feedback_type_not_null` NOT NULL type

Indexes:

- `CREATE UNIQUE INDEX feedback_pkey ON public.feedback USING btree (id)`

Policies:

- `Admins can read feedback` — SELECT to authenticated; using `has_role(auth.uid(), 'admin'::app_role)`

### `game_results`

RLS: enabled. Grants: none for anon/authenticated/service_role

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | `gen_random_uuid()` |
| `user_id` | uuid | not null |  |
| `puzzle_id` | uuid | not null |  |
| `won` | boolean | not null |  |
| `mistakes` | integer | not null | `0` |
| `completed_at` | timestamp with time zone | not null | `now()` |

Constraints:

- `game_results_completed_at_not_null` NOT NULL completed_at
- `game_results_id_not_null` NOT NULL id
- `game_results_mistakes_not_null` NOT NULL mistakes
- `game_results_pkey` PRIMARY KEY (id)
- `game_results_puzzle_id_fkey` FOREIGN KEY (puzzle_id) REFERENCES puzzles(id) ON DELETE CASCADE
- `game_results_puzzle_id_not_null` NOT NULL puzzle_id
- `game_results_user_id_fkey` FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
- `game_results_user_id_not_null` NOT NULL user_id
- `game_results_user_id_puzzle_id_key` UNIQUE (user_id, puzzle_id)
- `game_results_won_not_null` NOT NULL won

Indexes:

- `CREATE UNIQUE INDEX game_results_pkey ON public.game_results USING btree (id)`
- `CREATE UNIQUE INDEX game_results_user_id_puzzle_id_key ON public.game_results USING btree (user_id, puzzle_id)`

Policies:

- `Admins can read all results` — SELECT to public; using `has_role(auth.uid(), 'admin'::app_role)`
- `Users can read own results` — SELECT to public; using `(auth.uid() = user_id)`

### `game_sessions`

RLS: enabled. Grants: none for anon/authenticated/service_role

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

- `game_sessions_bonus_rainbow_attempted_not_null` NOT NULL bonus_rainbow_attempted
- `game_sessions_format_check` CHECK ((format = ANY (ARRAY['full'::text, 'mini'::text])))
- `game_sessions_format_not_null` NOT NULL format
- `game_sessions_id_not_null` NOT NULL id
- `game_sessions_is_official_not_null` NOT NULL is_official
- `game_sessions_mistakes_not_null` NOT NULL mistakes
- `game_sessions_pkey` PRIMARY KEY (id)
- `game_sessions_puzzle_id_not_null` NOT NULL puzzle_id
- `game_sessions_rainbow_source_check` CHECK (((rainbow_source IS NULL) OR (rainbow_source = ANY (ARRAY['in_game'::text, 'post_game'::text]))))
- `game_sessions_status_check` CHECK ((status = ANY (ARRAY['in_progress'::text, 'won'::text, 'lost'::text])))
- `game_sessions_status_completed_at_check` CHECK (((status = 'in_progress'::text) = (completed_at IS NULL)))
- `game_sessions_status_not_null` NOT NULL status
- `game_sessions_status_won_check` CHECK ((((status = 'in_progress'::text) AND (won IS NULL)) OR ((status = 'won'::text) AND (won IS TRUE)) OR ((status = 'lost'::text) AND (won IS FALSE))))

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

- `Admins can read all game sessions` — SELECT to authenticated; using `has_role(auth.uid(), 'admin'::app_role)`
- `Users can read own game sessions` — SELECT to authenticated; using `(user_id = auth.uid())`

### `guess_events`

RLS: enabled. Grants: none for anon/authenticated/service_role

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
- `guess_events_correct_not_null` NOT NULL correct
- `guess_events_game_session_id_not_null` NOT NULL game_session_id
- `guess_events_guess_number_not_null` NOT NULL guess_number
- `guess_events_id_not_null` NOT NULL id
- `guess_events_pkey` PRIMARY KEY (id)
- `guess_events_words_not_null` NOT NULL words

Indexes:

- `CREATE INDEX guess_events_bonus_rainbow_idx ON public.guess_events USING btree (game_session_id) WHERE (attempt_type = 'bonus_rainbow'::text)`
- `CREATE UNIQUE INDEX guess_events_pkey ON public.guess_events USING btree (id)`
- `CREATE UNIQUE INDEX guess_events_session_guess_number_key ON public.guess_events USING btree (game_session_id, guess_number)`

Policies:

- `Admins can read all guess events` — SELECT to authenticated; using `has_role(auth.uid(), 'admin'::app_role)`
- `Users can read own guess events` — SELECT to authenticated; using `(EXISTS ( SELECT 1
   FROM game_sessions gs
  WHERE ((gs.id = guess_events.game_session_id) AND (gs.user_id = auth.uid()))))`

### `hint_events`

> One row per hint ACTUALLY REVEALED. Opening the hint modal or viewing options is deliberately not recorded. Idempotent on (game_session_id, hint_type).

RLS: enabled. Grants: none for anon/authenticated/service_role

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
- `hint_events_game_session_id_not_null` NOT NULL game_session_id
- `hint_events_hint_type_check` CHECK ((hint_type = ANY (ARRAY['small'::text, 'full'::text])))
- `hint_events_hint_type_not_null` NOT NULL hint_type
- `hint_events_id_not_null` NOT NULL id
- `hint_events_one_per_type` UNIQUE (game_session_id, hint_type)
- `hint_events_pkey` PRIMARY KEY (id)
- `hint_events_revealed_at_not_null` NOT NULL revealed_at

Indexes:

- `CREATE UNIQUE INDEX hint_events_one_per_type ON public.hint_events USING btree (game_session_id, hint_type)`
- `CREATE UNIQUE INDEX hint_events_pkey ON public.hint_events USING btree (id)`
- `CREATE INDEX hint_events_session_idx ON public.hint_events USING btree (game_session_id)`

Policies:

- `Admins can read all hint events` — SELECT to authenticated; using `has_role(auth.uid(), 'admin'::app_role)`
- `Users can read own hint events` — SELECT to authenticated; using `(EXISTS ( SELECT 1
   FROM game_sessions gs
  WHERE ((gs.id = hint_events.game_session_id) AND (gs.user_id = auth.uid()))))`

### `luck_score_ceilings`

> Lucky Bot Luck Score ceiling ("1 in N" that scores 100). A puzzle uses the row with the latest effective_from on or before its own date, so adding a row later never changes an older puzzle's score. Add rows; do not edit old ones.

RLS: enabled. Grants: none for anon/authenticated/service_role

| Column | Type | Null | Default |
|---|---|---|---|
| `effective_from` | date | not null |  |
| `ceiling` | integer | not null |  |
| `note` | text | null |  |
| `created_at` | timestamp with time zone | not null | `now()` |

Constraints:

- `luck_score_ceilings_ceiling_check` CHECK ((ceiling >= 2))
- `luck_score_ceilings_ceiling_not_null` NOT NULL ceiling
- `luck_score_ceilings_created_at_not_null` NOT NULL created_at
- `luck_score_ceilings_effective_from_not_null` NOT NULL effective_from
- `luck_score_ceilings_pkey` PRIMARY KEY (effective_from)

Indexes:

- `CREATE UNIQUE INDEX luck_score_ceilings_pkey ON public.luck_score_ceilings USING btree (effective_from)`

### `puzzle_aggregates`

RLS: enabled. Grants: none for anon/authenticated/service_role

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
- `puzzle_aggregates_puzzle_id_not_null` NOT NULL puzzle_id

Indexes:

- `CREATE UNIQUE INDEX puzzle_aggregates_pkey ON public.puzzle_aggregates USING btree (puzzle_id)`

Policies:

- `Anyone can read puzzle aggregates` — SELECT to public; using `true`

### `puzzle_groups`

RLS: enabled. Grants: none for anon/authenticated/service_role

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

- `puzzle_groups_category_emoji_hint_only_not_null` NOT NULL category_emoji_hint_only
- `puzzle_groups_category_not_null` NOT NULL category
- `puzzle_groups_difficulty_check` CHECK (((difficulty >= 1) AND (difficulty <= 4)))
- `puzzle_groups_difficulty_not_null` NOT NULL difficulty
- `puzzle_groups_id_not_null` NOT NULL id
- `puzzle_groups_pkey` PRIMARY KEY (id)
- `puzzle_groups_puzzle_id_fkey` FOREIGN KEY (puzzle_id) REFERENCES puzzles(id) ON DELETE CASCADE
- `puzzle_groups_puzzle_id_not_null` NOT NULL puzzle_id
- `puzzle_groups_sort_order_not_null` NOT NULL sort_order
- `puzzle_groups_words_not_null` NOT NULL words

Indexes:

- `CREATE UNIQUE INDEX puzzle_groups_pkey ON public.puzzle_groups USING btree (id)`

Policies:

- `Admins can manage puzzle groups` — ALL to public; using `has_role(auth.uid(), 'admin'::app_role)`
- `Anyone can read published or beta puzzle groups` — SELECT to public; using `(EXISTS ( SELECT 1
   FROM puzzles
  WHERE ((puzzles.id = puzzle_groups.puzzle_id) AND ((puzzles.is_published = true) OR (puzzles.is_beta = true)))))`

### `puzzle_ratings`

RLS: enabled. Grants: none for anon/authenticated/service_role

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | `gen_random_uuid()` |
| `puzzle_id` | text | not null |  |
| `user_id` | uuid | not null |  |
| `rating` | integer | not null |  |
| `created_at` | timestamp with time zone | null | `now()` |

Constraints:

- `puzzle_ratings_id_not_null` NOT NULL id
- `puzzle_ratings_pkey` PRIMARY KEY (id)
- `puzzle_ratings_puzzle_id_not_null` NOT NULL puzzle_id
- `puzzle_ratings_rating_not_null` NOT NULL rating
- `puzzle_ratings_user_id_not_null` NOT NULL user_id

Indexes:

- `CREATE UNIQUE INDEX puzzle_ratings_pkey ON public.puzzle_ratings USING btree (id)`
- `CREATE UNIQUE INDEX puzzle_ratings_puzzle_user_key ON public.puzzle_ratings USING btree (puzzle_id, user_id)`

Policies:

- `Admins can read all ratings` — SELECT to authenticated; using `has_role(auth.uid(), 'admin'::app_role)`
- `Users can change own rating` — UPDATE to authenticated; using `(user_id = auth.uid())`; with check `(user_id = auth.uid())`
- `Users can rate as themselves` — INSERT to authenticated; with check `(user_id = auth.uid())`
- `Users can read own rating` — SELECT to authenticated; using `(user_id = auth.uid())`

### `puzzle_versions`

> Immutable gameplay-content snapshots of a puzzle. Never updated, never deleted except by cascade when the puzzle itself is deleted. A game_sessions row pins the exact snapshot that player is playing.

RLS: enabled. Grants: anon=SELECT, authenticated=SELECT

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | `gen_random_uuid()` |
| `puzzle_id` | uuid | not null |  |
| `version_number` | integer | not null |  |
| `content` | jsonb | not null |  |
| `created_at` | timestamp with time zone | not null | `now()` |
| `created_by` | uuid | null |  |

Constraints:

- `puzzle_versions_content_not_null` NOT NULL content
- `puzzle_versions_created_at_not_null` NOT NULL created_at
- `puzzle_versions_created_by_fkey` FOREIGN KEY (created_by) REFERENCES auth.users(id)
- `puzzle_versions_id_not_null` NOT NULL id
- `puzzle_versions_pkey` PRIMARY KEY (id)
- `puzzle_versions_puzzle_id_fkey` FOREIGN KEY (puzzle_id) REFERENCES puzzles(id) ON DELETE CASCADE
- `puzzle_versions_puzzle_id_not_null` NOT NULL puzzle_id
- `puzzle_versions_puzzle_id_version_number_key` UNIQUE (puzzle_id, version_number)
- `puzzle_versions_version_number_check` CHECK ((version_number >= 1))
- `puzzle_versions_version_number_not_null` NOT NULL version_number

Indexes:

- `CREATE UNIQUE INDEX puzzle_versions_pkey ON public.puzzle_versions USING btree (id)`
- `CREATE UNIQUE INDEX puzzle_versions_puzzle_id_version_number_key ON public.puzzle_versions USING btree (puzzle_id, version_number)`
- `CREATE INDEX puzzle_versions_puzzle_idx ON public.puzzle_versions USING btree (puzzle_id, version_number DESC)`

Triggers:

- `CREATE TRIGGER puzzle_versions_immutable BEFORE UPDATE ON public.puzzle_versions FOR EACH ROW EXECUTE FUNCTION puzzle_versions_block_update()`

Policies:

- `Admins can read all puzzle versions` — SELECT to authenticated; using `has_role(auth.uid(), 'admin'::app_role)`
- `Anyone can read published puzzle versions` — SELECT to public; using `(EXISTS ( SELECT 1
   FROM puzzles p
  WHERE ((p.id = puzzle_versions.puzzle_id) AND (p.is_published = true))))`

### `puzzles`

RLS: enabled. Grants: none for anon/authenticated/service_role

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

- `puzzles_alphabetize_completed_not_null` NOT NULL alphabetize_completed
- `puzzles_created_at_not_null` NOT NULL created_at
- `puzzles_created_by_fkey` FOREIGN KEY (created_by) REFERENCES auth.users(id)
- `puzzles_date_not_null` NOT NULL date
- `puzzles_designer_name_not_null` NOT NULL designer_name
- `puzzles_format_check` CHECK ((format = ANY (ARRAY['full'::text, 'mini'::text])))
- `puzzles_format_not_null` NOT NULL format
- `puzzles_id_not_null` NOT NULL id
- `puzzles_is_beta_not_null` NOT NULL is_beta
- `puzzles_is_published_not_null` NOT NULL is_published
- `puzzles_not_beta_and_published` CHECK ((NOT (is_published AND is_beta)))
- `puzzles_pkey` PRIMARY KEY (id)
- `puzzles_rainbow_category_emoji_hint_only_not_null` NOT NULL rainbow_category_emoji_hint_only
- `puzzles_updated_at_not_null` NOT NULL updated_at

Indexes:

- `CREATE UNIQUE INDEX puzzles_date_format_key ON public.puzzles USING btree (date, format)`
- `CREATE UNIQUE INDEX puzzles_pkey ON public.puzzles USING btree (id)`

Triggers:

- `CREATE TRIGGER puzzles_current_version_check BEFORE INSERT OR UPDATE OF current_version_id ON public.puzzles FOR EACH ROW EXECUTE FUNCTION puzzles_check_current_version()`
- `CREATE TRIGGER update_puzzles_updated_at BEFORE UPDATE ON public.puzzles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`

Policies:

- `Admins can manage puzzles` — ALL to public; using `has_role(auth.uid(), 'admin'::app_role)`
- `Anyone can read published or beta puzzles` — SELECT to public; using `((is_published = true) OR (is_beta = true))`

### `user_roles`

RLS: enabled. Grants: none for anon/authenticated/service_role

| Column | Type | Null | Default |
|---|---|---|---|
| `id` | uuid | not null | `gen_random_uuid()` |
| `user_id` | uuid | not null |  |
| `role` | app_role | not null |  |
| `created_at` | timestamp with time zone | not null | `now()` |

Constraints:

- `user_roles_created_at_not_null` NOT NULL created_at
- `user_roles_id_not_null` NOT NULL id
- `user_roles_pkey` PRIMARY KEY (id)
- `user_roles_role_not_null` NOT NULL role
- `user_roles_user_id_fkey` FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
- `user_roles_user_id_not_null` NOT NULL user_id
- `user_roles_user_id_role_key` UNIQUE (user_id, role)

Indexes:

- `CREATE UNIQUE INDEX user_roles_pkey ON public.user_roles USING btree (id)`
- `CREATE UNIQUE INDEX user_roles_user_id_role_key ON public.user_roles USING btree (user_id, role)`

Policies:

- `Admins can manage roles` — ALL to public; using `has_role(auth.uid(), 'admin'::app_role)`
- `Users can view own roles` — SELECT to public; using `(auth.uid() = user_id)`

### `user_streaks`

RLS: enabled. Grants: none for anon/authenticated/service_role

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

- `user_streaks_format_check` CHECK ((format = ANY (ARRAY['full'::text, 'mini'::text])))
- `user_streaks_format_not_null` NOT NULL format
- `user_streaks_id_not_null` NOT NULL id
- `user_streaks_pkey` PRIMARY KEY (id)

Indexes:

- `CREATE INDEX user_streaks_device_format_idx ON public.user_streaks USING btree (device_id, format) WHERE ((user_id IS NULL) AND (device_id IS NOT NULL))`
- `CREATE UNIQUE INDEX user_streaks_pkey ON public.user_streaks USING btree (id)`
- `CREATE INDEX user_streaks_user_format_idx ON public.user_streaks USING btree (user_id, format) WHERE (user_id IS NOT NULL)`

## Functions

| Function | Returns | Definer | Volatility | Executable by |
|---|---|---|---|---|
| `admin_save_puzzle(_puzzle_id uuid, _metadata jsonb, _content jsonb)` | jsonb | yes | volatile | authenticated, service_role |
| `admin_set_custom_puzzle_status(_puzzle_id uuid, _status text)` | boolean | yes | volatile | authenticated, service_role |
| `complete_beta_playtest(_playtest_id uuid, _device_id text, _device_token text, _won boolean, _mistakes integer, _hints_used boolean)` | boolean | yes | volatile | anon, authenticated, service_role |
| `count_own_anonymous_sessions(_device_id text, _device_token text)` | integer | yes | stable | anon, authenticated, service_role |
| `create_custom_puzzle(_creator_name text, _title text, _visibility text, _content jsonb)` | jsonb | yes | volatile | anon, authenticated, service_role |
| `create_device_identity()` | TABLE(device_id text, device_token text) | yes | volatile | anon, authenticated, service_role |
| `create_game_session(_puzzle_id text, _device_id text, _device_token text, _entry_context text, _active_time_seconds integer, _mistakes integer, _puzzle_version_id uuid)` | uuid | yes | volatile | anon, authenticated, service_role |
| `custom_creator_new_slug(_name text)` | text | no | volatile | none of the client roles |
| `custom_ensure_creator_profile(_uid uuid, _name text)` | void | yes | volatile | none of the client roles |
| `custom_puzzle_new_short_code()` | text | no | volatile | none of the client roles |
| `custom_puzzle_public_json(_p custom_puzzles)` | jsonb | yes | stable | none of the client roles |
| `custom_random_string(_alphabet text, _len integer)` | text | no | volatile | none of the client roles |
| `decline_guest_history(_device_id text, _device_token text)` | TABLE(outcome text) | yes | volatile | authenticated, service_role |
| `device_has_importable_history(_device_id text)` | boolean | yes | stable | none of the client roles |
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
| `luck_eligible_paths(_puzzle_id text)` | TABLE(session_id uuid, user_id uuid, device_id text, path jsonb) | yes | stable | none of the client roles |
| `puzzle_versions_block_update()` | trigger | no | volatile | anon, authenticated, service_role |
| `puzzles_check_current_version()` | trigger | no | volatile | anon, authenticated, service_role |
| `record_bonus_rainbow(_session_id uuid, _device_id text, _device_token text, _guess_number integer, _words jsonb, _correct boolean, _guessed_at timestamp with time zone, _active_time_seconds integer, _groups_solved smallint)` | boolean | yes | volatile | anon, authenticated, service_role |
| `record_guess_events(_session_id uuid, _device_id text, _device_token text, _events jsonb)` | integer | yes | volatile | anon, authenticated, service_role |
| `record_hint_event(_session_id uuid, _device_id text, _device_token text, _hint_type text, _revealed_at timestamp with time zone, _active_time_seconds integer, _guess_count smallint, _mistakes smallint, _groups_solved smallint, _rainbow_found boolean)` | boolean | yes | volatile | anon, authenticated, service_role |
| `record_streak(_user_id uuid, _device_id text, _won boolean, _local_date text, _format text)` | void | yes | volatile | none of the client roles |
| `reset_beta_playtest(_puzzle_id uuid, _device_id text, _device_token text)` | boolean | yes | volatile | anon, authenticated, service_role |
| `resolve_onboarding(_device_id text, _device_token text)` | TABLE(outcome text, status text, games_played integer, current_streak integer, longest_streak integer) | yes | volatile | authenticated, service_role |
| `session_capability_ok(_session_id uuid, _device_id text, _device_token text)` | boolean | yes | stable | anon, authenticated, service_role |
| `set_custom_puzzle_favorite(_share_id text, _favorite boolean)` | jsonb | yes | volatile | authenticated, service_role |
| `skill_score(_won boolean, _mistakes integer, _solve_order jsonb, _found_rainbow boolean, _rainbow_source text, _format text)` | integer | no | immutable | anon, authenticated, service_role |
| `start_beta_playtest(_puzzle_id uuid, _puzzle_version_id uuid, _device_id text, _device_token text)` | uuid | yes | volatile | anon, authenticated, service_role |
| `submit_beta_feedback(_puzzle_id uuid, _puzzle_version_id uuid, _playtest_id uuid, _tester_name text, _fun_rating smallint, _difficulty_rating smallint, _rainbow_fairness_rating smallint, _confusing_or_incorrect text, _additional_comments text, _would_play_again boolean)` | uuid | yes | volatile | anon, authenticated, service_role |
| `submit_custom_puzzle_result(_share_id text, _device_id text, _device_token text, _won boolean, _total_guesses smallint)` | boolean | yes | volatile | anon, authenticated, service_role |
| `submit_custom_puzzle_result(_share_id text, _device_id text, _device_token text, _won boolean, _total_guesses smallint, _run_id uuid)` | boolean | yes | volatile | anon, authenticated, service_role |
| `touch_game_session(_session_id uuid, _device_id text, _device_token text, _active_time_seconds integer, _mistakes integer)` | boolean | yes | volatile | anon, authenticated, service_role |
| `update_updated_at_column()` | trigger | no | volatile | anon, authenticated, service_role |
| `validate_custom_puzzle_content(_content jsonb)` | jsonb | no | immutable | anon, authenticated, service_role |
| `validate_puzzle_content(_content jsonb)` | jsonb | no | immutable | authenticated, service_role |
| `verify_device(_device_id text, _device_token text)` | boolean | yes | stable | none of the client roles |

## Storage

Storage is not part of this backend; see `0002_rainbow_storage.sql` for the bucket and its policies.

## Extensions present on the database this was read from

Rainbow requires none beyond what every Supabase project ships with; listed for completeness.

- `plpgsql` (pg_catalog)
