// Custom visual replacement for the plain emoji score grid shown on the
// completed-puzzle page. Styled to read as a miniature version of the
// puzzle tiles (mini-tile corner radius, a fixed near-black "Ink" border)
// rather than soft pill/dot chips — the Ink hex is the same fixed value as
// --ink in index.css, used literally (not the CSS var) so the border stays
// a consistent near-black outline in both light and dark mode, matching
// the fixed, non-theme-adaptive brand fill colors below.
//
// Row DATA is not decided here — GameBoard.tsx derives `rows` per-cell from
// the same state.guessHistory used to build the Share Score text
// (generateShareLines/generateShareText), including each submitted word's
// own true category membership for incorrect/one-away guesses, so the two
// always describe the same real solve path. This component only knows how
// to paint each cell kind.
export type ResultCellKind = "yellow" | "green" | "blue" | "red" | "rainbow";
export type ResultRow = ResultCellKind[];

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

const SOLID_FILLS: Record<Exclude<ResultCellKind, "rainbow">, string> = {
  yellow: "#F6D968",
  green: "#8CCB91",
  blue: "#7DB9DD",
  red: "#E9786D",
};

interface ResultGridProps {
  rows: ResultRow[];
}

export function ResultGrid({ rows }: ResultGridProps) {
  return (
    <div className="flex flex-col items-center gap-[3px]">
      {rows.map((row, rowIndex) => (
        <div key={rowIndex} className="flex gap-[3px]">
          {row.map((kind, i) => (
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
      ))}
    </div>
  );
}
