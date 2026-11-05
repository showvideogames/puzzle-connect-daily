import { AVATAR_IDS, CURRENT_NOTICE_VERSION, DEFAULT_AVATAR, DEFAULT_COLOR, DEFAULT_EMBLEM, GAME_STATUS, GROUP_EMBLEM_IDS, LIMITS, PROFILE_COLORS, RESULT_SHAPES } from './contract';
import type {
  CompletionInput,
  Face,
  FriendRequestRow,
  GameId,
  GameStatus,
  Limits,
  MemberPreview,
  MemberRow,
  Operations,
  OpName,
  Outcome,
  Result,
  ResultDetail,
  ResultRow,
  ResultShape,
  ResultSummary,
  ServerOperations,
  SocialServerRoute,
  SocialTransport,
} from './contract';

/**
 * MOCK ONLY. An in-memory stand-in for the Social Hub and its gateway, the one
 * reference for contract behaviour until a real hub is decided (D1). Nothing
 * here is secure or lasting: ids come from a plain random source, tokens are
 * table lookups, and everything is gone when the page or test ends.
 *
 * PORTABLE: copied unchanged into every game.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// The mock's token issuer
// ---------------------------------------------------------------------------

/**
 * Which games verify each other's tokens. Games in one mock project share one
 * token issuer and one sign-in per person, so a token that verifies proves only
 * that the person signed in, not that they have an account in this game. These
 * are mock labels and nothing more.
 */
const MOCK_PROJECT: Record<GameId, string> = {
  rainbow: 'project-a',
  crosspuns: 'project-a',
  hamburgle: 'project-a',
  priceiswhat: 'project-a',
  cluevoyance: 'project-b',
  wtf: 'project-c',
  yodel: 'project-d',
};

export interface MockIssue {
  game: GameId;
  globalUserId: string;
  /** A guest holding a real token, as some games have. */
  anonymous?: boolean;
  /** False for a valid token with no shared-account identity. */
  linked?: boolean;
  /** False for someone signed in to this game's project with no account in this game. */
  account?: boolean;
}

export interface MockClaims {
  game: GameId;
  globalUserId: string;
  anonymous: boolean;
  linked: boolean;
  /** This game's own id for the person. The hub never keys on it. */
  localId: string;
}

export interface MockIdentity {
  /** Unless told otherwise, a linked person also gets an account in this game. */
  issue(input: MockIssue): string;
  /** For the hub: what a token says, only if it comes from this game's project. */
  verify(game: GameId, token: string | null): MockClaims | null;
  /** For the hub: the question a real gateway asks the game's own account boundary. */
  hasAccount(game: GameId, globalUserId: string): boolean;
  /** One game deleted this person's account. */
  closeAccount(game: GameId, globalUserId: string): void;
  /** For conformance checks: a value that must never reach a response. */
  localIdFor(game: GameId, globalUserId: string): string | null;
}

function plainRandomId(): string {
  return Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12);
}

export function createMockIdentity({ randomId = plainRandomId }: { randomId?: () => string } = {}): MockIdentity {
  const tokens = new Map<string, MockClaims>();
  const localIds = new Map<string, string>();
  const accounts = new Set<string>();
  const localKey = (game: GameId, globalUserId: string) => `${game}\n${globalUserId}`;

  return {
    issue({ game, globalUserId, anonymous = false, linked = true, account = !anonymous && linked }) {
      const key = localKey(game, globalUserId);
      const localId = localIds.get(key) ?? `local-${randomId()}`;
      localIds.set(key, localId);
      if (account) accounts.add(key);
      const token = `token-${randomId()}`;
      tokens.set(token, { game, globalUserId, anonymous, linked, localId });
      return token;
    },
    verify(game, token) {
      const claims = token === null ? undefined : tokens.get(token);
      return claims && MOCK_PROJECT[claims.game] === MOCK_PROJECT[game] ? claims : null;
    },
    hasAccount(game, globalUserId) {
      return accounts.has(localKey(game, globalUserId));
    },
    closeAccount(game, globalUserId) {
      accounts.delete(localKey(game, globalUserId));
    },
    localIdFor(game, globalUserId) {
      return localIds.get(localKey(game, globalUserId)) ?? null;
    },
  };
}

// ---------------------------------------------------------------------------
// The hub
// ---------------------------------------------------------------------------

export interface MemoryHubOptions {
  identity: MockIdentity;
  /** Milliseconds since the epoch. */
  now?: () => number;
  gameStatus?: Record<GameId, GameStatus>;
  randomId?: () => string;
  /** For tests that can't reasonably reach a real limit. */
  limits?: Partial<Limits>;
}

export interface MemoryHub {
  transportFor(game: GameId): SocialTransport;
  /** The game-server route. No token reaches it, and nothing on a transport reaches it either. */
  serverFor(game: GameId): SocialServerRoute;
  /** One game deleted its account: only that game's link goes (D5). */
  unlinkGame(game: GameId, globalUserId: string): void;
  /** For conformance checks. No operation shows which games someone is in. */
  gameLinks(globalUserId: string): GameId[];
  /** For conformance worlds: someone who chose this name before the scenario began. */
  seedDisplayName(globalUserId: string, name: string): void;
  /** For conformance worlds: how many result cards are stored, as a count and never a card. No transport reaches it. */
  storedResultCount(): number;
}

interface Person extends Face {
  id: string;
  globalUserId: string;
  displayName: string | null;
  /** Stored clean: six characters, no dash. */
  friendCode: string;
  games: Set<GameId>;
  activity: { kind: 'create' | 'join' | 'friend_invite' | 'friend_lookup'; at: number }[];
}

interface Friendship {
  ref: string;
  a: string;
  b: string;
  since: number;
  /** Which notice each person saw. */
  notices: Map<string, number>;
  preferences?: Map<string, { favorite: boolean; nickname: string | null }>;
}

