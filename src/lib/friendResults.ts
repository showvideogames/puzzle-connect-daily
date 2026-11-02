import type { AvatarId, ProfileColor } from "./sharedProfile";

/**
 * One person's result for today's puzzle, as the Friends screen shows it. The
 * summary is always safe to show. `detail` is game-specific and left out until
 * the viewer finishes the same puzzle: that is decided by the server, so null
 * here means it was never sent, not that it is being hidden.
 */
export interface FriendResult {
  id: string;
  name: string;
  isYou: boolean;
  animalId: AvatarId;
  backgroundColor: ProfileColor;
  gameId: string;
  status: "solved" | "not-solved" | "not-played";
  mistakes: number;
  detail: unknown | null;
}

export function resultSummary(result: Pick<FriendResult, "status" | "mistakes">): string {
  if (result.status === "not-played") return "Not played yet";
  const count = `${result.mistakes} ${result.mistakes === 1 ? "mistake" : "mistakes"}`;
  return `${result.status === "solved" ? "Solved" : "Not solved"} · ${count}`;
}

/** Someone who has not played has nothing to open. */
export function canOpenResult(result: Pick<FriendResult, "status">): boolean {
  return result.status !== "not-played";
}
