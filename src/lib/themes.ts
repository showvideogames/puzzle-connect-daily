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
    gradient: "linear-gradient(to right, #b22234, #7a1f3d, #3c3b6e)",
    emoji: "🇺🇸",
    label: "Flag",
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

/** Selectable theme options for the admin puzzle form. */
export const THEME_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Default (Rainbow 🌈)" },
  ...Object.entries(THEMES).map(([value, t]) => ({ value, label: `${t.label} ${t.emoji}` })),
];
