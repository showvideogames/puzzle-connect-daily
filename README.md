# Welcome to your Lovable project

TODO: Document your project here

## Accounts and the database

Rainbow's only sign-in is the shared account service (WorkOS AuthKit), reached
through Supabase Auth's `custom:platform` provider; Rainbow keeps no passwords
and sends no email. Guests play with a per-browser device credential. The
whole database is `supabase/migrations/` (one baseline file, applicable to a
blank project), and `supabase/RAINBOW-OWNED-OBJECTS.md` lists exactly what
Rainbow owns. See `docs/CONFIG-INVENTORY.md` for every environment value,
`docs/WORKOS-LOCAL-SMOKE.md` for the manual sign-in test, and
`docs/PHASE-2-HOSTED-CHANGE-PREVIEW.md` for the pending beta reset.

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
