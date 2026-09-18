const PREFIX = "img:";

export function isCustomEmoji(word: string): boolean {
  return word.startsWith(PREFIX);
}

export function customEmojiName(word: string): string | null {
  return isCustomEmoji(word) ? word.slice(PREFIX.length) : null;
}

/**
 * A stable cache-busting token for one stored object, derived from its
 * Storage metadata rather than from the clock.
 *
 * The old `?t=${Date.now()}` was computed during render, so every React
 * re-render produced a brand-new URL for every emoji — a guaranteed cache
 * miss in both the browser and the CDN. With the Admin editor re-rendering on
 * each keystroke, one typed word could pull the whole bucket repeatedly.
 *
 * `updated_at` changes only when the object itself is replaced, so the token
 * is constant across renders and changes exactly when the bytes change.
 * Base-36 purely to keep the query string short.
 *
 * Returns null for missing/unparseable input so the caller falls back to the
 * plain, unversioned URL instead of inventing a token.
 */
export function emojiVersionToken(updatedAt: string | null | undefined): string | null {
  if (!updatedAt) return null;
  const ms = Date.parse(updatedAt);
  if (Number.isNaN(ms)) return null;
  return ms.toString(36);
}

/**
 * The public URL for a custom emoji.
 *
 * GAMEPLAY passes no version and gets the bare URL — byte-identical to what
 * has always been served. That matters: every player's browser cache and
 * every CDN entry is keyed on this exact string, and adding a query string
 * here would invalidate all of them at once, causing the very egress spike
 * this change exists to stop.
 *
 * The ADMIN manager passes a version token (see emojiVersionToken) so that
 * replacing an image shows the new artwork immediately, without a permanently
 * changing URL.
 */
export function customEmojiUrl(nameOrWord: string, version?: string | null): string {
  const name = customEmojiName(nameOrWord) ?? nameOrWord;
  const base = import.meta.env.VITE_SUPABASE_URL as string;
  const url = `${base}/storage/v1/object/public/custom-emoji/${name}.png`;
  return version ? `${url}?v=${version}` : url;
}

export function customEmojiReference(name: string): string {
  return `${PREFIX}${name}`;
}
