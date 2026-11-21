# Manual smoke test: the shared sign-in against the LOCAL stack

The one thing the automated suite deliberately never does is drive the
shared sign-in page (WorkOS AuthKit): it refuses automated browsers by
design. This runbook is how a person proves the real round trip on their
own machine, against Rainbow's disposable local Supabase stack, using the
WorkOS **Staging** environment. Nothing hosted is touched: no hosted Supabase
project, no WorkOS Production environment, no DNS.

Phase 1 of the plan requires this to pass once. Each case ends with a
database check, not an impression.

## What you need

| Item | Where from |
|---|---|
| Docker Desktop running; `npm run e2e:up` works | e2e/README.md |
| A WorkOS **Staging** API key (`sk_…`) | WorkOS dashboard → the Staging environment → API Keys. Short expiry. Export it in the shell only: `export WORKOS_STAGING_API_KEY=sk_…` |
| The Staging environment's AuthKit domain | WorkOS dashboard → Authentication → the `….authkit.app` address of the Staging environment. The tool refuses the proof's Production domain. |
| At least one sign-in method enabled in Staging | Email + Password or Magic Auth. Test people can use `@example.test` addresses; WorkOS drops mail to `.test`, so use Email + Password for them, or a real inbox you own for Magic Auth. |
| An ordinary browser (Chrome, Safari, Firefox) | Not a test-tool browser: the sign-in page's bot check fails those (proof entry E-23). |

## One-time setup

```bash
npm run e2e:up
npm run e2e:reset
export WORKOS_STAGING_API_KEY=sk_...
npm run workos:local -- register --authkit-domain <name>.authkit.app
npm run workos:local -- wire
export E2E_PLATFORM_DISCOVERY_URL=https://<name>.authkit.app/.well-known/openid-configuration
npm run e2e:up          # rewrites .env.e2e with the discovery URL (accounts ON in the build)
npm run e2e:app         # builds and serves http://127.0.0.1:5183
```

`register` creates one Connect OAuth application named `rainbow-categories-local`
in Staging whose only redirect is `http://127.0.0.1:54421/auth/v1/callback`
(the local stack's Supabase callback; WorkOS accepts loopback addresses, proof
entry E-19). `wire` installs it into the local stack as the `custom:platform`
provider. The client secret lives only in `.runtime/workos-local.json`
(git-ignored) and in the local stack.

Verification queries below run against the local database, e.g.
`docker exec supabase_db_rainbow-categories-e2e psql -U postgres -c "<sql>"`.

### Give the real browser a puzzle for today (local stack only)

The seed pins every fixture puzzle to a FIXED date (`FIXTURE_TODAY`,
2026-06-15, in `e2e/fixtures/catalog.ts`): the browser suite freezes the
page clock to that day, but a person's browser runs on the real date, so
`http://127.0.0.1:5183` shows no daily puzzle. Before the cases, move one
published Full and one published Mini fixture to today's date. This touches
the disposable local database only; `npm run e2e:reset` puts the fixtures
back afterwards.

```bash
docker exec supabase_db_rainbow-categories-e2e psql -U postgres -c "
  update public.puzzles set date = current_date
   where title in ('#902', 'Mini #12') and is_published;
  select format, date, title from public.puzzles where date = current_date;"
```

(#902 and Mini #12 are the fixtures dated `FIXTURE_TODAY`; any published Full
and Mini pair works. If the run spans midnight, run it again.)

### Which cases a person actually needs to run

The automated suite proves every database-level behaviour with a genuine
GoTrue JWT on every run, so the human set is only what a real OIDC round trip
can show. Run these four, in this order, with ONE test person in ONE ordinary
Chrome window: **S1, S4, S6, S7** (about 15 minutes). S2, S3, S5, S8, S9 and
S10 are covered by `persistence.spec.ts`, `admin.spec.ts`, the unit suite
and `npm run e2e:db:verify`; run them by hand only if a reviewer asks.

## The cases

Open http://127.0.0.1:5183 in your ordinary browser. Use a private window per
"person" so devices and sessions do not bleed between cases.