interface FriendRequest {
  ref: string;
  from: string;
  to: string;
  // Declined stays stored and looks pending to the sender, so a decline tells them nothing.
  status: 'pending' | 'declined';
  sentAt: number;
  noticeVersion: number;
}

/** What findFriendByCode handed out: good for one caller, one person, a short while. */
interface Lookup {
  ref: string;
  caller: string;
  target: string;
  expiresAt: number;
}

interface Block {
  ref: string;
  blocker: string;
  blocked: string;
  name: string | null;
}

interface FriendInvite {
  // Raw in the mock. The real hub stores only a hash of every invite code.
  code: string;
  creator: string;
  expiresAt: number;
  used: boolean;
  /** The notice the creator saw, for the friendship this invite becomes. */
  noticeVersion: number;
}

interface Membership {
  memberRef: string;
  person: string;
  name: string;
  joinedAt: number;
  noticeVersion: number;
  privatePosition?: number;
}

interface Removal {
  removedRef: string;
  person: string;
  name: string;
}

interface Group {
  id: string;
  name: string;
  owner: string;
  // Readable in the mock, so the owner can read it again. How a real hub stores group codes is pending D12.
  code: string;
  emblemId: string;
  accentColor: string;
  photo: string | null;
  photoVersion: number;
  members: Map<string, Membership>;
  removed: Map<string, Removal>;
}

interface ResultCard {
  person: string;
  completedAt: number;
  summary: ResultSummary;
  detail: ResultDetail | null;
}

const done = <T>(data: T) => ({ ok: true, data }) as const;
const fail = (outcome: Outcome) => ({ ok: false, outcome }) as const;
const NOTHING: Record<string, never> = {};

/** UTC ISO 8601 with milliseconds, the wire format. */
const iso = (ms: number) => new Date(ms).toISOString();

const CODE_LENGTH = 12;

/** Trimmed, and null unless it fits. Characters are counted as the database counts them. */
function cleanName(value: unknown, max: number): string | null {
  const name = typeof value === 'string' ? value.trim() : '';
  const length = [...name].length;
  return length >= 1 && length <= max ? name : null;
}

const cleanCode = (value: unknown) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

const isOneOf = (list: readonly string[], value: unknown) => typeof value === 'string' && list.includes(value);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const found = Object.keys(value);
  return found.length === keys.length && keys.every((key) => found.includes(key));
}

// -- Friend codes -----------------------------------------------------------

/** A to Z and 2 to 9, without O or I. Thirty-two characters, so five bits pick one. */
const FRIEND_CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const FRIEND_CODE_LENGTH = 6;

/** Ignoring case, spaces and the dash is all a lookup does. */
const cleanFriendCode = (value: unknown) => (typeof value === 'string' ? value.toUpperCase().replace(/[\s-]/g, '') : '');

const showFriendCode = (code: string) => `${code.slice(0, 3)}-${code.slice(3)}`;

// -- Group pictures, checked from their own bytes as CrossPuns does -----------

const PHOTO_PREFIX = 'data:image/jpeg;base64,';
const BASE64_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** The bytes, or null for anything but well-formed base64. */
function decodeBase64(text: string): number[] | null {
  if (text.length === 0 || text.length % 4 !== 0) return null;
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const bytes: number[] = [];
  let value = 0;
  let bits = 0;
  for (const letter of text.slice(0, text.length - padding)) {
    const digit = BASE64_LETTERS.indexOf(letter);
    if (digit < 0) return null;
    value = (value << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push(value >> bits);
      value &= (1 << bits) - 1;
    }
  }
  return value === 0 ? bytes : null;
}

const uint16 = (bytes: readonly number[], at: number) => bytes[at] * 256 + bytes[at + 1];

/** Walks the JPEG's markers to its frame header, as CrossPuns' group picture check does. Null if there isn't one. */
function jpegSize(bytes: readonly number[]): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  for (let steps = 0; at + 3 < bytes.length && steps < 200; steps++) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    if (marker === 0xff) {
      at += 1; // a fill byte
    } else if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2; // these markers carry no length
    } else if (marker === 0xd9 || marker === 0xda) {
      return null; // the image ended, or its scan began, before any frame header
    } else {
      const length = uint16(bytes, at + 2);
      if (length < 2) return null;
      const isFrameHeader = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrameHeader) return at + 8 < bytes.length ? { height: uint16(bytes, at + 5), width: uint16(bytes, at + 7) } : null;
      at += 2 + length;
    }
  }
  return null;
}

/** Structural PNG validation matching the proposed hub patch; not a pixel decoder. */
function pngSize(bytes: readonly number[]): { width: number; height: number } | null {
  if (bytes.length < 57 || [137,80,78,71,13,10,26,10].some((v,i) => bytes[i] !== v)) return null;
  const u32 = (at: number) => bytes[at] * 16777216 + bytes[at+1] * 65536 + bytes[at+2] * 256 + bytes[at+3];
  let width = 0, height = 0, data = false;
  for (let at = 8; at + 12 <= bytes.length;) {
    const length = u32(at);
    if (length > bytes.length - at - 12) return null;
    const tag = String.fromCharCode(...bytes.slice(at+4, at+8));
    if (at === 8) {
      if (tag !== 'IHDR' || length !== 13) return null;
      width = u32(16); height = u32(20);
      if (!width || !height || width > 2147483647 || height > 2147483647 || bytes[24] !== 8 || ![2,6].includes(bytes[25]) || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] !== 0) return null;
    } else if (tag === 'IDAT') { if (length > 0) data = true; }
    else if (tag === 'IEND') return length === 0 && at + 12 === bytes.length && data ? { width, height } : null;
    else if (['IHDR','acTL','fcTL','fdAT'].includes(tag)) return null;
    else if (tag !== 'PLTE' && (bytes[at+4] & 32) === 0) return null;
    at += length + 12;
  }
  return null;
}

