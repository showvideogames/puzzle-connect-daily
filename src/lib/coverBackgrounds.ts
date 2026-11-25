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
  position?: string;
  /** Picker section. */
  group: "rainbow" | "solid" | "pattern";
}

const dots = (c: string, r = 3, gap = 18) => ({ image: `radial-gradient(${c} ${r}px, transparent ${r + 0.5}px)`, size: `${gap}px ${gap}px` });
const stripes = (c: string, angle = 45, w = 10) => ({ image: `repeating-linear-gradient(${angle}deg, ${c} 0 ${w}px, transparent ${w}px ${w * 2}px)` });
const grid = (c: string, gap = 20) => ({ image: `linear-gradient(${c} 1.5px, transparent 1.5px), linear-gradient(90deg, ${c} 1.5px, transparent 1.5px)`, size: `${gap}px ${gap}px` });
const checks = (c: string, s = 16) => ({ image: `conic-gradient(${c} 25%, transparent 0 50%, ${c} 0 75%, transparent 0)`, size: `${s * 2}px ${s * 2}px` });
/** Inline SVG tiles (data: URIs), never fetched from anywhere. */
const svg = (markup: string, w: number, h: number) => ({ image: `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>${markup}</svg>`)}")`, size: `${w}px ${h}px` });
const waves = (c: string) => svg(`<path d='M0 14 Q15 2 30 14 T60 14 V28 H0Z' fill='${c}'/>`, 60, 28);
const stars = (c: string) => svg(`<path fill='${c}' d='M9 3l1.2 3.3L13.5 7l-3.3 1.2L9 11.5 7.8 8.2 4.5 7l3.3-.7z M28 18l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z'/><circle cx='22' cy='6' r='1.3' fill='${c}'/><circle cx='5' cy='22' r='1' fill='${c}'/>`, 34, 30);
/**
 * Broad, smooth rainbow arcs from two opposite corners, like the real Rainbow
 * Categories tiles, leaving the middle calm for the emoji.
 */
const arcs = (colors: string[], ground: string) => {
  const band = 10, gap = 3, start = 22;
  const corner = (cx: number, cy: number) => colors.map((c, i) => {
    const r = start + (colors.length - 1 - i) * (band + gap) + band / 2;
    return `<circle cx='${cx}' cy='${cy}' r='${r}' fill='none' stroke='${c}' stroke-width='${band}'/>`;
  }).join("");
  return { image: `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 125' preserveAspectRatio='xMidYMid slice'><rect width='200' height='125' fill='${ground}'/>${corner(0, 125)}${corner(200, 0)}</svg>`)}")`, size: "cover", position: "center" };
};
const BRIGHT = ["#FF5A5F", "#FF9F1C", "#FFD23F", "#44B54A", "#2F80ED", "#8B5CF6"];
const PASTEL = ["#FFB3B5", "#FFCF99", "#FFEB99", "#A8E6A1", "#A9CCFA", "#CDB8FF"];
const terrazzo = svg(`<path d='M6 8l6-3 3 5-5 4z' fill='#FF8A65'/><path d='M30 6l5 2-2 5-5-2z' fill='#4DB6AC'/><path d='M20 24l7 1-2 6-6-2z' fill='#9575CD'/><path d='M40 28l4 4-4 3-3-4z' fill='#FFB300'/><path d='M8 36l5-1 1 5-5 1z' fill='#64B5F6'/><circle cx='46' cy='12' r='2' fill='#E57373'/><circle cx='26' cy='42' r='1.6' fill='#81C784'/>`, 52, 48);
const sparkles = svg(`<path fill='#FFFFFF' d='M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z'/><path fill='#FFE27A' d='M36 22l1 2.8 2.8 1-2.8 1-1 2.8-1-2.8-2.8-1 2.8-1z'/><circle cx='30' cy='8' r='1.2' fill='#FFFFFF'/><circle cx='8' cy='30' r='1.4' fill='#FFE27A'/>`, 44, 38);
const zigzag = svg(`<path d='M0 12 L10 4 L20 12 L30 4 L40 12' fill='none' stroke='#FFFFFF' stroke-width='3' stroke-linejoin='round' opacity='0.7'/>`, 40, 16);
const confetti = svg(`<rect x='4' y='6' width='7' height='3' rx='1.5' fill='#FF6B6B' transform='rotate(25 7 7)'/><rect x='22' y='4' width='7' height='3' rx='1.5' fill='#2F80ED' transform='rotate(-30 25 5)'/><rect x='14' y='20' width='7' height='3' rx='1.5' fill='#44B54A' transform='rotate(60 17 21)'/><rect x='30' y='24' width='7' height='3' rx='1.5' fill='#FFB400' transform='rotate(10 33 25)'/><circle cx='34' cy='12' r='1.6' fill='#8B5CF6'/><circle cx='8' cy='28' r='1.6' fill='#FF8FC7'/>`, 40, 34);

