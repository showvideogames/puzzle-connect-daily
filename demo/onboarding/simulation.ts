import { clearPendingInvite, forgetSetupLater, rememberPendingInvite } from "@/lib/accountFlow";
import type { SharedProfile } from "@/lib/sharedProfile";
import type { FoundPerson } from "@/components/account/AddFriendScreen";
import type { FriendsTab } from "@/components/account/FriendsHome";
import type { GroupInvitePreview } from "@/components/account/GroupInviteCard";
import type { GroupSummary } from "@/components/account/GroupsTab";
import { cleanFriendCode } from "@/lib/friendCode";
import { inviteMemberPreview } from "@/lib/invitePreview";
import type { FriendResult } from "@/lib/friendResults";

/**
 * Everything simulated in the preview lives here: one fictional player, a few
 * fictional groups, and answers shaped like contract version 0. `name`,
 * `isMember` and `isRemoved` are the contract's previewInvite. `emblemId` and
 * `accentColor` are not in the contract yet: they are the extension the plan
 * proposes. Nothing here leaves this browser tab, and no real account or
 * invitation exists behind it.
 */
export const PREVIEW_ACCOUNT = "preview-only";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A fictional person, for the friend invitation and the friend code. */
export const FICTIONAL_FRIEND: FoundPerson = { displayName: "Jordan", animalId: "owl", backgroundColor: "#F8D0BD" };

/** The fictional player's own code, and the code that finds the fictional friend. */
export const OWN_FRIEND_CODE = "R8T-6NZ";
export const SAMPLE_FRIEND_CODE = "K7M-4PX";

/** Stands in for the server's lookup. Nothing is searched: only the sample code finds anyone. */
export async function findFriend(code: string): Promise<FoundPerson | "self" | null> {
  await wait(250);
  const clean = cleanFriendCode(code);
  if (clean === OWN_FRIEND_CODE) return "self";
  return clean === SAMPLE_FRIEND_CODE ? FICTIONAL_FRIEND : null;
}

/** Today's fictional results. `detail` is left out unless the viewer finished, as the real server would do. */
export function friendResults(profile: SharedProfile | null, viewerFinished: boolean): FriendResult[] {
  const you = profile ?? FICTIONAL_PLAYER;
  const base = { isYou: false, gameId: "rainbow" };
  const reveal = (grid: string) => (viewerFinished ? grid : null);
  return [
    {
      ...base,
      id: "you",
      name: you.displayName ?? "You",
      isYou: true,
      animalId: you.animalId,
      backgroundColor: you.backgroundColor,
      status: viewerFinished ? "solved" : "not-played",
      mistakes: viewerFinished ? 1 : 0,
      detail: viewerFinished ? "🟨🟨🟨🟨\n🟩🟩🟦🟩\n🟩🟩🟩🟩\n🟦🟦🟦🟦\n🟥🟥🟥🟥" : null,
    },
    { ...base, id: "sam", name: "Sam", animalId: "bear", backgroundColor: "#F1CDDA", status: "solved", mistakes: 0, detail: reveal("🟨🟨🟨🟨\n🟩🟩🟩🟩\n🟦🟦🟦🟦\n🟥🟥🟥🟥\n🌈🌈🌈🌈") },
    { ...base, id: "jordan", name: "Jordan", animalId: "owl", backgroundColor: "#F8D0BD", status: "solved", mistakes: 2, detail: reveal("🟩🟩🟨🟩\n🟨🟨🟨🟨\n💡\n🟦🟥🟦🟦\n🟩🟩🟩🟩\n🟦🟦🟦🟦\n🟥🟥🟥🟥") },
    { ...base, id: "taylor", name: "Taylor", animalId: "frog", backgroundColor: "#CCE6CA", status: "not-played", mistakes: 0, detail: null },
  ];
}

const groupMembers = [
  { name: "Sam", animalId: "bear", backgroundColor: "#F8E4A0" },
  { name: "Jordan", animalId: "owl", backgroundColor: "#F8D0BD" },
  { name: "Taylor", animalId: "frog", backgroundColor: "#CCE6CA" },
] as const;

