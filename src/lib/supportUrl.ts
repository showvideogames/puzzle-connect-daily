/**
 * The public "support the project" destination, configured (not hard-coded)
 * through VITE_SUPPORT_URL. It is public configuration, not a secret.
 * Returns the normalized URL only for a valid http(s) address; anything else
 * (unset, blank, "#", a javascript: URL, garbage) returns null so the UI can
 * omit the action instead of rendering a dead link.
 */
export function parseSupportUrl(raw: string | undefined | null): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function getSupportUrl(): string | null {
  return parseSupportUrl(import.meta.env.VITE_SUPPORT_URL as string | undefined);
}
