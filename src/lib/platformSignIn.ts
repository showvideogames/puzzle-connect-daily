/**
 * Signing in to Rainbow with the shared account.
 *
 * Rainbow has ONE sign-in method: the shared identity provider (WorkOS
 * AuthKit), wired into this project's Supabase Auth as the custom OIDC
 * provider `custom:platform`. This module is everything the app adds to use
 * it, adapted from the proven integration kit (shared-accounts-poc,
 * apps/shared/platform-signin.ts):
 *
 *   signInWithPlatform   leave for the hosted sign-in page (after checking it
 *                        is reachable, so an outage never strands the player
 *                        on a browser error page)
 *   handleCallback       runs ONLY on /auth/callback: swaps the one-time code
 *                        for a LOCAL Rainbow session and strips the code from
 *                        the address bar
 *   ensureAccount        asks the server to create/refresh the Rainbow
 *                        account behind this session (ensure_account RPC).
 *                        An auth user that did not come through the shared
 *                        sign-in is NOT a Rainbow account and is signed out
 *                        again locally
 *   signOutOfRainbow     local sign-out: this game, this browser. The shared
 *                        session and other games are untouched. The guest
 *                        identity is rotated so post-sign-out play is a
 *                        genuinely separate guest
 *   deleteMyAccount      self-service deletion of the Rainbow account
 *
 * Nothing here names a provider brand, a project or a domain: the discovery
 * URL is configuration (VITE_PLATFORM_DISCOVERY_URL) and the feature switch
 * is configuration (VITE_ACCOUNTS_ENABLED), so moving Rainbow to another
 * Supabase project, or changing the identity provider's address, changes
 * environment values and nothing here.
 */

import { supabase } from "@/integrations/supabase/client";
import { resetDeviceIdentity } from "./gameStats";
import { rememberReturnPath, takeReturnPath } from "./safePath";

/** The neutral technical name of the provider inside Supabase Auth. */
export const PLATFORM_PROVIDER = "custom:platform";

/** OpenID discovery document of the identity provider; the reachability probe. */
export const PLATFORM_DISCOVERY_URL: string = (import.meta.env.VITE_PLATFORM_DISCOVERY_URL ?? "").trim();

/**
 * Accounts are on when the provider is configured and the switch is not
 * explicitly off. The switch exists so a launch-day problem with the shared
 * sign-in can be answered by a redeploy that makes Rainbow guest-only,
 * without a schema change.
 */
export const ACCOUNTS_ENABLED: boolean =
  PLATFORM_DISCOVERY_URL !== "" && (import.meta.env.VITE_ACCOUNTS_ENABLED ?? "true") !== "false";

export const HUB_UNAVAILABLE = "Sign-in is temporarily unavailable. You can keep playing and try again later.";
export const NOT_RAINBOW_ACCOUNT = "That sign-in is not a Rainbow Categories account.";

/** The one, exactly allow-listed, callback address. The real destination is kept locally. */
export function callbackUrl(): string {
  return `${window.location.origin}/auth/callback`;
}

/**
 * Plain reachability test of the identity provider: no credentials, no
 * cookies, nothing read. Without this a provider outage would send the
 * player to a browser error page instead of a sentence.
 */
