/**
 * The preset backgrounds a creator can put behind their cover emoji (Community
 * preview). Keys are stored; the server accepts only these keys (the CHECK in
 * supabase/migrations/0009_community_covers_multi_and_likes.sql lists the same set, and a unit
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
  group: "rainbow" | "solid" | "pattern" | "motif";
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
  // Extra gradients with calmer centers for bright emoji.
  { key: "peach-sorbet", label: "Peach sorbet", color: "#FFB487", group: "rainbow", image: "linear-gradient(158deg,#FFEAA7,#FFA886 68%,#F27894)" },
  { key: "northern-lights", label: "Northern lights", color: "#124C56", group: "rainbow", image: "radial-gradient(ellipse at 20% 105%,#4BAE8B,transparent 70%),linear-gradient(140deg,#162649,#205A64 62%,#665792)" },
  { key: "rosey-dawn", label: "Rosy dawn", color: "#FFB5C8", group: "rainbow", image: "linear-gradient(160deg,#FFDBB4,#F9A8C9 50%,#AB92DC)" },
  { key: "pool-party", label: "Pool party", color: "#54CEDE", group: "rainbow", image: "linear-gradient(145deg,#94EEBC,#56CFE1 58%,#4E8BE1)" },
  { key: "blue-hour", label: "Blue hour", color: "#435A91", group: "rainbow", image: "linear-gradient(160deg,#1F2F65,#4F6BA8 58%,#7998CB)" },
  { key: "lemon-lime", label: "Lemon lime", color: "#C5EB81", group: "rainbow", image: "linear-gradient(145deg,#FFF0A0,#D9EC87 48%,#82C99C)" },
  { key: "plum-velvet", label: "Plum velvet", color: "#753F79", group: "rainbow", image: "radial-gradient(ellipse at 50% 42%,#995782,#46294F 86%)" },
  { key: "watermelon-split", label: "Watermelon split", color: "#FB9C94", group: "rainbow", image: "linear-gradient(155deg,#FBB3AA 0 64%,#FDE4AF 64% 68%,#62B590 68%)" },
  // Plain palette additions, including dark and neutral grounds.
  { key: "frost-blue", label: "Frost blue", color: "#D9EFFF", group: "solid" },
  { key: "tomato", label: "Tomato", color: "#DA4F49", group: "solid" },
  { key: "tart-cherry", label: "Tart cherry", color: "#9C325A", group: "solid" },
  { key: "evergreen", label: "Evergreen", color: "#214D42", group: "solid" },
  { key: "deep-navy", label: "Deep navy", color: "#24395E", group: "solid" },
  { key: "periwinkle", label: "Periwinkle", color: "#8C9AE5", group: "solid" },
  { key: "marigold", label: "Marigold", color: "#F5B744", group: "solid" },
  { key: "warm-sand", label: "Warm sand", color: "#EDD1A7", group: "solid" },
  { key: "oat-paper", label: "Oat paper", color: "#F5EEE6", group: "solid" },
  // Prints: play with direction, scale, and paper texture rather than busy pictures.
  { key: "picnic-gingham", label: "Picnic gingham", color: "#FFF3EF", group: "pattern", image: "linear-gradient(#EE707F45 50%,transparent 50%),linear-gradient(90deg,#EE707F45 50%,transparent 50%)", size: "32px 32px" },
  { key: "blueberry-gingham", label: "Blueberry gingham", color: "#DBE4FC", group: "pattern", image: "linear-gradient(#637CB94D 50%,transparent 50%),linear-gradient(90deg,#637CB94D 50%,transparent 50%)", size: "40px 40px" },
  { key: "school-paper", label: "Notebook paper", color: "#FFFCF3", group: "pattern", image: "linear-gradient(90deg,transparent 18%,#DE8F9F 18% 19%,transparent 19%),repeating-linear-gradient(0deg,#A9CEF0 0 1px,transparent 1px 17px)" },
  { key: "graph-paper", label: "Graph paper", color: "#DDF2EE", group: "pattern", ...grid("#91BFB8", 16) },
  { key: "navy-pinstripe", label: "Navy pinstripe", color: "#243858", group: "pattern", image: "repeating-linear-gradient(90deg,#5E7291 0 1px,transparent 1px 12px)" },
  { key: "citrus-dots", label: "Citrus dots", color: "#FFC462", group: "pattern", ...dots("#FFF5C9", 2, 12) },
  { key: "purple-disco", label: "Purple disco", color: "#6C4AA4", group: "pattern", ...checks("#9878C3", 12) },
  { key: "caramel-weave", label: "Caramel weave", color: "#D49B6D", group: "pattern", image: "repeating-linear-gradient(45deg,#713B231C 0 1px,transparent 1px 6px),repeating-linear-gradient(-45deg,#FFF7CA42 0 1px,transparent 1px 8px)" },
  { key: "seaglass-scales", label: "Sea glass scales", color: "#65BEAE", group: "pattern", image: "radial-gradient(circle at 50% 100%,transparent 9px,#B8EDDA 10px 11px,transparent 12px),radial-gradient(circle at 50% 0%,transparent 9px,#B8EDDA 10px 11px,transparent 12px)", size: "24px 20px" },
  { key: "retro-mosaic", label: "Retro mosaic", color: "#F3CB86", group: "pattern", image: "conic-gradient(from 45deg,#E18E6D 25%,#EBC27E 0 50%,#C7D8B0 0 75%,#EAD7A7 0)", size: "32px 32px" },
  // Moody and playful options, with small repeating motifs behind the emoji.
  { key: "moonlit", label: "Moonlit", color: "#26365E", group: "motif", ...svg("<path d='M14 6a8 8 0 1 0 9 10 8 8 0 0 1-9-10z' fill='#F5DF9D'/><circle cx='33' cy='8' r='1.2' fill='#C8D5EE'/><circle cx='29' cy='27' r='1' fill='#C8D5EE'/>", 45, 37) },
  { key: "snowfall", label: "Snowfall", color: "#78ADCA", group: "motif", ...svg("<path d='M12 4v14M5 11h14M7 6l10 10M17 6 7 16' fill='none' stroke='#E5F7FC' stroke-width='1.4'/><circle cx='31' cy='23' r='1.7' fill='#D8F1FA'/>", 38, 32) },
  { key: "daisy-field", label: "Daisy field", color: "#A7C99F", group: "motif", ...svg("<path d='M12 13c-7-7 4-10 5-3 6-6 13 1 6 5 9 4 2 13-5 7-1 9-12 7-10-1-8-1-7-10 4-8z' fill='#FDF4D2'/><circle cx='17' cy='17' r='3.1' fill='#DA9C47'/>", 41, 41) },
  { key: "sugar-hearts", label: "Sugar hearts", color: "#F2A6BA", group: "motif", ...svg("<path d='M4 9C4 3 11 3 14 8C17 3 24 3 24 9C24 14 14 20 14 20S4 14 4 9Z' fill='#FFE2DA'/><circle cx='32' cy='24' r='1.7' fill='#FFD6CE'/>", 41, 34) },
  { key: "daydream-clouds", label: "Daydream clouds", color: "#9AC9EF", group: "motif", ...svg("<path d='M4 24a6 6 0 0 1 6-6 8 8 0 0 1 15-2 5 5 0 0 1 9 4 4 4 0 0 1 0 8H9a5 5 0 0 1-5-4z' fill='#E9F7FF'/>", 52, 42) },
  { key: "desert-dunes", label: "Desert dunes", color: "#F0C5A1", group: "motif", ...svg("<path d='M0 22Q16 5 32 15T64 19V29H0Z' fill='#D99C77'/><path d='M0 23Q21 13 40 22T64 16V29H0Z' fill='#AE6C56' opacity='.45'/>", 64, 29) },
  { key: "botanical-stems", label: "Botanical stems", color: "#356958", group: "motif", ...svg("<path d='M10 33 23 8M14 24Q2 12 15 20M16 20Q29 21 27 13M19 14Q11 6 18 7' fill='none' stroke='#A7C892' stroke-width='1.7'/>", 37, 38) },
  { key: "arcade-pixels", label: "Arcade pixels", color: "#3D306A", group: "motif", ...svg("<path d='M4 8h4v4H4zm8 4h4v4h-4zm4-8h4v4h-4z' fill='#B994EE'/><path d='M24 19h4v4h-4zm5 5h4v4h-4z' fill='#72CFBD'/>", 42, 36) },
  { key: "retro-orbits", label: "Retro orbits", color: "#576EA3", group: "motif", ...svg("<ellipse cx='20' cy='18' rx='13' ry='5' fill='none' stroke='#B9BBE5' transform='rotate(-30 20 18)'/><circle cx='20' cy='18' r='3.1' fill='#ECAF99'/><circle cx='39' cy='31' r='1.4' fill='#C8D6F1'/>", 48, 39) },
  { key: "little-lightning", label: "Little lightning", color: "#404052", group: "motif", ...svg("<path d='m13 6-4 8h5l-1 7 8-11h-6l3-4z' fill='#FADF84'/><circle cx='30' cy='25' r='1' fill='#DFBDDF'/>", 37, 32) },
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