export const SAMPLE_GROUPS: GroupSummary[] = [
  { name: "Coffee Crew", emblemId: "coffee", photo: null, accentColor: "#F8D0BD", memberCount: 4 },
];

export const FICTIONAL_PLAYER: SharedProfile = {
  version: 1,
  displayName: "Alex",
  animalId: "fox",
  backgroundColor: "#DED1F2",
};

export const INVITE_CODES = {
  open: "fridaypuzzl3",
  removed: "removedgroup",
  member: "alreadyjoin1",
  broken: "notarealcode",
} as const;

const groups: Record<string, GroupInvitePreview> = {
  [INVITE_CODES.open]: { name: "Friday Puzzlers", emblemId: "campfire", accentColor: "#DED1F2", isMember: false, isRemoved: false, memberPreview: inviteMemberPreview(groupMembers, 6) },
  [INVITE_CODES.removed]: { name: "Book Club", emblemId: "book", accentColor: "#CCE6CA", isMember: false, isRemoved: true, memberPreview: inviteMemberPreview(groupMembers, 6) },
  [INVITE_CODES.member]: { name: "Coffee Crew", emblemId: "coffee", accentColor: "#F8D0BD", isMember: true, isRemoved: false, memberPreview: inviteMemberPreview(groupMembers, 4) },
};

/**
 * The contract's previewInvite. A guest always sees both flags false. The
 * member preview is the same for everyone with a valid link.
 */
export function previewInvite(code: string | null, signedIn: boolean): GroupInvitePreview | null {
  const group = code ? groups[code] : undefined;
  if (!group) return null;
  return signedIn ? group : { ...group, isMember: false, isRemoved: false };
}

/** The contract's joinGroup. */
export async function joinGroup(_code: string, _myName: string): Promise<{ ok: boolean; outcome?: string }> {
  await wait(350);
  return { ok: true };
}

export async function saveProfile(_profile: SharedProfile): Promise<void> {
  await wait(250);
}

export type View = "flow" | "sign-in" | "settings" | "edit-profile" | "games" | "friends" | "add-friend" | "name-form" | "friend-invite" | "friend-request";

export interface Simulation {
  signedIn: boolean;
  profile: SharedProfile | null;
  showPicker: boolean;
  isNewAccount: boolean;
  setupLater: boolean;
  /** The page behind this is a puzzle, so setup waits. */
  onGameplayPage: boolean;
  view: View;
  joined: boolean;
  /** Has the viewer finished today's puzzle? This decides whether details are sent. */
  viewerFinished: boolean;
  friendsTab: FriendsTab;
  /** What the banner says is simulated, or how the real app would differ. */
  note: string;
}

const returning: Omit<Simulation, "note"> = {
  signedIn: true,
  profile: FICTIONAL_PLAYER,
  showPicker: false,
  isNewAccount: false,
  setupLater: false,
  onGameplayPage: false,
  view: "flow",
  joined: false,
  viewerFinished: true,
  friendsTab: "friends",
};
const newPlayer = { ...returning, profile: null, isNewAccount: true };
const existingNoProfile = { ...returning, profile: null };
const guest = { ...returning, signedIn: false, profile: null };

export interface Scenario {
  id: string;
  label: string;
  invite: string | null;
  seed: Simulation;
}

