import type { FoundPerson, SentRequest } from "@/components/account/AddFriendScreen";
import type { GroupInvitePreview } from "@/components/account/GroupInviteCard";
import type { GroupView } from "@/components/account/GroupPage";
import type { GroupSummary } from "@/components/account/GroupsTab";
import type {
  Face,
  FriendInvitePreview,
  FriendRequestRow,
  FriendRow,
  GameSummaries,
  GroupInvitePreview as HubGroupPreview,
  GroupRow,
  MemberRow,
  Operations,
  ResultRow,
} from "@/social/contract";
import type { FriendResult } from "./friendResults";
import { GROUP_EMBLEMS, type GroupEmblemId } from "./groupEmblems";
import { AVATAR_IDS, PROFILE_COLORS, newProfile, type AvatarId, type ProfileColor, type SharedProfile } from "./sharedProfile";

/**
 * From the shared contract's answers to the props the existing screens take,
 * and from its outcomes to Rainbow's wording. Pure: nothing here fetches,
 * stores or knows who is signed in. Every mapping names the fields it keeps, so
 * a field the hub adds later can't reach a screen by accident.
 */

type Me = Operations["getMe"]["data"];
type Found = Operations["findFriendByCode"]["data"];

const GAME_ID = "rainbow";
const YOU_ID = "you";
const FALLBACK_EMBLEM: GroupEmblemId = "campfire";

/** The contract leaves a missing name to each game. */
const NO_NAME = "A Rainbow player";

const shownName = (name: string | null): string => name ?? NO_NAME;

export interface ScreenFace {
  animalId: AvatarId;
  backgroundColor: ProfileColor;
}

function animalOf(id: string): AvatarId {
  return AVATAR_IDS.includes(id as AvatarId) ? (id as AvatarId) : newProfile().animalId;
}

function colorOf(hex: string): ProfileColor {
  return PROFILE_COLORS.some((color) => color.hex === hex) ? (hex as ProfileColor) : newProfile().backgroundColor;
}

function emblemOf(id: string): GroupEmblemId {
  return GROUP_EMBLEMS.some((emblem) => emblem.id === id) ? (id as GroupEmblemId) : FALLBACK_EMBLEM;
}

function faceOf({ animalId, backgroundColor }: Face): ScreenFace {
  return { animalId: animalOf(animalId), backgroundColor: colorOf(backgroundColor) };
}

// ── Profile ──

export function profileFromMe(me: Me): SharedProfile {
  const profile: SharedProfile = { version: 1, ...faceOf(me) };
  return me.displayName === null ? profile : { ...profile, displayName: me.displayName };
}

// ── Results ──

function isRainbowSummary(summary: unknown): summary is GameSummaries["rainbow"] {
  const candidate = summary as Partial<GameSummaries["rainbow"]> | null;
  return typeof candidate?.solved === "boolean" && Number.isSafeInteger(candidate?.mistakes) && candidate.mistakes >= 0;
}

/**
 * The only place a result's detail is read, and it opens only for an explicit
 * false. A locked row maps to null whatever else it carries.
 */
function detailOf(row: ResultRow): FriendResult["detail"] {
  return row.detailLocked === false ? row.detail ?? null : null;
}

type Person = Pick<FriendResult, "id" | "name" | "isYou" | "animalId" | "backgroundColor">;

function resultFor(person: Person, row: ResultRow | undefined): FriendResult {
  const base = { ...person, gameId: GAME_ID };
  if (!row || !isRainbowSummary(row.summary)) return { ...base, status: "not-played", mistakes: 0, detail: null };
  return { ...base, status: row.summary.solved ? "solved" : "not-solved", mistakes: row.summary.mistakes, detail: detailOf(row) };
}

/**
 * The viewer, then every friend. listResults only has rows for people with a
 * result, so anyone without one is "not played" by joining refs. A row with no
 * friend behind it is left out: that connection has ended, so its sharing has.
 */
export function friendResults({ me, friends, rows }: { me: Me; friends: readonly FriendRow[]; rows: readonly ResultRow[] }): FriendResult[] {
  const you: Person = { id: YOU_ID, name: me.displayName ?? "You", isYou: true, ...faceOf(me) };
  const others = friends.map((friend) => {
    const person: Person = { id: friend.friendRef, name: shownName(friend.name), isYou: false, ...faceOf(friend) };
    return resultFor(person, rows.find((row) => !row.isMe && "friendRef" in row && row.friendRef === friend.friendRef));
  });
  return [resultFor(you, rows.find((row) => row.isMe)), ...others];
}

/**
 * The viewer, then every other member, joined the same way by memberRef. Everyone
 * here is a member, so this is the group's list of people as well as its results.
 */
