/**
 * What a player is told before joining, and before making a friend link or a
 * group. The group sentence is the owner's own wording, notice version 1 in the
 * shared contract. The hub records the version each person saw, so changing the
 * words means raising the version.
 */
export const SHARING_NOTICE_VERSION = 1;

export const GROUP_SHARING_NOTICE =
  "Your completed daily results are shared automatically with this group across our games. Puzzle details stay hidden until members finish the same puzzle. You can leave anytime.";

/** Worded to match the group sentence, because that one names a group. */
export const FRIEND_SHARING_NOTICE =
  "Your completed daily results are shared automatically with this friend across our games. Puzzle details stay hidden until they finish the same puzzle. You can remove a friend anytime.";

/** Said under the notice on a group invitation and when making a group, from the approved design. */
export const GROUP_VISIBILITY_NOTE = "Your name, avatar and daily results are visible to the group.";

/** A notice as its separate sentences, for showing one to a line. The words never change. */
export function noticeLines(notice: string): string[] {
  return notice.match(/[^.]+\./g)?.map((line) => line.trim()) ?? [notice];
}
