import Index from "./Index";
import ArchivePuzzlePage from "./ArchivePuzzle";
import { MINI_FORMAT } from "@/lib/puzzleFormat";

/**
 * The Mini routes.
 *
 * Both are the EXACT same page components the Full routes render, configured
 * with the Mini format — not copies. Everything that differs between a Full
 * and a Mini page (which puzzle loads, the board shape, the progress
 * namespace, the statistics and streak namespace, the nav targets, the share
 * identity) is carried by that one value. See lib/puzzleFormat.ts.
 */

/** `/mini` — today's Mini 3×3 Daily. */
export function MiniDaily() {
  return <Index format={MINI_FORMAT} />;
}

/** `/mini/archive/:puzzleId` — one archived Mini. */
export function MiniArchivePuzzle() {
  return <ArchivePuzzlePage format={MINI_FORMAT} />;
}