export async function hubIsReachable(timeoutMs = 8000): Promise<boolean> {
  if (!PLATFORM_DISCOVERY_URL) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    await fetch(PLATFORM_DISCOVERY_URL, { mode: "no-cors", credentials: "omit", cache: "no-store", signal: ctrl.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Leave for the shared sign-in page. Returns an error message, or null when the redirect is under way. */
export async function signInWithPlatform(): Promise<string | null> {
  if (!ACCOUNTS_ENABLED) return HUB_UNAVAILABLE;
  if (!(await hubIsReachable())) return HUB_UNAVAILABLE;
  rememberReturnPath();
  const { error } = await supabase.auth.signInWithOAuth({
    provider: PLATFORM_PROVIDER as never,
    options: { redirectTo: callbackUrl(), scopes: "openid email profile" },
  });
  return error ? error.message : null;
}

export interface CallbackResult {
  ok: boolean;
  errorCode?: string;
  errorMessage?: string;
  returnTo: string;
}

/**
 * Runs ONLY on /auth/callback. Exchanges the one-time code for a local
 * session. The code and any error text are removed from the address bar
 * (and history) immediately, whatever happens next.
 */
export async function handleCallback(): Promise<CallbackResult> {
  const returnTo = takeReturnPath();
  const url = new URL(window.location.href);
  const fromHash = new URLSearchParams(url.hash.replace(/^#/, ""));
  const pick = (k: string): string | null => url.searchParams.get(k) ?? fromHash.get(k);

  const code = pick("code");
  const errorCode = pick("error_code") ?? pick("error");
  const errorMessage = pick("error_description");

  window.history.replaceState(null, "", "/auth/callback");

  if (errorCode) return { ok: false, errorCode, errorMessage: errorMessage ?? errorCode, returnTo };
  if (!code) return { ok: false, errorCode: "missing_code", errorMessage: "No sign-in code was returned.", returnTo };

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return { ok: false, errorCode: (error as { code?: string }).code ?? "exchange_failed", errorMessage: error.message, returnTo };
  }
  forgetHubTokens();
  return { ok: true, returnTo };
}

/** The storage key the Supabase client is created with (see integrations/supabase/client.ts). */
export const AUTH_STORAGE_KEY = "rc-auth";

/**
 * After a sign-in Supabase hands the page the identity provider's own access
 * token and keeps it in browser storage. Rainbow has no use for it, and it is
 * the one thing an attacker on this page would want. Remove it at once. The
 * local Rainbow session is untouched.
 */
export function forgetHubTokens(): void {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return;
    const stored = JSON.parse(raw);
    if (stored && (stored.provider_token || stored.provider_refresh_token)) {
      delete stored.provider_token;
      delete stored.provider_refresh_token;
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(stored));
    }
  } catch {
    // storage unavailable: nothing was kept, so nothing to remove
  }
}

export interface RainbowAccount {
  user_id: string;
  global_user_id: string;
  email: string | null;
  created_at: string;
}

/** One shape rather than a discriminated union: the app compiles without strictNullChecks, where narrowing on `ok` is unreliable. */
export interface EnsureAccountResult {
  ok: boolean;
  account: RainbowAccount | null;
  reason: "ok" | "not_signed_in" | "not_platform_linked" | "unavailable";
  message: string;
}

/**
 * The server's answer to "is this session a Rainbow account?", creating the
 * account on first sight. `not_platform_linked` means the auth user exists
 * but did not come through the shared sign-in (in a shared Supabase project
 * that can be another tenant's user); Rainbow signs it out locally and the
 * person stays a guest.
 */
export async function ensureAccount(): Promise<EnsureAccountResult> {
  const { data, error } = await supabase.rpc("ensure_account");
  if (error) return { ok: false, account: null, reason: "unavailable", message: error.message };
  const row = (Array.isArray(data) ? data[0] : data) as (RainbowAccount & { outcome?: string }) | null | undefined;
  switch (row?.outcome) {
    case "ok":
      if (!row.user_id) break;
      return { ok: true, account: row, reason: "ok", message: "" };
    case "not_platform_linked":
      // The auth user exists but is not a Rainbow account. Drop the local
      // session so the app carries on as a guest.
      await supabase.auth.signOut({ scope: "local" });
      return { ok: false, account: null, reason: "not_platform_linked", message: NOT_RAINBOW_ACCOUNT };
    case "not_signed_in":
      return { ok: false, account: null, reason: "not_signed_in", message: "Not signed in." };
  }
  return { ok: false, account: null, reason: "unavailable", message: "No account row was returned." };
}

/**
 * LOCAL sign-out: this game, this browser. Then a fresh guest identity, so
 * the account holder's browser does not keep playing as the identity their
 * account already absorbed.
 */
export async function signOutOfRainbow(): Promise<void> {
  try {
    await supabase.auth.signOut({ scope: "local" });
  } finally {
    resetDeviceIdentity();
  }
}

/**
 * Delete the signed-in Rainbow account and its personal data. The shared
 * identity survives; signing in again creates a fresh, empty account.
 */
export async function deleteMyAccount(): Promise<{ ok: boolean; message?: string }> {
  const { data, error } = await supabase.rpc("delete_my_account");
  if (error) return { ok: false, message: error.message };
  if (data !== true) return { ok: false, message: "This session is not a Rainbow account." };
  // The auth user is gone server-side, so the local session is meaningless
  // and a server-side logout with its token would only be refused. Drop the
  // stored session first; signOut then finds nothing to revoke, makes no
  // request, and still tells the app it is signed out.
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    // storage unavailable: signOut will simply try the server and move on
  }
  await signOutOfRainbow();
  return { ok: true };
}
