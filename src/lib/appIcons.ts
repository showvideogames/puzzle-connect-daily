/**
 * Browser/home-screen icons per game. Rainbow and Mini are one app sharing
 * one index.html, but each has its own favicon, Apple touch icon and web-app
 * manifest.
 *
 * index.html ships Rainbow's set, each tag marked `data-app-icon="<key>"`.
 * Two things switch it to Mini's:
 *   - the build writes a mini.html copy with Mini's hrefs (vite.config.ts),
 *     and vercel.json serves it for /mini and /mini/*, so a direct visit —
 *     the one a phone saves to its home screen — has the right icons in the
 *     HTML itself;
 *   - AppIconSync swaps the hrefs on in-app navigation between the games.
 *
 * Bump ICON_VERSION whenever any icon file changes so browsers refetch.
 */
export const ICON_VERSION = "20261025";

export type AppIconKey = "icon32" | "ico" | "apple" | "manifest";

const v = `?v=${ICON_VERSION}`;

export const RAINBOW_ICONS: Record<AppIconKey, string> = {
  icon32: `/favicon-32x32.png${v}`,
  ico: `/favicon.ico${v}`,
  apple: `/apple-touch-icon.png${v}`,
  manifest: `/site.webmanifest${v}`,
};

export const MINI_ICONS: Record<AppIconKey, string> = {
  icon32: `/mini-favicon-32x32.png${v}`,
  ico: `/mini-favicon.ico${v}`,
  apple: `/mini-apple-touch-icon.png${v}`,
  manifest: `/mini.webmanifest${v}`,
};

export function isMiniPath(pathname: string): boolean {
  return pathname === "/mini" || pathname.startsWith("/mini/");
}

export function iconsForPath(pathname: string): Record<AppIconKey, string> {
  return isMiniPath(pathname) ? MINI_ICONS : RAINBOW_ICONS;
}

/** Point the document's icon tags at the given set; untouched if already there. */
export function applyAppIcons(icons: Record<AppIconKey, string>, doc: Document = document): void {
  for (const key of Object.keys(icons) as AppIconKey[]) {
    const el = doc.querySelector<HTMLLinkElement>(`link[data-app-icon="${key}"]`);
    if (el && el.getAttribute("href") !== icons[key]) el.setAttribute("href", icons[key]);
  }
}
