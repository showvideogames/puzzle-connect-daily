import { CURRENT_NOTICE_VERSION } from "@/social/contract";
import type { GameId, Operations, OpName, Outcome, Profile, Result, SocialTransport } from "@/social/contract";
import { createMemoryHub, createMockIdentity } from "@/social/memoryHub";

/**
 * MOCK ONLY. Everything outside Rainbow's own code: made-up people, one stored
 * session, the account check, one in-memory hub for the page, its clock and the
 * fake game server. It stands where the shared auth project and the Social Hub
 * would be, so the real session code reacts to it. All of it is gone on reload.
 * Global ids and tokens stay in here and in the stored session, and never reach
 * the screen.
 */

export type PersonId = "alex" | "jordan" | "sam" | "newcomer";

interface FinishedPuzzle {
  solved: boolean;
  mistakes: number;
  grid: string;
}

interface Person {
  label: string;
  /** Null for the one person who hasn't chosen a Display Name. */
  profile: Profile | null;
  globalUserId: string;
  authUid: string;
  /** What the fake game server reports when this person finishes. */
  finishes: FinishedPuzzle;
}

const GAME: GameId = "rainbow";

const PEOPLE: Record<PersonId, Person> = {
  alex: {
    label: "Alex",
    profile: { displayName: "Alex", animalId: "fox", backgroundColor: "#DED1F2" },
    globalUserId: "user_mockalex00000",
    authUid: "auth-mock-alex",
    finishes: { solved: true, mistakes: 1, grid: "🟨🟨🟨🟨\n🟩🟩🟦🟩\n🟩🟩🟩🟩\n🟦🟦🟦🟦\n🟥🟥🟥🟥" },
  },
  jordan: {
    label: "Jordan",
    profile: { displayName: "Jordan", animalId: "owl", backgroundColor: "#F8D0BD" },
    globalUserId: "user_mockjordan000",
    authUid: "auth-mock-jordan",
    finishes: { solved: true, mistakes: 2, grid: "🟩🟩🟨🟩\n🟨🟨🟨🟨\n💡\n🟦🟥🟦🟦\n🟩🟩🟩🟩\n🟦🟦🟦🟦\n🟥🟥🟥🟥" },
  },
  sam: {
    label: "Sam",
    profile: { displayName: "Sam", animalId: "bear", backgroundColor: "#F1CDDA" },
    globalUserId: "user_mocksam000000",
    authUid: "auth-mock-sam",
    finishes: { solved: true, mistakes: 0, grid: "🟨🟨🟨🟨\n🟩🟩🟩🟩\n🟦🟦🟦🟦\n🟥🟥🟥🟥\n🌈🌈🌈🌈" },
  },
  newcomer: {
    label: "New player (no name yet)",
    profile: null,
    globalUserId: "user_mocknewcomer0",
    authUid: "auth-mock-newcomer",
    finishes: { solved: false, mistakes: 4, grid: "🟩🟨🟩🟩\n🟦🟦🟥🟦\n🟨🟨🟩🟨\n🟥🟥🟦🟥" },
  },
};

const PERSON_IDS = Object.keys(PEOPLE) as PersonId[];

/** The key the real code reads its stored session from. */
const SESSION_KEY = "rc-auth";

const CREATED_AT = "2026-01-01T00:00:00.000Z";
const DAY_MS = 24 * 60 * 60 * 1000;

/** Nobody holds this code, so the hub itself says the link is broken. */
const BROKEN_CODE = "notarealcode";

export interface SeededLink {
  label: string;
  code: string;
}

interface StoredSession {
  access_token: string;
  user: { id: string };
}

// The clock starts at noon, so the small steps below stay on the same day.
let clock = Date.UTC(2026, 9, 31, 12);

/**
 * Every reading moves on a little. The hub's forward-only rule compares moments,
 * so on a clock that stood still a result finished just before two people
 * connected would count as finished after it.
 */
const now = () => {
  clock += 1;
  return clock;
};

const identity = createMockIdentity();
const hub = createMemoryHub({ identity, now });

/** One token per person. */
const tokens = Object.fromEntries(
  PERSON_IDS.map((person) => [person, identity.issue({ game: GAME, globalUserId: PEOPLE[person].globalUserId })]),
) as Record<PersonId, string>;

const hubTransport = hub.transportFor(GAME);

function hubCall<O extends OpName>(person: PersonId, op: O, args: Operations[O]["args"]): Promise<Result<Operations[O]["data"]>> {
  return hubTransport.call(op, args, tokens[person]);
}

function must<T>(answer: Result<T>): T {
  if (answer.ok === false) throw new Error(`The synthetic seed failed: ${answer.outcome}.`);
  return answer.data;
}

async function makeGroup(owner: PersonId, name: string, emblemId: string, accentColor: string) {
  const made = must(await hubCall(owner, "createGroup", { name, myName: PEOPLE[owner].label, noticeVersion: CURRENT_NOTICE_VERSION }));
  must(await hubCall(owner, "setGroupAppearance", { groupId: made.groupId, emblemId, photo: null, accentColor }));
  return made;
}

const joinAs = async (person: PersonId, code: string) =>
  must(await hubCall(person, "joinGroup", { code, myName: PEOPLE[person].label, noticeVersion: CURRENT_NOTICE_VERSION }));

