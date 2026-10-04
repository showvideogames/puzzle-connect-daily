# Configuration inventory

Everything that names a Supabase project, an environment or an outside
service. Nothing on this list lives in code: moving Rainbow/Mini to another
Supabase project, or pointing it at another sign-in environment, means
changing these values and applying `supabase/migrations/` to the new
project. See the launch-readiness plan (shared-accounts-poc,
`docs/RAINBOW-WORKOS-INTEGRATION-PLAN.md`, section 21).

`src/test/portability.test.ts` fails the build if a project ref, a hosted
Supabase address or another game's table prefix appears in `src/`,
`supabase/migrations/` or `supabase/functions/`.

## Build-time values (Vercel project settings; `.env` locally)

| Key | Purpose | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | the Supabase project | the only place the project is named, with the key below |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | its anon / publishable key | public by design |
| `VITE_PLATFORM_DISCOVERY_URL` | the shared sign-in service's OpenID discovery document | empty = accounts OFF (guest-only build) |
| `VITE_ACCOUNTS_ENABLED` | emergency switch; `"false"` hides every sign-in surface | anything else = on |
| `VITE_TURNSTILE_SITE_KEY` | Cloudflare Turnstile for the feedback form | public site key |
| `VITE_MINI_SHARE_URL` | where Mini share text points | defaults to rainbowcategories.com/mini |
| `VITE_SUPPORT_URL` | the "Keep the Puzzles Coming" link | empty hides the button |

## Supabase project: Auth settings (dashboard, per project)

| Setting | Value Rainbow needs | Why |
|---|---|---|
| Custom OIDC provider `custom:platform` | issuer = the AuthKit domain; client id + secret of Rainbow's WorkOS application; scopes `openid email profile`; PKCE on | installed by tooling, never by hand; the secret lives nowhere else |
| Site URL | `https://rainbowcategories.com` | |
| Redirect allow-list | `https://rainbowcategories.com/auth/callback` (plus preview URLs while testing) | the only page that completes a sign-in |
| Confirm email | ON | GoTrue may auto-link a shared sign-in to an existing confirmed same-email user; never to an unconfirmed one |
| Anonymous sign-ins | OFF | |
| Manual identity linking | OFF | |
| Email (password) provider | **shared beta project: ON** (another tenant's admin signs in with it); **a Rainbow-only project: OFF** | Rainbow itself never uses it; `rainbow_uid()` treats such users as guests |
| Google provider | OFF | Google sign-in, if wanted, is configured at the shared sign-in service |
| Email templates / SMTP | not needed by Rainbow | Rainbow sends no auth email |

## Supabase project: other

| Item | Value | Where it is defined |
|---|---|---|
| Storage bucket `custom-emoji` + policies | public read, admin write | `supabase/migrations/0002_rainbow_storage.sql` |
| Edge function `submit-feedback` secrets | `TURNSTILE_SECRET_KEY` (plus the Supabase-injected `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`) | function secrets |
| Migration ledger | `supabase_migrations.schema_migrations` holding `0001`, `0002`, … | written by `supabase db push`; the beta reset clears the beta-era rows |
| `supabase/config.toml` → `project_id` | the linked project ref | the CLI link only |

## The shared sign-in service (WorkOS)

| Item | Value |
|---|---|
| Application | one Connect OAuth application per GAME (`rainbow-categories`), first-party, confidential; never per Supabase project |
| Redirect URIs | `https://<supabase-ref>.supabase.co/auth/v1/callback` for every project Rainbow currently uses (add the new one, then remove the old one when moving) |
| Credentials | the application's client id + secret, held only in the Supabase provider configuration above |
| API key | local tooling only, short-lived, never stored in the repository |
| Environment | Phase 1: Staging; hosted BETA (Phase 2, 2026-10-04): Staging, temporary application `rainbow-categories-beta` (`npm run workos:hosted-beta`); launch: Production (after the proof's cleanup) |

## Local development and tests

| Item | Where |
|---|---|
| `.env` (git-ignored) | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` for local tooling |
| `.env.e2e` (generated) | the disposable local stack's own keys; `VITE_PLATFORM_DISCOVERY_URL` set from `E2E_PLATFORM_DISCOVERY_URL` for the manual smoke test only |
| `.env.test` (local only) | loopback placeholders so the unit suite can construct the client |
| `.runtime/workos-local.json` (git-ignored) | the local smoke-test application's credentials, written by `npm run workos:local -- register`; delete after use |
