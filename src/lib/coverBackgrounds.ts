/**
 * The preset backgrounds a creator can put behind their cover emoji (Community
 * preview). Keys are stored; the server accepts only these keys (the CHECK in
 * supabase/migrations/0008_community_covers.sql lists the same set, and a unit
 * test holds the two together). Pure CSS: no images, nothing remote.
 *
 * Chosen to stay high-contrast behind colourful emoji: clear mid or deep
 * tones, or pale grounds with a firm pattern, never a busy picture.
 */
export interface CoverBackground {
  key: string;
  label: string;
  /** CSS background-color. */
  color: string;
  /** Optional pattern layered on top, as CSS background-image + size. */
  image?: string;
  size?: string;
}

const dots = (c: string, r = 3, gap = 18) => ({ image: `radial-gradient(${c} ${r}px, transparent ${r + 0.5}px)`, size: `${gap}px ${gap}px` });
const stripes = (c: string, angle = 45, w = 10) => ({ image: `repeating-linear-gradient(${angle}deg, ${c} 0 ${w}px, transparent ${w}px ${w * 2}px)` });
const grid = (c: string, gap = 20) => ({ image: `linear-gradient(${c} 1.5px, transparent 1.5px), linear-gradient(90deg, ${c} 1.5px, transparent 1.5px)`, size: `${gap}px ${gap}px` });
const checks = (c: string, s = 16) => ({ image: `conic-gradient(${c} 25%, transparent 0 50%, ${c} 0 75%, transparent 0)`, size: `${s * 2}px ${s * 2}px` });
/** Inline SVG tiles (data: URIs), never fetched from anywhere. */
const svg = (markup: string, w: number, h: number) => ({ image: `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>${markup}</svg>`)}")`, size: `${w}px ${h}px` });
const waves = (c: string) => svg(`<path d='M0 14 Q15 2 30 14 T60 14 V28 H0Z' fill='${c}'/>`, 60, 28);
const stars = (c: string) => svg(`<path fill='${c}' d='M9 3l1.2 3.3L13.5 7l-3.3 1.2L9 11.5 7.8 8.2 4.5 7l3.3-.7z M28 18l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z'/><circle cx='22' cy='6' r='1.3' fill='${c}'/><circle cx='5' cy='22' r='1' fill='${c}'/>`, 34, 30);
const confetti = svg(`<rect x='4' y='6' width='7' height='3' rx='1.5' fill='#FF6B6B' transform='rotate(25 7 7)'/><rect x='22' y='4' width='7' height='3' rx='1.5' fill='#2F80ED' transform='rotate(-30 25 5)'/><rect x='14' y='20' width='7' height='3' rx='1.5' fill='#44B54A' transform='rotate(60 17 21)'/><rect x='30' y='24' width='7' height='3' rx='1.5' fill='#FFB400' transform='rotate(10 33 25)'/><circle cx='34' cy='12' r='1.6' fill='#8B5CF6'/><circle cx='8' cy='28' r='1.6' fill='#FF8FC7'/>`, 40, 34);

export const COVER_BACKGROUNDS: CoverBackground[] = [
  // Solids
  { key: "lilac", label: "Lilac", color: "#C9B6FF" },
  { key: "butter", label: "Butter", color: "#FFE58F" },
  { key: "mint", label: "Mint", color: "#9FE8C2" },
  { key: "sunflower", label: "Sunflower", color: "#FFD23F" },
  { key: "tangerine", label: "Tangerine", color: "#FF8A3D" },
  { key: "coral", label: "Coral", color: "#FF6B6B" },
  { key: "bubblegum", label: "Bubblegum", color: "#FF8FC7" },
  { key: "ocean", label: "Ocean", color: "#2F80ED" },
  { key: "forest", label: "Forest", color: "#1F7A4D" },
  { key: "charcoal", label: "Charcoal", color: "#2B2B33" },
  // Simple patterns
  { key: "lime-checks", label: "Lime checks", color: "#B9EC6A", ...checks("#D8F7A2", 14) },
  { key: "apricot-stripes", label: "Apricot stripes", color: "#FFB077", ...stripes("rgba(255,255,255,0.38)", 45, 9) },
  { key: "lilac-dots", label: "Lilac dots", color: "#C9B6FF", ...dots("rgba(255,255,255,0.8)", 4, 22) },
  { key: "indigo-stars", label: "Indigo stars", color: "#2E2A8F", ...stars("#FFE27A") },
  { key: "teal-waves", label: "Teal waves", color: "#14A9A3", ...waves("#5FD8CF") },
  { key: "pink-waves", label: "Pink waves", color: "#FF9EC4", ...waves("#FFC6DC") },
  { key: "sky-grid", label: "Sky grid", color: "#8FD3FF", ...grid("rgba(255,255,255,0.75)") },
  { key: "cream-confetti", label: "Cream confetti", color: "#FFF4DC", ...confetti },
  { key: "berry-stripes", label: "Berry stripes", color: "#FF7AA8", ...stripes("rgba(255,255,255,0.28)") },
  { key: "cherry-polka", label: "Cherry polka", color: "#E63946", ...dots("rgba(255,255,255,0.9)", 5, 30) },
  { key: "sunset-split", label: "Sunset split", color: "#FF8A3D", image: "linear-gradient(135deg, #FFD23F 0 50%, transparent 50%)" },
  { key: "peach-rings", label: "Peach rings", color: "#FFC29A", image: "repeating-radial-gradient(circle at 50% 50%, rgba(255,255,255,0.45) 0 6px, transparent 6px 16px)" },
  { key: "mint-checks", label: "Mint checks", color: "#9FE8C2", ...checks("rgba(255,255,255,0.45)") },
  { key: "rainbow-bands", label: "Rainbow bands", color: "#FFFFFF", image: "linear-gradient(180deg, #FF6B6B 0 20%, #FF8A3D 20% 40%, #FFD23F 40% 60%, #5ED3A8 60% 80%, #8B5CF6 80% 100%)" },
];

export const COVER_BACKGROUND_KEYS = COVER_BACKGROUNDS.map((b) => b.key);
const BY_KEY = new Map(COVER_BACKGROUNDS.map((b) => [b.key, b]));

export function coverBackground(key: string | null | undefined): CoverBackground | null {
  return key ? BY_KEY.get(key) ?? null : null;
}

export function backgroundStyle(bg: CoverBackground): Record<string, string> {
  return {
    backgroundColor: bg.color,
    ...(bg.image ? { backgroundImage: bg.image } : {}),
    ...(bg.size ? { backgroundSize: bg.size } : {}),
  };
}