// -- Results ----------------------------------------------------------------

const COMPLETION_KEYS: readonly string[] = ['gameId', 'puzzleId', 'globalUserId', 'completedAt', 'summary', 'detail'];
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const PUZZLE_ID = /^[A-Za-z0-9:_-]+$/;

function summaryFits(shape: ResultShape, summary: unknown): boolean {
  if (!isRecord(summary) || !hasExactKeys(summary, Object.keys(shape.summary))) return false;
  return Object.entries(shape.summary).every(([key, kind]) => {
    const value = summary[key];
    return kind === 'boolean' ? typeof value === 'boolean' : Number.isSafeInteger(value) && (value as number) >= 0;
  });
}

function detailFits(shape: ResultShape, detail: unknown, max: number): boolean {
  if (shape.detail === 'none') return detail === null;
  if (shape.detail === 'grid') return typeof detail === 'string' && detail.trim().length > 0 && [...detail].length <= max;
  return Array.isArray(detail) && detail.length >= 1 && detail.length <= max && detail.every((answer) => typeof answer === 'boolean');
}

const resultKey = (game: unknown, puzzleId: unknown, person: string) => `${String(game)}\n${String(puzzleId)}\n${person}`;

type Handlers = {
  [O in Exclude<OpName, 'previewInvite'>]: (me: Person, args: Operations[O]['args']) => Result<Operations[O]['data']>;
};

