# Rainbow Categories and Mini

## Start here for the next session

Rainbow Categories and Mini share this repository. The Full game groups 16 words into four categories with a four-mistake limit and a hidden Rainbow category; see [player rules](src/pages/HowToPlay.tsx). Treat format-specific behavior separately when changing Mini. Read [configuration](docs/CONFIG-INVENTORY.md), [database ownership](supabase/RAINBOW-OWNED-OBJECTS.md), and the [E2E guide](e2e/README.md) before account or persistence work. The React/Vite UI is in `src/`; Supabase migrations and functions are in `supabase/`. Shared WorkOS identity does not mean another game's tables belong to Rainbow.

### Status checked 2026-10-29

Release snapshot checked 2026-10-29: `main` at `b90b7f676ab142c922fb7d5e882f2543d101bb89` has a [successful Production deployment](https://api.github.com/repos/showvideogames/puzzle-connect-daily/deployments/7404151519/statuses). [PR 93](https://github.com/showvideogames/puzzle-connect-daily/pull/93) merged at that commit, including completed-game restoration, per-player browser progress and one-word results copy. [PR 95](https://github.com/showvideogames/puzzle-connect-daily/pull/95) merged into its feature branch first at `6ade3a9`, keeping guest decisions with the initiating account. The earlier October 28 snapshot at `32c96c3` was preview/CI evidence; the October 29 deployment record now establishes release. This does not establish real-phone acceptance or a new database migration.

[PR 90](https://github.com/showvideogames/puzzle-connect-daily/pull/90), the first-game streak fix with a migration, is separate and still open. Its hosted application is not verified by this pass; the owner handoff reports it unapplied. Do not bundle or apply it while publishing documentation. The released PR 93 behavior preserves incomplete legacy records without inventing detailed results or assigning old unlabeled saves to an account.

### Local setup and release boundary

Use Node 22+, `npm ci`, then `npm run dev` after configuring a local environment from `.env.example`. Use the E2E guide for the disposable backend; ordinary Vite dev is not itself a backend isolation guarantee. The test commands below are defined in `package.json`; browser tests need Docker and Playwright. CI results above do not establish real-phone or live shared-login acceptance. No suites were run manually for this documentation edit; the PR workflow runs its configured checks.

For a code-only release, review the exact PR head and CI, record the current production deployment, then verify the resulting deployment separately. Post-release account-switching and restored-result acceptance must not create production test scores. Roll back frontend code using the recorded previous deployment; database changes require their own reviewed rollback. The [beta reset evidence](supabase/ops/beta-reset/README.md) is historical work, not an instruction to reset again. Current comprehensive backup coverage and restore readiness remain to be checked.

## Game copy

`docs/RESULTS-COPY.md` lists every end-of-game message, button and rule (results popup, Share text, Rainbow placement, streak flame), taken from the code, with source references.

## Accounts and the database

Rainbow's only sign-in is the shared account service (WorkOS AuthKit), reached
through Supabase Auth's `custom:platform` provider; Rainbow keeps no passwords
and sends no email. Guests play with a per-browser device credential. The
whole database is `supabase/migrations/` (one baseline file, applicable to a
blank project), and `supabase/RAINBOW-OWNED-OBJECTS.md` lists exactly what
Rainbow owns. See `docs/CONFIG-INVENTORY.md` for every environment value,
`docs/WORKOS-LOCAL-SMOKE.md` for the manual sign-in test, and
`docs/PHASE-2-HOSTED-CHANGE-PREVIEW.md` for the historical beta reset plan; see `supabase/ops/beta-reset/` for its evidence.

## Configuration

`VITE_SUPPORT_URL` (optional, public): the destination of the "Keep the Puzzles Coming" button on custom puzzle pages. Set it to a full `https://` URL in the production host's environment variables and redeploy (Vite reads it at build time). When unset or invalid, the button and its supporting sentence are simply not shown. See `.env.example`.

## Testing

| Command | What it runs |
| --- | --- |
| `npm test` | the component/unit suite (Vitest, jsdom) |
| `npm run typecheck` | TypeScript for the app and the E2E harness — CI's first gate |
| `npm run typecheck:app` / `:e2e` | one project at a time, when you want the other's result too |
| `npm run lint` | ESLint |
| `npm run e2e:db:verify` | every migration on a clean in-process Postgres, plus the full fixture seed — no Docker needed |
| `npm run e2e:test` | the browser end-to-end suite against a disposable local Supabase stack |

The end-to-end suite has its own guide — prerequisites, first-time setup,
architecture, safety model and troubleshooting — in
[`e2e/README.md`](e2e/README.md). It never talks to production; see the
[Safety](e2e/README.md#safety) section for how that is enforced rather than
merely intended.

### Forward-only Best No-Hint Streak (prepared, not deployed)

Migration `0003_no_hint_streak.sql` adds completion order and explicit qualification
without resetting or backfilling existing results. The statistic counts consecutive
completed official games within Full or Mini: losses, hints, and unknown evidence
break runs; calendar gaps do not. Archive official results count; replays do not.
Order is database acceptance order, serialized per owner/format, not browser time.
A failed transaction may leave sequence gaps; those gaps have no gameplay meaning.
Guest import retains recorded order and the existing official-result deduplication.
Late persisted hint events disqualify an otherwise qualifying completion at read time.
Historical rows without a tracking order are outside the baseline; legacy direct
completions after installation are unknown rather than assumed hint-free wins.

The summary RPC aggregates server-side so an API row limit cannot truncate history.
If that RPC is unavailable, the UI reports tracking unavailable rather than zero.
Records that never reach the server cannot be counted; no missing history is inferred.

Before release, review and apply **only the unapplied additive migration** to the
intended Rainbow database through the normal migration workflow, verify guest and
account completion/read permissions plus retries against a disposable Supabase stack,
then deploy the matching frontend. No reset is part of this change. A future launch
reset requires its own separately authorized procedure. Frontend rollback may leave
these additive tracking fields/RPCs intact; do not delete recorded tracking evidence.

Validation: `npm run e2e:db:no-hint` exercises the real SQL in disposable in-process
PostgreSQL; `npm run e2e:db:verify` checks the full schema and seed. Neither connects
to a live database. The owned-object inventory was regenerated from that database,
preserving the previously recorded platform-extension inventory (PGlite omits those
Supabase extensions). Real HTTP/auth and concurrent-connection acceptance results are recorded below.

Concurrency release review (unreleased migration 0003): the baseline's partial
unique indexes `game_sessions_one_official_per_device` and
`game_sessions_one_official_per_user` already prevent two official results for
one puzzle/owner. Previously two completions could both classify themselves as
official before the no-hint trigger lock; the loser then failed with a unique
violation, rolling back all effects. Finalization now locks its session row,
rechecks capability/ownership, and takes the same puzzle/owner advisory lock as
legacy completed inserts **before** official classification. The later no-hint
owner/format lock remains responsible for acceptance ordering.

Import retains session IDs and completion sequence values; overlapping account
results demote the imported result instead of duplicating it. The existing device
lock and retirement compare-and-swap make repeat imports no-ops. Imported history
is merged by its original completion sequence, not import date. No sequence is
assigned to pre-tracking completions. Concurrent imports from different devices,
or an import racing an account completion, still rely on the baseline unique
indexes: a collision rolls the whole transaction back and requires a retry; no
claim is made that those pre-existing races are now automatically retried.

`npm run e2e:db:no-hint-concurrency` adds a guarded real-Supabase acceptance check:
it holds one completion transaction open, observes a second connection blocking,
then checks one official result and one replay, a single aggregate increment,
HTTP summary/retry stability, and guest/account Full/Mini isolation. It requires
`e2e:up` and `e2e:reset`; it never applies migrations or resets a database itself.
Real-stack acceptance passed on 2026-11-18 after starting the already installed
Docker app normally. The test used a temporary project ID
`rainbow-stats-task4-e2e` on the guarded E2E ports, preserving the older stopped
`rainbow-categories-e2e` and Crosspuns stacks. The documented `e2e:up` and
`e2e:reset` workflow applied fixtures only to this newly created stack.

All four overlapping-completion cases passed: guest/account × Full/Mini, with
one official, one saved replay, a single aggregate increment, and stable
PostgREST summary/retry results. Account setup/sign-in exercised local GoTrue.
Three genuine concurrent import cases passed too: same-device import is a no-op
for the loser; two-device imports and import/account-completion collisions reject
with 23505, fully roll back the losing transaction, then succeed on retry with
one account official and unchanged completion orders. The test now asserts those
outcomes. These retries are test-driven explicit retries, **not** a new automatic
client retry feature. The task stack was stopped afterward; existing stacks and
the private UI preview were unchanged. No live migration, reset or deployment
was performed. Production rollout still requires the normal migration and
frontend release procedure; no stats reset is included.