/**
 * Backend data put straight on the hub, not calls through the adapter. There are
 * no friends here, so every friendship on screen was made on screen. Three groups
 * give a link to join, one Alex is in, and one Alex was removed from, which no
 * screen could otherwise reach.
 */
async function seed(): Promise<SeededLink[]> {
  for (const person of PERSON_IDS) {
    const { profile } = PEOPLE[person];
    if (profile) must(await hubCall(person, "setProfile", profile));
  }

  const friday = await makeGroup("jordan", "Friday Puzzlers", "campfire", "#DED1F2");
  await joinAs("sam", friday.inviteCode);

  const coffee = await makeGroup("jordan", "Coffee Crew", "coffee", "#F8D0BD");
  await joinAs("alex", coffee.inviteCode);

  const book = await makeGroup("sam", "Book Club", "book", "#CCE6CA");
  await joinAs("alex", book.inviteCode);
  const members = must(await hubCall("sam", "listMembers", { groupId: book.groupId }));
  const alex = members.find((member) => member.name === PEOPLE.alex.label);
  must(await hubCall("sam", "removeMember", { groupId: book.groupId, memberRef: alex?.memberRef ?? "" }));

  return [
    { label: "Friday Puzzlers", code: friday.inviteCode },
    { label: "Coffee Crew (Alex is a member)", code: coffee.inviteCode },
    { label: "Book Club (Alex was removed)", code: book.inviteCode },
    { label: "A broken link", code: BROKEN_CODE },
  ];
}

function readSession(): StoredSession | null {
  const raw = localStorage.getItem(SESSION_KEY);
  return raw === null ? null : (JSON.parse(raw) as StoredSession);
}

/** Who the stored session belongs to at this moment. */
function holder(): PersonId | null {
  const uid = readSession()?.user.id;
  return PERSON_IDS.find((person) => PEOPLE[person].authUid === uid) ?? null;
}

function signIn(person: PersonId): void {
  const session: StoredSession = { access_token: tokens[person], user: { id: PEOPLE[person].authUid } };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

let accountChecks = 0;

function accountRow(person: PersonId | null) {
  if (person === null) return { outcome: "not_signed_in", user_id: null, global_user_id: null, email: null, created_at: null };
  return { outcome: "ok", user_id: PEOPLE[person].authUid, global_user_id: PEOPLE[person].globalUserId, email: null, created_at: CREATED_AT };
}

async function rpc(name: string) {
  if (name !== "ensure_account") return { data: null, error: { message: `The synthetic backend has no ${name}.` } };
  accountChecks += 1;
  return { data: [accountRow(holder())], error: null };
}

/** Only the surface the real sign-in code calls. */
const client = {
  rpc,
  auth: {
    /** Sign-out stays local in every game, so no other scope exists here. */
    signOut: async ({ scope }: { scope: "local" }) => {
      if (scope !== "local") return { error: { message: "Only a local sign-out exists here." } };
      localStorage.removeItem(SESSION_KEY);
      return { error: null };
    },
  },
};

let holdingAnswers = false;
/** Answers waiting for release, oldest first. */
let heldAnswers: (() => void)[] = [];

/** The browser's route to the hub. Answers can be held on the way back, as a slow network would. */
const transport: SocialTransport = {
  async call<O extends OpName>(op: O, args: Operations[O]["args"], credential: string | null): Promise<Result<Operations[O]["data"]>> {
    const hold = holdingAnswers;
    const answer = await hubTransport.call(op, args, credential);
    if (!hold) return answer;
    return new Promise((resolve) => {
      heldAnswers.push(() => resolve(answer));
    });
  },
};

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve));

/** Stops holding and delivers everything held, one task at a time. */
async function release(): Promise<void> {
  holdingAnswers = false;
  const waiting = heldAnswers;
  heldAnswers = [];
  for (const deliver of waiting) {
    deliver();
    await nextTask();
  }
  await nextTask();
}

function puzzleId(): string {
  return `daily:${new Date(clock).toISOString().slice(0, 10)}`;
}

/** The hub's date, as a local day for the Friends screen to show. */
function today(): Date {
  const date = new Date(clock);
  return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** The fake game server: the one caller of the route no browser can reach. */
async function finishToday(): Promise<Outcome | null> {
  const person = holder();
  if (person === null) return "not_signed_in";
  const { globalUserId, finishes } = PEOPLE[person];
  const answer = await hub.serverFor(GAME).recordCompletion({
    gameId: GAME,
    puzzleId: puzzleId(),
    globalUserId,
    completedAt: new Date(now()).toISOString(),
    summary: { solved: finishes.solved, mistakes: finishes.mistakes },
    detail: finishes.grid,
  });
  return answer.ok === false ? answer.outcome : null;
}

export const backend = {
  client,
  transport,
  signIn,
  holder,
  finishToday,
  puzzleId,
  today,
  /** The access token in the stored synthetic session, if there is one. */
  accessToken: () => readSession()?.access_token ?? null,
  nextDay: () => {
    clock += DAY_MS;
  },
  choices: PERSON_IDS.map((id) => ({ id, label: PEOPLE[id].label })),
  /** Demo links for the walkthrough, once the hub has them. */
  seeded: seed(),
  // For the test, which imports them. Nothing on the page reaches these.
  holdHubAnswers: (on: boolean) => {
    holdingAnswers = on;
  },
  release,
  heldCount: () => heldAnswers.length,
  hubCall,
  accountChecks: () => accountChecks,
  storedResultCount: () => hub.storedResultCount(),
};
