# Phase 2 preview: every change the beta reset would make to the shared hosted project

Status: **PREVIEW ONLY. Nothing here has been run against the hosted project.**
Phase 2 needs a separate, explicit approval from Deb after the Phase 1 review.

Target: the shared beta Supabase project (`zmauemcjcrdrgfjzkvgd`), which Rainbow/Mini share
with CrossPuns (objects prefixed `xw_`) and which still holds `cv_*` / `wtf_*` leftovers.
Everything below touches Rainbow's objects and Rainbow's beta users only.

Sources: `supabase/beta-era-migrations/beta-era-inventory.json` (what the beta chain built),
`supabase/rainbow-owned-objects.json` (the launch baseline), both regenerable from git;
`npm run db:change-preview` produces section 3 verbatim.

---

## 1. What is NOT known from git yet (read-only pre-checks, step 1 of Phase 2)

These are read in the dashboard / SQL editor **without writing anything**, and each can add
rows to `supabase/ops/beta-reset/extra-objects.json` before the teardown is generated:

| Check | Why | If it differs |
|---|---|---|
| Rainbow objects in `public` that are in neither inventory (e.g. `increment_puzzle_aggregate`, already listed in `extra-objects.json`; anything created by hand in the SQL editor since) | The teardown drops only what is listed | Add to `extra-objects.json` (Rainbow names only; `xw_/cv_/wtf_` refused) |
| Policies on `storage.objects` for the `custom-emoji` bucket, and the bucket's `public` flag | Never in git (plan risk R4) | Fold their names into `extra-objects.json` (so the teardown drops them) and their shape into `0002_rainbow_storage.sql` if it differs |
| RLS on `puzzle_ratings`, `puzzle_aggregates`, `feedback` | Reconstructed, never read from production | Correct the baseline first |
| Auth settings: Confirm email, Site URL, redirect list, providers | Project-wide, shared with CrossPuns | See section 5 |
| Which beta-era migrations the ledger lists (the snapshot from 2026-09-22 stops at `20260924000000`) | The teardown deletes 32 versions by name; unknown extra rows stay | Nothing to do: the delete is by exact version |
| The auth user ids to KEEP (CrossPuns' admin) | Owner-supplied keep-list | Written to a local file passed as `--keep-auth-users` |
| Row counts of every Rainbow table | For the report, and to size the export | — |

## 2. The sequence

```
0. export   content dump (puzzles, puzzle_groups, puzzle_versions, luck_score_ceilings)
            + feedback / beta_feedback to files for Deb          [read-only]
1. rehearse 10_teardown.REHEARSAL.sql (ends in ROLLBACK): prints what it would drop/delete
2. apply    10_teardown.sql (ends in COMMIT)                      [the irreversible step]
3. apply    supabase/migrations/0001_rainbow_baseline.sql, 0002_rainbow_storage.sql
            via `supabase db push` from a CLI linked to this ref (records 0001/0002 in the ledger)
4. restore  content import (puzzles/groups/versions/ceilings), created_by re-pointed to the
            new admin's id once it exists; storage objects untouched throughout
5. wire     install custom:platform (Rainbow's WorkOS application, Production env after cleanup)
6. verify   npm run db:manifest -- --check style comparison against the live project;
            S1, S9, S10, S11 smoke cases on a preview deploy
```

Steps 1–3 run inside one maintenance window (minutes). Until step 3 completes the site is in
"saving unavailable" mode for players (guests can still play; nothing is recorded) — acceptable
for a beta with disposable data. Rollback before step 2: nothing happened. Rollback after step 2:
re-apply the beta-era chain + `pre-git/` files, restore the content export, repair the ledger;
player data is not restored, by decision D7.

## 3. Object-level changes (generated)

Legend: **CREATE** = new in the baseline; **DROP** = beta-era only; ALTER = same object, changed.
"policy … (changed)" means the policy expression now uses `rainbow_uid()` instead of `auth.uid()`.
Grants: the beta-era chain left `TRUNCATE`, `REFERENCES` and `TRIGGER` on client roles through
default privileges; the baseline grants exactly SELECT/INSERT/UPDATE/DELETE as intended.

### Tables

| Table | Change | Detail |
|---|---|---|
| `accounts` | **CREATE** | 4 columns; RLS on; no client grants |
| `archive_access` | ALTER | policies now use `rainbow_uid()`; client grants trimmed to DML |
| `beta_feedback` | ALTER | policy `Admins can read beta feedback` (changed) |
| `beta_playtests` | ALTER | add FK `beta_playtests_device_id_fkey` → `device_identities`; policy changed |
| `creator_profiles` | unchanged | |
| `custom_puzzle_favorites` | unchanged | |
| `custom_puzzle_results` | ALTER | add FK `custom_puzzle_results_device_id_fkey` → `device_identities` |
| `custom_puzzle_stats` | unchanged | |
| `custom_puzzles` | ALTER | policy `Admins can read custom puzzles` (changed) |
| `device_identities` | ALTER | `token_hash` → not null; add `claimed_by uuid` (FK → auth.users, set null), `decided_at`; checks `device_identities_retired_pair_check`, `device_identities_retired_reason_check`; index `device_identities_claimed_by_idx` |
| `feedback` | ALTER | add FK `feedback_user_id_fkey` → auth.users (set null); policy changed; client grants trimmed to DML |
| `game_sessions` | ALTER | add FKs `game_sessions_device_id_fkey` → `device_identities`, `game_sessions_user_id_fkey` → auth.users (set null); policies changed; client grants trimmed to SELECT |
| `guess_events` | ALTER | policies changed; client grants trimmed to SELECT |
| `hint_events` | ALTER | policies changed; client grants trimmed to SELECT |
| `luck_score_ceilings` | unchanged | |
| `puzzle_aggregates` | ALTER | client grants trimmed to DML (RLS unchanged: read-only in practice) |
| `puzzle_groups` | ALTER | policy `Admins can manage puzzle groups` (changed); client grants trimmed to DML |
| `puzzle_ratings` | ALTER | add FK `puzzle_ratings_user_id_fkey` → auth.users (cascade); 4 policies changed; grants trimmed |
| `puzzle_versions` | ALTER | `puzzle_versions_created_by_fkey` re-created with ON DELETE SET NULL; policy changed |
| `puzzles` | ALTER | `puzzles_created_by_fkey` re-created with ON DELETE SET NULL; policy changed; anon loses TRUNCATE |
| `user_roles` | ALTER | policies changed; client grants trimmed to DML |
| `user_streaks` | ALTER | add FKs `user_streaks_device_id_fkey`, `user_streaks_user_id_fkey` (cascade); unique partial indexes `user_streaks_one_per_device_format`, `user_streaks_one_per_user_format` replace the non-unique ones |
| `account_onboarding` | **DROP** | 5 columns, replaced by the per-device decision on `device_identities` |
| `game_results` | **DROP** | 6 columns, 2 policies; `game_sessions` is the single record of a play |

### Functions

| Function | Change | Detail |
|---|---|---|
| `admin_find_account(_email text)` | **CREATE** | authenticated; searches `accounts`, replaces the `admin-find-user` edge function |
| `delete_local_account(_user_id uuid)` | **CREATE** | service_role only |
| `delete_my_account()` | **CREATE** | authenticated |
| `ensure_account()` | **CREATE** | authenticated; the only writer of `accounts` |
| `my_account()` | **CREATE** | authenticated |
| `ping()` | **CREATE** | anon, authenticated; replaces the `count_own_anonymous_sessions` probe |
| `rainbow_uid()` | **CREATE** | anon, authenticated; the tenant boundary |
| `resolve_device_import(_device_id text, _device_token text)` | **CREATE** | authenticated; replaces `resolve_onboarding` |
| `import_guest_history(text, text)`, `decline_guest_history(text, text)` | recreated | same signatures, per-device semantics |
| `create_game_session(…)` | recreated | the `account_onboarding` gate becomes the per-device gate |
| `finalize_game_session(…)` | recreated | no `game_results` mirror |
| `custom_creator_new_slug`, `custom_ensure_creator_profile`, `custom_puzzle_new_short_code`, `custom_puzzle_public_json`, `custom_random_string`, `device_has_importable_history`, `luck_eligible_paths`, `record_streak`, `verify_device` | ALTER (grants) | **executable by service_role only** — the beta chain revoked from PUBLIC but not from anon/authenticated, so default privileges had left them client-callable (`record_streak` is a write) |
| every other function (43) | recreated | same signature; body from the baseline; `auth.uid()` → `rainbow_uid()` where the function identifies the caller |
| `count_own_anonymous_sessions(text, text)` | **DROP** | |
| `resolve_onboarding(text, text)` | **DROP** | |
| `submit_custom_puzzle_result(text, text, text, boolean, smallint)` (5-arg) | **DROP** | the 6-arg form stays |
| `increment_puzzle_aggregate(…)` | **DROP** (extra-objects) | production-only leftover, already revoked |

### Types

- `app_role`: unchanged.

### Edge functions

| Function | Change |
|---|---|
| `submit-feedback` | unchanged (redeploy only if its secrets need re-entering) |
| `admin-find-user` | **DELETE** — replaced by `admin_find_account()` |

### Storage

- Bucket `custom-emoji`: kept, with its objects. Policies re-created from `0002_rainbow_storage.sql`
  (public read; admin insert/update/delete via `has_role(rainbow_uid(), 'admin')`).

## 4. Data

| Data | Fate |
|---|---|
| All Rainbow beta `auth.users` rows and their identities/sessions | **deleted** (everything not on the owner's keep-list) |
| `game_sessions`, `guess_events`, `hint_events`, `user_streaks`, `puzzle_aggregates`, `device_identities`, `account_onboarding`, `game_results`, `puzzle_ratings`, `archive_access`, `custom_*`, `creator_profiles`, `beta_playtests`, `beta_feedback`, `feedback` | **dropped with their tables** (feedback and beta_feedback exported to files first) |
| `puzzles`, `puzzle_groups`, `puzzle_versions`, `luck_score_ceilings` | **exported, tables dropped, re-imported** (`created_by` re-pointed) |
| Storage objects in `custom-emoji` | **untouched** |
| CrossPuns (`xw_*`), `cv_*`, `wtf_*` tables, functions, policies, data | **untouched** (the teardown names none of them; an unexpected dependency aborts it) |
| Migration ledger | 32 beta-era versions removed; `0001`, `0002` recorded by `db push` |

## 5. Auth settings (dashboard, project-wide, shared with CrossPuns)

| Setting | Now (to confirm read-only) | After |
|---|---|---|
| Custom OIDC provider `custom:platform` | absent | installed (Rainbow's WorkOS Production application) |
| Site URL | `https://rainbowcategories.com` (assumed) | same |
| Redirect allow-list | (assumed) origin only | `https://rainbowcategories.com/auth/callback` + preview URL during phase 2 |
| Confirm email | ON (inferred from the old sign-up UI; must be verified) | ON |
| Email + Password provider | ON | **stays ON** (CrossPuns' admin) — Rainbow ignores such users via `rainbow_uid()` |
| Google provider | ON (Rainbow's old Google button) | OFF once Rainbow's new build is live (CrossPuns does not use it) |
| Anonymous sign-ins | OFF | OFF |
| Manual identity linking | (unknown) | OFF |

## 6. WorkOS (Production environment)

1. Cleanup C1–C10 from the proof (`shared-accounts-poc/docs/WORKOS-DECISIONS-AND-CLEANUP.md`), verified with `tools/verify-workos.mjs`.
2. Register `rainbow-categories` (Connect OAuth, first-party, confidential) with the single redirect `https://zmauemcjcrdrgfjzkvgd.supabase.co/auth/v1/callback`.
3. Decide sign-in methods (plan decision D2).
4. Install the provider (step 5 of section 2); run the security probe against the Rainbow application.

## 7. Vercel

Two new build-time values: `VITE_PLATFORM_DISCOVERY_URL` (the Production AuthKit discovery URL) and,
optionally, `VITE_ACCOUNTS_ENABLED`. `VITE_SUPABASE_URL` / key unchanged (same project). Deploy the
branch as a **preview** first; production deploy is Phase 3.

## 8. What proves it went right

- `npm run db:manifest -- --check` logic run against the live project's `public` schema restricted to Rainbow names: zero diff.
- `select count(*) from auth.users` = keep-list size + Deb's new admin.
- CrossPuns' admin can still sign in at crosspuns.com/admin (S11).
- S1, S9, S10 on the preview deploy.
