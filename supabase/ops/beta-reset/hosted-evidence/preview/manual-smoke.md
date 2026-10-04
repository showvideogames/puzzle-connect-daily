# Manual WorkOS smoke on the Vercel preview (2026-10-04)

Preview: `https://puzzle-connect-daily-5wgbwst2y-showvideogames-2326s-projects.vercel.app` (this branch, hosted beta project, WorkOS Staging).
Driven in Deb's ordinary Chrome through the Claude in Chrome extension; Deb typed the password and the
emailed verification code herself and changed the test person's email in the WorkOS dashboard. Hosted AuthKit was
never automated; no human check was bypassed (none appeared). Every result below was read from the hosted
database with `manual-smoke-query.sql`.

Test identity: the Phase 1 Staging person (`user_01M3SV4ZFENGMPAXH8NRTYYKH4`), reused throughout.

| Case | What was done | Hosted database result |
|---|---|---|
| S1 | Guest guesses on archive puzzle #102 (device `12fe57c3`), Sign In (email + password + emailed code, since the address changed in Phase 1 was unverified), **Add My Progress** | auth user `a2c7ee9a` created by GoTrue with a `custom:platform` identity; one `accounts` row with the Phase 1 `global_user_id`; device `12fe57c3` retired `imported`, `claimed_by` the account; the guest session now owned by it. **PASS** |
| S4 | Sign Out (auth session revoked: 0 sessions), guest guess on the Mini archive puzzle on the rotated device `29229486`, Sign In again (silent: the Staging session survived the local sign-out), prompt for the new device, **Add My Progress** | still one account, same `global_user_id`; device `29229486` retired `imported`, claimed by the account; its sessions owned; 1 auth session. **PASS** |
| S6 | Email changed at WorkOS to `+rainbow3` (unverified), Sign Out, Sign In (silent) | `account_email()` = `+rainbow3` (from the identity); `auth.users.email` still `+rainbow2`; same `global_user_id`; one account; games unchanged (3); the account menu showed `samwestgames+rainbow3@gmail.com`. **PASS** (the approved S6 behaviour, now proven on hosted) |
| S7 | Delete account… → Delete; Sign In again | Deletion: 9 auth users again, no account, the 3 sessions kept with `user_id` and `device_id` null, `claimed_by` cleared on both devices, aggregates unchanged (280). Re-sign-in: **first attempt refused by GoTrue** ("Unverified email with custom:platform. A confirmation email has been sent"), because the hosted project has Confirm email ON and the provider reported `email_verified: false` for the hand-edited address; GoTrue created the new auth user `0679c454` unconfirmed and emailed a confirmation. Deb clicked it; the next Sign In completed: one account on `0679c454`, same `global_user_id`, email `+rainbow3`, 0 games. **PASS, with finding F1** |

## Findings

- **F0 (fixed during the run):** the preview's `/auth/callback` was not on the hosted redirect allow-list, so the first callback landed on the live site's Site URL. Added with `workos:hosted-beta allow-callback`. Every preview URL used for sign-in testing must be allow-listed (or the allow-list must carry a wildcard for the project's preview hosts).
- **F1 (hosted-only behaviour):** a first-ever sign-in whose WorkOS email is unverified does not complete on the hosted project (Confirm email ON): GoTrue creates the auth user unconfirmed and sends its own confirmation email. The local stack (Confirm email OFF) never shows this. Normal WorkOS sign-ups verify the address with a code, so real players do not hit it; it only arises after a dashboard edit of the email. The app's callback page showed the server's message and a way back to the game, as designed.
- The import prompt reports "0 games played" for a device whose only history is an unfinished game with recorded guesses; the import still applies (sessions move with the device). Cosmetic; the count is of completed games.

## Database changes left by the tests

Kept: the test person's hosted auth user `0679c454` (confirmed, `custom:platform` identity) and its empty `accounts` row, for further beta testing. Removed by `manual-smoke-cleanup.sql`: the three in-progress smoke sessions (and their guess events) and the two retired smoke devices. Aggregates never changed (no game was completed). CrossPuns, other auth users and storage untouched.
