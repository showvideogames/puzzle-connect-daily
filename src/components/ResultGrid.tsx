// Custom visual replacement for the plain emoji score grid shown on the
// completed-puzzle page. This is purely decorative — it always renders the
// same 5 rows in brand color order and never reflects the actual guess
// history/mistakes (that stays exact in the copied Share Score text, built
// separately from generateShareLines/generateShareText in GameBoard.tsx).
const CELL_SIZE = "w-[clamp(24px,6vw,32px)] h-[clamp(24px,6vw,32px)]";

const ROWS: { key: string; style: React.CSSProperties }[] = [
  {
    key: "rainbow",
    style: {
      backgroundImage:
        "linear-gradient(115deg, #F6D968 0%, #F6D968 12%, #8CCB91 34%, #7DB9DD 58%, #9B7BE5 76%, #E9786D 100%)",
    },
  },
  { key: "red", style: { backgroundColor: "#E9786D" } },
  { key: "blue", style: { backgroundColor: "#7DB9DD" } },
  { key: "green", style: { backgroundColor: "#8CCB91" } },
  { key: "yellow", style: { backgroundColor: "#F6D968" } },
];

export function ResultGrid() {
  return (
    <div className="flex flex-col items-center gap-1">
      {ROWS.map((row) => (
        <div key={row.key} className="flex gap-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className={`${CELL_SIZE} rounded-md border border-black/35`}
              style={row.style}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
