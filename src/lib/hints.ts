import type { GuessAttempt } from "@/lib/types";

/**
 * A hint type can affect a run at most once. Keeps the FIRST marker of each
 * type and drops later ones, so a restored (possibly already-duplicated)
 * history, or any double-fire, can never put two 🔦 or two 💡 in a share grid.
 */
export function dedupeHintMarkers(history: GuessAttempt[]): GuessAttempt[] {
  const seen = new Set<string>();
  let changed = false;
  const out = history.filter((g) => {
    if (!g.isHintMarker) return true;
    const key = g.hintType ?? "";
    if (seen.has(key)) {
      changed = true;
      return false;
    }
    seen.add(key);
    return true;
  });
  return changed ? out : history;
}
