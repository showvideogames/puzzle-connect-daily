# Hamburgle accounts in the shared Friends and Groups hub: hosted change bundle

Status: RELEASE BUNDLE, not yet applied, pushed or deployed. Merged onto
Rainbow main `d70b580` (Friends redesign, PR 111) from the Mini-based proposal
(`570fb495`, PR 110). Binding design: Hamburgle
`docs/social/FRIENDS-PREVIEW-DESIGN.md`.

## Ownership and review

- Owner-settled: in a Hamburgle group, current members' earlier eligible results
  show (history on join), and 7/30-day views key on the Daily's publication date.
- Compatibility review against the canonical contract, the CrossPuns
  repository's `docs/shared-social/CONTRACT.md` (branch
  `feat/shared-social-foundation`, last changed `eb238dd`, 2026-11-01): done
  from source; see the release assessment. That text matches Rainbow `6ad00ba`
  (2026-11-02) and predates every shared change Rainbow has released since, so
  it still lists Hamburgle as `disabled` with summary `{ guesses }`.
  `src/social/contract.ts`, `memoryHub.ts` and `conformance.ts` here are the
  portable copies.
- The SQL is numbered `0013`: `shared-service/patches/0013_hamburgle_results.sql`,
  rollback `shared-service/rollback/0013_hamburgle_results.sql`. The Hamburgle
  release applies 0013 on the released 0002-0011 chain and does NOT apply
  `0012_recent_completions.sql` (deferred: it touches none of 0013's objects,
  and no Hamburgle behaviour uses it). `hamburgleResults.test.ts` runs exactly
  that chain; the other shared-service suites apply the whole 0002-0013 folder.

## What changes

1. Shared SQL `shared-service/patches/0013_hamburgle_results.sql`, one transaction:
   - guard, by exact body (md5 of `prosrc`): each of `game_enabled`,
     `result_fits` and `list_results` must be exactly as released (result_fits as
     Mini 0011 left it) or exactly as this patch leaves it. Anything else (no
     Mini, or another patch replaced one of them first) is refused and nothing
     changes. Re-running it is a no-op;
   - `social.game_enabled`: adds `hamburgle` (record_completion refuses it today);
   - `social.result_fits`: 0011's body verbatim, Rainbow's optional Mini
     `seconds` included, except the hamburgle branch, now exactly
     `{ guesses, solved }`, `guesses` a whole number of at least 1, `solved`
     boolean, detail null;
   - `social.list_results` (history on join): the released body with one change.
     In a group list for `hamburgle`, another current member's card shows
     whatever its `completed_at`; before, it had to be at or after the later of
     the two joining. Unchanged: `not_a_member`, the block check either way, the
     own row, the detail lock, friends lists (forward-only from `since`), and
     every other game. Ended memberships are deleted rows, so someone who left or
     was removed is simply not in the audience.
   No grants, tables, data or deletes. `create or replace` keeps owner and ACLs.
2. Gateway `supabase/functions/social-gateway/core.ts` and `index.ts`:
   - new setting `SOCIAL_HAMBURGLE`; exactly `on` enables, anything else is off;
   - caller resolution: Rainbow `public.accounts` row first, unchanged. Only if
     none and the setting is on, as the connection's own role:
     `select a.global_user_id from hamburgle.progress_accounts a where a.global_user_id = (select i.provider_id from auth.identities i where i.user_id = $1::uuid and i.provider = 'custom:platform' order by i.created_at limit 1) and a.global_user_id ~ '^user_[0-9A-Za-z]{10,64}$'`.
     The shared sign-in id is derived exactly as Rainbow's `public.ensure_account`
     derives it (`supabase/migrations/0001_rainbow_baseline.sql` lines 3181-3187);
     no Hamburgle helper function is used. With several `custom:platform`
     identities on one auth user it takes the earliest, which may differ from the
     order Hamburgle's /user-endpoint check uses, but it can only resolve that same
     auth user's own identity, or find no account and fail closed (`not_linked`).
     Never from args; no account created in either game. Same resolver for
     previewInvite's caller;
   - `ensure_person($1, $2)` with the caller's game (`rainbow` or `hamburgle`),
     replacing the literal `'rainbow'`. Rainbow callers send `'rainbow'` exactly as before;
   - `listResults` for `hamburgle` (setting on only): `shareHamburgleCompletions`
     mirrors `shareCompletions`. Puzzle id must be `daily:<n>` (1..100000),
     otherwise nothing is shared and the list still answers. Reads only
     `hamburgle.progress_daily.entry -> 'counted'` with status won/lost, `mode`
     `daily` and `dated.number` equal to the Daily number, in a
     read-only transaction; guesses = length of the counted guesses list (at
     least 1), time = `completedAt` normalised to UTC milliseconds. Each row is
     `record_completion(gid, 'hamburgle', 'daily:<n>', time, {guesses, solved}, null)`
     in its own transaction as `social_game_server`; failures log a fixed line and
     at most an SQLSTATE. In-progress attempts, extras, archive and Unlimited never.
     With the setting on, a Rainbow account that calls listResults for `hamburgle`
     also triggers this copy (intended; Rainbow's own UI never makes that call).
     Mini's `COMPLETIONS_SQL` and `completionParams` are untouched.
3. Contract (portable copies): `GameSummaries.hamburgle = { solved: boolean; guesses: number }`,
   `RESULT_SHAPES.hamburgle.summary = { solved: 'boolean', guesses: 'count' }`,
   `GAME_STATUS.hamburgle = 'mock'`, and `GROUP_HISTORY_GAMES = {'hamburgle'}`
   (provisional). memoryHub's group listResults skips the connection-time check
   for those games, exactly like the SQL. Conformance: the expected status list
   follows, `SAMPLE_RESULTS.hamburgle`, and a history-on-join scenario.
   The contract's `count` allows 0; the hub SQL requires at least 1 for Hamburgle
   (the gateway never sends 0).

## Rolling windows

The hub has no 7/30-day Hamburgle view. Any such view keys on the Daily's
publication date (`daily:<n>` → its scheduled date), never on join or play date;
Hamburgle has a pure helper for that selection (`src/social/windows.ts`). What a
window ranks by, without points, is an open owner decision; nothing aggregates.

## Prerequisites (read-only checks, before anything is applied)

- `hamburgle.progress_accounts` and `hamburgle.progress_daily` exist in the
  target project (production has them; 2026-10-31 read-only inspection), and the
  gateway's connection role can select them and `auth.identities`, as it already
  reads `public.accounts` (owner or RLS bypass). Catalog check only, no rows read.
  No Hamburgle helper function is needed.
- 0011 is applied and verified. `md5(prosrc)` of the three functions matches the
  guard's "released" values (f74654f1… game_enabled, db3cb694… result_fits,
  7a71c305… list_results); otherwise the patch refuses, and must be rebased on
  whatever is there.