export function groupResults({ members, rows }: { members: readonly MemberRow[]; rows: readonly ResultRow[] }): FriendResult[] {
  const shown = members.map((member) => {
    const person: Person = { id: member.memberRef, name: shownName(member.name), isYou: member.isMe, ...faceOf(member) };
    return resultFor(person, rows.find((row) => "memberRef" in row && row.memberRef === member.memberRef));
  });
  return [...shown.filter((result) => result.isYou), ...shown.filter((result) => !result.isYou)];
}

export interface GroupMemberView extends ScreenFace {
  memberRef: string;
  name: string;
  isOwner: boolean;
  isMe: boolean;
}

export function groupMemberView(member: MemberRow): GroupMemberView {
  return { memberRef: member.memberRef, name: member.name, isOwner: member.isOwner, isMe: member.isMe, ...faceOf(member) };
}

// ── Groups ──

export function groupSummary({ groupId, name, emblemId, photo, accentColor, memberCount }: GroupRow): GroupSummary {
  return { groupId, name, emblemId: emblemOf(emblemId), photo, accentColor: colorOf(accentColor), memberCount };
}

/** The list row plus what its page needs. A code only ever reaches an owner's page, and it can still be null. */
export function groupView(row: GroupRow): GroupView {
  return { ...groupSummary(row), isOwner: row.isOwner, inviteCode: row.isOwner ? row.inviteCode : null };
}

/** Tells the two kinds of invitation apart, the way the contract says to. */
export function isGroupPreview(preview: FriendInvitePreview | HubGroupPreview): preview is HubGroupPreview {
  return "isMember" in preview;
}

/**
 * The hub sends no member preview to a member or a removed person, and the card
 * draws one for neither. Its prop can't be null, so that case is an empty one.
 */
export function groupInvite(preview: HubGroupPreview): GroupInvitePreview {
  const { name, emblemId, photo, accentColor, isMember, isRemoved, memberPreview } = preview;
  return {
    name,
    emblemId: emblemOf(emblemId),
    photo,
    accentColor: colorOf(accentColor),
    isMember,
    isRemoved,
    memberPreview: memberPreview
      ? { faces: memberPreview.faces.map((face) => faceOf(face)), leadName: memberPreview.leadName, memberCount: memberPreview.memberCount }
      : { faces: [], leadName: "", memberCount: 0 },
  };
}

// ── Friends ──

/** What FriendInviteCard needs to know about the other person. */
export interface FriendCard {
  inviterName: string;
  inviter: ScreenFace;
}

export function friendInvite(preview: FriendInvitePreview): FriendCard {
  return { inviterName: shownName(preview.inviterName), inviter: faceOf(preview) };
}

export function friendRequest(row: FriendRequestRow): FriendCard {
  return { inviterName: shownName(row.name), inviter: faceOf(row) };
}

/** The requestRef stays with the caller: the screen has no use for it. */
export function foundPerson(found: Found): FoundPerson {
  return { displayName: shownName(found.name), ...faceOf(found) };
}

/** A sent request's id is its requestRef, which is all Cancel needs. */
export function sentRequest(row: FriendRequestRow): SentRequest {
  return { id: row.requestRef, displayName: shownName(row.name), ...faceOf(row) };
}

// ── Wording ──
//
// Rainbow's words for the contract's outcomes, in the style of joinProblem in
// accountFlow.ts, which stays the wording for joinGroup.

const TRY_TOMORROW = "Please try again tomorrow.";
const FRESH_LINK = "Ask for a fresh link.";

function commonProblem(outcome: string): string | null {
  switch (outcome) {
    case "not_signed_in":
      return "Sign in to use Friends and Groups.";
    case "not_linked":
      return "That sign-in is not a Rainbow Categories account.";
    case "needs_display_name":
      return "Choose a Display Name first.";
    case "notice_required":
      return "Please read what's shared first, then try again.";
    case "still_checking":
      return "We're still checking your account. Please try again in a moment.";
    case "stale_session":
      return "The person using this device changed, so that didn't finish.";
    case "game_disabled":
    case "unavailable":
      return "Friends and Groups aren't available right now. Please try again later.";
    default:
      return null;
  }
}

/** When nothing more specific fits, such as a list that wouldn't load. */
export function socialProblem(outcome: string): string {
  return commonProblem(outcome) ?? "Something went wrong. Please try again.";
}

/**
 * The account being re-checked, which Rainbow does on every focus and reconnect.
 * A read refused for this says nothing about the player, so it asks again quietly.
 */
export function isBackgroundCheck(outcome: string): boolean {
  return outcome === "still_checking" || outcome === "stale_session";
}

