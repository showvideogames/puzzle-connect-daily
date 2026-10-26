/**
 * Browser/home-screen icons and name per game. Rainbow and Mini are one app
 * sharing one index.html, but each has its own favicon, Apple touch icon,
 * web-app manifest and home-screen name (apple-mobile-web-app-title, marked
 * `data-app-title`; the manifests carry the same name).
 *
 * index.html ships Rainbow's set, each tag marked `data-app-icon="<key>"`.
 * Two things switch it to Mini's:
 *   - the build writes a mini.html copy with Mini's hrefs (vite.config.ts),
 *     and vercel.json serves it for /mini and /mini/*, so a direct visit —
 *     the one a phone saves to its home screen — has the right icons in the
 *     HTML itself;
 *   - AppIconSync swaps the hrefs on in-app navigation between the games.
 *
 * Icon files live in public/icons/ under names ending in the first 8 hex
 * characters of their SHA-256, so a changed image always gets a new URL.
 * Safari keeps its own favicon store and does not reliably refetch when only
 * a ?v= query changes, which is why the old fixed names kept showing stale
 * art. When an icon changes: add the new file under its new hashed name,
 * update the hrefs here, the tags in index.html, the manifests, and the
 * legacy redirects in vercel.json (src/test/appIcons.test.ts checks all of
 * it). The manifests themselves keep stable URLs (installed apps are tied to
 * them); bump MANIFEST_VERSION when their content changes.
 */
export const MANIFEST_VERSION = "20261025b";

export type AppIconKey = "icon32" | "ico" | "apple" | "manifest";

export const RAINBOW_ICONS: Record<AppIconKey, string> = {
  icon32: "/icons/rainbow-favicon-32x32-2cbde970.png",
  ico: "/icons/rainbow-favicon-07c6f0f1.ico",
  apple: "/icons/rainbow-apple-touch-icon-e5ee3a28.png",
  manifest: `/site.webmanifest?v=${MANIFEST_VERSION}`,
};

export const MINI_ICONS: Record<AppIconKey, string> = {
  icon32: "/icons/mini-favicon-32x32-646d7866.png",
  ico: "/icons/mini-favicon-f4546936.ico",
  apple: "/icons/mini-apple-touch-icon-50ebe6fa.png",
  manifest: `/mini.webmanifest?v=${MANIFEST_VERSION}`,
};

export const RAINBOW_HOME_TITLE = "🌈 Categories";
export const MINI_HOME_TITLE = "🌈 Mini";

export function isMiniPath(pathname: string): boolean {
  return pathname === "/mini" || pathname.startsWith("/mini/");
}

export function iconsForPath(pathname: string): Record<AppIconKey, string> {
  return isMiniPath(pathname) ? MINI_ICONS : RAINBOW_ICONS;
}

export function homeTitleForPath(pathname: string): string {
  return isMiniPath(pathname) ? MINI_HOME_TITLE : RAINBOW_HOME_TITLE;
}

/** Set the iPhone home-screen name tag; untouched if already there. */
export function applyHomeTitle(title: string, doc: Document = document): void {
  const el = doc.querySelector<HTMLMetaElement>("meta[data-app-title]");
  if (el && el.getAttribute("content") !== title) el.setAttribute("content", title);
}

/** Point the document's icon tags at the given set; untouched if already there. */
export function applyAppIcons(icons: Record<AppIconKey, string>, doc: Document = document): void {
  for (const key of Object.keys(icons) as AppIconKey[]) {
    const el = doc.querySelector<HTMLLinkElement>(`link[data-app-icon="${key}"]`);
    if (el && el.getAttribute("href") !== icons[key]) el.setAttribute("href", icons[key]);
  }
}
