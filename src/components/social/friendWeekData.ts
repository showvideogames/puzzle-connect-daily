import type { FriendResult } from "@/lib/friendResults";
import { resultFor } from "@/lib/socialView";
import { localPuzzleDate, socialWeek } from "@/lib/socialWeek";
import type { SocialApi } from "./socialApi";
export type RecentActivity = {
  date: string;
  /** Null from the weekly reader, which knows the puzzle's day but not when it was finished. */
  completedAt: string | null;
  puzzleId: string;
  puzzleDate: string | null;
  puzzleTitle: string | null;
  result: FriendResult;
};
export type DayResult = RecentActivity;
/** Seven viewer-local calendar days, inclusive today; UTC instants cross DST safely. */
export function recentBounds(today: Date) {
  const start = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() - 6,
  );
  const until = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() + 1,
  );
  return { from: start.toISOString(), until: until.toISOString() };
}
export async function readRecentActivity(
  api: SocialApi,
  friends: readonly FriendResult[],
  today: Date,
  friendRef?: string,
): Promise<RecentActivity[]> {
  const people = friends.filter((friend) => !friend.isYou);
  if (!people.length) return [];
  const bounds = recentBounds(today);
  const answer = await api.client.call("recentCompletions", {
    ...bounds,
    ...(friendRef ? { friendRef } : {}),
  });
  if (answer.ok === false) throw new Error(answer.outcome);
  return answer.data.rows.flatMap((row) => {
    const friend = people.find((friend) => friend.id === row.result.friendRef);
    if (!friend || row.result.isMe || (friendRef && friend.id !== friendRef))
      return [];
    const at = new Date(row.completedAt);
    if (
      !Number.isFinite(at.getTime()) ||
      at.toISOString() < bounds.from ||
      at.toISOString() >= bounds.until
    )
      return [];
    const result = resultFor(friend, row.result);
    return result.status === "not-played"
      ? []
      : [
          {
            date: localPuzzleDate(at),
            completedAt: row.completedAt,
            puzzleId: row.puzzleId,
            puzzleDate: row.puzzleDate,
            puzzleTitle: row.puzzleTitle,
            result,
          },
        ];
  });
}
/**
 * Production's weekly reader, for when recent completions are off: this week's
 * Daily puzzles, then one listResults per exact puzzle id, so each read is
 * authorized and spoiler-gated for that puzzle alone. Played days only, newest first.
 */
export async function readWeekPuzzles(
  api: SocialApi,
  friend: FriendResult,
  today: Date,
): Promise<DayResult[]> {
  if (!api.weekPuzzles) throw new Error("Unavailable");
  const days = socialWeek(today);
  const puzzles = await api.weekPuzzles(days[0].date, localPuzzleDate(today));
  const played: DayResult[] = [];
  for (const day of days.filter((day) => !day.future)) {
    const puzzle = puzzles.find((puzzle) => puzzle.date === day.date);
    if (!puzzle) continue;
    // Each request is independently authorized and gated by this exact puzzle id.
    const answer = await api.client.call("listResults", { gameId: "rainbow", puzzleId: puzzle.id });
    if (answer.ok === false) throw new Error("Unavailable");
    const row = answer.data.find((row) => !row.isMe && "friendRef" in row && row.friendRef === friend.id);
    const result = resultFor(friend, row);
    if (result.status === "not-played") continue;
    played.push({ date: day.date, completedAt: null, puzzleId: puzzle.id, puzzleDate: day.date, puzzleTitle: null, result });
  }
  return played.reverse();
}

/** Recent completions only while that reader is switched on; otherwise production's weekly reader. */
export const readFriendWeek = (
  api: SocialApi,
  friend: FriendResult,
  today: Date,
): Promise<DayResult[]> => {
  if (api.recentActivity) return readRecentActivity(api, [friend], today, friend.id);
  if (api.weekPuzzles) return readWeekPuzzles(api, friend, today);
  return Promise.reject(new Error("Unavailable"));
};