export function findProblem(outcome: string): string {
  switch (outcome) {
    case "not_found":
      return "We couldn't find anyone with that code. Check it and try again.";
    case "own_code":
      return "That's your own code. Ask your friend for theirs.";
    case "already_friends":
      return "You're already friends.";
    case "request_pending":
      return "There's already a friend request between you.";
    case "slow_down":
      return `You've looked up a lot of friend codes today. ${TRY_TOMORROW}`;
    default:
      return commonProblem(outcome) ?? "We couldn't look that up just now. Please try again.";
  }
}

export function sendProblem(outcome: string): string {
  switch (outcome) {
    case "not_found":
      return "That request has run out of time. Find your friend again.";
    case "already_friends":
      return "You're already friends.";
    case "request_pending":
      return "There's already a friend request between you.";
    case "slow_down":
      return `You've sent a lot of friend requests today. ${TRY_TOMORROW}`;
    default:
      return commonProblem(outcome) ?? "We couldn't send that request just now. Please try again.";
  }
}

/** Accepting a request or a link, and a link that can't be opened. */
export function acceptProblem(outcome: string): string {
  switch (outcome) {
    case "not_found":
      return "That friend request is no longer waiting.";
    case "too_many_friends":
      return "One of you has as many friends as you can have.";
    case "invalid_code":
      return `This invitation isn't working. ${FRESH_LINK}`;
    case "invite_used":
      return `This invitation has already been used. ${FRESH_LINK}`;
    case "invite_expired":
      return `This invitation has run out of time. ${FRESH_LINK}`;
    case "own_invite":
      return "That's your own link. Send it to a friend.";
    default:
      return commonProblem(outcome) ?? "We couldn't add your friend just now. Please try again.";
  }
}

export function friendLinkProblem(outcome: string): string {
  if (outcome === "slow_down") return `You've made a lot of friend links today. ${TRY_TOMORROW}`;
  return commonProblem(outcome) ?? "We couldn't make a link just now. Please try again.";
}

export function makeGroupProblem(outcome: string): string {
  switch (outcome) {
    case "bad_name":
      return "That group name won't work. Try another.";
    case "bad_my_name":
      return "Your name won't work in a group. Try another.";
    case "too_many_created":
      return "You've made as many groups as you can.";
    case "too_many_groups":
      return "You've joined as many groups as you can.";
    case "slow_down":
      return `You've made a lot of groups today. ${TRY_TOMORROW}`;
    default:
      return commonProblem(outcome) ?? "We couldn't make the group just now. Please try again.";
  }
}

/** Declining a request that was sent to you, or cancelling one you sent. */
export function requestChangeProblem(outcome: string): string {
  if (outcome === "not_found") return "That friend request is no longer waiting.";
  return commonProblem(outcome) ?? "We couldn't change that request just now. Please try again.";
}

/** Removing or blocking a friend. */
export function friendChangeProblem(outcome: string): string {
  if (outcome === "not_found") return "That person isn't on your friends list any more.";
  return commonProblem(outcome) ?? "We couldn't change that just now. Please try again.";
}

/** Reading a group's page. */
export function groupProblem(outcome: string): string {
  if (outcome === "not_a_member") return "You're not in this group any more.";
  return commonProblem(outcome) ?? "We couldn't open this group just now. Please try again.";
}

export function leaveProblem(outcome: string): string {
  if (outcome === "not_a_member") return "You're not in this group any more.";
  return commonProblem(outcome) ?? "We couldn't leave the group just now. Please try again.";
}

/** The group already exists by this point, so this always says so. */
export function groupPictureProblem(outcome: string): string {
  switch (outcome) {
    case "not_a_picture":
      return "Your group was made, but that file isn't a picture we can use.";
    case "wrong_size":
      return "Your group was made, but that picture is the wrong size.";
    case "too_big":
      return "Your group was made, but that picture is too large.";
    default:
      return "Your group was made, but its picture and color weren't saved.";
  }
}

export const copyProblem = (url: string): string => `We couldn't copy that. Here's your link: ${url}`;

export const NO_RESULTS_NOTE = "We couldn't load today's results. Please try again later.";

// ── Questions and notes ──

export const memberWords = (count: number): string => `${count} ${count === 1 ? "member" : "members"}`;

export const removeFriendQuestion = (name: string): string => `Remove ${name} from your friends? You'll stop sharing results.`;

export const blockQuestion = (name: string): string => `Block ${name}? You'll stop being friends, and neither of you can add the other.`;

export const leaveGroupQuestion = (name: string): string => `Leave ${name}? Your results will stop being shared with this group.`;

export const leftGroupNote = (name: string, closed: boolean): string => (closed ? `You left ${name}, and that closed the group.` : `You left ${name}.`);

export const CHECKING_NOTE = "Checking who this is";

export const LOADING_NOTE = "Loading";

export const GUEST_HEADING = "Sign in for Friends and Groups";

export const GUEST_NOTE = "Your friends and groups need an account. Every game stays open without one.";