export function createMemoryHub({ identity, now = Date.now, gameStatus = GAME_STATUS, randomId = plainRandomId, limits: overrides }: MemoryHubOptions): MemoryHub {
  const limits: Limits = { ...LIMITS, ...overrides };
  const people = new Map<string, Person>();
  const personByGlobalId = new Map<string, string>();
  const personByFriendCode = new Map<string, string>();
  const friendships = new Map<string, Friendship>();
  const requests = new Map<string, FriendRequest>();
  const lookups = new Map<string, Lookup>();
  const blocks = new Map<string, Block>();
  const friendInvites = new Map<string, FriendInvite>();
  const groups = new Map<string, Group>();
  const results = new Map<string, ResultCard>();

  /** Exactly 12 characters of 0-9a-z, whatever the id source gives. The tries only stop a source that gives nothing usable. */
  function newCode(): string {
    let code = '';
    for (let tries = 0; code.length < CODE_LENGTH && tries < CODE_LENGTH; tries++) {
      code += randomId().toLowerCase().replace(/[^0-9a-z]/g, '');
    }
    return code.padEnd(CODE_LENGTH, '0').slice(0, CODE_LENGTH);
  }

  /** Unused, and from the approved letters, whatever the id source gives. The try number moves a source that repeats itself along. */
  function newFriendCode(): string {
    for (let attempt = 0; ; attempt++) {
      let mixed = 0;
      for (const letter of `${randomId()}:${attempt}`) mixed = (mixed * 31 + letter.charCodeAt(0)) % 4294967296;
      let code = '';
      for (let i = 0; i < FRIEND_CODE_LENGTH; i++) code += FRIEND_CODE_LETTERS[(mixed >>> (i * 5)) & 31];
      if (!personByFriendCode.has(code)) return code;
    }
  }

  function personFor(globalUserId: string): Person {
    const known = personByGlobalId.get(globalUserId);
    const found = known === undefined ? undefined : people.get(known);
    if (found) return found;
    const person: Person = {
      id: randomId(),
      globalUserId,
      displayName: null,
      animalId: DEFAULT_AVATAR,
      backgroundColor: DEFAULT_COLOR,
      friendCode: newFriendCode(),
      games: new Set(),
      activity: [],
    };
    people.set(person.id, person);
    personByGlobalId.set(globalUserId, person.id);
    personByFriendCode.set(person.friendCode, person.id);
    return person;
  }

  const displayNameOf = (id: string) => people.get(id)?.displayName ?? null;

  function faceOf(id: string): Face {
    const person = people.get(id);
    return { animalId: person?.animalId ?? DEFAULT_AVATAR, backgroundColor: person?.backgroundColor ?? DEFAULT_COLOR };
  }

  /** True while this person is under the limit for the last 24 hours. Forgets anything older than two days. */
  function underDailyLimit(me: Person, kind: Person['activity'][number]['kind'], perDay: number): boolean {
    const time = now();
    me.activity = me.activity.filter((a) => a.at >= time - 2 * DAY_MS);
    return me.activity.filter((a) => a.kind === kind && a.at > time - DAY_MS).length < perDay;
  }

  /** Every attempt counts, whatever it finds, so guessing at codes costs the same as using one. */
  function spendLookup(me: Person): boolean {
    if (!underDailyLimit(me, 'friend_lookup', limits.friendLookupsPerDay)) return false;
    me.activity.push({ kind: 'friend_lookup', at: now() });
    return true;
  }

  const friendshipsOf = (id: string) => [...friendships.values()].filter((f) => f.a === id || f.b === id);
  const otherSide = (f: Friendship, id: string) => (f.a === id ? f.b : f.a);
  const friendshipBetween = (a: string, b: string) => friendshipsOf(a).find((f) => otherSide(f, a) === b);

  const requestsBetween = (a: string, b: string) => [...requests.values()].filter((r) => (r.from === a && r.to === b) || (r.from === b && r.to === a));

  function dropRequestsBetween(a: string, b: string): void {
    for (const request of requestsBetween(a, b)) requests.delete(request.ref);
  }

  /** The only way two people become friends, so no route leaves an old request behind. */
  function makeFriendship(a: string, b: string, notices: Map<string, number>): Friendship {
    const friendship: Friendship = { ref: randomId(), a, b, since: now(), notices };
    friendships.set(friendship.ref, friendship);
    dropRequestsBetween(a, b);
    return friendship;
  }

  const blockedEitherWay = (a: string, b: string) =>
    [...blocks.values()].some((x) => (x.blocker === a && x.blocked === b) || (x.blocker === b && x.blocked === a));

  /** Why these two can't start a friend request, or nothing. A block looks exactly like a code nobody holds. */
  function requestRefusal(me: string, other: string): Outcome | null {
    if (blockedEitherWay(me, other)) return 'not_found';
    if (friendshipBetween(me, other)) return 'already_friends';
    if (requestsBetween(me, other).length > 0) return 'request_pending';
    return null;
  }

  function requestRow(request: FriendRequest, other: string): FriendRequestRow {
    return { requestRef: request.ref, name: displayNameOf(other), ...faceOf(other), sentAt: iso(request.sentAt) };
  }

  const groupsOf = (id: string) => [...groups.values()].filter((g) => g.members.has(id));
  const groupWithCode = (code: string) => [...groups.values()].find((g) => g.code === code);
  const newMembership = (person: string, name: string, noticeVersion: number): Membership => ({ memberRef: randomId(), person, name, joinedAt: now(), noticeVersion });

  /** The group and my place in it, or nothing: a group I'm not in and a group that doesn't exist look the same. */
  function membership(me: Person, groupId: string) {
    const group = groups.get(groupId);
    const mine = group?.members.get(me.id);
    return group && mine ? { group, mine } : null;
  }

  /** Who a ref points to, if the caller can see that ref. */
  function personBehind(me: Person, ref: string): { person: string; name: string | null } | null {
    const friendship = friendships.get(ref);
    if (friendship && (friendship.a === me.id || friendship.b === me.id)) {
      const person = otherSide(friendship, me.id);
      return { person, name: displayNameOf(person) };
    }
    for (const group of groupsOf(me.id)) {
      const member = [...group.members.values()].find((m) => m.memberRef === ref);
      if (member) return { person: member.person, name: member.name };
    }
    return null;
  }

  /** Someone leaves or goes. Ownership passes to the longest-standing member; the last one out closes the group. */
  function leave(group: Group, person: string): boolean {
    group.members.delete(person);
    if (group.members.size === 0) {
      groups.delete(group.id);
      return true;
    }
    if (group.owner === person) {
      // sort is stable, so people who joined at the same moment stay in joining order
      group.owner = [...group.members.values()].sort((x, y) => x.joinedAt - y.joinedAt)[0].person;
    }
    return false;
  }

  /** Runs an owner-only change, after the two refusals every owner-only operation shares. */
  function asOwner<T>(me: Person, groupId: string, change: (group: Group) => Result<T>): Result<T> {
    const found = membership(me, groupId);
    if (!found) return fail('not_a_member');
    if (found.group.owner !== me.id) return fail('not_the_creator');
    return change(found.group);
  }

  /** What a good picture earns is null. The base64 length test comes first, so an absurd upload is never decoded. */
  function photoRefusal(photo: unknown): Outcome | null {
    if (typeof photo !== 'string') return 'not_a_picture';
    const png = photo.startsWith('data:image/png;base64,');
    const prefix = png ? 'data:image/png;base64,' : PHOTO_PREFIX;
    if (!photo.startsWith(prefix)) return 'not_a_picture';
    const encoded = photo.slice(prefix.length);
    if (encoded.length > Math.ceil(limits.photoBytes / 3) * 4) return 'too_big';
    const bytes = decodeBase64(encoded);
    if (!bytes) return 'not_a_picture';
    if (bytes.length > limits.photoBytes) return 'too_big';
    const size = png ? pngSize(bytes) : jpegSize(bytes);
    if (!size) return 'not_a_picture';
    return size.width === limits.photoEdge && size.height === limits.photoEdge ? null : 'wrong_size';
  }

  /** The wire format exactly, and not in the future: a later date would slip past the forward-only rule. */
  function completedAtFits(value: unknown): boolean {
    if (typeof value !== 'string' || !TIMESTAMP.test(value)) return false;
    const ms = Date.parse(value);
    return !Number.isNaN(ms) && iso(ms) === value && ms <= now();
  }

  function resultFits(game: GameId, input: unknown): input is CompletionInput {
    const shape = RESULT_SHAPES[game];
    if (!shape || !isRecord(input) || !hasExactKeys(input, COMPLETION_KEYS) || input.gameId !== game) return false;
    const { puzzleId, globalUserId, completedAt, summary, detail } = input;
    return (
      typeof puzzleId === 'string' &&
      puzzleId.length <= limits.puzzleIdMax &&
      PUZZLE_ID.test(puzzleId) &&
      typeof globalUserId === 'string' &&
      completedAtFits(completedAt) &&
      summaryFits(shape, summary) &&
      detailFits(shape, detail, limits.resultDetailMax)
    );
  }

  /** The game-server route. It takes a global id, so it has no place among the handlers. */
  function recordCompletion(game: GameId, input: unknown): Result<ServerOperations['recordCompletion']['data']> {
    if (gameStatus[game] !== 'mock') return fail('game_disabled');
    if (!resultFits(game, input)) return fail('bad_result');
    const person = personByGlobalId.get(input.globalUserId);
    if (person === undefined || !identity.hasAccount(game, input.globalUserId)) return fail('not_found');
    const key = resultKey(game, input.puzzleId, person);
    // The first result stands, so a replay can't overwrite it.
    if (!results.has(key)) {
      results.set(key, { person, completedAt: Date.parse(input.completedAt), summary: { ...input.summary }, detail: Array.isArray(input.detail) ? [...input.detail] : input.detail });
    }
    return done(NOTHING);
  }

  /** Detail goes out only to someone who finished the same puzzle: for anyone else the key isn't there at all. */
  function resultRow(ref: { friendRef: string | null } | { memberRef: string }, card: ResultCard, name: string | null, isMe: boolean, finished: boolean): ResultRow {
    const row = { ...ref, isMe, name, ...faceOf(card.person), summary: card.summary };
    if (card.detail === null) return { ...row, detail: null, detailLocked: false };
    return finished ? { ...row, detail: card.detail, detailLocked: false } : { ...row, detailLocked: true };
  }

  /** Who the owner is and who else is here, for anyone holding a valid link. Results never come near it. */
  function memberPreview(group: Group): MemberPreview {
    const owner = group.members.get(group.owner) as Membership;
    // A Map keeps insertion order, which is joining order.
    const others = [...group.members.values()].filter((m) => m.person !== group.owner);
    return {
      faces: [owner, ...others].slice(0, limits.previewFaces).map((m) => faceOf(m.person)),
      leadName: owner.name,
      memberCount: group.members.size,
    };
  }

  function previewInvite(me: Person | null, code: string): Result<Operations['previewInvite']['data']> {
    const invite = friendInvites.get(cleanCode(code));
    if (invite) {
      // Blocks are ignored on purpose: a blocked person sees what a guest sees.
      if (invite.used) return fail('invite_used');
      if (now() > invite.expiresAt) return fail('invite_expired');
      return done({ inviterName: displayNameOf(invite.creator), ...faceOf(invite.creator) });
    }
    const group = groupWithCode(cleanCode(code));
    if (!group) return fail('invalid_code');
    const isMember = !!me && group.members.has(me.id);
    const isRemoved = !!me && group.removed.has(me.id);
    return done({
      name: group.name,
      emblemId: group.emblemId,
      accentColor: group.accentColor,
      photo: group.photo,
      memberPreview: isMember || isRemoved ? null : memberPreview(group),
      isMember,
      isRemoved,
    });
  }

  const handlers: Handlers = {
    getMe(me) {
      return done({
        displayName: me.displayName,
        animalId: me.animalId,
        backgroundColor: me.backgroundColor,
        friendCode: showFriendCode(me.friendCode),
        friendCount: friendshipsOf(me.id).length,
        groupCount: groupsOf(me.id).length,
      });
    },

    setDisplayName(me, { name }) {
      const clean = cleanName(name, limits.nameMax);
      if (clean === null) return fail('bad_my_name');
      me.displayName = clean;
      return done({ displayName: clean });
    },

    setProfile(me, { displayName, animalId, backgroundColor }) {
      const clean = cleanName(displayName, limits.nameMax);
      if (clean === null) return fail('bad_my_name');
      if (!isOneOf(AVATAR_IDS, animalId)) return fail('bad_avatar');
      if (!isOneOf(PROFILE_COLORS, backgroundColor)) return fail('bad_color');
      me.displayName = clean;
      me.animalId = animalId;
      me.backgroundColor = backgroundColor;
      return done({ displayName: clean, animalId, backgroundColor });
    },

    createFriendInvite(me, { noticeVersion }) {
      if (me.displayName === null) return fail('needs_display_name');
      if (noticeVersion !== CURRENT_NOTICE_VERSION) return fail('notice_required');
      if (!underDailyLimit(me, 'friend_invite', limits.friendInvitesPerDay)) return fail('slow_down');
      const invite: FriendInvite = { code: newCode(), creator: me.id, expiresAt: now() + limits.friendInviteDays * DAY_MS, used: false, noticeVersion };
      friendInvites.set(invite.code, invite);
      me.activity.push({ kind: 'friend_invite', at: now() });
      return done({ code: invite.code, expiresAt: iso(invite.expiresAt) });
    },

    acceptFriendInvite(me, { code, noticeVersion }) {
      if (me.displayName === null) return fail('needs_display_name');
      if (noticeVersion !== CURRENT_NOTICE_VERSION) return fail('notice_required');
      const invite = friendInvites.get(cleanCode(code));
      if (!invite) return fail('invalid_code');
      if (invite.creator === me.id) return fail('own_invite');
      if (invite.used) return fail('invite_used');
      if (now() > invite.expiresAt) return fail('invite_expired');
      if (blockedEitherWay(me.id, invite.creator)) {
        // Used up, just as if someone else had taken it, so a later preview agrees and the block can't be detected.
        invite.used = true;
        return fail('invite_used');
      }
      const existing = friendshipBetween(me.id, invite.creator);
      if (existing) {
        existing.notices.set(me.id, noticeVersion);
        return done({ friendRef: existing.ref, name: displayNameOf(invite.creator) });
      }
      if (friendshipsOf(me.id).length >= limits.friends || friendshipsOf(invite.creator).length >= limits.friends) return fail('too_many_friends');
      invite.used = true;
      const notices = new Map<string, number>([
        [me.id, noticeVersion],
        [invite.creator, invite.noticeVersion],
      ]);
      const friendship = makeFriendship(me.id, invite.creator, notices);
      return done({ friendRef: friendship.ref, name: displayNameOf(invite.creator) });
    },

    findFriendByCode(me, { friendCode }) {
      if (me.displayName === null) return fail('needs_display_name');
      if (!spendLookup(me)) return fail('slow_down');
      const target = personByFriendCode.get(cleanFriendCode(friendCode));
      if (target === undefined) return fail('not_found');
      if (target === me.id) return fail('own_code');
      const refusal = requestRefusal(me.id, target);
      if (refusal) return fail(refusal);
      const lookup: Lookup = { ref: randomId(), caller: me.id, target, expiresAt: now() + limits.lookupRefHours * HOUR_MS };
      lookups.set(lookup.ref, lookup);
      return done({ requestRef: lookup.ref, name: displayNameOf(target), ...faceOf(target) });
    },

    sendFriendRequest(me, { requestRef, noticeVersion }) {
      if (me.displayName === null) return fail('needs_display_name');
      if (noticeVersion !== CURRENT_NOTICE_VERSION) return fail('notice_required');
      if (!spendLookup(me)) return fail('slow_down');
      const lookup = lookups.get(requestRef);
      if (!lookup || lookup.caller !== me.id || now() > lookup.expiresAt) return fail('not_found');
      const refusal = requestRefusal(me.id, lookup.target);
      if (refusal) return fail(refusal);
      const request: FriendRequest = { ref: randomId(), from: me.id, to: lookup.target, status: 'pending', sentAt: now(), noticeVersion };
      requests.set(request.ref, request);
      return done(NOTHING);
    },

    listFriendRequests(me) {
      const all = [...requests.values()];
      return done({
        incoming: all.filter((r) => r.to === me.id && r.status === 'pending').map((r) => requestRow(r, r.from)),
        // Declined or not: the sender's row stays exactly as it was.
        outgoing: all.filter((r) => r.from === me.id).map((r) => requestRow(r, r.to)),
      });
    },

    acceptFriendRequest(me, { requestRef, noticeVersion }) {
      if (me.displayName === null) return fail('needs_display_name');
      if (noticeVersion !== CURRENT_NOTICE_VERSION) return fail('notice_required');
      const request = requests.get(requestRef);
      if (!request || request.to !== me.id || request.status !== 'pending') return fail('not_found');
      if (friendshipsOf(me.id).length >= limits.friends || friendshipsOf(request.from).length >= limits.friends) return fail('too_many_friends');
      const notices = new Map<string, number>([
        [me.id, noticeVersion],
        [request.from, request.noticeVersion],
      ]);
      const friendship = makeFriendship(me.id, request.from, notices);
      return done({ friendRef: friendship.ref, name: displayNameOf(request.from) });
    },

    declineFriendRequest(me, { requestRef }) {
      const request = requests.get(requestRef);
      if (!request || request.to !== me.id || request.status !== 'pending') return fail('not_found');
      request.status = 'declined';
      return done(NOTHING);
    },

    cancelFriendRequest(me, { requestRef }) {
      if (requests.get(requestRef)?.from !== me.id) return fail('not_found');
      requests.delete(requestRef);
      return done(NOTHING);
    },

    listFriends(me) {
      return done(
        friendshipsOf(me.id).map((f) => {
          const friend = otherSide(f, me.id);
          return { friendRef: f.ref, name: displayNameOf(friend), ...faceOf(friend), since: iso(f.since) };
        }),
      );
    },

    listFriendPreferences(me) {
      return done(friendshipsOf(me.id).flatMap(f => {
        const preference = f.preferences?.get(me.id);
        return preference ? [{ friendRef: f.ref, ...preference }] : [];
      }));
    },

    setFriendPreference(me, { friendRef, favorite, nickname }) {
      const friendship = friendships.get(friendRef);
      if (!friendship || (friendship.a !== me.id && friendship.b !== me.id)) return fail('not_found');
      if (typeof favorite !== 'boolean') return fail('unavailable');
      const name = nickname === null ? null : cleanName(nickname, limits.nameMax);
      if (nickname !== null && name === null) return fail('bad_name');
      friendship.preferences ??= new Map();
      friendship.preferences.set(me.id, { favorite, nickname: name });
      return done({ friendRef, favorite, nickname: name });
    },

    removeFriend(me, { friendRef }) {
      const friendship = friendships.get(friendRef);
      if (!friendship || (friendship.a !== me.id && friendship.b !== me.id)) return fail('not_found');
      friendships.delete(friendRef);
      return done(NOTHING);
    },

    block(me, { ref }) {
      const target = personBehind(me, ref);
      if (!target || target.person === me.id) return fail('not_found');
      const already = [...blocks.values()].find((b) => b.blocker === me.id && b.blocked === target.person);
      if (already) return done({ blockRef: already.ref });
      const friendship = friendshipBetween(me.id, target.person);
      if (friendship) friendships.delete(friendship.ref);
      dropRequestsBetween(me.id, target.person);
      const entry: Block = { ref: randomId(), blocker: me.id, blocked: target.person, name: target.name };
      blocks.set(entry.ref, entry);
      return done({ blockRef: entry.ref });
    },

    unblock(me, { blockRef }) {
      if (blocks.get(blockRef)?.blocker !== me.id) return fail('not_found');
      blocks.delete(blockRef);
      return done(NOTHING);
    },

    listBlocks(me) {
      return done([...blocks.values()].filter((b) => b.blocker === me.id).map((b) => ({ blockRef: b.ref, name: b.name })));
    },

    createGroup(me, { name, myName, noticeVersion }) {
      if (me.displayName === null) return fail('needs_display_name');
      if (noticeVersion !== CURRENT_NOTICE_VERSION) return fail('notice_required');
      const groupName = cleanName(name, limits.groupNameMax);
      if (groupName === null) return fail('bad_name');
      const shownName = cleanName(myName, limits.nameMax);
      if (shownName === null) return fail('bad_my_name');
      if ([...groups.values()].filter((g) => g.owner === me.id).length >= limits.groupsCreatedTotal) return fail('too_many_created');
      if (groupsOf(me.id).length >= limits.groupsJoinedTotal) return fail('too_many_groups');
      if (!underDailyLimit(me, 'create', limits.groupsCreatedPerDay)) return fail('slow_down');
      const group: Group = {
        id: randomId(),
        name: groupName,
        owner: me.id,
        code: newCode(),
        emblemId: DEFAULT_EMBLEM,
        accentColor: DEFAULT_COLOR,
        photo: null,
        photoVersion: 0,
        members: new Map([[me.id, newMembership(me.id, shownName, noticeVersion)]]),
        removed: new Map(),
      };
      groups.set(group.id, group);
      me.activity.push({ kind: 'create', at: now() });
      return done({ groupId: group.id, inviteCode: group.code });
    },

    joinGroup(me, { code, myName, noticeVersion }) {
      if (me.displayName === null) return fail('needs_display_name');
      if (noticeVersion !== CURRENT_NOTICE_VERSION) return fail('notice_required');
      const group = groupWithCode(cleanCode(code));
      if (!group) return fail('invalid_code');
      const existing = group.members.get(me.id);
      if (existing) {
        existing.noticeVersion = noticeVersion;
        return done({ groupId: group.id });
      }
      if (group.removed.has(me.id)) return fail('removed');
      const shownName = cleanName(myName, limits.nameMax);
      if (shownName === null) return fail('bad_my_name');
      if (groupsOf(me.id).length >= limits.groupsJoinedTotal) return fail('too_many_groups');
      if (group.members.size >= limits.groupSize) return fail('group_full');
      if (!underDailyLimit(me, 'join', limits.groupsJoinedPerDay)) return fail('slow_down');
      group.members.set(me.id, newMembership(me.id, shownName, noticeVersion));
      me.activity.push({ kind: 'join', at: now() });
      return done({ groupId: group.id });
    },

    listGroupOrder(me) {
      const membership = (g: Group) => g.members.get(me.id) as Membership;
      const ordered = groupsOf(me.id).sort((a,b) => (membership(a).privatePosition ?? Infinity) - (membership(b).privatePosition ?? Infinity) || membership(a).joinedAt - membership(b).joinedAt || membership(a).memberRef.localeCompare(membership(b).memberRef));
      return done({ groupIds: ordered.map(g => g.id) });
    },

    setGroupOrder(me, { groupIds }) {
      const current = groupsOf(me.id);
      if (!Array.isArray(groupIds) || groupIds.length > limits.groupsJoinedTotal || groupIds.length !== current.length || new Set(groupIds).size !== groupIds.length || groupIds.some(id => !current.some(g => g.id === id))) return fail('not_found');
      groupIds.forEach((id, position) => { (groups.get(id)?.members.get(me.id) as Membership).privatePosition = position; });
      return done(NOTHING);
    },

    listMyGroups(me) {
      const mine = (group: Group) => group.members.get(me.id) as Membership;
      const inJoiningOrder = groupsOf(me.id).sort((x, y) => mine(x).joinedAt - mine(y).joinedAt);
      return done(
        inJoiningOrder.map((group) => {
          const isOwner = group.owner === me.id;
          return {
            groupId: group.id,
            name: group.name,
            emblemId: group.emblemId,
            accentColor: group.accentColor,
            photo: group.photo,
            photoVersion: group.photoVersion,
            memberCount: group.members.size,
            isOwner,
            myName: mine(group).name,
            inviteCode: isOwner ? group.code : null,
          };
        }),
      );
    },

    listMembers(me, { groupId, after, limit }) {
      const found = membership(me, groupId);
      if (!found) return fail('not_a_member');
      const { group } = found;
      const rows: MemberRow[] = [...group.members.values()].map((m) => ({
        memberRef: m.memberRef,
        name: m.name,
        ...faceOf(m.person),
        isOwner: m.person === group.owner,
        isMe: m.person === me.id,
        joinedAt: iso(m.joinedAt),
      }));
      // joining order, the ref settling ties, so a page boundary is exact
      const before = (x: Pick<MemberRow, 'joinedAt' | 'memberRef'>, y: Pick<MemberRow, 'joinedAt' | 'memberRef'>) =>
        x.joinedAt < y.joinedAt || (x.joinedAt === y.joinedAt && x.memberRef < y.memberRef);
      rows.sort((x, y) => (before(x, y) ? -1 : 1));
      const size = Math.min(Math.max(typeof limit === 'number' ? Math.floor(limit) : limits.memberPage, 1), limits.memberPage);
      return done((after ? rows.filter((r) => before(after, r)) : rows).slice(0, size));
    },

    leaveGroup(me, { groupId }) {
      const found = membership(me, groupId);
      if (!found) return fail('not_a_member');
      return done({ closed: leave(found.group, me.id) });
    },

    renameMeInGroup(me, { groupId, name }) {
      const found = membership(me, groupId);
      if (!found) return fail('not_a_member');
      const clean = cleanName(name, limits.nameMax);
      if (clean === null) return fail('bad_my_name');
      found.mine.name = clean;
      return done(NOTHING);
    },

    renameGroup(me, { groupId, name }) {
      return asOwner(me, groupId, (group) => {
        const clean = cleanName(name, limits.groupNameMax);
        if (clean === null) return fail('bad_name');
        group.name = clean;
        return done(NOTHING);
      });
    },

    setGroupAppearance(me, { groupId, emblemId, photo, accentColor }) {
      return asOwner(me, groupId, (group) => {
        if (!isOneOf(GROUP_EMBLEM_IDS, emblemId)) return fail('bad_emblem');
        if (!isOneOf(PROFILE_COLORS, accentColor)) return fail('bad_color');
        const refusal = photo === null ? null : photoRefusal(photo);
        if (refusal) return fail(refusal);
        if (photo !== group.photo) group.photoVersion += 1;
        group.emblemId = emblemId;
        group.accentColor = accentColor;
        group.photo = photo;
        return done({ photoVersion: group.photoVersion });
      });
    },

    removeMember(me, { groupId, memberRef }) {
      return asOwner(me, groupId, (group) => {
        const member = [...group.members.values()].find((m) => m.memberRef === memberRef);
        if (!member) return fail('not_found');
        if (member.person === me.id) return fail('cannot_remove_self');
        group.removed.set(member.person, { removedRef: randomId(), person: member.person, name: member.name });
        group.members.delete(member.person);
        return done(NOTHING);
      });
    },

    listRemoved(me, { groupId }) {
      return asOwner(me, groupId, (group) => done([...group.removed.values()].map((r) => ({ removedRef: r.removedRef, name: r.name }))));
    },

    letBackIn(me, { groupId, removedRef }) {
      return asOwner(me, groupId, (group) => {
        const removal = [...group.removed.values()].find((r) => r.removedRef === removedRef);
        if (!removal) return fail('not_found');
        group.removed.delete(removal.person);
        return done(NOTHING);
      });
    },

    replaceInvite(me, { groupId }) {
      return asOwner(me, groupId, (group) => {
        group.code = newCode();
        return done({ inviteCode: group.code });
      });
    },

    // The audience comes from the token alone. Whoever isn't connected to the
    // caller right now simply has no row, so an ended connection needs no cleaning up.
    listResults(me, { gameId, puzzleId, groupId }) {
      const cardOf = (person: string) => results.get(resultKey(gameId, puzzleId, person));
      const mine = cardOf(me.id);
      const finished = mine !== undefined;

      /** Someone else's card, only if it was completed at or after the two connected, and never across a block. */
      const sharedCard = (person: string, connectedAt: number) => {
        const card = cardOf(person);
        return card && card.completedAt >= connectedAt && !blockedEitherWay(me.id, person) ? card : undefined;
      };

      if (groupId !== undefined) {
        const found = membership(me, groupId);
        if (!found) return fail('not_a_member');
        const rows: ResultRow[] = [];
        for (const member of found.group.members.values()) {
          const isMe = member.person === me.id;
          const card = isMe ? mine : sharedCard(member.person, Math.max(member.joinedAt, found.mine.joinedAt));
          if (card) rows.push(resultRow({ memberRef: member.memberRef }, card, member.name, isMe, finished));
        }
        return done(rows);
      }

      const rows: ResultRow[] = mine ? [resultRow({ friendRef: null }, mine, me.displayName, true, finished)] : [];
      for (const friendship of friendshipsOf(me.id)) {
        const friend = otherSide(friendship, me.id);
        const card = sharedCard(friend, friendship.since);
        if (card) rows.push(resultRow({ friendRef: friendship.ref }, card, displayNameOf(friend), false, finished));
      }
      return done(rows);
    },

    deleteMySocialData(me) {
      for (const group of [...groups.values()]) {
        if (group.members.has(me.id)) leave(group, me.id);
        group.removed.delete(me.id);
      }
      for (const f of friendshipsOf(me.id)) friendships.delete(f.ref);
      for (const r of [...requests.values()]) {
        if (r.from === me.id || r.to === me.id) requests.delete(r.ref);
      }
      for (const l of [...lookups.values()]) {
        if (l.caller === me.id || l.target === me.id) lookups.delete(l.ref);
      }
      for (const b of [...blocks.values()]) {
        if (b.blocker === me.id || b.blocked === me.id) blocks.delete(b.ref);
      }
      for (const invite of [...friendInvites.values()]) {
        if (invite.creator === me.id) friendInvites.delete(invite.code);
      }
      for (const [key, card] of [...results.entries()]) {
        if (card.person === me.id) results.delete(key);
      }
      personByFriendCode.delete(me.friendCode);
      people.delete(me.id);
      personByGlobalId.delete(me.globalUserId);
      return done(NOTHING);
    },
  };

  // Check order: game enabled, then signed in, then linked, then the operation's
  // own rules. A name that is no operation at all has no rules to reach.
  function answer(game: GameId, op: OpName, args: unknown, credential: string | null): Result<unknown> {
    if (gameStatus[game] !== 'mock') return fail('game_disabled');
    if (op !== 'previewInvite' && !Object.prototype.hasOwnProperty.call(handlers, op)) return fail('unavailable');

    const claims = identity.verify(game, credential);
    // A token that verifies isn't an account: this game's own boundary has to say so.
    const usable = claims && !claims.anonymous && claims.linked && identity.hasAccount(game, claims.globalUserId) ? claims : null;

    if (op === 'previewInvite') {
      // Anyone may look. Only a real account in this game gets answers about themselves.
      const knownId = usable ? personByGlobalId.get(usable.globalUserId) : undefined;
      const me = knownId === undefined ? null : (people.get(knownId) ?? null);
      return previewInvite(me, (args as Operations['previewInvite']['args'] | undefined)?.code ?? '');
    }

    if (!claims || claims.anonymous) return fail('not_signed_in');
    if (!usable) return fail('not_linked');
    const handler = (handlers as unknown as Record<string, (me: Person, args: unknown) => Result<unknown>>)[op];
    const me = personFor(usable.globalUserId);
    me.games.add(game);
    return handler(me, args ?? {});
  }

  return {
    transportFor(game) {
      return {
        async call<O extends OpName>(op: O, args: Operations[O]['args'], credential: string | null) {
          // A copy, as a real network answer would be: nothing live leaks out of the hub.
          return JSON.parse(JSON.stringify(answer(game, op, args, credential))) as Result<Operations[O]['data']>;
        },
      };
    },
    serverFor(game) {
      return {
        async recordCompletion(input) {
          return JSON.parse(JSON.stringify(recordCompletion(game, input))) as Result<ServerOperations['recordCompletion']['data']>;
        },
      };
    },
    unlinkGame(game, globalUserId) {
      identity.closeAccount(game, globalUserId);
      const known = personByGlobalId.get(globalUserId);
      if (known !== undefined) people.get(known)?.games.delete(game);
    },
    gameLinks(globalUserId) {
      const known = personByGlobalId.get(globalUserId);
      const person = known === undefined ? undefined : people.get(known);
      return person ? [...person.games] : [];
    },
    seedDisplayName(globalUserId, name) {
      personFor(globalUserId).displayName = name;
    },
    storedResultCount() {
      return results.size;
    },
  };
}