export const SCENARIOS: readonly Scenario[] = [
  { id: "new-user", label: "New player: setup", invite: null, seed: { ...newPlayer, note: "Simulated sign-in. Continue or Later both lead to the games. Nothing is saved outside this tab." } },
  { id: "picker", label: "Game picker", invite: null, seed: { ...returning, showPicker: true, note: "Covers are provisional. Play opens the real, live site in a new tab." } },
  { id: "existing-offer", label: "Existing player: profile offer", invite: null, seed: { ...existingNoProfile, note: "An existing account with no profile, away from any puzzle. Later goes back to their page." } },
  { id: "existing-playing", label: "Existing player: mid-puzzle", invite: null, seed: { ...existingNoProfile, onGameplayPage: true, note: "An existing account with no profile, on a puzzle. Setup does not interrupt." } },
  { id: "returning", label: "Returning player", invite: null, seed: { ...returning, note: "Setup skipped. They are back on the page they signed in from. The picker is in the menu." } },
  { id: "settings", label: "Menu: games, groups, profile", invite: null, seed: { ...returning, view: "settings", note: "This is the real Settings menu, with All games and Friends & Groups added." } },
  { id: "edit-profile", label: "Edit profile", invite: null, seed: { ...returning, view: "edit-profile", note: "Same form as setup. Saving keeps the profile in this tab only." } },
  { id: "friends-finished", label: "Friends: you finished today", invite: null, seed: { ...returning, view: "friends", note: "Fictional people and results. No results are connected. Rows open to details." } },
  { id: "friends-not-finished", label: "Friends: you haven't finished", invite: null, seed: { ...returning, view: "friends", viewerFinished: false, note: "Fictional people and results. Details stay locked, as if the server never sent them." } },
  { id: "groups", label: "Groups tab", invite: null, seed: { ...returning, view: "friends", friendsTab: "groups", note: "Fictional groups. An upload stays in this browser tab and is never sent anywhere." } },
  { id: "add-friend", label: "Add a friend", invite: null, seed: { ...returning, view: "add-friend", note: `Sample codes: ${SAMPLE_FRIEND_CODE} finds a fictional friend, ${OWN_FRIEND_CODE} is your own. No link is created and nothing is sent.` } },
  { id: "friend-request", label: "Friend request: their side", invite: null, seed: { ...returning, view: "friend-request", note: "Fictional person. This is what the other person sees. The sharing sentence is a draft, not the owner's wording." } },
  { id: "name-gate", label: "Display Name gate", invite: null, seed: { ...existingNoProfile, setupLater: true, view: "friends", note: "They chose Later, and games still work. Friends and Groups ask for a Display Name here." } },
  { id: "invite-guest", label: "Invitation before sign-in", invite: INVITE_CODES.open, seed: { ...guest, note: "Fictional group and members. Sign in here goes to a simulated page." } },
  { id: "invite-join", label: "Invitation: Join", invite: INVITE_CODES.open, seed: { ...returning, note: "Fictional group and members. Join changes nothing outside this tab." } },
  { id: "friend-invite", label: "Friend invitation", invite: null, seed: { ...returning, view: "friend-invite", note: "Fictional friend. The sharing sentence is a draft, not the owner's wording." } },
  { id: "invite-setup", label: "New player with invitation", invite: INVITE_CODES.open, seed: { ...newPlayer, note: "The invitation waits through setup, then comes back as a Join button." } },
  { id: "invite-later", label: "Invitation after Later", invite: INVITE_CODES.open, seed: { ...existingNoProfile, setupLater: true, note: "They chose Later, so Join asks for a Display Name first." } },
  { id: "guest-games", label: "Guest: games from the menu", invite: null, seed: { ...guest, view: "games", note: "No account and no profile. Every game is open." } },
  { id: "invite-removed", label: "Removed from the group", invite: INVITE_CODES.removed, seed: { ...returning, note: "Fictional group." } },
  { id: "invite-member", label: "Already a member", invite: INVITE_CODES.member, seed: { ...returning, note: "Fictional group." } },
  { id: "invite-broken", label: "Link not working", invite: INVITE_CODES.broken, seed: { ...returning, note: "A replaced or mistyped link." } },
];

const SIMULATION_KEY = "onboarding-preview.simulation";

/** Survives the full page load of the simulated sign-in, as a real session would. */
export function saveSimulation(simulation: Simulation): void {
  sessionStorage.setItem(SIMULATION_KEY, JSON.stringify(simulation));
}

/** Starts a scenario from a link, or carries on after the simulated sign-in. */
export function startSimulation(stateParam: string | null): Simulation {
  const scenario = SCENARIOS.find((candidate) => candidate.id === stateParam);
  if (!scenario) {
    const stored = sessionStorage.getItem(SIMULATION_KEY);
    if (stored && stateParam === "live") return JSON.parse(stored) as Simulation;
    return startSimulation(SCENARIOS[0].id);
  }
  clearPendingInvite();
  forgetSetupLater(PREVIEW_ACCOUNT);
  if (scenario.invite) rememberPendingInvite(scenario.invite);
  saveSimulation(scenario.seed);
  return scenario.seed;
}
