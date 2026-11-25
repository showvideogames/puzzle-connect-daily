/**
 * Which cover a Community puzzle gets (components/community/PuzzleCover.tsx).
 *
 * Derived from the PUBLIC short code only: never the title, categories, words
 * or hints, so a cover can't suggest a solution, and the same puzzle gets the
 * same cover everywhere it appears. No per-puzzle art and no upload flow.
 * Eight scenes × three palettes give 24 looks, so a short list rarely repeats.
 */
export const COVER_IDS = ["shelf", "wave", "sky", "burst", "garden", "night", "hills", "confetti"] as const;
export type CoverId = (typeof COVER_IDS)[number];

export interface CoverPalette {
  bg: string;
  tile: string;
  shade: string;
}

const P = (bg: string, tile: string, shade: string): CoverPalette => ({ bg, tile, shade });
export const COVER_PALETTES: Record<CoverId, [CoverPalette, CoverPalette, CoverPalette]> = {
  shelf: [P("#ffd66b", "#ff5a5f", "#d9363d"), P("#bfe6ff", "#ff8a00", "#d66f00"), P("#ffc7d6", "#7a4fd6", "#5b33b0")],
  wave: [P("#7fd6dd", "#2f80ed", "#1b5fc0"), P("#ffd9a8", "#ff5a5f", "#d9363d"), P("#d8ccff", "#ffc21a", "#e09a00")],
  sky: [P("#9fd4ff", "#ffc21a", "#e09a00"), P("#ffd1e0", "#2f80ed", "#1b5fc0"), P("#c9f0c8", "#ff6b57", "#d84a37")],
  burst: [P("#ffc2d4", "#ff6b57", "#d84a37"), P("#fff0a8", "#8b5cf6", "#6d3fd6"), P("#bdeee6", "#2f80ed", "#1b5fc0")],
  garden: [P("#c9f0c8", "#8b5cf6", "#6d3fd6"), P("#fff1c2", "#ff5a5f", "#d9363d"), P("#d6ecff", "#ff9f1c", "#d97c00")],
  night: [P("#3b2a8f", "#ff9f1c", "#d97c00"), P("#0f4c6e", "#ffd34d", "#e0a800"), P("#5a1e5c", "#22b8a6", "#108f80")],
  hills: [P("#ffd9b8", "#22b8a6", "#108f80"), P("#cfe8ff", "#ff6b57", "#d84a37"), P("#f0e0ff", "#ffc21a", "#e09a00")],
  confetti: [P("#e4d6ff", "#7a4fd6", "#5b33b0"), P("#d9f5e5", "#2e9e6a", "#1f7a50"), P("#ffe3cc", "#e0663a", "#b84d26")],
};

export interface Cover {
  scene: CoverId;
  palette: CoverPalette;
}

export function coverFor(shortCode: string): Cover {
  let h = 2166136261;
  for (const ch of shortCode) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  // Final avalanche (murmur3 fmix32), so the low bits used below are well mixed.
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  const scene = COVER_IDS[h % COVER_IDS.length];
  return { scene, palette: COVER_PALETTES[scene][Math.floor(h / COVER_IDS.length) % 3] };
}

/** Blend two #rrggbb colours: t=0 is a, t=1 is b. */
export function mixHex(a: string, b: string, t: number): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return "#" + [0, 1, 2].map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t).toString(16).padStart(2, "0")).join("");
}

/** The soft panel colour a Featured card uses beside its cover, in light and dark mode. */
export function coverTone(cover: Cover): { light: string; dark: string } {
  // Light scenes keep a vivid tint; dark ones (night) are lifted far enough that dark text reads.
  const bg = cover.palette.bg;
  const luma = (0.299 * parseInt(bg.slice(1, 3), 16) + 0.587 * parseInt(bg.slice(3, 5), 16) + 0.114 * parseInt(bg.slice(5, 7), 16)) / 255;
  return { light: mixHex(bg, "#ffffff", luma < 0.5 ? 0.85 : 0.45), dark: mixHex(bg, "#141414", 0.8) };
}
