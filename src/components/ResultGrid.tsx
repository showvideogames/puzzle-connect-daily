// Custom visual replacement for the plain emoji score grid shown on the
// completed-puzzle page. This is purely decorative — it always renders the
// same 5 rows in brand color order and never reflects the actual guess
// history/mistakes (that stays exact in the copied Share Score text, built
// separately from generateShareLines/generateShareText in GameBoard.tsx).
//
// Styled to read as a miniature version of the puzzle tiles (mini-tile
// corner radius, a fixed near-black "Ink" border) rather than soft pill/dot
// chips — the Ink hex is the same fixed value as --ink in index.css, used
// literally (not the CSS var) so the border stays a consistent near-black
// outline in both light and dark mode, matching the fixed, non-theme-
// adaptive brand fill colors below.
const INK = "#292825";

const CELL_SIZE = "w-[clamp(28px,7.5vw,38px)] h-[clamp(28px,7.5vw,38px)]";

const ROWS: { key: string; style: React.CSSProperties }[] = [
  {
    key: "rainbow",
    style: {
      // Five roughly-equal color bands with short blend zones at each
      // boundary — reads clearly as distinct colors rather than one
      // continuous, muddy smear across the whole cell.
      backgroundImage: `linear-gradient(
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
      )`,
    },
  },
  { key: "red", style: { backgroundColor: "#E9786D" } },
  { key: "blue", style: { backgroundColor: "#7DB9DD" } },
  { key: "green", style: { backgroundColor: "#8CCB91" } },
  { key: "yellow", style: { backgroundColor: "#F6D968" } },
];

export function ResultGrid() {
  return (
    <div className="flex flex-col items-center gap-[3px]">
      {ROWS.map((row) => (
        <div key={row.key} className="flex gap-[3px]">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className={`${CELL_SIZE} rounded-[4px] border-2`}
              style={{ ...row.style, borderColor: INK }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