- The coordinator has fixed this file's number and order against the redesign's
  0012.

## Order (each step separately approved; nothing here has been run)

1. Apply the numbered patch in the shared project (after 0011). Verify:
   `pg_get_functiondef` of `result_fits` keeps 0011's rainbow branch and has the new
   hamburgle branch; `select social.game_enabled('hamburgle')` is true; owner and
   ACLs of the three functions unchanged; `result_fits('rainbow', ...)` with and
   without seconds as 0011 expects; a Rainbow group list is unchanged.
2. Deploy the gateway code with `SOCIAL_HAMBURGLE` unset. Behaviour is unchanged:
   the only difference for Rainbow is `ensure_person($1, 'rainbow')` bound as a parameter.
   Verify a Rainbow tester's getMe, listFriends and listResults rainbow.
3. Set `SOCIAL_HAMBURGLE=on` (the one new setting). Verify with an allow-listed
   Hamburgle test account (owner signs in): getMe ok; `social.game_links` shows
   `hamburgle`; listResults `hamburgle` / `daily:<n>` shows only finished counted
   Dailies; no row in `public.accounts` was created. Note: with
   `SOCIAL_ACCESS=everyone` every Hamburgle account is admitted too.
4. Only then enable the Hamburgle site's social build flag.

## Rollback

1. Setting off first (`SOCIAL_HAMBURGLE` unset): Hamburgle-only callers are
   `not_linked` again and no more Hamburgle results are copied. No redeploy of SQL needed.
2. If needed, `shared-service/rollback/0013_hamburgle_results.sql` restores
   the three functions to exactly the bodies the patch replaced (result_fits as
   0011 left it, so Mini's seconds stay). Its guard runs it only from exactly the
   state the patch leaves; anything else is refused and nothing changes.
   Recorded Hamburgle result cards and game links stay; nothing is deleted.
   Hamburgle group lists are forward-only again.
3. A frontend rollback (Hamburgle flag off) deletes no shared records.
4. Policy while the setting is off: Hamburgle-only people get `not_linked`, so
   they can't use deleteMySocialData themselves. Their social data stays, and
   stays visible to their friends and groups, until the setting is on again or a
   separately approved operator action removes it (`social.delete_person` for
   named global ids).

## Overlap for serialized release

| Item | Other change | This proposal |
| --- | --- | --- |
| `social.result_fits` | Mini 0011 (released) | replaces it again: 0011 body + hamburgle branch |
| `social.list_results` | none since the released hub | replaced: Hamburgle group history |
| `social.game_enabled` | none | adds hamburgle |
| patch number 0012 | Rainbow redesign `0012_recent_completions.sql` (unapplied, adds `social.recent_completions` only) | unnumbered until the coordinator decides |
| `core.ts` | Mini's COMPLETIONS_SQL / completionParams | not touched; Hamburgle code in its own section |
| `contract.ts` | Mini's `seconds?` / `optionalSummary` | hamburgle lines and `GROUP_HISTORY_GAMES` only |
| `memoryHub.ts` | Mini's `summaryFits` | group listResults history rule only |
| `conformance.ts` | Mini's seconds scenario | status line, `SAMPLE_RESULTS.hamburgle`, history scenario |

## Local evidence

See the Hamburgle checkpoint `docs/social/FRIENDS-PREVIEW-CHECKPOINT.md` for the
commands, counts and revisions. SQL tests: `shared-service/tests/hamburgleResults.test.ts`
(PGlite: shapes with Mini preserved, guards, exact rollback, whole-chain re-run,
history on join, and the gateway's real SQL end to end with Hamburgle's two
tables copied from `db/progress.sql` and a minimal `auth.identities`).
