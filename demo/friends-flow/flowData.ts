import type { GroupInvitePreview } from "@/components/account/GroupInviteCard";
import type { GroupSummary } from "@/components/account/GroupsTab";
import type { FriendResult } from "@/lib/friendResults";
import { acceptProblem, friendInvite, friendResults, groupInvite, groupSummary, isGroupPreview, type FriendCard } from "@/lib/socialView";
import type { FriendRequestRow, Operations } from "@/social/contract";
import type { Preview } from "./preview";

/** What the page reads through the real client, mapped for the real screens. Nothing here holds state. */

export type LinkView = { kind: "friend"; card: FriendCard } | { kind: "group"; invite: GroupInvitePreview | null };

export interface PersonData {
  me: Operations["getMe"]["data"];
  incoming: FriendRequestRow[];
  results: FriendResult[];
  groups: GroupSummary[];
}

/** Group or friend comes from the answer's own shape, as the contract says. An unknown code shows the card for a link that doesn't work. */
export async function readLink(preview: Preview, code: string): Promise<{ link: LinkView; problem: string | null }> {
  const answer = await preview.client.call("previewInvite", { code });
  if (answer.ok === false) {
    return { link: { kind: "group", invite: null }, problem: answer.outcome === "invalid_code" ? null : acceptProblem(answer.outcome) };
  }
  const { data } = answer;
  return { link: isGroupPreview(data) ? { kind: "group", invite: groupInvite(data) } : { kind: "friend", card: friendInvite(data) }, problem: null };
}

/** One after another, so the first refusal ends it. Today's results are joined to the friends list here. */
export async function readPerson(preview: Preview): Promise<PersonData | { outcome: string }> {
  const { client } = preview;
  const me = await client.call("getMe", {});
  if (me.ok === false) return { outcome: me.outcome };
  const requests = await client.call("listFriendRequests", {});
  if (requests.ok === false) return { outcome: requests.outcome };
  const friends = await client.call("listFriends", {});
  if (friends.ok === false) return { outcome: friends.outcome };
  const rows = await client.call("listResults", { gameId: "rainbow", puzzleId: preview.puzzleId() });
  if (rows.ok === false) return { outcome: rows.outcome };
  const groups = await client.call("listMyGroups", {});
  if (groups.ok === false) return { outcome: groups.outcome };
  return {
    me: me.data,
    incoming: requests.data.incoming,
    results: friendResults({ me: me.data, friends: friends.data, rows: rows.data }),
    groups: groups.data.map(groupSummary),
  };
}
