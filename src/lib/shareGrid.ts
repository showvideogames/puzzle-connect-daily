import type { GuessAttempt, Puzzle } from "./types";
import { dedupeHintMarkers } from "./hints";
import { formatOf } from "./puzzleFormat";

const DIFFICULTY_SQUARE: Record<number, string> = {
  1: "🟨",
  2: "🟩",
  3: "🟦",
  4: "🟥",
};

/**
 * The share grid saved with a finished game (game_sessions.share_grid).
 *
 * Moved here unchanged from useGame.ts so that a game restored from the
 * server can be checked against the grid saved when it finished: the same
 * history must produce the same grid (see lib/finishedGame.ts).
 */
export function buildShareGrid(guessHistory: GuessAttempt[], puzzle: Puzzle): string {
  // One square per answer in a guess, so a Mini row is 3 wide and a Full row
  // is 4 — the Rainbow row included, which is as wide as the board it was
  // found on rather than a fixed four emoji.
  const rainbowRow = "🌈".repeat(formatOf(puzzle).categoryCount);
  const lines: string[] = [];
  for (const attempt of dedupeHintMarkers(guessHistory)) {
    if (attempt.isHintMarker) {
      const emoji = attempt.hintType === "small" ? "💡" : "🔦";
      const last = lines[lines.length - 1];
      if (last === "💡" || last === "🔦" || last === "💡🔦" || last === "🔦💡") {
        lines[lines.length - 1] = last + emoji;
      } else {
        lines.push(emoji);
      }
    } else if (attempt.isRainbow) {
      lines.push(rainbowRow);
    } else {
      const row = attempt.groupIndices
        .map((gi) => {
          const diff = puzzle.groups[gi]?.difficulty;
          return DIFFICULTY_SQUARE[diff] || "⬜";
        })
        .join("");
      lines.push(row);
    }
  }
  return lines.join("\n");
}
