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
export const SIGN_IN_CHANGED = "Your sign-in changed while it was being checked.";

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

/** The user id in a stored session's text. Null when it can't be parsed or has no usable id. */
export function sessionOwner(session: string): string | null {
  try {
    const id = JSON.parse(session)?.user?.id;
    return typeof id === "string" && id !== "" ? id : null;
  } catch {
    return null;
  }
}

/** Who holds the stored session: a user id, null when nothing is stored, undefined when we can't tell. */
export function storedSessionOwner(): string | null | undefined {
  try {
    const session = localStorage.getItem(AUTH_STORAGE_KEY);
    return session === null ? null : sessionOwner(session) ?? undefined;
  } catch {
    return undefined;
  }
}

export interface RainbowAccount {
  user_id: string;
  /** The permanent identity key: the shared provider's subject (`user_…`). */
  global_user_id: string;
  /**
   * The account's CURRENT email, as the server's account_email() reports it:
   * the provider identity's address, which GoTrue refreshes on every sign-in.
   * NOT auth.users.email, which GoTrue sets once and never updates (Staging
   * smoke case S6). Display only; never an identity key.
   */
  email: string | null;
  created_at: string;
}

// ── The current account: one client-side source, fed by the server ──
//
// ensureAccount() runs on every signed-in load (useAccountOnboarding) and
// after the callback, so whatever it last returned IS the account the app
// is showing. Anything that displays account details reads this rather
// than the auth user object, whose email is stale after a change at the
// shared provider.

type AccountListener = (account: RainbowAccount | null) => void;
let currentAccount: RainbowAccount | null = null;
const accountListeners = new Set<AccountListener>();

// What the newest check said is tracked apart from currentAccount, because a
// failed check deliberately leaves currentAccount in place for the UI.
// ensureAccount() calls can overlap (the callback page and onboarding both run
// one), so each takes a number and the answer comes from the newest. An older
// check's late ok is dropped and touches none of this, and so is the ok of a
// check whose stored session changed under it. A confirmation still records who
// it confirmed and counts only while that person is currentAccount.
let accountChecksRunning = 0;
let latestAccountCheck = 0;
let latestCheckConfirmedUserId: string | null = null;
let latestCheckSaidNotAnAccount = false;
let signInGeneration = 0;

/**
 * A sign-in ended or failed somewhere publishAccount() cannot see. The account
 * stays on screen, but no earlier answer counts, and a check still running
 * began too early to earn a new one.
 */
export function forgetAccountConfirmation(): void {
  latestAccountCheck += 1;
  latestCheckConfirmedUserId = null;
  latestCheckSaidNotAnAccount = false;
  signInGeneration += 1;
}

/**
 * Moves when a different person is published or a confirmation is forgotten,
 * so anything kept per sign-in compares it. A re-check that publishes the same
 * person, or fails at ensure_account, leaves it alone. One that fails earlier,
 * at onboarding's user check, forgets the confirmation and so moves it.
 */
export function accountSignInGeneration(): number {
  return signInGeneration;
}

function publishAccount(account: RainbowAccount | null): void {
  // Only the generation moves here: forgetting would retire the check that is
  // publishing this very answer.
  if (account?.user_id !== currentAccount?.user_id) signInGeneration += 1;
  currentAccount = account;
  if (!account) forgetAccountConfirmation();
  for (const listener of accountListeners) listener(account);
}

/** The Rainbow account behind the current session, or null (guest, unknown, or not a Rainbow account). */
export function getCurrentAccount(): RainbowAccount | null {
  return currentAccount;
}

/**
 * What the account checks have settled, which getCurrentAccount() cannot say
 * because it keeps the last account through a re-check and a failed check.
 *
 *   confirmed       nothing running, and the newest check confirmed the person
 *                   who is currentAccount
 *   not_an_account  nothing running, and the newest check's own answer was
 *                   not_platform_linked. not_signed_in does not count: the
 *                   server saw no session, which says nothing about one still
 *                   stored here
 *   unsettled       everything else: no check yet, one running, one failed, or
 *                   the answer was forgotten
 */
export function accountCheckState(): "confirmed" | "not_an_account" | "unsettled" {
  if (accountChecksRunning > 0) return "unsettled";
  if (latestCheckSaidNotAnAccount) return "not_an_account";
  if (latestCheckConfirmedUserId !== null && latestCheckConfirmedUserId === currentAccount?.user_id) return "confirmed";
  return "unsettled";
}

/** Whether a check is running now, which accountCheckState() can't say: its "unsettled" also covers one that failed. */
export const accountCheckRunning = () => accountChecksRunning > 0;

