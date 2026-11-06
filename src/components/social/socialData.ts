import { applyGroupOrder, groupOrderEnabled, applyFriendPreferences, socialPreferencesEnabled } from "@/lib/socialPreferences";
import type { GroupInvitePreview } from "@/components/account/GroupInviteCard";
import type { GroupView } from "@/components/account/GroupPage";
import type { FriendResult } from "@/lib/friendResults";
import { acceptProblem, friendInvite, friendResults, groupInvite, groupResults, groupView, isBackgroundCheck, isGroupPreview, type FriendCard } from "@/lib/socialView";
import { LIMITS } from "@/social/contract";
import type { FriendRequestRow, MemberRow, Operations, Outcome, ResultRow } from "@/social/contract";
import type { SocialApi } from "./socialApi";

/** What the page reads through the client, mapped for the screens. Nothing here holds state. */

/** How long a read waits before asking again after a background account check got in its way. */
export const RETRY_MS = 1000;

export type LinkView = { kind: "friend"; card: FriendCard } | { kind: "group"; invite: GroupInvitePreview | null };

export interface PersonData {
  me: Operations["getMe"]["data"];
  incoming: FriendRequestRow[];
  outgoing: FriendRequestRow[];
  results: FriendResult[];
  groups: GroupView[];
  /** Nobody's results could be asked for, so "Not played yet" would be a guess. */
  noResults: boolean;
  resultsPending?: boolean;
}

export interface LinkRead {
  link: LinkView | null;
  problem: string | null;
  /** A background check stopped this, so the link says nothing yet. */
  retry?: boolean;
}

/** Group or friend comes from the answer's own shape, as the contract says. An unknown code shows the card for a link that doesn't work. */
export async function readLink(api: SocialApi, code: string): Promise<LinkRead> {
  const answer = await api.client.call("previewInvite", { code });
  if (answer.ok === false) {
    if (isBackgroundCheck(answer.outcome)) return { link: null, problem: null, retry: true };
    return { link: { kind: "group", invite: null }, problem: answer.outcome === "invalid_code" ? null : acceptProblem(answer.outcome) };
  }
  const { data } = answer;
  return { link: isGroupPreview(data) ? { kind: "group", invite: groupInvite(data) } : { kind: "friend", card: friendInvite(data) }, problem: null };
}

/** Today's result rows, for the friends or for one group. Null when there is no puzzle to ask about. */
async function readRows(api: SocialApi, groupId?: string): Promise<ResultRow[] | null | { outcome: Outcome }> {
  const puzzleId = await api.puzzleId();
  if (puzzleId === null) return null;
  const rows = await api.client.call("listResults", groupId ? { gameId: "rainbow", puzzleId, groupId } : { gameId: "rainbow", puzzleId });
  return rows.ok === false ? { outcome: rows.outcome } : rows.data;
}

/** Independent reads overlap. The hub can show groups while results remain explicitly pending. */
export async function readPerson(api: SocialApi, onReady?: (person: PersonData) => void): Promise<PersonData | { outcome: Outcome }> {
  const { client } = api;
  const rowsPending = readRows(api).catch(() => ({ outcome: "unavailable" as const }));
  const [me, requests, friends, groups, preferences, order] = await Promise.all([
    client.call("getMe", {}),
    client.call("listFriendRequests", {}),
    client.call("listFriends", {}),
    client.call("listMyGroups", {}),
    socialPreferencesEnabled() ? client.call("listFriendPreferences", {}) : null,
    groupOrderEnabled() ? client.call("listGroupOrder", {}) : null,
  ]);
  if (me.ok === false) return { outcome: me.outcome };
  if (requests.ok === false) return { outcome: requests.outcome };
  if (friends.ok === false) return { outcome: friends.outcome };
  if (groups.ok === false) return { outcome: groups.outcome };
  if (preferences?.ok === false) return { outcome: preferences.outcome };
  if (order?.ok === false) return { outcome: order.outcome };
  const base = {
    me: me.data, incoming: requests.data.incoming, outgoing: requests.data.outgoing,
    groups: order ? applyGroupOrder(groups.data.map(groupView), order.data.groupIds) : groups.data.map(groupView),
  };
  onReady?.({ ...base, results: [], noResults: false, resultsPending: true });
  const rows = await rowsPending;
  if (rows !== null && !Array.isArray(rows)) return { outcome: rows.outcome };
  let results = friendResults({ me: me.data, friends: friends.data, rows: Array.isArray(rows) ? rows : [] });
  if (preferences) results = applyFriendPreferences(results, preferences.data);
  return { ...base, results, noResults: rows === null, resultsPending: false };
}

/** Every member, page by page, then today's results joined to them. */
export async function readGroup(api: SocialApi, groupId: string): Promise<{ members: MemberRow[]; results: FriendResult[]; noResults: boolean } | { outcome: Outcome }> {
  const members: MemberRow[] = [];
  for (;;) {
    const last = members[members.length - 1];
    const after = last ? { joinedAt: last.joinedAt, memberRef: last.memberRef } : undefined;
    const page = await api.client.call("listMembers", after ? { groupId, after } : { groupId });
    if (page.ok === false) return { outcome: page.outcome };
    members.push(...page.data);
    if (page.data.length < LIMITS.memberPage) break;
  }
  const rows = await readRows(api, groupId);
  if (rows !== null && !Array.isArray(rows)) return { outcome: rows.outcome };
  return { members, results: groupResults({ members, rows: Array.isArray(rows) ? rows : [] }), noResults: rows === null };
}
