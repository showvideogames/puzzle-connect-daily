/**
 * Signing a fixture account in WITHOUT the shared sign-in page.
 *
 * Rainbow's only sign-in method is the shared identity provider (WorkOS),
 * whose hosted page refuses automated browsers by design. The browser suite
 * therefore never drives it. Instead a test asks the LOCAL GoTrue for a
 * session directly (password grant: the local stack keeps the email provider
 * on for exactly this; the hosted project does not) and hands that session
 * to the app the way a completed callback would have — in localStorage under
 * the client's storage key — then reloads.
 *
 * What this still exercises for real: the JWT is a genuine GoTrue token, so
 * `rainbow_uid()`, `ensure_account()`, `has_role(...)` and every RLS policy
 * run server-side exactly as in production. What it does not exercise is the
 * OIDC round trip itself, which is covered by the manual smoke tests.
 */

import { expect, type Page } from "@playwright/test";
import { loadE2eConfig } from "../env.ts";

const config = loadE2eConfig();

/**
 * The Supabase client's storage key (src/integrations/supabase/client.ts and
 * src/lib/platformSignIn.ts). Repeated here rather than imported: the e2e
 * harness compiles without Vite's `import.meta.env` types, and a test must
 * not pull the app's runtime modules into Node anyway.
 */
export const AUTH_STORAGE_KEY = "rc-auth";

export interface FixtureCredentials {
  email: string;
  password: string;
}

interface GoTrueSession {
  access_token: string;
  token_type: string;
  expires_in: number;
  expires_at?: number;
  refresh_token: string;
  user: { id: string; email?: string };
}

/** A real session from the local GoTrue for a seeded account. */
export async function sessionFromLocalGoTrue(credentials: FixtureCredentials): Promise<GoTrueSession> {
  const response = await fetch(`${config.apiUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: config.anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email: credentials.email, password: credentials.password }),
  });
  if (!response.ok) {
    throw new Error(`Local GoTrue refused the fixture sign-in for ${credentials.email}: ${response.status} ${await response.text()}`);
  }
  const session = (await response.json()) as GoTrueSession;
  if (!session.expires_at) session.expires_at = Math.floor(Date.now() / 1000) + session.expires_in;
  return session;
}

/**
 * Sign the page in as a seeded account and reload so the app boots with the
 * session, exactly as it does after /auth/callback. Waits for the app shell,
 * i.e. for OnboardingGate to have run ensure_account + resolve_device_import.
 */
export async function signInAs(page: Page, credentials: FixtureCredentials): Promise<GoTrueSession> {
  const session = await sessionFromLocalGoTrue(credentials);
  await page.evaluate(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    [AUTH_STORAGE_KEY, JSON.stringify(session)] as const
  );
  await page.reload();
  // "Signed in" means OnboardingGate has finished asking the server: it is
  // then showing either the app (any page, admin included), the one-time
  // import decision, or the saving-unavailable notice over the app — but
  // never the checking spinner. Wait for React to mount, then for the
  // spinner to be gone.
  await expect(
    page.locator('[data-testid="onboarding-checking"], [data-testid="onboarding-decision"], header, main, h1').first()
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("onboarding-checking")).toHaveCount(0, { timeout: 30_000 });
  return session;
}

/** Signs in as the fixture admin and waits for the admin page. */
export async function signInAsAdmin(page: Page, credentials: FixtureCredentials): Promise<void> {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Admin Login" })).toBeVisible();
  await signInAs(page, credentials);
  await expect(page.getByRole("heading", { name: "Puzzle Admin" })).toBeVisible({ timeout: 20_000 });
}

/** The session the app currently holds, or null. */
export async function storedSession(page: Page): Promise<GoTrueSession | null> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as GoTrueSession) : null;
  }, AUTH_STORAGE_KEY);
}
