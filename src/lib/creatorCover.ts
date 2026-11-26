/**
 * Creator covers (Community): one to three emoji and one preset background,
 * stored as keys. See supabase/migrations/0008 and 0009.
 *
 * The emoji are never stored as text: each key is a fully-qualified
 * code-point sequence ("1F355"), and the characters are rebuilt from it here.
 * Anything that isn't 1-3 well-formed, distinct keys with no gaps, plus a known
 * background, is treated as "no cover", so nothing a server or fixture returns
 * can turn into markup.
 */
import { coverBackground, type CoverBackground } from "./coverBackgrounds";

export const MAX_COVER_EMOJI = 3;

export interface CreatorCover {
  /** One to three emoji keys, in display order. */
  emojis: string[];
  background: string;
  /**
   * Each emoji's size, slot for slot, as a whole percentage of the standard
   * size (COVER_SIZE_MIN-COVER_SIZE_MAX). Absent means all standard, which is
   * how every cover saved before sizes existed reads.
   */
  sizes?: number[];
}

/** Per-emoji cover size bounds, in percent of the standard size (the server checks the same). */
export const COVER_SIZE_MIN = 50;
export const COVER_SIZE_MAX = 250;
export const COVER_SIZE_DEFAULT = 100;
export const COVER_SIZE_STEP = 5;

/** count whole-number sizes within bounds, or null. */
export function validSizes(sizes: unknown, count: number): number[] | null {
  if (!Array.isArray(sizes) || sizes.length !== count) return null;
  if (!sizes.every((v) => typeof v === "number" && Number.isInteger(v) && v >= COVER_SIZE_MIN && v <= COVER_SIZE_MAX)) return null;
  return sizes as number[];
}
const allStandard = (sizes: number[]) => sizes.every((v) => v === COVER_SIZE_DEFAULT);

const KEY = /^[0-9A-F]{4,6}(-[0-9A-F]{4,6}){0,9}$/;

export function emojiFromKey(key: string): string | null {
  if (typeof key !== "string" || !KEY.test(key)) return null;
  const points = key.split("-").map((h) => parseInt(h, 16));
  if (points.some((p) => p > 0x10ffff)) return null;
  return String.fromCodePoint(...points);
}

/** Valid only as 1-3 distinct valid keys in order; anything else is null. */
export function validEmojiList(keys: unknown[]): string[] | null {
  if (keys.length < 1 || keys.length > MAX_COVER_EMOJI) return null;
  if (!keys.every((k) => typeof k === "string" && emojiFromKey(k) !== null)) return null;
  if (new Set(keys).size !== keys.length) return null;
  return keys as string[];
}

/**
 * A stored cover from its columns (cover_emoji, cover_emoji_2, cover_emoji_3,
 * cover_background), or null for "no cover". A later emoji without the ones
 * before it, a duplicate, or any malformed value means no cover.
 */
export function parseCover(emoji: unknown, background: unknown, emoji2: unknown = null, emoji3: unknown = null, sizes: unknown = null): CreatorCover | null {
  if (typeof background !== "string" || !coverBackground(background)) return null;
  const raw = [emoji, emoji2, emoji3];
  const last = raw.reduce<number>((n, v, i) => (v !== null && v !== undefined ? i + 1 : n), 0);
  const list = raw.slice(0, last);
  if (list.some((v) => v === null || v === undefined)) return null;
  const emojis = validEmojiList(list);
  if (!emojis) return null;
  // Sizes that don't fit this cover exactly are ignored: it draws at standard size.
  const sized = validSizes(sizes, emojis.length);
  return sized && !allStandard(sized) ? { emojis, background, sizes: [...sized] } : { emojis, background };
}

export function resolveCover(cover: CreatorCover | null | undefined): { chars: string[]; bg: CoverBackground; scales: number[] } | null {
  if (!cover || !Array.isArray(cover.emojis)) return null;
  const emojis = validEmojiList(cover.emojis);
  const bg = coverBackground(cover.background);
  if (!emojis || !bg) return null;
  const sizes = validSizes(cover.sizes, emojis.length);
  return { chars: emojis.map((k) => emojiFromKey(k)!), bg, scales: emojis.map((_, i) => (sizes ? sizes[i] : COVER_SIZE_DEFAULT) / 100) };
}