/** Subscribe to changes of the current account; returns the unsubscribe function. */
export function subscribeToCurrentAccount(listener: AccountListener): () => void {
  accountListeners.add(listener);
  return () => {
    accountListeners.delete(listener);
  };
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
  const thisCheck = beginAccountCheck();
  let confirmedUserId: string | null = null;
  try {
    const result = await askServerForAccount(thisCheck);
    if (!thisCheck.droppedOk) confirmedUserId = result.account?.user_id ?? null;
    return result;
  } finally {
    endAccountCheck(thisCheck, confirmedUserId);
  }
}

interface AccountCheck {
  number: number;
  /** Who held the stored session as this check opened, as storedSessionOwner() says. */
  startedFor: string | null | undefined;
  /** The server said ok, and that answer came too late to count. */
  droppedOk: boolean;
}

/** Opens a check. */
function beginAccountCheck(): AccountCheck {
  latestAccountCheck += 1;
  accountChecksRunning += 1;
  return { number: latestAccountCheck, startedFor: storedSessionOwner(), droppedOk: false };
}

/**
 * Whether this check still speaks for the sign-in: nothing newer has opened or
 * been forgotten, and a session it began with still has the same owner. A check
 * that began with no readable session has no owner to compare, so a session
 * arriving during it changes nothing. A token refresh keeps the owner.
 */
function isCurrentCheck(check: AccountCheck): boolean {
  if (check.number !== latestAccountCheck) return false;
  return typeof check.startedFor !== "string" || storedSessionOwner() === check.startedFor;
}

/** Closes a check. confirmedUserId is who it confirmed, or null if nobody. */
function endAccountCheck(check: AccountCheck, confirmedUserId: string | null): void {
  accountChecksRunning -= 1;
  // An older check finishing late can spoil a confirmation but never set one,
  // and a dropped ok does neither.
  if (check.number === latestAccountCheck) {
    latestCheckConfirmedUserId = confirmedUserId;
    latestCheckSaidNotAnAccount = false;
  } else if (confirmedUserId === null && !check.droppedOk) {
    latestCheckConfirmedUserId = null;
  }
}

/**
 * This check's own answer that the auth user is not a Rainbow account.
 * publishAccount(null) retires every running check, this one included, so
 * whether this is the newest must be read before it and recorded after it.
 */
function publishNotAnAccount(thisCheck: AccountCheck): void {
  const newest = thisCheck.number === latestAccountCheck;
  publishAccount(null);
  latestCheckSaidNotAnAccount = newest;
}

/**
 * A late ok changes no account state, and nobody is told. The callback page and
 * onboarding overlap in an ordinary sign-in, so the caller of the older check
 * still hears ok when the answer is about whoever is signed in now: its work can
 * carry on, and the newest check does the publishing. Otherwise the answer is
 * about someone else, and the caller gets an honest failure.
 */
function dropLateOk(check: AccountCheck, account: RainbowAccount): EnsureAccountResult {
  check.droppedOk = true;
  return storedSessionOwner() === account.user_id
    ? { ok: true, account, reason: "ok", message: "" }
    : { ok: false, account: null, reason: "unavailable", message: SIGN_IN_CHANGED };
}

/** One row of the ensure_account answer. Only an `ok` row fills in the account's fields. */
type AccountAnswer = RainbowAccount & { outcome?: string };

async function askServerForAccount(thisCheck: AccountCheck): Promise<EnsureAccountResult> {
  const { data, error } = await supabase.rpc("ensure_account");
  if (error) return { ok: false, account: null, reason: "unavailable", message: error.message };
  const row = (Array.isArray(data) ? data[0] : data) as AccountAnswer | null | undefined;
  const result = applyAccountAnswer(thisCheck, row);
  // The auth user exists but is not a Rainbow account. Drop the local session
  // so the app carries on as a guest.
  if (result.reason === "not_platform_linked") await supabase.auth.signOut({ scope: "local" });
  return result;
}

/** Applies the server's answer to an open check, and says what it amounted to. */
function applyAccountAnswer(check: AccountCheck, row: AccountAnswer | null | undefined): EnsureAccountResult {
  switch (row?.outcome) {
    case "ok": {
      if (!row.user_id) break;
      const account: RainbowAccount = {
        user_id: row.user_id,
        global_user_id: row.global_user_id,
        email: row.email ?? null,
        created_at: row.created_at,
      };
      if (!isCurrentCheck(check)) return dropLateOk(check, account);
      publishAccount(account);
      return { ok: true, account, reason: "ok", message: "" };
    }
    case "not_platform_linked":
      publishNotAnAccount(check);
      return { ok: false, account: null, reason: "not_platform_linked", message: NOT_RAINBOW_ACCOUNT };
    case "not_signed_in":
      publishAccount(null);
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
    publishAccount(null);
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
