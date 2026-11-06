import type { FriendResult } from "@/lib/friendResults";

/**
 * Who the results popup lists, in what order, and what each row says. Pure:
 * the Friends tab and every group tab use the same rules.
 *
 * - Only people who finished: solved, or a completed loss. Not played or still
 *   playing is left out.
 * - Full: solved by fewest mistakes. Equal mistakes are a tie; time never
 *   counts, even if a row carries one.
 * - Mini: solved by fastest time. Equal times are a tie. A solved row with no
 *   usable time is never treated as 0: it goes after every timed solved row.
 * - Completed losses come after every solved row.
 * - A tie is ordered by name, then by id, so the list never jitters. No rank
 *   numbers are shown, and the player's own row sits where it ranks.
 */

export type RankFormat = "full" | "mini";

type Ranked = Pick<FriendResult, "id" | "name" | "status" | "mistakes" | "seconds">;

/** A time that can be shown and ranked: a positive whole number of seconds. Anything else is no time. */
export function usableSeconds(seconds: unknown): number | null {
  return typeof seconds === "number" && Number.isSafeInteger(seconds) && seconds > 0 ? seconds : null;
}

/** "0:42", "1:05", "1:00:00": minutes and seconds, with hours from an hour on. */
export function formatSeconds(total: number): string {
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

/** "No mistakes", "1 mistake", "3 mistakes". */
export function mistakeWords(mistakes: number): string {
  if (mistakes === 0) return "No mistakes";
  return `${mistakes} ${mistakes === 1 ? "mistake" : "mistakes"}`;
}

/**
 * What a finished row says. Full: "No mistakes" / "2 mistakes" / "Not solved".
 * Mini: "0:42 · 1 mistake", or "Solved · 1 mistake" without a usable time, or
 * "Not solved".
 */
export function resultWording(result: Pick<FriendResult, "status" | "mistakes" | "seconds">, format: RankFormat): string {
  if (result.status !== "solved") return "Not solved";
  if (format === "full") return mistakeWords(result.mistakes);
  const seconds = usableSeconds(result.seconds);
  return `${seconds === null ? "Solved" : formatSeconds(seconds)} · ${mistakeWords(result.mistakes)}`;
}

/** Solved before unsolved; on Mini, timed solved before untimed solved. */
function band(result: Ranked, format: RankFormat): number {
  if (result.status !== "solved") return 2;
  return format === "mini" && usableSeconds(result.seconds) === null ? 1 : 0;
}

/** Within a band, what counts: time for timed Mini rows, mistakes otherwise. Losses are all equal. */
function score(result: Ranked, format: RankFormat): number {
  if (result.status !== "solved") return 0;
  if (format === "mini") return usableSeconds(result.seconds) ?? result.mistakes;
  return result.mistakes;
}

function byNameThenId(a: Ranked, b: Ranked): number {
  const name = a.name.localeCompare(b.name);
  if (name !== 0) return name;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Finished people only, ranked. The list given is not changed. */
export function rankResults<T extends Ranked>(results: readonly T[], format: RankFormat): T[] {
  return results
    .filter((result) => result.status === "solved" || result.status === "not-solved")
    .slice()
    .sort((a, b) => band(a, format) - band(b, format) || score(a, format) - score(b, format) || byNameThenId(a, b));
}
