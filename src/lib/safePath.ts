/**
 * Return-path safety for the sign-in round trip.
 *
 * Before the browser leaves for the shared sign-in page, the path the player
 * was on is remembered so they land back on it afterwards. Only a path on
 * THIS origin is ever accepted; anything else silently becomes the home
 * page. A full URL is never stored or followed, so a crafted link cannot
 * bounce a player somewhere else after signing in.
 *
 * Copied from the proven integration kit (shared-accounts-poc,
 * apps/shared/safe-path.ts), with Rainbow's storage key.
 */

export function safeInternalPath(candidate: unknown, ownOrigin: string, fallback = "/"): string {
  if (typeof candidate !== "string") return fallback;
  const value = candidate.trim();
  if (value === "" || value.length > 512) return fallback;
  // Must be a single-slash absolute path. Rejects "//evil.test", "/\evil.test",
  // "https://evil.test", "javascript:..." and anything with control characters.
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback;
  let resolved: URL;
  try {
    resolved = new URL(value, ownOrigin);
  } catch {
    return fallback;
  }
  if (resolved.origin !== new URL(ownOrigin).origin) return fallback;
  return resolved.pathname + resolved.search + resolved.hash;
}

const RETURN_KEY = "rc-auth-return-to";

/** Remember where the player is, before leaving for the sign-in page. Same tab only. */
export function rememberReturnPath(ownOrigin: string = window.location.origin): void {
  const here = window.location.pathname + window.location.search;
  const safe = safeInternalPath(here, ownOrigin);
  try {
    sessionStorage.setItem(RETURN_KEY, safe.startsWith("/auth/") ? "/" : safe);
  } catch {
    // storage blocked: the player simply lands on the home page
  }
}

/** Read it back once. Always re-validated: storage is not trusted. */
export function takeReturnPath(ownOrigin: string = window.location.origin): string {
  let stored: string | null = null;
  try {
    stored = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
  } catch {
    // ignore
  }
  return safeInternalPath(stored, ownOrigin);
}
