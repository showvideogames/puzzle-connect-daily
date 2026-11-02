import type { ComponentType } from "react";
import { Lock } from "lucide-react";
import { resultSummary, type FriendResult } from "@/lib/friendResults";
import { quietText } from "./accountStyles";

/** Tile colors in the saved Rainbow share grid, with words for screen readers. */
const RAINBOW_TILES: Record<string, { label: string; color: string }> = {
  "🟨": { label: "yellow", color: "hsl(var(--group-1))" },
  "🟩": { label: "green", color: "hsl(var(--group-2))" },
  "🟦": { label: "blue", color: "hsl(var(--group-3))" },
  "🟥": { label: "red", color: "hsl(var(--group-4))" },
};
const RAINBOW_MARK = "🌈";

const isHintRow = (tiles: string[]) => tiles.every((tile) => tile === "💡" || tile === "🔦");

function tileName(tile: string): string {
  if (tile === RAINBOW_MARK) return "rainbow";
  return RAINBOW_TILES[tile]?.label ?? "blank";
}

function describeRow(tiles: string[]): string {
  if (tiles.every((tile) => tile === tiles[0])) return `All ${tileName(tiles[0])}`;
  return tiles.map(tileName).join(", ");
}

/** Rainbow's saved grid, one row per guess, drawn from the same text a player can share. */
function RainbowDetail({ detail }: { detail: unknown }) {
  const rows = String(detail).split("\n").map((row) => [...row.trim()]).filter((row) => row.length > 0);
  let guess = 0;
  return (
    <ol className="space-y-1" aria-label="Guesses, in order">
      {rows.map((tiles, rowIndex) => {
        if (isHintRow(tiles)) {
          return <li key={rowIndex} className={`text-base ${quietText}`}>Used a hint</li>;
        }
        guess += 1;
        return (
          <li key={rowIndex} className="flex gap-1" aria-label={`Guess ${guess}: ${describeRow(tiles)}`}>
            {tiles.map((tile, tileIndex) => (
              <span
                key={tileIndex}
                aria-hidden="true"
                className="h-7 w-11 rounded-md"
                style={{ background: tile === RAINBOW_MARK ? "linear-gradient(90deg,#f87171,#fbbf24,#4ade80,#60a5fa,#c084fc)" : RAINBOW_TILES[tile]?.color ?? "hsl(var(--tile))" }}
              />
            ))}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Each game draws its own details. Adding a game means adding one entry here,
 * and a game without one still shows its summary.
 */
const DETAIL_VIEWS: Record<string, ComponentType<{ detail: unknown }>> = {
  rainbow: RainbowDetail,
};

/** What opens under a result row. Locked means the details were never sent to this browser. */
export function ResultDetail({ result }: { result: FriendResult }) {
  if (result.detail === null) {
    return (
      <p className="flex items-start gap-3 text-base text-foreground" data-testid="result-locked">
        <Lock aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
        <span>Finish today's puzzle to see {result.isYou ? "your" : "their"} details.</span>
      </p>
    );
  }
  const View = DETAIL_VIEWS[result.gameId];
  return (
    <div data-testid="result-detail">
      {View ? <View detail={result.detail} /> : <p className={`text-base ${quietText}`}>{resultSummary(result)}</p>}
    </div>
  );
}
