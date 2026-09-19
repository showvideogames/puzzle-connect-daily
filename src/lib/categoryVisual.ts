/**
 * The small visual shown for a category in the Full Hint.
 *
 * Category Emoji is its own value, kept literally (emoji, short text,
 * underscores, custom emoji codes): "___ 💬" stays "___ 💬". Only puzzles
 * saved BEFORE the field existed have no explicit value, and only those fall
 * back to reading the emoji off the end of the category title.
 */

/** Emoji at the end of a title ("Parts of a Car 🚘" -> "🚘"). Legacy fallback only. */
export function extractTrailingEmojis(str: string): string {
  try {
    const segmenter = new Intl.Segmenter();
    const segments = [...segmenter.segment(str)].map((s) => s.segment);
    const emojiRegex = /\p{Emoji}/u;
    const result: string[] = [];
    for (let i = segments.length - 1; i >= 0; i--) {
      const seg = segments[i].trim();
      if (seg === "") continue;
      if (emojiRegex.test(seg)) {
        result.unshift(seg);
      } else {
        break;
      }
    }
    return result.join("");
  } catch {
    return "";
  }
}

/** The explicit Category Emoji when one exists (kept exactly as saved), else the legacy title extraction. */
export function resolveCategoryVisual(explicit: string | null | undefined, categoryTitle: string): string {
  const own = (explicit ?? "").trim();
  return own !== "" ? own : extractTrailingEmojis(categoryTitle);
}

export type VisualPart = { type: "text"; value: string } | { type: "emoji"; name: string };

/**
 * Splits a visual into literal text and custom emoji references (":caveman:"
 * or "img:caveman") so the board can draw images for the latter and print
 * everything else exactly as written.
 */
export function splitCategoryVisual(value: string): VisualPart[] {
  const parts: VisualPart[] = [];
  const re = /:([a-z][a-z0-9_-]*):|\bimg:([a-z][a-z0-9_-]*)/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) {
    if (m.index > last) parts.push({ type: "text", value: value.slice(last, m.index) });
    parts.push({ type: "emoji", name: (m[1] ?? m[2]).toLowerCase() });
    last = m.index + m[0].length;
  }
  if (last < value.length) parts.push({ type: "text", value: value.slice(last) });
  return parts;
}
