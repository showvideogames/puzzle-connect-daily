// Custom visual replacement for the plain emoji score grid shown on the
// completed-puzzle page. Styled to read as a miniature version of the
// puzzle tiles (mini-tile corner radius, a fixed near-black "Ink" border)
// rather than soft pill/dot chips — the Ink hex is the same fixed value as
// --ink in index.css, used literally (not the CSS var) so the border stays
// a consistent near-black outline in both light and dark mode, matching
// the fixed, non-theme-adaptive brand fill colors below.
//
// Row DATA is not decided here — GameBoard.tsx derives `rows` from the same
// state.guessHistory used to build the Share Score text (generateShareLines/
// generateShareText), so the two always describe the same real solve order.
// This component only knows how to paint each row kind.
export type ResultRowKind = "rainbow" | "yellow" | "green" | "blue" | "red" | "wrong";

const INK = "#292825";

const CELL_SIZE = "w-[clamp(28px,7.5vw,38px)] h-[clamp(28px,7.5vw,38px)]";

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

const SOLID_FILLS: Partial<Record<ResultRowKind, string>> = {
  yellow: "#F6D968",
  green: "#8CCB91",
  blue: "#7DB9DD",
  red: "#E9786D",
};

interface ResultGridProps {
  rows: ResultRowKind[];
}

export function ResultGrid({ rows }: ResultGridProps) {
  return (
    <div className="flex flex-col items-center gap-[3px]">
      {rows.map((kind, rowIndex) => (
        <div key={rowIndex} className="flex gap-[3px]">
          {Array.from({ length: 4 }).map((_, i) =>
            kind === "wrong" ? (
              // Wrong guesses get a neutral, theme-adaptive fill (reusing the
              // existing --muted token: warm gray/cream in light mode, muted
              // charcoal in dark mode) rather than red, which already means
              // the Red category. A faint "x" marks it as a miss without
              // competing with the solid category-color rows.
              <div
                key={i}
                className={`${CELL_SIZE} rounded-[4px] border-2 bg-muted flex items-center justify-center`}
                style={{ borderColor: INK }}
              >
                <span className="text-[10px] leading-none select-none text-black/25 dark:text-white/25">
                  ✕
                </span>
              </div>
            ) : (
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
            )
          )}
        </div>
      ))}
    </div>
  );
}
