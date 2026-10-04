# Live beta smoke (2026-10-04)

Live site `https://www.rainbowcategories.com`, Vercel production deployment `puzzle-connect-daily-ik7roizqb`, built from main `bbc7635` (the merge of PR #72). Bundle checked: hosted project ref present, WorkOS Staging discovery URL present, no Production domain, new client.

| Check | Result |
|---|---|
| Automated guest smoke (`npm run preview:check` pointed at the live site, no bypass needed on the custom domain): home, device registered on hosted, archive, Full guest play saved with a guess event, stats dialog, Mini daily, Mini guest play saved, sign-in redirects to WorkOS Staging, every account linked to a shared identity, a beta auth user is `not_platform_linked`, CrossPuns counts unchanged, no console errors; rows removed afterwards | **pass** (`preview-check.md` in this folder) |
| Real sign-in from `/admin` in Deb's Chrome with the existing test identity (silent: Staging session alive) | **pass**: returned to `www.rainbowcategories.com`, signed in, "You don't have admin access" (non-admin), one account on hosted, same WorkOS id |
| Account menu (Settings → Account) | shows `Signed in as samwestgames+rainbow3@gmail.com` (the provider's current email) |
| Sign Out | **pass**: menu back to Sign In; the hosted auth session revoked |
| CrossPuns / other auth users / storage | unchanged (`comparison.md`: after → live) |

## Live-only finding, fixed during the smoke

The live client reports its callback as `https://www.rainbowcategories.com/auth/callback` (the bare domain
redirects permanently to `www`), and the hosted allow-list only carried the bare form, so GoTrue fell back
to the Site URL and the first sign-in landed on the site root with an unusable code. Added the `www` form
with `npm run workos:hosted-beta -- allow-callback`. The allow-list is now: the bare site, both `/auth/callback`
forms, and the preview deployment's callback.

## Rows left by this verification

None beyond the test person's hosted account (kept). The automated runs removed their own sessions and
devices. Stray auth sessions of the test account from the aborted callbacks remain in `auth.sessions`
(harmless; they expire).
