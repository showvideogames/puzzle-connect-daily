# Welcome to your Lovable project

TODO: Document your project here

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