// Keys are stored: never rename or reuse one. "rainbow-bands" keeps its key and
// is now drawn as curved arcs, so covers already saved with it stay valid.
export const COVER_BACKGROUNDS: CoverBackground[] = [
  // Rainbow & gradients
  { key: "rainbow-bands", label: "Rainbow", color: "#F3FAFF", group: "rainbow", ...arcs(BRIGHT, "#F3FAFF") },
  { key: "pastel-rainbow", label: "Pastel rainbow", color: "#FFFFFF", group: "rainbow", ...arcs(PASTEL, "#FFFFFF") },
  { key: "dusk-gradient", label: "Dusk", color: "#6C4AB6", group: "rainbow", image: "linear-gradient(160deg, #3B2A8F 0%, #8B5CF6 45%, #FF8A65 100%)" },
  { key: "ocean-gradient", label: "Lagoon", color: "#14A9A3", group: "rainbow", image: "linear-gradient(160deg, #5FD8CF 0%, #14A9A3 45%, #2F80ED 100%)" },
  { key: "retro-sunburst", label: "Retro sunburst", color: "#FFB000", group: "rainbow", image: "repeating-conic-gradient(from 0deg at 50% 110%, #FFD23F 0deg 9deg, #FF8A3D 9deg 18deg)" },
  { key: "sunset-split", label: "Sunset split", color: "#FF8A3D", group: "rainbow", image: "linear-gradient(135deg, #FFD23F 0 50%, transparent 50%)" },
  // Solids
  { key: "lilac", label: "Lilac", color: "#C9B6FF", group: "solid" },
  { key: "butter", label: "Butter", color: "#FFE58F", group: "solid" },
  { key: "mint", label: "Mint", color: "#9FE8C2", group: "solid" },
  { key: "sunflower", label: "Sunflower", color: "#FFD23F", group: "solid" },
  { key: "tangerine", label: "Tangerine", color: "#FF8A3D", group: "solid" },
  { key: "coral", label: "Coral", color: "#FF6B6B", group: "solid" },
  { key: "bubblegum", label: "Bubblegum", color: "#FF8FC7", group: "solid" },
  { key: "ocean", label: "Ocean", color: "#2F80ED", group: "solid" },
  { key: "forest", label: "Forest", color: "#1F7A4D", group: "solid" },
  { key: "charcoal", label: "Charcoal", color: "#2B2B33", group: "solid" },
  // Patterns
  { key: "lime-checks", label: "Lime checks", color: "#B9EC6A", group: "pattern", ...checks("#D8F7A2", 14) },
  { key: "apricot-stripes", label: "Apricot stripes", color: "#FFB077", group: "pattern", ...stripes("rgba(255,255,255,0.38)", 45, 9) },
  { key: "lilac-dots", label: "Lilac dots", color: "#C9B6FF", group: "pattern", ...dots("rgba(255,255,255,0.8)", 4, 22) },
  { key: "indigo-stars", label: "Indigo stars", color: "#2E2A8F", group: "pattern", ...stars("#FFE27A") },
  { key: "teal-waves", label: "Teal waves", color: "#14A9A3", group: "pattern", ...waves("#5FD8CF") },
  { key: "pink-waves", label: "Pink waves", color: "#FF9EC4", group: "pattern", ...waves("#FFC6DC") },
  { key: "sky-grid", label: "Sky grid", color: "#8FD3FF", group: "pattern", ...grid("rgba(255,255,255,0.75)") },
  { key: "cream-confetti", label: "Cream confetti", color: "#FFF4DC", group: "pattern", ...confetti },
  { key: "berry-stripes", label: "Berry stripes", color: "#FF7AA8", group: "pattern", ...stripes("rgba(255,255,255,0.28)") },
  { key: "cherry-polka", label: "Cherry polka", color: "#E63946", group: "pattern", ...dots("rgba(255,255,255,0.9)", 5, 30) },
  { key: "peach-rings", label: "Peach rings", color: "#FFC29A", group: "pattern", image: "repeating-radial-gradient(circle at 50% 50%, rgba(255,255,255,0.45) 0 6px, transparent 6px 16px)" },
  { key: "mint-checks", label: "Mint checks", color: "#9FE8C2", group: "pattern", ...checks("rgba(255,255,255,0.45)") },
  { key: "terrazzo", label: "Terrazzo", color: "#FBF4EA", group: "pattern", ...terrazzo },
  { key: "sparkles", label: "Sparkles", color: "#1F3A8A", group: "pattern", ...sparkles },
  { key: "ripples", label: "Ripples", color: "#8FD3FF", group: "pattern", image: "repeating-radial-gradient(circle at 0% 100%, rgba(255,255,255,0.55) 0 5px, transparent 5px 18px)" },
  { key: "bold-checker", label: "Bold checker", color: "#26206B", group: "pattern", ...checks("#FFE58F", 18) },
  { key: "candy-stripes", label: "Candy stripes", color: "#FFF4DC", group: "pattern", ...stripes("#FF5A5F", 90, 12) },
  { key: "polka-pop", label: "Polka pop", color: "#FF4FA3", group: "pattern", ...dots("#FFE27A", 5, 26) },
  { key: "mint-zigzag", label: "Mint zigzag", color: "#3CC79A", group: "pattern", ...zigzag },
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
    ...(bg.position ? { backgroundPosition: bg.position } : {}),
  };
}
