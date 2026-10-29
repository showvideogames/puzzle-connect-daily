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
