/**
 * Creator covers (Community preview): exactly one emoji and one preset
 * background, stored as two keys. See supabase/migrations/0008_community_covers.sql.
 *
 * The emoji is never stored as text: its key is the fully-qualified code-point
 * sequence ("1F355"), and the character is rebuilt from that here. Anything
 * that isn't a well-formed key plus a known background is treated as "no
 * cover", so nothing a server or fixture returns can turn into markup.
 */
import { coverBackground, type CoverBackground } from "./coverBackgrounds";

export interface CreatorCover {
  emoji: string;
  background: string;
}

const KEY = /^[0-9A-F]{4,6}(-[0-9A-F]{4,6}){0,9}$/;

export function emojiFromKey(key: string): string | null {
  if (!KEY.test(key)) return null;
  const points = key.split("-").map((h) => parseInt(h, 16));
  if (points.some((p) => p > 0x10ffff)) return null;
  return String.fromCodePoint(...points);
}

/** A stored cover pair, or null for "no cover" (including anything malformed). */
export function parseCover(emoji: unknown, background: unknown): CreatorCover | null {
  if (typeof emoji !== "string" || typeof background !== "string") return null;
  if (!emojiFromKey(emoji) || !coverBackground(background)) return null;
  return { emoji, background };
}

export function resolveCover(cover: CreatorCover | null | undefined): { char: string; bg: CoverBackground } | null {
  if (!cover) return null;
  const char = emojiFromKey(cover.emoji);
  const bg = coverBackground(cover.background);
  return char && bg ? { char, bg } : null;
}
