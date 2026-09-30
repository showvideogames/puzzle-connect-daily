/**
 * The shared sign-in glue, tested without the shared sign-in page: what the
 * app does before it leaves, what it does when it comes back, and what it
 * never keeps. The hosted page itself is never automated (it refuses
 * automated browsers by design); see the manual smoke tests.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { auth, rpc } = vi.hoisted(() => ({
  auth: {
    signInWithOAuth: vi.fn(async () => ({ error: null })),
    exchangeCodeForSession: vi.fn(async () => ({ error: null })),
    signOut: vi.fn(async () => ({ error: null })),
  },
  rpc: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth, rpc } }));

import {
  AUTH_STORAGE_KEY,
  HUB_UNAVAILABLE,
  NOT_RAINBOW_ACCOUNT,
  PLATFORM_PROVIDER,
  ensureAccount,
  forgetHubTokens,
  handleCallback,
  signInWithPlatform,
  signOutOfRainbow,
} from "@/lib/platformSignIn";
import { rememberReturnPath, safeInternalPath, takeReturnPath } from "@/lib/safePath";

const ORIGIN = "http://127.0.0.1:5183";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  auth.signInWithOAuth.mockClear();
  auth.exchangeCodeForSession.mockClear();
  auth.signOut.mockClear();
  rpc.mockReset();
  vi.unstubAllGlobals();
});

describe("safeInternalPath", () => {
  it("accepts only a same-origin absolute path and falls back for everything else", () => {
    expect(safeInternalPath("/mini/archive?x=1#y", ORIGIN)).toBe("/mini/archive?x=1#y");
    expect(safeInternalPath("//evil.test/x", ORIGIN)).toBe("/");
    expect(safeInternalPath("/\\evil.test", ORIGIN)).toBe("/");
    expect(safeInternalPath("https://evil.test/x", ORIGIN)).toBe("/");
    expect(safeInternalPath("javascript:alert(1)", ORIGIN)).toBe("/");
    expect(safeInternalPath("/ok\u0000", ORIGIN)).toBe("/");
    expect(safeInternalPath(42, ORIGIN)).toBe("/");
    expect(safeInternalPath("", ORIGIN, "/fallback")).toBe("/fallback");
  });

  it("remembers the current page once, never an /auth/ page, and re-validates on the way back", () => {
    window.history.replaceState(null, "", "/archive?d=1");
    rememberReturnPath(ORIGIN);
    expect(takeReturnPath(ORIGIN)).toBe("/archive?d=1");
    expect(takeReturnPath(ORIGIN)).toBe("/"); // read once

    window.history.replaceState(null, "", "/auth/callback");
    rememberReturnPath(ORIGIN);
    expect(takeReturnPath(ORIGIN)).toBe("/");

    sessionStorage.setItem("rc-auth-return-to", "https://evil.test/");
    expect(takeReturnPath(ORIGIN)).toBe("/");
  });
});

describe("signInWithPlatform", () => {
  it("does not leave when the sign-in service is unreachable, and says so in a sentence", async () => {
    // Accounts are configured in this test (see vitest env), so the only
    // thing between the click and the redirect is the reachability probe.
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await signInWithPlatform()).toBe(HUB_UNAVAILABLE);
    expect(auth.signInWithOAuth).not.toHaveBeenCalled();
  });

  it("leaves through Supabase's OAuth flow for the neutral provider id, with the exact callback", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    window.history.replaceState(null, "", "/mini");
    expect(await signInWithPlatform()).toBeNull();
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: PLATFORM_PROVIDER,
      options: { redirectTo: `${window.location.origin}/auth/callback`, scopes: "openid email profile" },
    });
    expect(sessionStorage.getItem("rc-auth-return-to")).toBe("/mini");
  });
});

describe("handleCallback", () => {
  it("exchanges the code, strips it from the address bar, forgets the provider token and returns home", async () => {
    window.history.replaceState(null, "", "/archive");
    rememberReturnPath(window.location.origin);
    window.history.replaceState(null, "", "/auth/callback?code=one-time-code");
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ access_token: "local", provider_token: "hub-secret", provider_refresh_token: "hub-refresh" }));

    const result = await handleCallback();
    expect(result).toEqual({ ok: true, returnTo: "/archive" });
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("one-time-code");
    expect(window.location.search).toBe("");
    expect(window.location.pathname).toBe("/auth/callback");
    const stored = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY)!);
    expect(stored).toEqual({ access_token: "local" });
  });

  it("reports a provider error without exchanging anything", async () => {
    window.history.replaceState(null, "", "/auth/callback?error=access_denied&error_description=Nope");
    const result = await handleCallback();
    expect(result).toMatchObject({ ok: false, errorCode: "access_denied", errorMessage: "Nope", returnTo: "/" });
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(window.location.search).toBe("");
  });

  it("reports a missing code", async () => {
    window.history.replaceState(null, "", "/auth/callback");
    expect(await handleCallback()).toMatchObject({ ok: false, errorCode: "missing_code" });
  });
});

describe("forgetHubTokens", () => {
  it("leaves a session without provider tokens untouched and copes with no storage entry", () => {
    forgetHubTokens();
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ access_token: "a", refresh_token: "r" }));
    forgetHubTokens();
    expect(JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY)!)).toEqual({ access_token: "a", refresh_token: "r" });
  });
});

describe("ensureAccount", () => {
  it("returns the Rainbow account row", async () => {
    rpc.mockResolvedValueOnce({ data: [{ outcome: "ok", user_id: "u1", global_user_id: "user_X", email: "a@b.test", created_at: "now" }], error: null });
    const result = await ensureAccount();
    expect(result.ok).toBe(true);
    expect(result.account?.global_user_id).toBe("user_X");
    expect(rpc).toHaveBeenCalledWith("ensure_account");
  });

  it("signs out locally and stays a guest when the auth user is not a Rainbow account", async () => {
    rpc.mockResolvedValueOnce({ data: [{ outcome: "not_platform_linked", user_id: null, global_user_id: null, email: null, created_at: null }], error: null });
    const result = await ensureAccount();
    expect(result).toMatchObject({ ok: false, reason: "not_platform_linked", message: NOT_RAINBOW_ACCOUNT });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("treats any other failure as unavailable, without signing out", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "not in schema cache" } });
    expect((await ensureAccount()).reason).toBe("unavailable");
    expect(auth.signOut).not.toHaveBeenCalled();
  });
});

describe("signOutOfRainbow", () => {
  it("signs out of this game only and rotates the guest identity", async () => {
    localStorage.setItem("rc-device-id", "old-device");
    localStorage.setItem("rc-device-token", "old-token");
    await signOutOfRainbow();
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(localStorage.getItem("rc-device-id")).toBeNull();
    expect(localStorage.getItem("rc-device-token")).toBeNull();
  });
});
