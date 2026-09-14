// Custom visual replacement for the plain emoji score grid shown on the
// completed-puzzle page. Styled to read as a miniature version of the
// puzzle tiles (mini-tile corner radius, a fixed near-black "Ink" border)
// rather than soft pill/dot chips — the Ink hex is the same fixed value as
// --ink in index.css, used literally (not the CSS var) so the border stays
// a consistent near-black outline in both light and dark mode, matching
// the fixed, non-theme-adaptive brand fill colors below.
//
// Row DATA is not decided here — GameBoard.tsx derives `rows` from the same
// state.guessHistory used to build the Share Score text
// (generateShareLines/generateShareText), including each submitted word's
// own true category membership for incorrect/one-away guesses and each
// hint's real chronological position, so the two always describe the same
// real solve path. This component only knows how to paint each row kind.
export type ResultCellKind = "yellow" | "green" | "blue" | "red" | "rainbow";
export type ResultRow =
  | { type: "guess"; cells: ResultCellKind[] }
  | { type: "hint"; hint: "bulb" | "flashlight" };

const INK = "#292825";
const SLATE = "#65635E";
const WARM_YELLOW = "#F6D968";

const CELL_SIZE = "w-[clamp(28px,7.5vw,38px)] h-[clamp(28px,7.5vw,38px)]";
// Hint icons read as their own compact event row rather than a fourth guess
// cell, so they're sized a touch narrower than a full result cell per the
// design direction ("can be slightly narrower").
const HINT_ICON_SIZE = "w-[clamp(22px,6vw,30px)] h-[clamp(22px,6vw,30px)]";

// Five roughly-equal color bands with short blend zones at each boundary —
// reads clearly as distinct colors rather than one continuous, muddy smear.
const RAINBOW_GRADIENT = `linear-gradient(
  115deg,
  #F6D968 0%,
  #F6D968 16%,
  #8CCB91 24%,
  #8CCB91 36%,
  #7DB9DD 44%,
  #7DB9DD 56%,
  #9B7BE5 64%,
  #9B7BE5 76%,
  #E9786D 84%,
  #E9786D 100%
)`;

const SOLID_FILLS: Record<Exclude<ResultCellKind, "rainbow">, string> = {
  yellow: "#F6D968",
  green: "#8CCB91",
  blue: "#7DB9DD",
  red: "#E9786D",
};

// Simple flat bulb silhouette: warm-yellow glass, three short Slate rays, a
// muted Ink/Slate base — no square backdrop, no gloss, no thick outline.
function LightbulbIcon() {
  return (
    <svg viewBox="0 0 24 24" className={`${HINT_ICON_SIZE}`} aria-hidden="true">
      <line x1="12" y1="0.5" x2="12" y2="2.5" stroke={SLATE} strokeWidth="1.4" strokeLinecap="round" />
      <line x1="3.5" y1="5.5" x2="5.1" y2="7.1" stroke={SLATE} strokeWidth="1.4" strokeLinecap="round" />
      <line x1="20.5" y1="5.5" x2="18.9" y2="7.1" stroke={SLATE} strokeWidth="1.4" strokeLinecap="round" />
      <path
        d="M12 3.5a6.2 6.2 0 0 0-3.4 11.4c.55.36.9.98.9 1.66v.44h5v-.44c0-.68.35-1.3.9-1.66A6.2 6.2 0 0 0 12 3.5z"
        fill={WARM_YELLOW}
        stroke={INK}
        strokeWidth="1"
      />
      <rect x="9.4" y="17.6" width="5.2" height="1.4" rx="0.5" fill={SLATE} />
      <rect x="9.7" y="19.2" width="4.6" height="1.3" rx="0.5" fill={SLATE} />
      <rect x="10.1" y="20.7" width="3.8" height="1.1" rx="0.5" fill={INK} />
    </svg>
  );
}

// Simple flat flashlight: Slate/Ink body, a warm-yellow lens with two short
// beam strokes — angled slightly, no square backdrop, no gloss.
function FlashlightIcon() {
  return (
    <svg viewBox="0 0 28 20" className={`${HINT_ICON_SIZE}`} aria-hidden="true" style={{ transform: "rotate(-14deg)" }}>
      <line x1="1" y1="6.5" x2="3.2" y2="7.6" stroke={WARM_YELLOW} strokeWidth="1.2" strokeLinecap="round" opacity="0.65" />
      <line x1="1" y1="13.5" x2="3.2" y2="12.4" stroke={WARM_YELLOW} strokeWidth="1.2" strokeLinecap="round" opacity="0.65" />
      <circle cx="5.5" cy="10" r="3.4" fill={WARM_YELLOW} stroke={INK} strokeWidth="0.8" />
      <path d="M8 6.6h4.5v6.8H8a1.2 1.2 0 0 1-1.2-1.2V7.8A1.2 1.2 0 0 1 8 6.6z" fill={INK} />
      <rect x="12.3" y="7.4" width="10.2" height="5.2" rx="1.4" fill={SLATE} stroke={INK} strokeWidth="0.8" />
      <rect x="15.4" y="5.6" width="2" height="1.8" rx="0.4" fill={INK} />
    </svg>
  );
}

interface ResultGridProps {
  rows: ResultRow[];
}

export function ResultGrid({ rows }: ResultGridProps) {
  return (
    <div className="flex flex-col items-center gap-[3px]">
      {rows.map((row, rowIndex) =>
        row.type === "hint" ? (
          // A compact centered event row — no cells, no square backdrop, no
          // label — reserved full-width so it reads as its own moment in the
          // chronology rather than a guess or a fake category row.
          <div key={rowIndex} className="w-full flex items-center justify-center py-1">
            {row.hint === "bulb" ? <LightbulbIcon /> : <FlashlightIcon />}
          </div>
        ) : (
          <div key={rowIndex} className="flex gap-[3px]">
            {row.cells.map((kind, i) => (
              <div
                key={i}
                className={`${CELL_SIZE} rounded-[4px] border-2`}
                style={{
                  borderColor: INK,
                  ...(kind === "rainbow"
                    ? { backgroundImage: RAINBOW_GRADIENT }
                    : { backgroundColor: SOLID_FILLS[kind] }),
                }}
              />
            ))}
          </div>
        )
      )}
    </div>
  );
}
