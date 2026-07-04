// Per-puzzle visual themes for the bonus ("Rainbow") category.
//
// A puzzle's nullable `theme` field selects one of these. `null` or an unknown
// value falls back to DEFAULT_THEME, which reproduces the original rainbow
// visuals exactly. Adding a holiday theme is just adding one entry to THEMES
// below — no game logic changes. Themes are purely cosmetic: they never affect
// scoring, saving, or the bonus-find mechanic.

export interface PuzzleTheme {
  /** Left-to-right gradient for the bonus reveal box, "spot" button, and hint chip. */
  gradient: string;
  /** Emoji paired with the bonus label across copy (e.g. 🌈, 🇺🇸). */
  emoji: string;
  /** Noun for the bonus category, used in copy ("Spot the {label}?"). */
  label: string;
  /**
   * Optional text-shadow applied over the gradient so the white bonus text stays
   * legible against light bands (e.g. the flag's white stripe). Omit for gradients
   * that are dark enough on their own (the default rainbow).
   */
  textShadow?: string;
}

/** A theme plus derived copy strings, so components stay declarative. */
export interface ResolvedTheme extends PuzzleTheme {
  /** True when this is the built-in rainbow (lets callers keep the animated rainbow tile). */
  isDefault: boolean;
  /** Category name shown when the puzzle doesn't set its own (e.g. "Rainbow 🌈"). */
  defaultCategoryName: string;
  /** Prompt on the post-completion bonus button (e.g. "Spot the Rainbow? 🌈"). */
  spotPrompt: string;
  /** Message shown when the bonus is found (e.g. "🌈 Rainbow Spotted!"). */
  spottedMessage: string;
  /** Near-miss pill copy (e.g. "Almost 🌈"). */
  almostMessage: string;
  /** One share-grid row when the bonus was found (e.g. "🌈🌈🌈🌈"). */
  shareRow: string;
}

export const DEFAULT_THEME: PuzzleTheme = {
  gradient: "linear-gradient(to right, #f97316, #eab308, #22c55e, #3b82f6, #a855f7)",
  emoji: "🌈",
  label: "Rainbow",
};

// Add new holiday themes here — one entry per theme, keyed by the string stored
// in puzzles.theme. Nothing else needs to change.
const THEMES: Record<string, PuzzleTheme> = {
  july4: {
    // Three crisp horizontal stripes — true red, white, true navy — so it reads
    // as a flag at a glance instead of blending into a muddy middle tone.
    gradient: "linear-gradient(180deg, #b22234 0%, #b22234 34%, #ffffff 34%, #ffffff 66%, #3c3b6e 66%, #3c3b6e 100%)",
    emoji: "🇺🇸",
    label: "Flag",
    // Navy outline + soft drop so white text stays readable over the white band.
    textShadow: "-1px 0 0 #16224a, 1px 0 0 #16224a, 0 -1px 0 #16224a, 0 1px 0 #16224a, 0 1px 3px rgba(0,0,0,0.35)",
  },
};

export function resolveTheme(theme: string | null | undefined): ResolvedTheme {
  const match = theme ? THEMES[theme] : undefined;
  const base = match ?? DEFAULT_THEME;
  return {
    ...base,
    isDefault: !match,
    defaultCategoryName: `${base.label} ${base.emoji}`,
    spotPrompt: `Spot the ${base.label}? ${base.emoji}`,
    spottedMessage: `${base.emoji} ${base.label} Spotted!`,
    almostMessage: `Almost ${base.emoji}`,
    shareRow: base.emoji.repeat(4),
  };
}

// ── Holiday header logo ──────────────────────────────────────────────────────
// On its day, the header wordmark ("/textlogo.png") is swapped for a holiday
// version site-wide. Date-based (local time) so it's independent of which puzzle
// is loaded. Add more holidays by extending todaysLogo().

const DEFAULT_LOGO = "/textlogo.png";
const JULY4_LOGO = "/AmericanFlagLogo.png";

/** True on July 4th in the viewer's local time. */
export function isJuly4(d: Date = new Date()): boolean {
  return d.getMonth() === 6 && d.getDate() === 4; // month is 0-indexed; 6 = July
}

/** The header wordmark logo to show today (holiday override, else the default). */
export function todaysLogo(d: Date = new Date()): string {
  return isJuly4(d) ? JULY4_LOGO : DEFAULT_LOGO;
}

/** Selectable theme options for the admin puzzle form. */
export const THEME_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Default (Rainbow 🌈)" },
  ...Object.entries(THEMES).map(([value, t]) => ({ value, label: `${t.label} ${t.emoji}` })),
];
