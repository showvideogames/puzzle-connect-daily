# End-to-end tests

Browser tests that open the real Rainbow Categories app and play it, against a
throwaway copy of the real backend.

Nothing here can touch production. That is enforced, not promised — see
[Safety](#safety).

---

## TL;DR

```bash
npm ci
npm run e2e:install     # one-off: download the Chromium Playwright uses
npm run e2e:up          # start the disposable local Supabase stack
npm run e2e:reset       # build the schema from scratch and seed the fixtures
npm run e2e:test        # run the suite
```

`npm run e2e:doctor` explains what is missing if any of those refuse.

---

## Prerequisites

| What | Why | Notes |
| --- | --- | --- |
| Node 20+ | everything | the repo is already on it |
| **Docker Desktop** (or Podman) | the local Supabase stack runs in containers | **required for the browser suite** |
| ~2 GB disk | Supabase images + a Chromium build | one-off |

Windows, macOS and Linux are all supported. Every command is a Node script —
there is no shell scripting to go wrong on Windows.

### Running without Docker

Without a container runtime the browser suite **cannot run**, and it will not
pretend otherwise: `npm run e2e:up` stops with an explanation rather than
falling back to anything.

One thing still works, and it is worth running:

```bash
npm run e2e:db:verify
```

That applies the pre-git baseline and **every migration** to a clean
in-process Postgres (PGlite — real PostgreSQL compiled to WebAssembly), then
runs the **entire seed** through the application's own RPCs, so
`validate_puzzle_content`, `admin_save_puzzle`'s versioning logic and the
admin-role gate all genuinely execute. It takes about ten seconds.

Be clear about what it does and does not prove:

* ✅ the schema builds from nothing, and the fixtures are valid
* ❌ nothing about PostgREST, GoTrue, HTTP, table GRANTs or the browser

It is a fast migration check, not a substitute for the E2E suite.

---

## Architecture

```
  ┌─ e2e/supabase/        a SECOND Supabase project directory, linked to
  │                       nothing, on its own ports (54421-54424).
  │                       migrations/ is empty on purpose.
  │
  ├─ e2e/schema/          how a clean database becomes this project's schema:
  │                       reset → pre-git tables → every migration (with the
  │                       pre-git columns spliced in) → pre-git policies
  │
  ├─ e2e/fixtures/        typed fixture definitions + the payload builders,
  │                       which REUSE the app's own buildContentPayload
  │
  ├─ e2e/scripts/         up / reset / seed / down / doctor / verify-db
  │
  ├─ e2e/support/         the Playwright fixture (clock, storage, request
  │                       blocking, error gating) and the game helpers
  │
  └─ e2e/tests/           full · mini · admin · persistence · custom ·
                          isolation · layout · theme
```

### Why Playwright

It was already a devDependency, its browsers were already installed, and it is
the only one of the mainstream options that gives all of: a real project
matrix, traces you can step through after a CI failure, `page.clock` for a
fixed date, and first-class `getByRole` selectors. No reason was found to
depart from it.

### Only the services this suite needs are started

`e2e/scripts/up.ts` passes `-x storage-api,imgproxy,realtime,edge-runtime,
logflare,vector,supavisor`. Disabling something in `config.toml` stops the CLI
STARTING it but not PRE-PULLING its image, and pulling images this suite has
no use for is how a first run filled a disk and took the Docker engine down
with it. What is kept: db, auth (GoTrue), rest (PostgREST), kong — the real
data and authentication path — plus studio, postgres-meta and mailpit.

### Why a second Supabase project directory

`supabase/` at the repository root is **linked to the production project**.
Running the E2E stack from there would mean one mistyped command away from
`db push` against production, and it would share the CLI's default ports with
a developer's ordinary local stack.

`e2e/supabase/` has its own `config.toml`, no project ref at all, and ports
outside the default range. `supabase --workdir e2e` cannot reach production
because there is nothing there to reach it with.

### Why the schema is applied by hand instead of `supabase db reset`

**A clean database plus this repository's migrations is not the production
schema.** Six tables (`game_sessions`, `guess_events`, `user_streaks`,
`puzzle_ratings`, `puzzle_aggregates`, `feedback`) and eight columns on
`puzzles`/`puzzle_groups` were created in Lovable's editor and were never
written as migrations — the migrations only ever `ALTER` them. The first
migration that touches `game_sessions` fails on a truly empty database.

So `e2e/scripts/lib/schema.ts` owns the order:

1. `000_reset.sql` — drop `public`, recreate it, restore Supabase's bootstrap
   grants, clear `auth.users`
2. `010_pre_git_tables.sql` — the six tables, with RLS enabled
3. every file in `supabase/migrations/`, in filename order …
4. … with `020_pre_git_columns.sql` spliced in just before
   `20260917120000`, the first migration that reads those columns
5. `030_pre_git_policies.sql` — RLS for the three pre-git tables no migration
   defines

Both backends (the real stack and PGlite) use that same plan, so they cannot
drift. The one difference is `e2e/schema/pglite/000_supabase_stubs.sql`, which
stands in for GoTrue's `auth` schema and is **never** applied to the real
stack.

> **Known gap, stated plainly:** production's live RLS for `puzzle_ratings`,
> `puzzle_aggregates` and `feedback` is not in git and could not be read while
> this was written. `030_pre_git_policies.sql` reconstructs it from how the
> app uses each table and from the recorded security audit. If production ever
> turns out to differ, fix it there and here — do not loosen a test to match.

### How authentication works

There is no fake session and no injected token.

* `npm run e2e:reset` creates the fixture accounts through **GoTrue's admin
  API**, already email-confirmed.
* The admin account is made an admin by a row in `public.user_roles` — the
  same thing a real deployment does out of band.
* The seed then **signs in as that admin with its real password** and calls
  `admin_save_puzzle` over PostgREST, exactly as the Admin page does. The
  RPC's own `has_role(auth.uid(), 'admin')` check therefore runs at seed time:
  a broken admin gate fails the seed, not just the tests.
* `admin.spec.ts` types the same email and password into the real login form.

### The fixtures

Seeded through `admin_save_puzzle` and `create_custom_puzzle`, never by
inserting rows — so a fixture the real builder could not produce is rejected
by `validate_puzzle_content` at seed time.

| Key | What | Date | Notes |
| --- | --- | --- | --- |
| `fullRainbow` | Full 4×4, Rainbow | **2026-06-15** | today's Full; Rainbow is `SURF/CARD/SNOW/DASH` → "___ Board" |
| `fullClassic` | Full 4×4, Classic | 2026-06-12 | the Full archive target |
| `miniRainbow` | Mini 3×3, Rainbow | **2026-06-15** | today's Mini; three Rainbow answers |
| `miniClassic` | Mini 3×3, Classic | 2026-06-12 | the Mini archive target |
| `fullVersionSandbox` | Full 4×4, **Draft** | 2026-06-10 | only the Admin versioning test edits it |
| `customPublic` | public custom puzzle | — | created anonymously, like a real visitor |
| `admin` / `player` | accounts | — | `e2e-admin@` / `e2e-player@rainbow.test` |

**2026-06-15 is "today"** for every test: the Playwright fixture pins the
browser clock with `page.clock.setFixedTime` and the timezone to UTC. That is
why the dates above never change and the archive fixtures sit in the same
month — no month navigation, no dependence on the real calendar.

Ids the database generates (puzzle uuids, the custom puzzle's share id and
short code) are written to `e2e/.artifacts/seed-manifest.json` and read by the
tests through the `seed` fixture.

### The project matrix

Deliberately small — not a cross-product:

| Project | Viewport | Runs |
| --- | --- | --- |
| `desktop-light` | 1280×800 | everything except `@theme` |
| `mobile-light` | 375×812 | only `@responsive` |
| `desktop-dark` | 1280×800, dark | only `@theme` |

Re-running every functional assertion at every width would triple the runtime
to re-prove logic that has nothing to do with viewport size. What genuinely
varies is layout and colour, so that is what the extra projects run.

Dark mode here is a **localStorage setting**, not `prefers-color-scheme`, so
`theme.spec.ts` seeds `connections-settings.darkMode` — emulating the media
query alone would prove nothing.

---

## Safety

The E2E system is built so that writing to production is not a mistake you
*avoid*, it is a thing that cannot happen.

**1. The runtime guard — `e2e/safety.ts`.** Every destructive command (reset,
seed, and the browser suite's global setup) calls `assertDisposableTarget()`
before touching anything. It refuses unless *all* of:

* every endpoint — API, database, app — is loopback (or a host explicitly
  designated disposable, for a CI container network);
* **no** value matches a production marker (`*.supabase.co`,
  `rainbowcategories.com`, `*.lovable.app`, …) — deny always beats allow, so a
  "designated" host on the deny list is still refused;
* no key is a hosted-project credential (a JWT with a `ref` claim, or the
  `sb_secret_` / `sb_publishable_` formats);
* nothing contains the project ref from the repo's own `supabase/config.toml`;
* nothing is copied verbatim out of the repo's own `.env`.

It is covered by `src/test/e2eSafetyGuard.test.ts`, so it runs in the ordinary
Vitest suite on every commit — including on machines that cannot run the
browser suite at all.

**2. The bundler guard — `vite.config.ts`.** Vite layers `.env.e2e` on top of
`.env`, and `.env` holds the real Supabase URL. A missing or half-written
`.env.e2e` would therefore *inherit production*. In `--mode e2e` the build
refuses to start unless the resolved `VITE_SUPABASE_URL` is loopback.

**3. The browser guard — `e2e/support/fixtures.ts`.** Every request to a host
other than `127.0.0.1`/`localhost` is aborted. index.html loads Google
Analytics on every page; without this, a test run would send real hits to the
live property — completed games, archive visits, share clicks — from a
database full of fake puzzles. The two known analytics hosts are blocked
silently and asserted on in `tests/isolation.spec.ts`; **any other** host
fails the test that reached for it.

**4. No secrets, anywhere.** `.env.e2e` is generated by `npm run e2e:up` from
the local stack's own `supabase status`, and is git-ignored. The committed
[`.env.e2e.example`](../.env.e2e.example) documents the shape and contains no
keys. CI needs **zero** secrets.

**5. No silent fallback.** If the local stack is not running, commands stop
with a diagnostic. Nothing degrades to production, and nothing degrades to
mocks pretending to be production.

---

## Commands

| Command | What it does |
| --- | --- |
| `npm run e2e:install` | download the Chromium build Playwright needs |
| `npm run e2e:doctor` | read-only diagnosis of the environment |
| `npm run e2e:up` | start the disposable stack, write `.env.e2e` |
| `npm run e2e:reset` | rebuild the schema from nothing and seed the fixtures |
| `npm run e2e:seed` | re-seed only (faster; use when only fixtures changed) |
| `npm run e2e:down` | stop the stack (`-- --purge` also deletes its data) |
| `npm run e2e:smoke` | the `@smoke` subset |
| `npm run e2e:test` | the whole suite |
| `npm run e2e:headed` | the suite in a visible browser |
| `npm run e2e:debug` | the Playwright inspector, step by step |
| `npm run e2e:ui` | Playwright's interactive UI mode |
| `npm run e2e:report` | open the last HTML report |
| `npm run e2e:db:verify` | migrations + seed on in-process Postgres (no Docker) |

`e2e:reset` and `e2e:seed` are idempotent: they clear first, so running either
twice gives the same result.

---

## What is covered

**Full** (`tests/full.spec.ts`) — the landing screen leads into today's board ·
16 tiles in four columns · the instruction and the four-mistake allowance ·
selecting and submitting a category · finding the Rainbow by submitting its
four answers (the real path, not the bonus prompt) · results, share controls
and a frozen completed state that survives a reload · the archive calendar
opening the intended Full puzzle · no Mini content on any Full page.

**Mini** (`tests/mini.spec.ts`) — nine *square* tiles in three columns
(measured) · three-answer groups · a three-answer Rainbow, one per category ·
a revealed Rainbow tile accepting a regular category-colour ring · no running
clock during play, a frozen time afterwards that survives a reload · share
text with the `Mini #…` heading, 3-wide rows, the `⏳` line and the `/mini`
address · the Mini archive holding only Minis · no Full content on any Mini
page.

**Admin** (`tests/admin.spec.ts`) — signing in through the real form · a
non-admin refused · an incomplete Rainbow **rejected**, with the database
checked to prove nothing was saved as Classic instead · saving the same
content as Classic · answers stored uppercase including `JACK-IN-THE-BOX` ·
category names, emoji and hints round-tripping · Start Over clearing the date
while keeping the editing identity until Update · Mini defaulting to Classic,
switching to Rainbow, and saving three Rainbow answers · an unchanged re-save
minting no version, a gameplay change minting one.

**Persistence and identity** (`tests/persistence.spec.ts`) — a refresh
restoring solved groups, mistakes and the Rainbow · palette marks restoring ·
the Mini timer surviving a refresh and continuing from the banked total ·
a guest receiving a device credential whose games stay anonymous · signing in
and choosing *Start Fresh* leaving the guest's history unclaimed.

> **Hidden-tab time is deliberately not asserted here.** It is real behaviour
> and it is tested — `src/test/miniTimer.test.tsx` drives `document.hidden`
> and the `visibilitychange` event directly. It cannot be tested from a real
> browser: a headless Chromium page stays `visibilityState === "visible"`
> even with another page fronted, and CDP's
> `Emulation.setPageVisibilityState` has been removed from the protocol. An
> earlier version of this test appeared to pass while measuring nothing,
> which is worse than the gap.

**Custom** (`tests/custom.spec.ts`) — a public custom puzzle loading · the
header stats button opening the *player's* stats · *Puzzle Stats* opening
*this puzzle's* · *Create Your Own* routing to `/create` · the support CTA
staying hidden while `VITE_SUPPORT_URL` is unset · a completed play landing in
the local database and nowhere else.

**Isolation** (`tests/isolation.spec.ts`) — the app really does try to load
Google's analytics tag, it really is blocked, and the only off-machine hosts
attempted are the two known analytics ones · every Supabase call goes to a
loopback origin. (Analytics is blocked *silently* — it is loaded on every page
by `index.html`, so failing every test over it would only teach everyone to
ignore the signal. Anything else that tries to leave the machine fails the
test it happened in.)

**Layout** (`tests/layout.spec.ts`, `@responsive`) — no horizontal overflow on
the Daily, the Mini, both archives and How to Play · board column counts ·
44px header tap targets.

**Theme** (`tests/theme.spec.ts`, `@theme`) — a Full and a Mini path in dark
mode, with measured background lightness and a measured contrast ratio on a
solved bar.

### Not covered yet

* **Account import.** *Start Fresh* is covered; **Add My Progress** — the
  branch that actually moves anonymous history onto an account — is not. The
  fixtures and the sign-in helper it needs are already here.
* Beta playtesting (`/beta`), creator profiles, favourites while signed in,
  password reset, and the `/create` authoring flow.

### Next cases, in the order worth writing them

1. **Add My Progress.** The mirror of the Start Fresh test: play as a guest,
   sign in with a fresh account, choose *Add My Progress*, then assert the
   anonymous sessions now carry that `user_id` and the streak moved with
   them. The highest-value gap — it is the one path that rewrites history.
2. **A losing game.** Four wrong guesses: the loss headline, the revealed
   board, and a share grid that reports what actually happened.
3. **Creating a custom puzzle through `/create`,** then opening the link it
   produces. The one public authoring flow with no coverage at all.
4. **Hints.** Small and Full hint, their once-only rule, the view-only state
   after the game resolves, and the `💡`/`🔦` share rows.
5. **Signed-in favourites** on a custom puzzle, and `/favorites`.
6. **The Beta area** (`/beta`, `/beta/:id`) — unlisted, so nothing else
   protects it.
7. **Password reset**, using the local mail catcher on port 54424.

---

## Writing a test

* **Address things the way a person does.** `getByRole`, `getByLabel`,
  visible names. A `data-testid` only where there is genuinely no semantic
  handle — today that is the builder's category cards, the Admin puzzle rows
  and a couple of custom-page rows.
* **Never sleep to synchronise.** Wait for the state that actually arrives: a
  solved bar, a toast, a storage key, `expect.poll`. The one
  `waitForTimeout` in the suite is the *interval being measured* in the
  hidden-tab timer test, and says so.
* **Console errors, page errors and failed API calls fail the test.** If a
  test legitimately expects one, list it in `allowedConsoleErrors` for that
  test — there is no global allowlist, because that is how a real regression
  gets ignored forever.
* **Do not depend on order.** Each test gets a fresh browser context, fresh
  storage and a fresh device identity. Anything that mutates shared data uses
  its own fixture (the version sandbox) or creates its own row.

---

## CI

`.github/workflows/e2e.yml`, on every pull request and on demand.

1. **`schema`** — `npm run e2e:db:verify`: every migration on a clean database
   plus the whole seed, no Docker, ~10 s. A broken migration fails here before
   anything slower starts.
2. **`browser`** — starts the local Supabase stack on the runner's Docker,
   applies the schema from scratch, seeds, builds the app with `--mode e2e`,
   runs the suite, and stops the stack in an `always()` step.

On failure it uploads the HTML report (with traces), the raw
traces/screenshots/videos, and the stack's status. On success it uploads
nothing.

**No secrets are required**, and nothing outside the repository needs
configuring for the workflow itself to run. Two things are worth doing by
hand, in GitHub's settings, once someone decides to:

* add **End-to-end tests / Browser suite (local Supabase)** as a required
  status check on the default branch (Settings → Branches → branch protection);
* nothing else — there is no environment, no variable and no secret to add.

---

## Troubleshooting

**`No container runtime found on PATH`** — Docker Desktop is not installed or
not running. `npm run e2e:db:verify` still works meanwhile.

**`Refusing to run … the configured target is not a disposable local test
environment`** — the guard did its job. The message lists every reason. The
usual cause is a stale `.env.e2e`; delete it and re-run `npm run e2e:up`.

**`Refusing to build in e2e mode: VITE_SUPABASE_URL is …`** — same cause, seen
from the bundler. `npm run e2e:up`.

**`The local test database has not been seeded`** — `npm run e2e:reset`.

**`The seed manifest was written against a different Supabase instance`** — the
stack was recreated on different ports since the last seed. `npm run e2e:reset`.

**Ports already in use (54421-54424)** — another E2E stack is still up.
`npm run e2e:down`.

**Windows: "No container runtime found on PATH" but Docker Desktop is
running** — Docker Desktop adds itself to your USER Path, which a terminal
that was already open when you installed it will not pick up. Close the
terminal and open a new one.

**The stack comes up on ports 54321/54322 instead of 54421/54422** — the CLI
did not read `e2e/supabase/config.toml` and fell back to the repository's own
(production-linked) project directory. `--workdir` must be given the directory
CONTAINING `supabase/` — `e2e`, not `e2e/supabase`. `assertIsE2eStack` in
`e2e/env.ts` refuses to go any further when this happens, because the next
step drops a `public` schema.

**A test fails with "the page reported errors or failed requests"** — open the
`browser-problems` attachment in the HTML report (`npm run e2e:report`). It
lists page errors, console errors, failed API calls with their status and body,
and any request that tried to leave the machine.

**Everything passes locally but fails in CI** — download the
`playwright-report` artifact and open it; the traces let you step through the
failing run frame by frame.