**S1 — new person, guest history, Add My Progress.** Play and finish today's
puzzle as a guest. Note the device id (`localStorage['rc-device-id']` in
devtools). Sign In → complete the hosted page as a NEW test person → back on
Rainbow → "Bring your progress with you?" → Add My Progress.
```sql
select a.global_user_id, u.email from public.accounts a join auth.users u on u.id = a.user_id;
select id, user_id, device_id from public.game_sessions where device_id = '<device id>';
select retired_reason, claimed_by from public.device_identities where device_id = '<device id>';
```
Expect: one account with a `user_…` id; the session now has that `user_id`;
the device is `imported` and `claimed_by` that user. The player's Stats show
the game.

**S2 — new person, guest history, Start Fresh.** As S1 in a fresh private
window with a second test person, choose Start Fresh. Expect: the session's
`user_id` stays null; the device is `started_fresh`; the new account has no
games.

**S3 — same person, second browser, no guest history.** In a fresh private
window (or another browser) sign in as the S1 person without playing first.
Expect: no prompt; Stats show the S1 game; `accounts` still has one row for
that `global_user_id`.

**S4 — sign out, guest play, sign in again.** In the S1 window: Sign Out
(person icon → Sign Out). Play a game as a guest. Sign In as the S1 person
again. Expect: the prompt appears again for this browser's (new) device; Add
My Progress moves the one new game onto the account.

**S5 — Mini.** Visit `/mini` signed in; play. Expect: `game_sessions.format =
'mini'` rows carry the same `user_id`; Full stats unchanged.

**S6 — email change.** Change the test person's email in the WorkOS
dashboard (Staging → Users). Sign out of Rainbow and sign in again. Expect:
the account menu shows the new email; `accounts.global_user_id` unchanged;
one `accounts` row for it; the S1 game still owned by it.
```sql
select a.global_user_id, public.account_email(a.user_id) as current_email, u.email as auth_users_email,
       i.identity_data->>'email' as identity_email
  from public.accounts a join auth.users u on u.id = a.user_id
  join auth.identities i on i.user_id = a.user_id and i.provider = 'custom:platform';
```
Known and by design (found on 2026-09-30): GoTrue refreshes the identity's
email on the next sign-in but never `auth.users.email`, so `auth_users_email`
stays at the sign-up address. Rainbow reads `account_email()` (the identity)
everywhere, so `current_email` and the menu must show the NEW address.

**S7 — delete account.** Person icon → Delete account… → Delete. Expect: the
`accounts` row and the auth user are gone; the S1 session row still exists
with `user_id` and `device_id` null; `puzzle_aggregates.total_plays` unchanged.
Sign in again as the same person: a fresh, empty account with the same
`global_user_id` on a NEW auth user, whose email is whatever the provider
reports at that moment (after S6, the new address).

**S8 — sign-in service unreachable.** In devtools, block requests to the
AuthKit domain (Network → request blocking), then press Sign In. Expect: the
message "Sign-in is temporarily unavailable…", no navigation away, guest play
still fine. Unblock, and an already signed-in tab keeps working throughout.

**S9 — admin.** Grant the S1 person the role:
`insert into public.user_roles (user_id, role) select user_id, 'admin' from public.accounts limit 1;`
Open `/admin` signed in. Expect: the builder. Open `/admin` as the S2 person:
"You don't have admin access."

**S10 — an auth user that is not a Rainbow account.** Create a plain user in
the local GoTrue (Studio at http://127.0.0.1:54423 → Authentication → Add user,
with a password), obtain a session for it the way `e2e/support/auth.ts` does,
or simply run the automated test for this case (`persistence.spec.ts`). Expect:
no `accounts` row, the app stays a guest.

Record the outcomes (pass/fail and the query results) in the Phase 1 report.

## On a hosted deployment

The same cases run against the hosted beta through `npm run workos:hosted-beta` (Staging application
for the hosted callback, provider install, redirect allow-list) and `npm run preview:check` (the
automated guest half against a preview or the live site). Two things only a hosted run shows: every
origin that starts a sign-in must have its exact `/auth/callback` on the allow-list (the live site is the
`www` host), and with Confirm email ON a first-ever sign-in whose WorkOS email is unverified is refused
by GoTrue until its confirmation email is clicked. Evidence of the 2026-10-04 runs:
`supabase/ops/beta-reset/hosted-evidence/preview/` and `.../live/`.

## Tear down

```bash
npm run workos:local -- remove      # deletes the Staging application and the local provider
unset WORKOS_STAGING_API_KEY E2E_PLATFORM_DISCOVERY_URL
npm run e2e:up                      # .env.e2e back to accounts OFF
```
Delete the API key in the WorkOS dashboard, and the test people if you like
(Staging → Users).
