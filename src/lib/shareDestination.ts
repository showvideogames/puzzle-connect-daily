/**
 * WHERE A SHARED RESULT POINTS — the one place the public-facing addresses
 * printed in share text are decided.
 *
 * Every shared result ends with a line a reader can type into a browser. That
 * line is marketing copy as much as it is a URL: it is read, retyped and
 * screenshotted, so it must be short, stable, and above all CORRECT — a
 * shared result pointing somewhere that does not resolve is worse than one
 * with no link at all.
 *
 * ── Why Mini's destination is configurable and Full's is not ──────────────
 *
 * Full has pointed at rainbowcategories.com for its whole life and is not
 * moving. Mini is expected to get its own domain — `minicategories.com` — at
 * some point after this ships, and nothing about that purchase is settled:
 * not the date, not whether the name survives contact with the registrar.
 *
 * So the future domain is deliberately NOT written throughout the codebase.
 * It is one value, in one module, read through one function. When the domain
 * is bought and pointed at the app, the change is: set the environment
 * variable (or, if it becomes permanent, edit MINI_SHARE_FALLBACK below).
 * Nothing else in the app mentions a Mini host.
 *
 * Until then, Mini shares `rainbowcategories.com/mini`, which is the address
 * that genuinely works today.
 *
 * NOTE ON SCOPE: configuring this does NOT set up a redirect. Pointing
 * minicategories.com at the app is DNS and hosting work, entirely outside
 * this module — and this value must not be changed until that work is done,
 * or every shared Mini result will advertise a dead address.
 */

/** The address to print when nothing valid is configured. Always works. */
export const MINI_SHARE_FALLBACK = "rainbowcategories.com/mini";

/**
 * Is this a share destination safe to print?
 *
 * Strict on purpose. The value ends up in text sent to other people, so a
 * misconfiguration must degrade to the known-good fallback rather than
 * publish something broken or hostile. Rejected: anything empty, anything
 * carrying a scheme (`https://`, and with it `javascript:`), anything with
 * whitespace, and anything that is not recognisably `host[/path]`.
 */
export function isValidShareDestination(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > 120) return false;
  if (/\s/.test(trimmed)) return false;
  // No scheme, no protocol-relative prefix, no credentials, no query/fragment
  // — a bare host with an optional path is the whole permitted shape.
  if (/[:@?#]/.test(trimmed) || trimmed.startsWith("//")) return false;
  // host: at least two dot-separated labels, then an optional /path.
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/[a-z0-9\-._~/]*)?$/i.test(trimmed);
}

/**
 * The public address a shared MINI result points at.
 *
 * Reads `VITE_MINI_SHARE_URL` when one is configured and valid, and falls
 * back to {@link MINI_SHARE_FALLBACK} otherwise — including when the variable
 * is absent, blank, or set to something that would not work. A production
 * build with a typo'd variable therefore still ships a working address.
 *
 * @param configured Override for tests; defaults to the build-time env value.
 */
export function miniShareDestination(configured?: unknown): string {
  const raw =
    configured !== undefined
      ? configured
      : readEnv("VITE_MINI_SHARE_URL");
  return isValidShareDestination(raw) ? raw.trim() : MINI_SHARE_FALLBACK;
}

/**
 * Vite inlines `import.meta.env.*` at build time. Wrapped in a try/catch
 * because a non-Vite consumer (a bare Node script, an older test runner)
 * has no import.meta.env at all, and a missing config must fall back, never
 * throw on a share click.
 */
function readEnv(key: string): string | undefined {
  try {
    return (import.meta.env as Record<string, string | undefined>)?.[key];
  } catch {
    return undefined;
  }
}
