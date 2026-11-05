import { createSocialClient, disabledSocialClient } from './client';
import type { SocialClient } from './client';
import { AVATAR_IDS, CONTRACT_VERSION, CURRENT_NOTICE_VERSION, FORBIDDEN_RESPONSE_KEYS, GAME_STATUS, GROUP_EMBLEM_IDS, LIMITS, OUTCOMES, PROFILE_COLORS } from './contract';
import type { CompletionInput, FriendRequestRow, GameId, GroupInvitePreview, Limits, MemberRow, Operations, OpName, Outcome, Result, ResultRow, SessionState, SocialSession, SocialTransport } from './contract';
import { createMemoryHub, createMockIdentity } from './memoryHub';
import type { MemoryHub, MockIdentity } from './memoryHub';

/**
 * The conformance scenarios every game's adapter must pass, against the mock
 * hub. PORTABLE: copied unchanged into every game. No test framework: a
 * scenario throws when it fails, so any runner can register them.
 *
 * An enabled game runs adapterConformanceScenarios({ fixture, adapt }), which
 * joins two sets, because neither proves the other's point, and then fails
 * unless the game's own adapter really ran:
 *   adapterScenarios(fixture)           its real session source and factory
 *   socialConformanceScenarios(world)   the contract, with its adapter plugged in
 * It also passes its file through adapterSourceProblems. A disabled game runs
 * disabledGameScenarios(makeClient) and passes its file through
 * disabledAdapterSourceProblems.
 *
 * Every scenario in the world set also checks, at its end, every answer a
 * player received and every call that reached the transport.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const NOTICE = CURRENT_NOTICE_VERSION;

/** Every way of not having seen the current notice: left out, null, stale, from the future, and not a number. */
const WRONG_NOTICES = [{}, { noticeVersion: null }, { noticeVersion: NOTICE - 1 }, { noticeVersion: NOTICE + 1 }, { noticeVersion: String(NOTICE) }] as unknown as { noticeVersion: number }[];

/** O and I are never in a friend code, so nobody can hold this one. */
const NO_SUCH_FRIEND_CODE = 'OOO-III';

const PUZZLE = 'daily:2026-01-01';
const OTHER_PUZZLE = 'daily:2026-01-02';

const GAMES = Object.keys(GAME_STATUS) as GameId[];
const ENABLED_GAMES = GAMES.filter((game) => GAME_STATUS[game] === 'mock');
const DISABLED_GAMES = GAMES.filter((game) => GAME_STATUS[game] === 'disabled');

// ---------------------------------------------------------------------------
// What each operation may carry, and args good enough to reach its first check
// ---------------------------------------------------------------------------

type Row<T> = T extends readonly (infer R)[] ? R : T;
type FieldsOf<T> = T extends unknown ? keyof T : never;

/** The only keys an operation's args may hold. An identity has no place in any of them. */
const DECLARED_ARGS: { [O in OpName]: readonly FieldsOf<Operations[O]['args']>[] } = {
  getMe: [],
  setDisplayName: ['name'],
  setProfile: ['displayName', 'animalId', 'backgroundColor'],
  createFriendInvite: ['noticeVersion'],
  previewInvite: ['code'],
  acceptFriendInvite: ['code', 'noticeVersion'],
  findFriendByCode: ['friendCode'],
  sendFriendRequest: ['requestRef', 'noticeVersion'],
  listFriendRequests: [],
  acceptFriendRequest: ['requestRef', 'noticeVersion'],
  declineFriendRequest: ['requestRef'],
  cancelFriendRequest: ['requestRef'],
  listFriends: [],
  listFriendPreferences: [],
  setFriendPreference: ['friendRef', 'favorite', 'nickname'],
  removeFriend: ['friendRef'],
  block: ['ref'],
  unblock: ['blockRef'],
  listBlocks: [],
  createGroup: ['name', 'myName', 'noticeVersion'],
  joinGroup: ['code', 'myName', 'noticeVersion'],
  listGroupOrder: [],
  setGroupOrder: ['groupIds'],
  listMyGroups: [],
  listMembers: ['groupId', 'after', 'limit'],
  leaveGroup: ['groupId'],
  renameMeInGroup: ['groupId', 'name'],
  renameGroup: ['groupId', 'name'],
  setGroupAppearance: ['groupId', 'emblemId', 'photo', 'accentColor'],
  removeMember: ['groupId', 'memberRef'],
  listRemoved: ['groupId'],
  letBackIn: ['groupId', 'removedRef'],
  replaceInvite: ['groupId'],
  listResults: ['gameId', 'puzzleId', 'groupId'],
  deleteMySocialData: [],
};

const ALL_OPS = Object.keys(DECLARED_ARGS) as OpName[];

/** The exact keys of an operation's data, or of each row of a list. Anything else, an activity field say, fails. */
const DECLARED_FIELDS: { [O in Exclude<OpName, 'previewInvite' | 'listResults'>]: readonly FieldsOf<Row<Operations[O]['data']>>[] } = {
  getMe: ['displayName', 'animalId', 'backgroundColor', 'friendCode', 'friendCount', 'groupCount'],
  setDisplayName: ['displayName'],
  setProfile: ['displayName', 'animalId', 'backgroundColor'],
  createFriendInvite: ['code', 'expiresAt'],
  acceptFriendInvite: ['friendRef', 'name'],
  findFriendByCode: ['requestRef', 'name', 'animalId', 'backgroundColor'],
  sendFriendRequest: [],
  listFriendRequests: ['incoming', 'outgoing'],
  acceptFriendRequest: ['friendRef', 'name'],
  declineFriendRequest: [],
  cancelFriendRequest: [],
  listFriends: ['friendRef', 'name', 'animalId', 'backgroundColor', 'since'],
  listFriendPreferences: ['friendRef', 'favorite', 'nickname'],
  setFriendPreference: ['friendRef', 'favorite', 'nickname'],
  removeFriend: [],
  block: ['blockRef'],
  unblock: [],
  listBlocks: ['blockRef', 'name'],
  createGroup: ['groupId', 'inviteCode'],
  joinGroup: ['groupId'],
  listGroupOrder: ['groupIds'],
  setGroupOrder: [],
  listMyGroups: ['groupId', 'name', 'emblemId', 'accentColor', 'photo', 'photoVersion', 'memberCount', 'isOwner', 'myName', 'inviteCode'],
  listMembers: ['memberRef', 'name', 'animalId', 'backgroundColor', 'isOwner', 'isMe', 'joinedAt'],
  leaveGroup: ['closed'],
  renameMeInGroup: [],
  renameGroup: [],
  setGroupAppearance: ['photoVersion'],
  removeMember: [],
  listRemoved: ['removedRef', 'name'],
  letBackIn: [],
  replaceInvite: ['inviteCode'],
  deleteMySocialData: [],
};

const FACE_FIELDS: readonly unknown[] = ['animalId', 'backgroundColor'];
const FRIEND_PREVIEW_FIELDS: readonly unknown[] = ['inviterName', 'animalId', 'backgroundColor'];
const GROUP_PREVIEW_FIELDS: readonly unknown[] = ['name', 'emblemId', 'accentColor', 'photo', 'memberPreview', 'isMember', 'isRemoved'];
const MEMBER_PREVIEW_FIELDS: readonly unknown[] = ['faces', 'leadName', 'memberCount'];
const REQUEST_ROW_FIELDS: readonly unknown[] = ['requestRef', 'name', 'animalId', 'backgroundColor', 'sentAt'];
/** Every result row, before its one ref and, when it isn't locked, its detail. */
const RESULT_ROW_FIELDS: readonly unknown[] = ['isMe', 'name', 'animalId', 'backgroundColor', 'summary', 'detailLocked'];

const LIST_OPS: readonly OpName[] = ['listFriendPreferences', 'listFriends', 'listBlocks', 'listMyGroups', 'listMembers', 'listRemoved', 'listResults'];

const TIMESTAMP_FIELDS: readonly string[] = ['expiresAt', 'since', 'joinedAt', 'sentAt'];
const CODE_FIELDS: readonly string[] = ['code', 'inviteCode'];
const COLOR_FIELDS: readonly string[] = ['backgroundColor', 'accentColor'];
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CODE = /^[0-9a-z]{12}$/;
const FRIEND_CODE = /^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/;
const PHOTO_PREFIX = 'data:image/jpeg;base64,';

const SAMPLE_ARGS: { [O in OpName]: Operations[O]['args'] } = {
  getMe: {},
  setDisplayName: { name: 'Sam' },
  setProfile: { displayName: 'Sam', animalId: 'fox', backgroundColor: '#DED1F2' },
  createFriendInvite: { noticeVersion: NOTICE },
  previewInvite: { code: 'no-such-code' },
  acceptFriendInvite: { code: 'no-such-code', noticeVersion: NOTICE },
  findFriendByCode: { friendCode: NO_SUCH_FRIEND_CODE },
  sendFriendRequest: { requestRef: 'no-such-ref', noticeVersion: NOTICE },
  listFriendRequests: {},
  acceptFriendRequest: { requestRef: 'no-such-ref', noticeVersion: NOTICE },
  declineFriendRequest: { requestRef: 'no-such-ref' },
  cancelFriendRequest: { requestRef: 'no-such-ref' },
  listFriends: {},
  listFriendPreferences: {},
  setFriendPreference: { friendRef: "no-such-ref", favorite: true, nickname: null },
  removeFriend: { friendRef: 'no-such-ref' },
  block: { ref: 'no-such-ref' },
  unblock: { blockRef: 'no-such-ref' },
  listBlocks: {},
  createGroup: { name: 'Group', myName: 'Sam', noticeVersion: NOTICE },
  joinGroup: { code: 'no-such-code', myName: 'Sam', noticeVersion: NOTICE },
  listGroupOrder: {},
  setGroupOrder: { groupIds: [] },
  listMyGroups: {},
  listMembers: { groupId: 'no-such-group' },
  leaveGroup: { groupId: 'no-such-group' },
  renameMeInGroup: { groupId: 'no-such-group', name: 'Sam' },
  renameGroup: { groupId: 'no-such-group', name: 'Group' },
  setGroupAppearance: { groupId: 'no-such-group', emblemId: 'campfire', photo: null, accentColor: '#DED1F2' },
  removeMember: { groupId: 'no-such-group', memberRef: 'no-such-ref' },
  listRemoved: { groupId: 'no-such-group' },
  letBackIn: { groupId: 'no-such-group', removedRef: 'no-such-ref' },
  replaceInvite: { groupId: 'no-such-group' },
  listResults: { gameId: 'crosspuns', puzzleId: 'no-such-puzzle' },
  deleteMySocialData: {},
};

/** A result of the right shape for each game these scenarios finish a puzzle in. */
const SAMPLE_RESULTS = {
  rainbow: { summary: { solved: true, mistakes: 1 }, detail: 'GGGG\nYYBB' },
  crosspuns: { summary: { seconds: 95 }, detail: null },
  wtf: { summary: { score: 7 }, detail: [true, false, true] },
};

type ResultGame = keyof typeof SAMPLE_RESULTS;

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function must<T>(result: Result<T>, label: string): T {
  if (result.ok === false) throw new Error(`${label}: expected success, got ${result.outcome}`);
  return result.data;
}

function refused(result: Result<unknown>, outcome: Outcome, label: string): void {
  check(result.ok === false && result.outcome === outcome, `${label}: expected ${outcome}, got ${JSON.stringify(result)}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactly(row: Record<string, unknown>, fields: readonly unknown[]): boolean {
  const keys = Object.keys(row);
  return keys.length === fields.length && keys.every((key) => fields.includes(key));
}

function visit(value: unknown, onKey: (key: string) => void, onValue: (value: string) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) visit(item, onKey, onValue);
  } else if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      onKey(key);
      visit(item, onKey, onValue);
    }
  } else {
    onValue(String(value));
  }
}

/** `nested` names the keys that may hold more than one value. The caller checks those itself. */
function checkRow(op: OpName, row: Record<string, unknown>, nested: readonly string[] = []): void {
  for (const [key, value] of Object.entries(row)) {
    if (!nested.includes(key)) check(value === null || typeof value !== 'object', `${op} returned a nested value under ${key}`);
    if (TIMESTAMP_FIELDS.includes(key)) check(typeof value === 'string' && TIMESTAMP.test(value), `${op} returned a badly formed ${key}: ${String(value)}`);
    if (CODE_FIELDS.includes(key) && value !== null) check(typeof value === 'string' && CODE.test(value), `${op} returned a badly formed ${key}`);
    if (key === 'friendCode') check(typeof value === 'string' && FRIEND_CODE.test(value), `${op} returned a badly formed friend code: ${String(value)}`);
    if (key === 'animalId') check((AVATAR_IDS as readonly unknown[]).includes(value), `${op} returned an unapproved avatar: ${String(value)}`);
    if (COLOR_FIELDS.includes(key)) check((PROFILE_COLORS as readonly unknown[]).includes(value), `${op} returned an unapproved color: ${String(value)}`);
    if (key === 'emblemId') check((GROUP_EMBLEM_IDS as readonly unknown[]).includes(value), `${op} returned an unapproved emblem: ${String(value)}`);
    if (key === 'photo' && value !== null) check(typeof value === 'string' && value.startsWith(PHOTO_PREFIX), `${op} returned a photo that is not a JPEG data URL`);
  }
}

function checkGroupPreview(data: Record<string, unknown>): void {
  const preview = data.memberPreview;
  if (data.isMember === true || data.isRemoved === true) check(preview === null, 'previewInvite showed the group to a member or a removed person');
  if (preview === null) return;
  check(isRecord(preview) && hasExactly(preview, MEMBER_PREVIEW_FIELDS), `previewInvite returned the wrong memberPreview: ${JSON.stringify(preview)}`);
  check(typeof preview.leadName === 'string' && typeof preview.memberCount === 'number', 'previewInvite returned a badly formed memberPreview');
  const { faces } = preview;
  check(Array.isArray(faces) && faces.length <= LIMITS.previewFaces, 'previewInvite returned too many faces');
  for (const face of faces) {
    check(isRecord(face) && hasExactly(face, FACE_FIELDS), `previewInvite returned the wrong fields in a face: ${JSON.stringify(face)}`);
    checkRow('previewInvite', face);
  }
}

function checkRequestRows(rows: unknown): void {
  check(Array.isArray(rows), 'listFriendRequests should answer with two lists');
  for (const row of rows) {
    check(isRecord(row) && hasExactly(row, REQUEST_ROW_FIELDS), `listFriendRequests returned the wrong fields: ${JSON.stringify(row)}`);
    checkRow('listFriendRequests', row);
  }
}

/** The ref and the detail are what vary. A locked row has no detail key, and a summary holds no free text. */
function checkResultRow(row: unknown): void {
  check(isRecord(row), 'listResults should answer with rows');
  const fields = [...RESULT_ROW_FIELDS, 'memberRef' in row ? 'memberRef' : 'friendRef', ...(row.detailLocked === true ? [] : ['detail'])];
  check(hasExactly(row, fields), `listResults returned the wrong fields: ${JSON.stringify(row)}`);
  checkRow('listResults', row, ['summary', 'detail']);
  const { summary, detail } = row;
  check(isRecord(summary) && Object.values(summary).every((value) => typeof value === 'number' || typeof value === 'boolean'), `listResults returned free text in a summary: ${JSON.stringify(summary)}`);
  check(detail === undefined || detail === null || typeof detail === 'string' || (Array.isArray(detail) && detail.every((answer) => typeof answer === 'boolean')), 'listResults returned a badly formed detail');
}

function checkData(op: OpName, data: unknown): void {
  if (op === 'listGroupOrder') {
    check(isRecord(data) && hasExactly(data, ['groupIds']), 'listGroupOrder returned the wrong fields');
    check(Array.isArray(data.groupIds) && data.groupIds.length <= LIMITS.groupsJoinedTotal && data.groupIds.every(id => typeof id === 'string'), 'listGroupOrder returned invalid group ids');
    check(new Set(data.groupIds).size === data.groupIds.length, 'listGroupOrder returned duplicate group ids');
    return;
  }
  if (op === 'previewInvite') {
    check(isRecord(data) && (hasExactly(data, FRIEND_PREVIEW_FIELDS) || hasExactly(data, GROUP_PREVIEW_FIELDS)), `previewInvite returned the wrong fields: ${JSON.stringify(data)}`);
    if ('isMember' in data) checkGroupPreview(data);
    checkRow(op, data, ['memberPreview']);
    return;
  }
  if (op === 'listResults') {
    check(Array.isArray(data), 'listResults should answer with an array of rows');
    for (const row of data) checkResultRow(row);
    return;
  }
  if (op === 'listFriendRequests') {
    check(isRecord(data) && hasExactly(data, DECLARED_FIELDS.listFriendRequests), `listFriendRequests returned the wrong fields: ${JSON.stringify(data)}`);
    checkRequestRows(data.incoming);
    checkRequestRows(data.outgoing);
    return;
  }
  const fields: readonly unknown[] = DECLARED_FIELDS[op];
  const rows: unknown = LIST_OPS.includes(op) ? data : [data];
  check(Array.isArray(rows), `${op} should answer with an array of rows`);
  for (const row of rows) {
    check(isRecord(row) && hasExactly(row, fields), `${op} returned the wrong fields: ${JSON.stringify(row)}`);
    checkRow(op, row);
  }
}

/** The one rule every answer keeps: the wire shape, a known outcome, the declared fields, and nothing private. */
function checkAnswer(op: OpName, answer: unknown, secrets: readonly string[]): void {
  check(isRecord(answer), `${op}: an answer should be an object`);
  if (hasExactly(answer, ['ok', 'data'])) {
    check(answer.ok === true, `${op}: an answer with data should have ok true`);
    checkData(op, answer.data);
  } else {
    check(hasExactly(answer, ['ok', 'outcome']), `${op}: an answer should hold exactly ok and data, or ok and outcome: ${JSON.stringify(answer)}`);
    check(answer.ok === false, `${op}: an answer with an outcome should have ok false`);
    check((OUTCOMES as readonly unknown[]).includes(answer.outcome), `${op}: unknown outcome ${String(answer.outcome)}`);
  }
  visit(
    answer,
    (key) => check(!FORBIDDEN_RESPONSE_KEYS.includes(key), `${op} returned the key ${key}`),
    (value) => {
      check(!value.includes('@'), `${op} returned what looks like an email`);
      for (const secret of secrets) check(!value.includes(secret), `${op} returned a private value`);
    },
  );
}

/** What is wrong with the args reaching a transport. Identity comes from the token alone. */
function argProblems(op: OpName, args: unknown, secrets: readonly string[]): string[] {
  if (!isRecord(args)) return [`${op}: args should be an object`];
  const problems: string[] = [];
  const declared: readonly unknown[] = DECLARED_ARGS[op];
  for (const key of Object.keys(args)) {
    if (!declared.includes(key)) problems.push(`${op} sent an undeclared arg: ${key}`);
  }
  visit(
    args,
    (key) => {
      if (FORBIDDEN_RESPONSE_KEYS.includes(key)) problems.push(`${op} sent the key ${key}`);
    },
    (value) => {
      if (secrets.some((secret) => value.includes(secret))) problems.push(`${op} sent a private value in its args`);
    },
  );
  return problems;
}

// ---------------------------------------------------------------------------
// A small world: a mock hub, a clock, and people signing in to games
// ---------------------------------------------------------------------------

export interface MockPlayer {
  readonly game: GameId;
  /** The token this player's session holds right now, or null. */
  credential(): string | null;
  call: SocialClient['call'];
  forget(): void;
}

export interface RecordedResponse {
  op: OpName;
  answer: Result<unknown>;
}

export interface RecordedCall {
  game: GameId;
  op: OpName;
  credential: string | null;
}

export interface MockWorld {
  hub: MemoryHub;
  identity: MockIdentity;
  /** Every answer the hub gave. */
  responses: RecordedResponse[];
  /** Every answer a player received, after the game's adapter had it. */
  answers: RecordedResponse[];
  /** Every call that reached the transport. */
  calls: RecordedCall[];
  /** Everything wrong with those calls. Empty unless an adapter misbehaved. */
  violations: string[];
  /** The person has their own label as a display name the first time, unless `nameless` says they haven't chosen one. */
  signIn(game: GameId, person: string, options?: { nameless?: boolean }): MockPlayer;
  /** Holds a real token that belongs to a guest. */
  signInAnonymous(game: GameId, person: string): MockPlayer;
  /** Holds a real token with no shared-account identity behind it. */
  signInUnlinked(game: GameId, person: string): MockPlayer;
  /** Holds a token good for this game's project, with no account in this game. */
  signInNoAccount(game: GameId, person: string): MockPlayer;
  guest(game: GameId): MockPlayer;
  /** Sign-out stays local in every game: it ends this one session and nothing else. */
  signOut(player: MockPlayer, options: { scope: 'local' }): void;
  /** Someone else signs in on the same browser. */
  become(player: MockPlayer, person: string): void;
  /** The game goes back to checking who this is. */
  setChecking(player: MockPlayer): void;
  advance(ms: number): void;
  now(): number;
  /** Holds the game's next hub call until the returned function is called. */
  hold(game: GameId): () => void;
  /** The game's next hub call fails. */
  failNext(game: GameId): void;
  globalIdOf(person: string): string;
  /** Every id, email and token issued in this world: none may reach a response. */
  secrets(): string[];
}

export interface MockWorldOptions {
  adapt?: (game: GameId, getSession: () => SessionState, transport: SocialTransport) => SocialClient;
  limits?: Partial<Limits>;
}

export function createMockWorld(options: MockWorldOptions = {}): MockWorld {
  let clock = Date.UTC(2026, 0, 1);
  let visits = 0;
  const identity = createMockIdentity();
  const hub = createMemoryHub({ identity, now: () => clock, limits: options.limits });
  const responses: RecordedResponse[] = [];
  const answers: RecordedResponse[] = [];
  const calls: RecordedCall[] = [];
  const violations: string[] = [];
  const people = new Map<string, { globalUserId: string; email: string }>();
  const named = new Set<string>();
  const tokens: string[] = [];
  const holds = new Map<GameId, Promise<void>>();
  const failing = new Set<GameId>();
  const sessions = new Map<MockPlayer, { current: SessionState }>();

  function personNamed(person: string) {
    const known = people.get(person);
    if (known) return known;
    const made = { globalUserId: `user_${person}0000000000`, email: `${person}@example.test` };
    people.set(person, made);
    return made;
  }

  function secrets(): string[] {
    const found = [...tokens];
    for (const { globalUserId, email } of people.values()) {
      found.push(globalUserId, email);
      for (const game of GAMES) {
        const local = identity.localIdFor(game, globalUserId);
        if (local) found.push(local);
      }
    }
    return found;
  }

  function sessionFor(game: GameId, person: string, kind: { anonymous?: boolean; linked?: boolean; account?: boolean } = {}): SocialSession {
    const credential = identity.issue({ game, globalUserId: personNamed(person).globalUserId, ...kind });
    tokens.push(credential);
    visits += 1;
    return { scope: `${game}:${person}:${visits}`, credential };
  }

  /** Only once: a later sign-in must not undo a name they changed, or bring one back after they deleted it. */
  function nameOnce(person: string): void {
    if (named.has(person)) return;
    named.add(person);
    hub.seedDisplayName(personNamed(person).globalUserId, person);
  }

  /** The hub's transport for a game, writing down what reaches it and what comes back. */
  function recordingTransport(game: GameId): SocialTransport {
    const real = hub.transportFor(game);
    return {
      async call<O extends OpName>(op: O, args: Operations[O]['args'], credential: string | null) {
        calls.push({ game, op, credential });
        violations.push(...argProblems(op, args, secrets()));
        const held = holds.get(game);
        holds.delete(game);
        if (held) await held;
        if (failing.delete(game)) throw new Error('this call was told to fail');
        const answer = await real.call(op, args, credential);
        responses.push({ op, answer });
        return answer;
      },
    };
  }

  function open(game: GameId, first: SessionState): MockPlayer {
    const holder = { current: first };
    const getSession = () => holder.current;
    const transport = recordingTransport(game);
    const client = options.adapt ? options.adapt(game, getSession, transport) : createSocialClient({ getSession, transport });
    const player: MockPlayer = {
      game,
      credential() {
        const session = holder.current;
        return session === null || session === 'checking' ? null : session.credential;
      },
      async call<O extends OpName>(op: O, args: Operations[O]['args']) {
        const answer = await client.call(op, args);
        answers.push({ op, answer });
        return answer;
      },
      forget: () => client.forget(),
    };
    sessions.set(player, holder);
    return player;
  }

  function setSession(player: MockPlayer, session: SessionState): void {
    const holder = sessions.get(player);
    if (holder) holder.current = session;
  }

  return {
    hub,
    identity,
    responses,
    answers,
    calls,
    violations,
    signIn(game, person, { nameless = false } = {}) {
      if (!nameless) nameOnce(person);
      return open(game, sessionFor(game, person));
    },
    signInAnonymous: (game, person) => open(game, sessionFor(game, person, { anonymous: true })),
    signInUnlinked: (game, person) => open(game, sessionFor(game, person, { linked: false })),
    signInNoAccount: (game, person) => open(game, sessionFor(game, person, { account: false })),
    guest: (game) => open(game, null),
    signOut: (player) => setSession(player, null),
    become(player, person) {
      nameOnce(person);
      setSession(player, sessionFor(player.game, person));
    },
    setChecking: (player) => setSession(player, 'checking'),
    advance: (ms) => {
      clock += ms;
    },
    now: () => clock,
    hold(game) {
      let release: () => void = () => undefined;
      holds.set(
        game,
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );
      return () => release();
    },
    failNext(game) {
      failing.add(game);
    },
    globalIdOf: (person) => personNamed(person).globalUserId,
    secrets,
  };
}

/** The invariant behind every world scenario. */
function checkWorld(world: MockWorld): void {
  check(world.violations.length === 0, `a transport call broke the rules: ${world.violations[0]}`);
  const secrets = world.secrets();
  for (const { op, answer } of world.answers) checkAnswer(op, answer, secrets);
}

// ---------------------------------------------------------------------------
// Small steps
// ---------------------------------------------------------------------------

function groupPreview(result: Result<Operations['previewInvite']['data']>, label: string): GroupInvitePreview {
  const preview = must(result, label);
  check('isMember' in preview, `${label}: expected a group preview`);
  return preview;
}

async function makeGroup(owner: MockPlayer, name = 'Club', myName = 'Owner') {
  return must(await owner.call('createGroup', { name, myName, noticeVersion: NOTICE }), 'createGroup');
}

async function join(player: MockPlayer, code: string, myName = 'Member') {
  return must(await player.call('joinGroup', { code, myName, noticeVersion: NOTICE }), 'joinGroup');
}

async function makeFriendInvite(player: MockPlayer) {
  return must(await player.call('createFriendInvite', { noticeVersion: NOTICE }), 'createFriendInvite');
}

async function befriend(inviter: MockPlayer, accepter: MockPlayer) {
  const { code } = await makeFriendInvite(inviter);
  return must(await accepter.call('acceptFriendInvite', { code, noticeVersion: NOTICE }), 'acceptFriendInvite');
}

async function friendCodeOf(player: MockPlayer) {
  return must(await player.call('getMe', {}), 'getMe').friendCode;
}

async function lookUp(player: MockPlayer, target: MockPlayer) {
  return must(await player.call('findFriendByCode', { friendCode: await friendCodeOf(target) }), 'findFriendByCode');
}

async function requestsOf(player: MockPlayer) {
  return must(await player.call('listFriendRequests', {}), 'listFriendRequests');
}

/** A lookup and a send: the request now waits with the other person. */
async function sendRequest(from: MockPlayer, to: MockPlayer) {
  const found = await lookUp(from, to);
  must(await from.call('sendFriendRequest', { requestRef: found.requestRef, noticeVersion: NOTICE }), 'sendFriendRequest');
  return found;
}

async function incomingRequest(player: MockPlayer): Promise<FriendRequestRow> {
  const [row] = (await requestsOf(player)).incoming;
  check(row, 'expected an incoming friend request');
  return row;
}

async function hasNoRequests(player: MockPlayer): Promise<boolean> {
  const { incoming, outgoing } = await requestsOf(player);
  return incoming.length === 0 && outgoing.length === 0;
}

/** A finished puzzle, as a game server reports it, at this moment on the world's clock. */
function completion(world: MockWorld, game: ResultGame, person: string, puzzleId = PUZZLE): CompletionInput {
  return { gameId: game, puzzleId, globalUserId: world.globalIdOf(person), completedAt: new Date(world.now()).toISOString(), ...SAMPLE_RESULTS[game] };
}

async function finish(world: MockWorld, game: ResultGame, person: string, puzzleId = PUZZLE): Promise<void> {
  must(await world.hub.serverFor(game).recordCompletion(completion(world, game, person, puzzleId)), `recordCompletion for ${person}`);
}

async function resultsOf(player: MockPlayer, gameId: GameId, puzzleId = PUZZLE, groupId?: string): Promise<ResultRow[]> {
  return must(await player.call('listResults', groupId === undefined ? { gameId, puzzleId } : { gameId, puzzleId, groupId }), 'listResults');
}

function resultNamed(rows: ResultRow[], name: string): ResultRow {
  const row = rows.find((r) => r.name === name);
  check(row, `expected a result for ${name}`);
  return row;
}

function checkLocked(row: ResultRow, label: string): void {
  check(!('detail' in row) && row.detailLocked === true, `${label}: the detail should be left out and locked, got ${JSON.stringify(row)}`);
}

function checkUnlocked(row: ResultRow, game: ResultGame, label: string): void {
  check(row.detailLocked === false && JSON.stringify(row.detail) === JSON.stringify(SAMPLE_RESULTS[game].detail), `${label}: the detail should be there, got ${JSON.stringify(row)}`);
}

/** A minimal JPEG: start marker, a comment holding `padding` bytes, a frame header, end marker. */
function jpegBytes(width: number, height: number, padding = 0): number[] {
  const length = padding + 2;
  const comment = padding > 0 ? [0xff, 0xfe, length >> 8, length & 255, ...new Array<number>(padding).fill(0x41)] : [];
  return [0xff, 0xd8, ...comment, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9];
}

const BASE64_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function toBase64(bytes: readonly number[]): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const first = bytes[i];
    const second: number | undefined = bytes[i + 1];
    const third: number | undefined = bytes[i + 2];
    text += BASE64_LETTERS[first >> 2] + BASE64_LETTERS[((first & 3) << 4) | ((second ?? 0) >> 4)];
    text += second === undefined ? '=' : BASE64_LETTERS[((second & 15) << 2) | ((third ?? 0) >> 6)];
    text += third === undefined ? '=' : BASE64_LETTERS[third & 63];
  }
  return text;
}

const photoFrom = (bytes: readonly number[]) => `${PHOTO_PREFIX}${toBase64(bytes)}`;

async function groupsOf(player: MockPlayer) {
  return must(await player.call('listMyGroups', {}), 'listMyGroups');
}

async function friendsOf(player: MockPlayer) {
  return must(await player.call('listFriends', {}), 'listFriends');
}

async function blocksOf(player: MockPlayer) {
  return must(await player.call('listBlocks', {}), 'listBlocks');
}

async function membersOf(player: MockPlayer, groupId: string) {
  return must(await player.call('listMembers', { groupId }), 'listMembers');
}

async function otherMember(player: MockPlayer, groupId: string): Promise<MemberRow> {
  const row = (await membersOf(player, groupId)).find((m) => !m.isMe);
  check(row, 'expected another member in the group');
  return row;
}

async function removeOther(owner: MockPlayer, groupId: string): Promise<void> {
  must(await owner.call('removeMember', { groupId, memberRef: (await otherMember(owner, groupId)).memberRef }), 'removeMember');
}

/** A new group both are in, and the other person's row as the first sees it. */
async function makeGroupRef(owner: MockPlayer, other: MockPlayer): Promise<MemberRow> {
  const { groupId, inviteCode } = await makeGroup(owner, 'Shared');
  await join(other, inviteCode, 'Bee');
  return otherMember(owner, groupId);
}

/** Everything these players can see. */
async function stateOf(players: readonly MockPlayer[]): Promise<string> {
  const seen: unknown[] = [];
  for (const player of players) {
    const groups = await groupsOf(player);
    seen.push(must(await player.call('getMe', {}), 'getMe'), groups, await friendsOf(player), await blocksOf(player), await requestsOf(player));
    for (const group of groups) {
      seen.push(await membersOf(player, group.groupId));
      if (group.isOwner) seen.push(must(await player.call('listRemoved', { groupId: group.groupId }), 'listRemoved'));
    }
  }
  return JSON.stringify(seen);
}

/** A refused call must leave nothing behind, for anyone involved. */
async function noEffect(players: readonly MockPlayer[], label: string, attempt: () => Promise<void>): Promise<void> {
  const before = await stateOf(players);
  await attempt();
  check((await stateOf(players)) === before, `${label}: a refused call should change nothing`);
}

function lastCredentialIs(world: MockWorld, player: MockPlayer, label: string): void {
  const last = world.calls[world.calls.length - 1];
  check(last && last.credential === player.credential(), `${label}: the transport should get the current holder's credential`);
}

/** Walks a member list a page at a time, in the wire's own paging. */
async function pageThrough(player: MockPlayer, groupId: string, limit?: number): Promise<MemberRow[]> {
  const seen: MemberRow[] = [];
  let after: Pick<MemberRow, 'joinedAt' | 'memberRef'> | undefined;
  for (let page = 0; page < 20; page++) {
    const rows: MemberRow[] = must(await player.call('listMembers', { groupId, after, limit }), 'listMembers');
    if (rows.length === 0) return seen;
    seen.push(...rows);
    const last = rows[rows.length - 1];
    after = { joinedAt: last.joinedAt, memberRef: last.memberRef };
  }
  throw new Error('paging never reached the end');
}

/** Touches every operation, so the privacy scenarios can't pass by not looking. */
async function fullFlow(world: MockWorld): Promise<void> {
  const alice = world.signIn('crosspuns', 'alice');
  const bob = world.signIn('rainbow', 'bob');
  const carol = world.signIn('wtf', 'carol');
  const guest = world.guest('cluevoyance');

  must(await alice.call('setDisplayName', { name: 'Alice' }), 'setDisplayName');
  must(await bob.call('setProfile', { displayName: 'Bob', animalId: 'otter', backgroundColor: '#CCE1F1' }), 'setProfile');
  must(await alice.call('getMe', {}), 'getMe');

  const { code } = await makeFriendInvite(alice);
  must(await guest.call('previewInvite', { code }), 'previewInvite');
  const { friendRef } = must(await bob.call('acceptFriendInvite', { code, noticeVersion: NOTICE }), 'acceptFriendInvite');
  await friendsOf(alice);
  must(await alice.call("setFriendPreference", { friendRef, favorite: true, nickname: "Pal" }), "setFriendPreference");
  must(await alice.call("listFriendPreferences", {}), "listFriendPreferences");

  const dave = world.signIn('crosspuns', 'dave');
  check((await sendRequest(dave, alice)).name === 'Alice', 'the lookup should show who it found');
  const [sent] = (await requestsOf(dave)).outgoing;
  check(sent, 'the sender should see the request');
  must(await alice.call('declineFriendRequest', { requestRef: (await incomingRequest(alice)).requestRef }), 'declineFriendRequest');
  must(await dave.call('cancelFriendRequest', { requestRef: sent.requestRef }), 'cancelFriendRequest');
  await sendRequest(alice, dave);
  must(await dave.call('acceptFriendRequest', { requestRef: (await incomingRequest(dave)).requestRef, noticeVersion: NOTICE }), 'acceptFriendRequest');

  const { groupId, inviteCode } = await makeGroup(alice);
  must(await alice.call('setGroupAppearance', { groupId, emblemId: 'moon', photo: photoFrom(jpegBytes(LIMITS.photoEdge, LIMITS.photoEdge)), accentColor: '#CCE6CA' }), 'setGroupAppearance');
  groupPreview(await bob.call('previewInvite', { code: inviteCode }), 'previewInvite');
  await join(bob, inviteCode, 'Bee');
  await join(carol, inviteCode, 'Cee');
  await groupsOf(alice);
  must(await alice.call("setGroupOrder", { groupIds: [groupId] }), "setGroupOrder");
  must(await alice.call("listGroupOrder", {}), "listGroupOrder");
  await groupsOf(bob);
  must(await bob.call('renameMeInGroup', { groupId, name: 'Beatrice' }), 'renameMeInGroup');
  must(await alice.call('renameGroup', { groupId, name: 'Puzzle club' }), 'renameGroup');

  await finish(world, 'crosspuns', 'alice');
  await finish(world, 'wtf', 'carol');
  await resultsOf(bob, 'crosspuns');
  await resultsOf(bob, 'crosspuns', PUZZLE, groupId);
  await resultsOf(bob, 'wtf', PUZZLE, groupId);

  const carolRow = (await membersOf(alice, groupId)).find((m) => m.name === 'Cee');
  check(carolRow, 'carol should be listed');
  const { blockRef } = must(await alice.call('block', { ref: carolRow.memberRef }), 'block');
  await blocksOf(alice);
  must(await alice.call('unblock', { blockRef }), 'unblock');

  must(await alice.call('removeMember', { groupId, memberRef: carolRow.memberRef }), 'removeMember');
  const [removed] = must(await alice.call('listRemoved', { groupId }), 'listRemoved');
  must(await alice.call('letBackIn', { groupId, removedRef: removed.removedRef }), 'letBackIn');
  const fresh = must(await alice.call('replaceInvite', { groupId }), 'replaceInvite');
  await join(carol, fresh.inviteCode, 'Cee');

  must(await bob.call('removeFriend', { friendRef }), 'removeFriend');
  must(await bob.call('leaveGroup', { groupId }), 'leaveGroup');
  must(await carol.call('deleteMySocialData', {}), 'deleteMySocialData');
}

// ---------------------------------------------------------------------------
// The scenarios
// ---------------------------------------------------------------------------

export interface SocialScenario {
  name: string;
  run(): Promise<void> | void;
}

/** What a disabled game's adapter is handed, so any use of either can be counted. */
export interface DisabledAdapterParts {
  getSession: () => SessionState;
  transport: SocialTransport;
}

/**
 * For a game whose status is disabled. A separate set, because such a game has
 * no accounts to sign in and no place in a mock world. The client is required:
 * passing nothing would prove the shared stub and not the game's own. One that
 * looks at either part fails, even if the answer is right.
 */
export function disabledGameScenarios(makeClient: (parts: DisabledAdapterParts) => SocialClient): SocialScenario[] {
  const scenario = (name: string, session: SessionState): SocialScenario => ({
    name,
    async run() {
      let sessionReads = 0;
      let transportCalls = 0;
      const client = makeClient({
        getSession: () => {
          sessionReads += 1;
          return session;
        },
        transport: {
          call: () => {
            transportCalls += 1;
            return Promise.reject(new Error('a disabled game has no transport'));
          },
        },
      });

      for (const op of ALL_OPS) refused(await client.call(op, SAMPLE_ARGS[op]), 'game_disabled', `${name}: ${op}`);
      client.forget();
      refused(await client.call('previewInvite', SAMPLE_ARGS.previewInvite), 'game_disabled', `${name}: after forget`);

      check(sessionReads === 0, `${name}: the answer should come before any check of who is calling`);
      check(transportCalls === 0, `${name}: nothing should reach a transport`);
    },
  });

  return [
    scenario('disabled game: every operation, previewInvite included, is refused with nobody signed in', null),
    scenario('disabled game: every operation, previewInvite included, is refused even with a session on hand', { scope: 'visit', credential: 'token' }),
    scenario('disabled game: every operation, previewInvite included, is refused while a session is being checked', 'checking'),
  ];
}

// Spelled apart so the portable files' own text guards don't trip on this list.
const OUTSIDE_WORLD = ['fe' + 'tch', 'XMLHttp' + 'Request', 'Web' + 'Socket', 'Event' + 'Source', 'send' + 'Beacon', 'local' + 'Storage', 'session' + 'Storage', 'indexed' + 'DB'];

/**
 * For any game's adapter file, enabled or disabled: hand in its text, however
 * your runner reads files. An adapter reaches nothing itself, so any mention of
 * the network, of browser storage or of signing out is a problem. An empty list
 * means none was found.
 */
export function adapterSourceProblems(source: string): string[] {
  const problems: string[] = [];
  for (const name of OUTSIDE_WORLD) {
    if (new RegExp(`\\b${name}\\b`).test(source)) problems.push(`uses ${name} directly`);
  }
  if (/\.signOut\s*\(/.test(source)) problems.push('signs out');
  if (/\bserverFor\b|\brecordCompletion\b/.test(source)) problems.push('reaches for the game-server route');
  return problems;
}

/**
 * For a disabled game's adapter file. As above, and an empty list also means it
 * keeps to the pattern in section 9, which has no flag, no session and no
 * transport, so nothing can switch it on.
 */
export function disabledAdapterSourceProblems(source: string): string[] {
  const problems = adapterSourceProblems(source);
  for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g)) {
    if (match[1] !== './client' && match[1] !== './contract') problems.push(`imports ${match[1]}`);
  }
  if (!/disabledSocialClient\(\s*['"]game_disabled['"]\s*\)/.test(source)) problems.push("doesn't use disabledSocialClient('game_disabled')");
  if (/transport/i.test(source)) problems.push('names a transport');
  if (/createSocialClient/.test(source)) problems.push('builds a real client');
  if (/getSession/.test(source)) problems.push('reads a session');
  if (/\benv\b/i.test(source)) problems.push('reads configuration');
  return problems;
}

/** What a drive step returns: nothing, or a promise the suite waits for. */
export type DriveResult = void | Promise<void>;

/**
 * Drives a game's real session source into each state. Nothing here may stand
 * in for that source. A drive step may be asynchronous, as a real account check
 * is: the suite waits for each one before it reads the session or takes the next
 * step. A step that rejects fails the scenario, so a step that expects a failure
 * handles it itself.
 */
export interface AdapterFixture {
  game: GameId;
  drive: {
    /** A confirmed guest. */
    guest(): DriveResult;
    /** The session is still being checked. */
    checking(): DriveResult;
    /** The check failed. */
    failedCheck(): DriveResult;
    /** A guest who holds a real token, where the game has such a thing. */
    anonymous(): DriveResult;
    /** Signed in to the shared account, with no account row in this game. */
    noAccountRow(): DriveResult;
    /** This person, on a fresh sign-in. */
    signIn(name: string): DriveResult;
    /** The same person, on a new visit. */
    revisit(name: string): DriveResult;
  };
  /** The game's real session function. */
  session(): SessionState;
  /** The game's real factory, under each environment. */
  build: {
    defaultEnv(transport: SocialTransport): SocialClient;
    garbageFlag(transport: SocialTransport): SocialClient;
    production(transport: SocialTransport): SocialClient;
    mock(transport: SocialTransport): SocialClient;
  };
}

const TRANSPORT_ANSWER = { ok: true, data: { displayName: 'From the transport', friendCount: 7, groupCount: 3 } };

/** A transport that writes down what reaches it, gives one fixed answer, and can be made to wait or fail. */
function scriptedTransport(failing = false) {
  const calls: { op: OpName; args: unknown; credential: string | null }[] = [];
  let gate: Promise<void> | null = null;
  const transport: SocialTransport = {
    async call<O extends OpName>(op: O, args: Operations[O]['args'], credential: string | null) {
      calls.push({ op, args, credential });
      if (gate) await gate;
      if (failing) throw new Error('down');
      return TRANSPORT_ANSWER as unknown as Result<Operations[O]['data']>;
    },
  };
  function hold(): () => void {
    let release: () => void = () => undefined;
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return () => release();
  }
  return { calls, transport, hold };
}

function isSession(session: SessionState): session is SocialSession {
  return session !== null && session !== 'checking' && typeof session.scope === 'string' && session.scope !== '' && typeof session.credential === 'string' && session.credential !== '';
}

/**
 * For an enabled game's real adapter. Passing the world scenarios with the
 * adapter left out proves nothing, so this set takes the game's own session
 * source and factory, and fails if the factory never reaches its transport.
 */
export function adapterScenarios(fixture: AdapterFixture): SocialScenario[] {
  const { game, drive, build } = fixture;

  const signedIn = (name: string): SocialSession => {
    const session = fixture.session();
    check(isSession(session), `${game}: ${name} should have a real session`);
    return session;
  };

  const notAccounts: { state: string; enter: () => DriveResult; session: null | 'checking' }[] = [
    { state: 'a confirmed guest', enter: () => drive.guest(), session: null },
    { state: 'an anonymous guest', enter: () => drive.anonymous(), session: null },
    { state: 'someone with no account row', enter: () => drive.noAccountRow(), session: null },
    { state: 'a session being checked', enter: () => drive.checking(), session: 'checking' },
    { state: 'a failed check', enter: () => drive.failedCheck(), session: 'checking' },
  ];

  return [
    {
      name: `${game} adapter: nobody without a confirmed account gets a session or reaches the transport`,
      async run() {
        check(GAME_STATUS[game] === 'mock', `${game} is disabled: use disabledGameScenarios`);
        const { calls, transport } = scriptedTransport();
        const client = build.mock(transport);
        for (const { state, enter, session } of notAccounts) {
          await enter();
          check(fixture.session() === session, `${game}: ${state} should have the session ${String(session)}, got ${JSON.stringify(fixture.session())}`);
          const refusal = session === 'checking' ? 'still_checking' : 'not_signed_in';
          for (const op of ALL_OPS) {
            if (op !== 'previewInvite') refused(await client.call(op, SAMPLE_ARGS[op]), refusal, `${game}: ${state} calling ${op}`);
          }
          check(calls.length === 0, `${game}: ${state} should send nothing, but ${calls[0]?.op} reached the transport`);

          // The one thing a guest may send, and it goes with no credential at all.
          await client.call('previewInvite', SAMPLE_ARGS.previewInvite);
          const previews = calls.slice();
          if (session === 'checking') {
            check(previews.length === 0, `${game}: ${state} should not even send a preview`);
          } else {
            check(previews.length === 1 && previews[0].credential === null, `${game}: ${state} should preview with no credential`);
          }
          calls.length = 0;
        }
      },
    },
    {
      name: `${game} adapter: each person and each visit has its own scope, and the current credential is the one sent`,
      async run() {
        const { calls, transport } = scriptedTransport();
        const client = build.mock(transport);
        const seen: SocialSession[] = [];
        const steps: [string, () => DriveResult][] = [
          ['the first person', () => drive.signIn('alice')],
          ['the second person', () => drive.signIn('bob')],
          ['the first person again', () => drive.revisit('alice')],
        ];
        for (const [label, step] of steps) {
          await step();
          const session = signedIn(label);
          seen.push(session);
          const sent = calls.length;
          const answer = await client.call('getMe', {});
          check(calls.length === sent + 1, `${game}: the adapter should really reach its transport for ${label}`);
          check(calls[sent].credential === session.credential, `${game}: ${label} should send their own credential`);
          check(JSON.stringify(answer) === JSON.stringify(TRANSPORT_ANSWER), `${game}: the adapter should hand the answer back as it came`);
        }
        check(new Set(seen.map((s) => s.scope)).size === seen.length, `${game}: two people, or two visits, should never share a scope`);
        check(seen[0].credential !== seen[1].credential, `${game}: two people should not share a credential`);
      },
    },
    {
      name: `${game} adapter: args reach the transport as they were given, with no identity added`,
      async run() {
        const { calls, transport } = scriptedTransport();
        const client = build.mock(transport);
        await drive.signIn('alice');
        const session = signedIn('alice');
        for (const op of ALL_OPS) {
          const answer = await client.call(op, SAMPLE_ARGS[op]);
          const last = calls[calls.length - 1];
          check(last?.op === op, `${game}: ${op} should reach the transport`);
          const problems = argProblems(op, last.args, [session.credential]);
          check(problems.length === 0, `${game}: ${problems[0]}`);
          check(JSON.stringify(last.args) === JSON.stringify(SAMPLE_ARGS[op]), `${game}: ${op} should send its args unchanged`);
          check(JSON.stringify(answer) === JSON.stringify(TRANSPORT_ANSWER), `${game}: ${op} should hand the answer back as it came`);
        }
      },
    },
    {
      name: `${game} adapter: the notice version is the caller's to send, so a call without one stays without one`,
      async run() {
        const { calls, transport } = scriptedTransport();
        const client = build.mock(transport);
        await drive.signIn('alice');
        signedIn('alice');
        const unseen = { joinGroup: { code: 'no-such-code', myName: 'Sam' }, createGroup: { name: 'Group', myName: 'Sam' }, createFriendInvite: {} };
        for (const op of Object.keys(unseen) as (keyof typeof unseen)[]) {
          await client.call(op, unseen[op] as Operations[typeof op]['args']);
          const last = calls[calls.length - 1];
          check(last?.op === op, `${game}: ${op} should reach the transport`);
          check(!('noticeVersion' in (last.args as object)), `${game}: only the screen that showed the notice may say so`);
        }
      },
    },
    {
      name: `${game} adapter: the default environment, a garbage flag and a production build reach no transport`,
      async run() {
        const environments: [string, (transport: SocialTransport) => SocialClient][] = [
          ['the default environment', (transport) => build.defaultEnv(transport)],
          ['a garbage flag', (transport) => build.garbageFlag(transport)],
          ['a production build', (transport) => build.production(transport)],
        ];
        for (const [label, make] of environments) {
          await drive.signIn('alice');
          const { calls, transport } = scriptedTransport();
          const client = make(transport);
          for (const op of ALL_OPS) refused(await client.call(op, SAMPLE_ARGS[op]), 'unavailable', `${game} under ${label}: ${op}`);
          check(calls.length === 0, `${game} under ${label} should reach no transport`);
        }
      },
    },
    {
      name: `${game} adapter: a failing transport gives unavailable, and never a rejection`,
      async run() {
        await drive.signIn('alice');
        const rejecting = scriptedTransport(true);
        refused(await build.mock(rejecting.transport).call('getMe', {}), 'unavailable', `${game}: a rejected call`);
        check(rejecting.calls.length === 1, `${game}: the failing call should have reached the transport`);
        const throwing: SocialTransport = {
          call() {
            throw new Error('down');
          },
        };
        refused(await build.mock(throwing).call('getMe', {}), 'unavailable', `${game}: a thrown call`);
      },
    },
    {
      name: `${game} adapter: an answer that arrives after the session changed is dropped`,
      async run() {
        const changes: [string, () => DriveResult][] = [
          ['another person', () => drive.signIn('bob')],
          ['a sign-out', () => drive.guest()],
          ['a new check', () => drive.checking()],
          ['the same person on a new visit', () => drive.revisit('alice')],
        ];
        for (const [label, change] of changes) {
          await drive.signIn('alice');
          const { transport, hold } = scriptedTransport();
          const client = build.mock(transport);
          const release = hold();
          const pending = client.call('getMe', {});
          await change();
          release();
          refused(await pending, 'stale_session', `${game}: ${label} during a call`);
        }
      },
    },
    {
      name: `${game} adapter: a confirmed person whose check fails, or starts again, has no session and reaches nothing`,
      async run() {
        const { calls, transport } = scriptedTransport();
        const client = build.mock(transport);
        const rechecks: [string, () => DriveResult][] = [
          ['a failed check', () => drive.failedCheck()],
          ['a new check', () => drive.checking()],
        ];
        for (const [label, recheck] of rechecks) {
          await drive.signIn('alice');
          signedIn(`alice before ${label}`);
          await recheck();
          check(fixture.session() === 'checking', `${game}: ${label} after a confirmed sign-in should have the session checking, got ${JSON.stringify(fixture.session())}`);
          for (const op of ALL_OPS) refused(await client.call(op, SAMPLE_ARGS[op]), 'still_checking', `${game}: ${label} after a confirmed sign-in, calling ${op}`);
          check(calls.length === 0, `${game}: ${label} after a confirmed sign-in should send nothing, but ${calls[0]?.op} reached the transport`);
        }
      },
    },
  ];
}

/**
 * Plugs a game's adapter into the mock world. For its own game it must build the
 * client with buildAdapter, which is the fixture's real factory: that is how the
 * suite knows the adapter ran. For any other game it returns a plain client.
 */
export type AdapterPlug = (
  game: GameId,
  getSession: () => SessionState,
  transport: SocialTransport,
  buildAdapter: (transport: SocialTransport) => SocialClient,
) => SocialClient;

/**
 * Everything an enabled game must pass. The last scenario needs the ones before
 * it to have run, so register the whole list. Without it the world scenarios
 * could pass on a plain client and prove nothing about the game.
 */
export function adapterConformanceScenarios({ fixture, adapt }: { fixture: AdapterFixture; adapt: AdapterPlug }): SocialScenario[] {
  let adapterCalls = 0;

  const plugged: NonNullable<MockWorldOptions['adapt']> = (game, getSession, transport) =>
    adapt(game, getSession, transport, (inner) => {
      const client = fixture.build.mock(inner);
      if (game !== fixture.game) return client;
      return {
        call<O extends OpName>(op: O, args: Operations[O]['args']) {
          adapterCalls += 1;
          return client.call(op, args);
        },
        forget: () => client.forget(),
      };
    });

  return [
    ...adapterScenarios(fixture),
    ...socialConformanceScenarios((options) => createMockWorld({ ...options, adapt: plugged })),
    {
      name: `${fixture.game} adapter: the world scenarios really ran through the game's own adapter`,
      run() {
        check(adapterCalls > 0, `${fixture.game}: adapt never used the adapter it was given, so the world scenarios proved nothing about it`);
      },
    },
  ];
}

/** Scenarios ask for a reduced limit only where reaching the real one would prove nothing more. */
export type MakeWorld = (options?: Pick<MockWorldOptions, 'limits'>) => MockWorld;

export function socialConformanceScenarios(makeWorld: MakeWorld): SocialScenario[] {
  const scenario = (name: string, body: (world: MockWorld) => Promise<void>, options?: Pick<MockWorldOptions, 'limits'>): SocialScenario => ({
    name,
    async run() {
      const world = makeWorld(options);
      await body(world);
      checkWorld(world);
    },
  });

  return [
    // -- The published values -----------------------------------------------
    scenario('contract: the version, the limits and the game statuses are the published ones', async () => {
      const published: Limits = {
        groupNameMax: 40,
        nameMax: 24,
        groupsCreatedTotal: 20,
        groupsCreatedPerDay: 5,
        groupsJoinedTotal: 50,
        groupsJoinedPerDay: 30,
        groupSize: 10000,
        memberPage: 100,
        friendInvitesPerDay: 30,
        friendInviteDays: 14,
        friends: 500,
        friendLookupsPerDay: 30,
        lookupRefHours: 1,
        previewFaces: 3,
        photoEdge: 256,
        photoBytes: 61440,
        puzzleIdMax: 64,
        resultDetailMax: 500,
      };
      const keys = Object.keys(published) as (keyof Limits)[];
      check(Object.keys(LIMITS).length === keys.length, 'LIMITS should have exactly the published keys');
      for (const key of keys) check(LIMITS[key] === published[key], `LIMITS.${key} should be ${published[key]}`);

      const statuses: typeof GAME_STATUS = {
        rainbow: 'mock',
        crosspuns: 'mock',
        cluevoyance: 'mock',
        wtf: 'mock',
        yodel: 'disabled',
        hamburgle: 'disabled',
        priceiswhat: 'disabled',
      };
      check(GAMES.length === Object.keys(statuses).length, 'GAME_STATUS should have exactly the seven games');
      for (const game of GAMES) check(GAME_STATUS[game] === statuses[game], `${game} should be ${statuses[game]}`);

      check((CONTRACT_VERSION as number) === 0, 'this suite is for contract version 0');
    }),

    scenario('contract: the avatars, colors, emblems and notice version are the published ones', async () => {
      const same = (list: readonly string[], published: string, label: string) => check(list.join(' ') === published, `${label} should be exactly the published list`);
      same(
        AVATAR_IDS,
        'bear owl fox frog cat saint-bernard rabbit raccoon penguin koala red-panda otter hedgehog panda tiger lion elephant giraffe mouse squirrel sloth deer basketball football soccer baseball-bat pizza hamburger ghost frankenstein',
        'AVATAR_IDS',
      );
      same(PROFILE_COLORS, '#DED1F2 #F1CDDA #F8D0BD #F8E4A0 #CCE6CA #CCE1F1', 'PROFILE_COLORS');
      same(GROUP_EMBLEM_IDS, 'campfire cabin mountains cards-dice coffee book picnic flowers moon', 'GROUP_EMBLEM_IDS');
      check((CURRENT_NOTICE_VERSION as number) === 1, 'the current notice is version 1');
    }),

    // -- Cross-game ---------------------------------------------------------
    scenario('cross-game: a group shows the same way in every game, and join and leave reach them all', async (world) => {
      const alice = ENABLED_GAMES.map((game) => world.signIn(game, 'alice'));
      const bob = ENABLED_GAMES.map((game) => world.signIn(game, 'bob'));

      for (let i = 0; i < ENABLED_GAMES.length; i++) {
        const name = `Club ${i}`;
        const { groupId, inviteCode } = await makeGroup(alice[i], name, 'Al');
        for (const player of alice) {
          const row = (await groupsOf(player)).find((g) => g.groupId === groupId);
          check(row && row.name === name && row.memberCount === 1 && row.myName === 'Al' && row.isOwner, `${player.game} should show the group made in ${alice[i].game}`);
        }

        const joiner = bob[(i + 1) % bob.length];
        await join(joiner, inviteCode, 'Bee');
        for (const player of [...alice, ...bob]) {
          const row = (await groupsOf(player)).find((g) => g.groupId === groupId);
          check(row?.memberCount === 2, `${player.game} should show the join made in ${joiner.game}`);
        }

        const leaver = bob[(i + 2) % bob.length];
        must(await leaver.call('leaveGroup', { groupId }), 'leaveGroup');
        for (const player of bob) {
          check(!(await groupsOf(player)).some((g) => g.groupId === groupId), `${player.game} should show the leave made in ${leaver.game}`);
        }
        for (const player of alice) {
          const row = (await groupsOf(player)).find((g) => g.groupId === groupId);
          check(row?.memberCount === 1, `${player.game} should show one member left`);
        }
      }
    }),

    scenario('cross-game: an owner runs a group from any game, and everyone sees the same thing in every game', async (world) => {
      const alice = ENABLED_GAMES.map((game) => world.signIn(game, 'alice'));
      const bob = ENABLED_GAMES.map((game) => world.signIn(game, 'bob'));
      const carol = ENABLED_GAMES.map((game) => world.signIn(game, 'carol'));

      const { groupId, inviteCode } = await makeGroup(alice[0], 'Club', 'Al');
      must(await alice[1].call('renameGroup', { groupId, name: 'Renamed' }), 'renameGroup');
      check((await groupsOf(alice[2]))[0].name === 'Renamed', 'a rename from one game should read back in a third');

      const fresh = must(await alice[1].call('replaceInvite', { groupId }), 'replaceInvite').inviteCode;
      for (const player of bob) refused(await player.call('joinGroup', { code: inviteCode, myName: 'Bee', noticeVersion: NOTICE }), 'invalid_code', `${player.game}: the replaced code`);
      await join(bob[3], fresh, 'Bee');
      await join(carol[2], fresh, 'Cee');

      const seen = await membersOf(alice[0], groupId);
      for (const player of [...alice, ...bob]) {
        const rows = await membersOf(player, groupId);
        check(JSON.stringify(rows.map((r) => r.memberRef)) === JSON.stringify(seen.map((r) => r.memberRef)), `${player.game} should show the same memberRefs`);
        const myName = alice.includes(player) ? 'Al' : 'Bee';
        for (const row of rows) {
          check(row.isMe === (row.name === myName), `${player.game}: isMe should be right for ${row.name}`);
          check(row.isOwner === (row.name === 'Al'), `${player.game}: isOwner should be right for ${row.name}`);
        }
      }

      const target = seen.find((r) => r.name === 'Cee');
      check(target, 'carol should be listed');
      must(await alice[3].call('removeMember', { groupId, memberRef: target.memberRef }), 'removeMember');
      for (const player of carol) refused(await player.call('joinGroup', { code: fresh, myName: 'Cee', noticeVersion: NOTICE }), 'removed', `${player.game}: the removed person`);
    }),

    scenario('cross-game: a friendship made in one game exists in the others, and removing it anywhere removes it everywhere', async (world) => {
      const alice = world.signIn('cluevoyance', 'alice');
      const bob = world.signIn('cluevoyance', 'bob');
      const { friendRef } = await befriend(alice, bob);
      const elsewhere = ['wtf', 'rainbow', 'crosspuns'] as const;

      for (const game of elsewhere) {
        const friends = await friendsOf(world.signIn(game, 'alice'));
        check(friends.length === 1 && friends[0].friendRef === friendRef, `${game} should show the friendship`);
        check((await friendsOf(world.signIn(game, 'bob'))).length === 1, `${game} should show it to the other side too`);
      }

      must(await world.signIn('wtf', 'bob').call('removeFriend', { friendRef }), 'removeFriend');
      for (const game of [...elsewhere, 'cluevoyance'] as const) {
        check((await friendsOf(world.signIn(game, 'alice'))).length === 0, `${game} should show the removal`);
        check((await friendsOf(world.signIn(game, 'bob'))).length === 0, `${game} should show it to the other side too`);
      }
    }),

    scenario('cross-game: a name in a group, changed in one game, reads back in another', async (world) => {
      const owner = world.signIn('crosspuns', 'alice');
      const here = world.signIn('rainbow', 'bob');
      const there = world.signIn('wtf', 'bob');
      const { groupId, inviteCode } = await makeGroup(owner);
      await join(here, inviteCode, 'Bee');

      must(await here.call('renameMeInGroup', { groupId, name: '  Beatrice  ' }), 'renameMeInGroup');

      check((await groupsOf(there))[0].myName === 'Beatrice', 'listMyGroups in another game should show the new name');
      check((await otherMember(owner, groupId)).name === 'Beatrice', 'listMembers should show the new name to the rest of the group');
    }),

    scenario('cross-game: a display name follows the person', async (world) => {
      const here = world.signIn('crosspuns', 'alice');
      const friend = world.signIn('rainbow', 'bob');
      must(await here.call('setDisplayName', { name: 'Alice' }), 'setDisplayName');
      const { name } = await befriend(here, friend);
      check(name === 'Alice', 'the accepter should see the name');

      for (const game of ENABLED_GAMES) {
        const me = must(await world.signIn(game, 'alice').call('getMe', {}), 'getMe');
        check(me.displayName === 'Alice', `${game} should show the display name`);
      }

      must(await world.signIn('wtf', 'alice').call('setDisplayName', { name: 'Ali' }), 'setDisplayName');
      check((await friendsOf(friend))[0].name === 'Ali', 'a new name should reach friends in other games');
    }),

    scenario('cross-game: daily limits count across games', async (world) => {
      const alice = ENABLED_GAMES.map((game) => world.signIn(game, 'alice'));
      for (let i = 0; i < LIMITS.groupsCreatedPerDay; i++) await makeGroup(alice[i % alice.length], `Club ${i}`);
      for (const player of alice) refused(await player.call('createGroup', { name: 'One too many', myName: 'Al', noticeVersion: NOTICE }), 'slow_down', `${player.game}: creating`);

      const bob = ENABLED_GAMES.map((game) => world.signIn(game, 'bob'));
      const codes = (await groupsOf(alice[0])).map((g) => g.inviteCode);
      await join(bob[0], String(codes[0]));
      await join(bob[1], String(codes[1]));
      for (const player of bob) refused(await player.call('joinGroup', { code: String(codes[2]), myName: 'Bee', noticeVersion: NOTICE }), 'slow_down', `${player.game}: joining`);

      await makeFriendInvite(bob[2]);
      await makeFriendInvite(bob[3]);
      for (const player of bob) refused(await player.call('createFriendInvite', { noticeVersion: NOTICE }), 'slow_down', `${player.game}: inviting`);
    }, { limits: { groupsJoinedPerDay: 2, friendInvitesPerDay: 2 } }),

    // -- Tokens and accounts ------------------------------------------------
    scenario('tokens: a token from another project is not signed in, even for someone with an account there', async (world) => {
      const pairs: [GameId, GameId][] = [
        ['rainbow', 'cluevoyance'],
        ['rainbow', 'wtf'],
        ['crosspuns', 'cluevoyance'],
        ['crosspuns', 'wtf'],
        ['cluevoyance', 'rainbow'],
        ['cluevoyance', 'wtf'],
        ['wtf', 'crosspuns'],
        ['wtf', 'cluevoyance'],
      ];
      for (const [from, to] of pairs) {
        world.signIn(to, 'alice');
        const token = world.signIn(from, 'alice').credential();
        refused(await world.hub.transportFor(to).call('getMe', {}, token), 'not_signed_in', `a ${from} token on ${to}`);
      }
      for (const game of ENABLED_GAMES) {
        refused(await world.hub.transportFor(game).call('getMe', {}, 'made-up-token'), 'not_signed_in', 'a made-up token');
      }
    }),

    scenario('tokens: a valid token is not an account, so someone with no account in this game is not linked', async (world) => {
      const rainbowOnly = world.signIn('rainbow', 'rita').credential();
      must(await world.hub.transportFor('rainbow').call('getMe', {}, rainbowOnly), 'on its own game');
      refused(await world.hub.transportFor('crosspuns').call('getMe', {}, rainbowOnly), 'not_linked', 'a rainbow-only person on crosspuns');

      const crosspunsOnly = world.signIn('crosspuns', 'carl').credential();
      refused(await world.hub.transportFor('rainbow').call('getMe', {}, crosspunsOnly), 'not_linked', 'a crosspuns-only person on rainbow');

      const { inviteCode } = await makeGroup(world.signIn('crosspuns', 'alice'));
      for (const game of ENABLED_GAMES) {
        const noAccount = world.signInNoAccount(game, 'nora');
        for (const op of ALL_OPS) {
          if (op !== 'previewInvite') refused(await noAccount.call(op, SAMPLE_ARGS[op]), 'not_linked', `${game} with no account: ${op}`);
        }
        const preview = groupPreview(await noAccount.call('previewInvite', { code: inviteCode }), `${game} preview with no account`);
        check(!preview.isMember && !preview.isRemoved, `${game}: someone with no account should get false flags`);
      }
    }),

    scenario('tokens: someone with accounts in two games of one project may use one token in both', async (world) => {
      const token = world.signIn('rainbow', 'alice').credential();
      world.signIn('crosspuns', 'alice');
      must(await world.hub.transportFor('rainbow').call('setDisplayName', { name: 'Alice' }, token), 'on rainbow');
      const seen = must(await world.hub.transportFor('crosspuns').call('getMe', {}, token), 'on crosspuns');
      check(seen.displayName === 'Alice', 'one token should reach one person in both games');
    }),

    // -- Isolation ----------------------------------------------------------
    scenario('isolation: two people see only their own lists', async (world) => {
      const alice = world.signIn('crosspuns', 'alice');
      const bob = world.signIn('crosspuns', 'bob');
      const carol = world.signIn('wtf', 'carol');
      const { groupId } = await makeGroup(alice, 'Alice only');
      await befriend(alice, carol);

      check((await groupsOf(bob)).length === 0, 'bob should see no groups');
      check((await friendsOf(bob)).length === 0, 'bob should see no friends');
      const bobs = await makeGroup(bob, 'Bob only');
      const seen = await groupsOf(alice);
      check(seen.length === 1 && seen[0].groupId === groupId, 'alice should see only her group');
      check(!(await groupsOf(bob)).some((g) => g.groupId === groupId), 'bob should not see her group');
      check(bobs.groupId !== groupId, 'groups should have their own ids');
    }),

    scenario('isolation: one client, passed between people, only ever speaks for whoever holds it', async (world) => {
      for (let i = 0; i < ENABLED_GAMES.length; i++) {
        const game = ENABLED_GAMES[i];
        const first = `alice${i}`;
        const second = `bob${i}`;
        const friend = world.signIn(game, `carol${i}`);
        const player = world.signIn(game, first);
        const hers = await makeGroup(player, 'Hers', 'Al');
        await befriend(friend, player);

        world.become(player, second);
        check((await groupsOf(player)).length === 0, `${game}: bob should see none of her groups`);
        lastCredentialIs(world, player, game);
        check((await friendsOf(player)).length === 0, `${game}: bob should see none of her friends`);
        const his = await makeGroup(player, 'His', 'Bo');
        lastCredentialIs(world, player, game);

        world.become(player, first);
        const groups = await groupsOf(player);
        lastCredentialIs(world, player, game);
        check(groups.length === 1 && groups[0].groupId === hers.groupId && groups[0].groupId !== his.groupId, `${game}: alice should see only her own group`);
        check((await friendsOf(player)).length === 1, `${game}: alice should see her friend again`);
      }
    }),

    scenario('isolation: a person has unrelated refs in different groups, and a ref from one group fails in another', async (world) => {
      const alice = world.signIn('crosspuns', 'alice');
      const bob = world.signIn('rainbow', 'bob');
      const first = await makeGroup(alice, 'One');
      const second = await makeGroup(alice, 'Two');
      await join(bob, first.inviteCode);
      await join(bob, second.inviteCode);

      const inFirst = await otherMember(alice, first.groupId);
      const inSecond = await otherMember(alice, second.groupId);
      check(inFirst.memberRef !== inSecond.memberRef, 'the same person should have different refs in different groups');

      await noEffect([alice, bob], 'a ref from another group', async () => {
        refused(await alice.call('removeMember', { groupId: second.groupId, memberRef: inFirst.memberRef }), 'not_found', 'a ref from another group');
      });
    }),

    scenario('isolation: the invite code goes to the owner only, and everyone gets the key', async (world) => {
      const owner = world.signIn('crosspuns', 'alice');
      const member = world.signIn('wtf', 'bob');
      const { inviteCode } = await makeGroup(owner);
      await join(member, inviteCode);

      check((await groupsOf(owner))[0].inviteCode === inviteCode, 'the owner should get the code');
      const [row] = await groupsOf(member);
      check('inviteCode' in row && row.inviteCode === null, 'a member should get inviteCode as null');
    }),

    scenario('isolation: a signed-out client is refused', async (world) => {
      for (const game of ENABLED_GAMES) {
        const leaving = world.signIn(game, 'alice');
        must(await leaving.call('getMe', {}), 'getMe before signing out');
        world.signOut(leaving, { scope: 'local' });
        refused(await leaving.call('getMe', {}), 'not_signed_in', `${game} after signing out`);
      }
    }),

    scenario('isolation: an answer that arrives after the person changed is dropped', async (world) => {
      for (const game of ENABLED_GAMES) {
        const swapped = world.signIn(game, 'alice');
        let release = world.hold(game);
        let pending: Promise<Result<unknown>> = swapped.call('getMe', {});
        world.become(swapped, 'bob');
        release();
        refused(await pending, 'stale_session', `${game}: the person changed`);

        const left = world.signIn(game, 'alice');
        release = world.hold(game);
        pending = left.call('getMe', {});
        world.signOut(left, { scope: 'local' });
        release();
        refused(await pending, 'stale_session', `${game}: the person signed out`);

        const rechecked = world.signIn(game, 'alice');
        release = world.hold(game);
        pending = rechecked.call('getMe', {});
        world.setChecking(rechecked);
        release();
        refused(await pending, 'stale_session', `${game}: the session went back to being checked`);

        const forgot = world.signIn(game, 'alice');
        release = world.hold(game);
        pending = forgot.call('getMe', {});
        forgot.forget();
        release();
        refused(await pending, 'stale_session', `${game}: the client was told to forget`);

        const previewing = world.signIn(game, 'alice');
        release = world.hold(game);
        pending = previewing.call('previewInvite', SAMPLE_ARGS.previewInvite);
        world.become(previewing, 'bob');
        release();
        refused(await pending, 'stale_session', `${game}: a preview, the person changed`);

        const guest = world.guest(game);
        release = world.hold(game);
        pending = guest.call('previewInvite', SAMPLE_ARGS.previewInvite);
        world.become(guest, 'bob');
        release();
        refused(await pending, 'stale_session', `${game}: a preview, a guest signed in`);

        const failing = world.signIn(game, 'alice');
        release = world.hold(game);
        world.failNext(game);
        pending = failing.call('getMe', {});
        world.become(failing, 'bob');
        release();
        refused(await pending, 'stale_session', `${game}: the person changed and the call failed`);
      }
    }),

    scenario('session: while a game is checking, nothing is sent, previewInvite included', async (world) => {
      for (const game of ENABLED_GAMES) {
        const player = world.signIn(game, 'alice');
        must(await player.call('getMe', {}), 'getMe before the check');
        const sent = world.calls.length;
        world.setChecking(player);
        for (const op of ALL_OPS) refused(await player.call(op, SAMPLE_ARGS[op]), 'still_checking', `${game} checking: ${op}`);
        check(world.calls.length === sent, `${game}: nothing should reach the transport during a check`);
      }
    }),

    scenario('session: a failing transport comes back as unavailable through the adapter', async (world) => {
      for (const game of ENABLED_GAMES) {
        const player = world.signIn(game, 'alice');
        world.failNext(game);
        refused(await player.call('getMe', {}), 'unavailable', `${game}: a failed call`);
        must(await player.call('getMe', {}), `${game}: the next call`);
      }
    }),

    scenario('isolation: a guest preview has false flags, whoever is on the other end', async (world) => {
      const owner = world.signIn('crosspuns', 'alice');
      const removed = world.signIn('crosspuns', 'bob');
      const { groupId, inviteCode } = await makeGroup(owner, 'Club');
      await join(removed, inviteCode);
      await removeOther(owner, groupId);

      for (const game of ENABLED_GAMES) {
        const preview = groupPreview(await world.guest(game).call('previewInvite', { code: inviteCode }), `${game} guest preview`);
        check(preview.name === 'Club' && preview.isMember === false && preview.isRemoved === false, `${game}: a guest should get false flags`);
      }

      check(groupPreview(await owner.call('previewInvite', { code: inviteCode }), 'owner preview').isMember, 'the owner should be told they are a member');
      check(groupPreview(await removed.call('previewInvite', { code: inviteCode }), 'removed preview').isRemoved, 'a removed person should be told so');
    }),

    scenario("isolation: a token from another game at previewInvite gets guest flags, whoever it belongs to", async (world) => {
      const owner = world.signIn('crosspuns', 'alice');
      const { inviteCode } = await makeGroup(owner);
      await join(world.signIn('crosspuns', 'bob'), inviteCode);
      await join(world.signIn('rainbow', 'rita'), inviteCode);
      const transport = world.hub.transportFor('crosspuns');

      const otherProject = world.signIn('wtf', 'bob').credential();
      const crossProject = groupPreview(await transport.call('previewInvite', { code: inviteCode }, otherProject), 'a token from another project');
      check(!crossProject.isMember && !crossProject.isRemoved, 'a member with a token from another project should get false flags');

      const noAccount = world.signIn('rainbow', 'rita').credential();
      const samePool = groupPreview(await transport.call('previewInvite', { code: inviteCode }, noAccount), 'a token with no account here');
      check(!samePool.isMember && !samePool.isRemoved, 'a member with no account in this game should get false flags');
    }),

    scenario('isolation: an identity in the args changes nothing, whatever the operation', async (world) => {
      const alice = world.signIn('crosspuns', 'alice');
      const bob = world.signIn('crosspuns', 'bob');
      must(await alice.call('setDisplayName', { name: 'Alice' }), 'setDisplayName');
      must(await bob.call('setDisplayName', { name: 'Bob' }), 'setDisplayName');
      await makeGroup(bob, 'Bobs');

      // Straight at the hub: a client's own args are checked at the transport by every scenario.
      const transport = world.hub.transportFor('crosspuns');
      const token = alice.credential();
      const identity = { globalUserId: world.globalIdOf('bob'), global_user_id: world.globalIdOf('bob'), accountId: 'bob', email: 'bob@example.test', playerKey: 'bob', personId: 'bob' };
      const sneaky = identity as unknown as Record<string, never>;
      const renaming = { ...identity, name: 'Changed' };

      check(must(await transport.call('getMe', sneaky, token), 'getMe').displayName === 'Alice', 'getMe should be about the caller');
      check(must(await transport.call('listMyGroups', sneaky, token), 'listMyGroups').length === 0, "listMyGroups should list the caller's groups");
      check(must(await transport.call('setDisplayName', renaming, token), 'setDisplayName').displayName === 'Changed', 'setDisplayName should answer for the caller');
      check(must(await bob.call('getMe', {}), 'getMe').displayName === 'Bob', "setDisplayName should leave bob's name alone");

      must(await transport.call('deleteMySocialData', sneaky, token), 'deleteMySocialData');
      const left = must(await bob.call('getMe', {}), 'getMe');
      check(left.displayName === 'Bob' && left.groupCount === 1, 'deleteMySocialData should erase the caller and leave bob whole');
    }),

    // -- Permission denied --------------------------------------------------
    scenario('denied: a guest can only preview', async (world) => {
      for (const game of ENABLED_GAMES) {
        const guest = world.guest(game);
        const transport = world.hub.transportFor(game);
        for (const op of ALL_OPS) {
          if (op === 'previewInvite') continue;
          refused(await guest.call(op, SAMPLE_ARGS[op]), 'not_signed_in', `${game} guest ${op}`);
          refused(await transport.call(op, SAMPLE_ARGS[op], null), 'not_signed_in', `${game} no token ${op}`);
        }
      }
    }),

    scenario('denied: an anonymous user gets what a guest gets', async (world) => {
      const { inviteCode } = await makeGroup(world.signIn('crosspuns', 'alice'));
      for (const game of ENABLED_GAMES) {
        const anonymous = world.signInAnonymous(game, 'dave');
        for (const op of ALL_OPS) {
          if (op === 'previewInvite') continue;
          refused(await anonymous.call(op, SAMPLE_ARGS[op]), 'not_signed_in', `${game} anonymous ${op}`);
        }
        const preview = groupPreview(await anonymous.call('previewInvite', { code: inviteCode }), `${game} anonymous preview`);
        check(!preview.isMember && !preview.isRemoved, `${game}: an anonymous preview should have false flags`);
      }
    }),

    scenario('denied: a valid token with no shared identity is told so', async (world) => {
      const { inviteCode } = await makeGroup(world.signIn('crosspuns', 'alice'));
      for (const game of ENABLED_GAMES) {
        const unlinked = world.signInUnlinked(game, 'dave');
        for (const op of ALL_OPS) {
          if (op === 'previewInvite') continue;
          refused(await unlinked.call(op, SAMPLE_ARGS[op]), 'not_linked', `${game} unlinked ${op}`);
        }
        const preview = groupPreview(await unlinked.call('previewInvite', { code: inviteCode }), `${game} unlinked preview`);
        check(!preview.isMember && !preview.isRemoved, `${game}: an unlinked preview should have false flags`);
      }
    }),

    scenario('denied: every operation in a disabled game, whoever asks', async (world) => {
      check(DISABLED_GAMES.length > 0, 'the contract has disabled games');
      for (const game of DISABLED_GAMES) {
        const signedIn = world.signIn(game, 'alice');
        const anonymous = world.signInAnonymous(game, 'dave');
        const unlinked = world.signInUnlinked(game, 'erin');
        const noAccount = world.signInNoAccount(game, 'nora');
        const stub = disabledSocialClient('game_disabled');
        const transport = world.hub.transportFor(game);
        for (const op of ALL_OPS) {
          refused(await signedIn.call(op, SAMPLE_ARGS[op]), 'game_disabled', `${game} signed in ${op}`);
          refused(await anonymous.call(op, SAMPLE_ARGS[op]), 'game_disabled', `${game} anonymous ${op}`);
          refused(await unlinked.call(op, SAMPLE_ARGS[op]), 'game_disabled', `${game} unlinked ${op}`);
          refused(await noAccount.call(op, SAMPLE_ARGS[op]), 'game_disabled', `${game} no account ${op}`);
          refused(await stub.call(op, SAMPLE_ARGS[op]), 'game_disabled', `${game} stub ${op}`);
          refused(await transport.call(op, SAMPLE_ARGS[op], null), 'game_disabled', `${game} no token ${op}`);
        }
        refused(await world.guest(game).call('previewInvite', SAMPLE_ARGS.previewInvite), 'game_disabled', `${game} guest preview`);
      }
    }),

    scenario('denied: a name that is no operation is unavailable, and calls nothing', async (world) => {
      const token = world.signIn('crosspuns', 'alice').credential();
      const transport = world.hub.transportFor('crosspuns');
      for (const name of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'noSuchOperation', 'recordCompletion']) {
        refused(await transport.call(name as OpName, {}, token), 'unavailable', name);
        refused(await transport.call(name as OpName, {}, null), 'unavailable', `${name} with no token`);
      }
    }),

    scenario('denied: a group I am not in and a group that does not exist look the same', async (world) => {
      const owner = world.signIn('crosspuns', 'alice');
      const stranger = world.signIn('wtf', 'bob');
      const { groupId } = await makeGroup(owner);
      const probes: ((id: string) => Promise<Result<unknown>>)[] = [
        (id) => stranger.call('listMembers', { groupId: id }),
        (id) => stranger.call('leaveGroup', { groupId: id }),
        (id) => stranger.call('renameMeInGroup', { groupId: id, name: 'Bee' }),
        (id) => stranger.call('renameGroup', { groupId: id, name: 'Mine now' }),
        (id) => stranger.call('setGroupAppearance', { ...SAMPLE_ARGS.setGroupAppearance, groupId: id }),
        (id) => stranger.call('listResults', { ...SAMPLE_ARGS.listResults, groupId: id }),
        (id) => stranger.call('removeMember', { groupId: id, memberRef: 'no-such-ref' }),
        (id) => stranger.call('listRemoved', { groupId: id }),
        (id) => stranger.call('letBackIn', { groupId: id, removedRef: 'no-such-ref' }),
        (id) => stranger.call('replaceInvite', { groupId: id }),
      ];
      for (const probe of probes) {
        await noEffect([owner, stranger], 'probing a group', async () => {
          const real = await probe(groupId);
          const missing = await probe('no-such-group');
          refused(real, 'not_a_member', 'a real group the caller is not in');
          check(JSON.stringify(real) === JSON.stringify(missing), 'the two answers should be identical');
        });
      }
    }),

    scenario('denied: owner-only operations refuse a member and change nothing', async (world) => {
      const owner = world.signIn('crosspuns', 'alice');
      const member = world.signIn('rainbow', 'bob');
      const { groupId, inviteCode } = await makeGroup(owner);
      await join(member, inviteCode);
      const ownerRow = await otherMember(member, groupId);

      await noEffect([owner, member], 'a member using owner powers', async () => {
        refused(await member.call('renameGroup', { groupId, name: 'Mine now' }), 'not_the_creator', 'renameGroup');
        refused(await member.call('setGroupAppearance', { ...SAMPLE_ARGS.setGroupAppearance, groupId }), 'not_the_creator', 'setGroupAppearance');
        refused(await member.call('removeMember', { groupId, memberRef: ownerRow.memberRef }), 'not_the_creator', 'removeMember');
        refused(await member.call('listRemoved', { groupId }), 'not_the_creator', 'listRemoved');
        refused(await member.call('letBackIn', { groupId, removedRef: 'no-such-ref' }), 'not_the_creator', 'letBackIn');
        refused(await member.call('replaceInvite', { groupId }), 'not_the_creator', 'replaceInvite');
      });
      must(await member.call('joinGroup', { code: inviteCode, myName: 'Member', noticeVersion: NOTICE }), 'the code should not have been replaced');
    }),

    scenario('denied: someone who owned a group and came back has no owner powers', async (world) => {
      const owner = world.signIn('crosspuns', 'alice');
      const next = world.signIn('rainbow', 'bob');
      const { groupId, inviteCode } = await makeGroup(owner);
      await join(next, inviteCode);
      must(await owner.call('leaveGroup', { groupId }), 'leaveGroup');
      await join(owner, inviteCode, 'Back again');

      const [row] = await groupsOf(owner);
      check(!row.isOwner && row.inviteCode === null, 'the returning owner should be an ordinary member');
      const nextRow = await otherMember(owner, groupId);
      await noEffect([owner, next], 'a previous owner using owner powers', async () => {
        refused(await owner.call('renameGroup', { groupId, name: 'Mine again' }), 'not_the_creator', 'renameGroup');
        refused(await owner.call('setGroupAppearance', { ...SAMPLE_ARGS.setGroupAppearance, groupId }), 'not_the_creator', 'setGroupAppearance');
        refused(await owner.call('removeMember', { groupId, memberRef: nextRow.memberRef }), 'not_the_creator', 'removeMember');
        refused(await owner.call('listRemoved', { groupId }), 'not_the_creator', 'listRemoved');
        refused(await owner.call('letBackIn', { groupId, removedRef: 'no-such-ref' }), 'not_the_creator', 'letBackIn');
        refused(await owner.call('replaceInvite', { groupId }), 'not_the_creator', 'replaceInvite');
      });
    }),

    scenario('denied: someone removed stays out, with any code, until let back in', async (world) => {
      const owner = world.signIn('crosspuns', 'alice');
      const member = world.signIn('wtf', 'bob');
      const { groupId, inviteCode } = await makeGroup(owner);
      await join(member, inviteCode, 'Bee');
      await removeOther(owner, groupId);

      refused(await member.call('listMembers', { groupId }), 'not_a_member', 'a removed person reading the group');
      await noEffect([owner, member], 'a removed person coming back', async () => {
        refused(await member.call('joinGroup', { code: inviteCode, myName: 'Bee', noticeVersion: NOTICE }), 'removed', 'rejoining with the old code');
      });
      const fresh = must(await owner.call('replaceInvite', { groupId }), 'replaceInvite').inviteCode;
      check(fresh !== inviteCode, 'a replaced code should be new');
      await noEffect([owner, member], 'a removed person coming back', async () => {
        refused(await member.call('joinGroup', { code: fresh, myName: 'Bee', noticeVersion: NOTICE }), 'removed', 'rejoining with the replaced code');
        refused(await member.call('joinGroup', { code: inviteCode, myName: 'Bee', noticeVersion: NOTICE }), 'invalid_code', 'the old code after replacing');
        refused(await member.call('previewInvite', { code: inviteCode }), 'invalid_code', 'previewing the old code');
      });

      const [entry] = must(await owner.call('listRemoved', { groupId }), 'listRemoved');
      check(entry.name === 'Bee', 'the owner should see the name they had');
      must(await owner.call('letBackIn', { groupId, removedRef: entry.removedRef }), 'letBackIn');
      await join(member, fresh, 'Bee');
      check((await membersOf(owner, groupId)).length === 2, 'they should be back');
      check(must(await owner.call('listRemoved', { groupId }), 'listRemoved').length === 0, 'the removal should be gone');

      must(await member.call('leaveGroup', { groupId }), 'leaveGroup');
      await join(member, fresh, 'Bee');
      check((await membersOf(owner, groupId)).length === 2, 'leaving on your own should block nothing');
    }),

    scenario("denied: a removedRef from the owner's other group is not found", async (world) => {
      const owner = world.signIn('crosspuns', 'alice');
      const member = world.signIn('wtf', 'bob');
      const first = await makeGroup(owner, 'One');
      const second = await makeGroup(owner, 'Two');
      await join(member, first.inviteCode);
      await removeOther(owner, first.groupId);
      const [entry] = must(await owner.call('listRemoved', { groupId: first.groupId }), 'listRemoved');

      await noEffect([owner, member], 'a ref from the other group', async () => {
        refused(await owner.call('letBackIn', { groupId: second.groupId, removedRef: entry.removedRef }), 'not_found', 'the wrong group');
      });
      refused(await member.call('joinGroup', { code: first.inviteCode, myName: 'Bee', noticeVersion: NOTICE }), 'removed', 'still removed from the first');
    }),

    scenario('denied: the owner cannot remove themselves', async (world) => {
      const owner = world.signIn('crosspuns', 'alice');
      const { groupId } = await makeGroup(owner);
      const [me] = await membersOf(owner, groupId);
      await noEffect([owner], 'removing myself', async () => {
        refused(await owner.call('removeMember', { groupId, memberRef: me.memberRef }), 'cannot_remove_self', 'removing myself');
      });
    }),

    scenario('denied: a block ends the friendship, and the blocked person can not tell from any response', async (world) => {
      const alice = world.signIn('cluevoyance', 'alice');
      const bob = world.signIn('wtf', 'bob');
      must(await alice.call('setDisplayName', { name: 'Alice' }), 'setDisplayName');
      must(await bob.call('setDisplayName', { name: 'Bob' }), 'setDisplayName');
      const { friendRef } = await befriend(alice, bob);
      const hers = (await makeFriendInvite(alice)).code;
      const { blockRef } = must(await alice.call('block', { ref: friendRef }), 'block');
      check(must(await alice.call('block', { ref: (await makeGroupRef(alice, bob)).memberRef }), 'blocking again').blockRef === blockRef, 'blocking again should give the same blockRef');

      check((await friendsOf(alice)).length === 0 && (await friendsOf(bob)).length === 0, 'the friendship should be over');
      const his = (await makeFriendInvite(bob)).code;

      // A preview ignores blocks: both sides see what a guest sees.
      const guest = world.guest('rainbow');
      const guestSeesHers = JSON.stringify(await guest.call('previewInvite', { code: hers }));
      const guestSeesHis = JSON.stringify(await guest.call('previewInvite', { code: his }));
      check(JSON.stringify(await bob.call('previewInvite', { code: hers })) === guestSeesHers, 'the blocked person should preview what a guest does');
      check(JSON.stringify(await alice.call('previewInvite', { code: his })) === guestSeesHis, 'the blocker should preview what a guest does');

      // Accepting looks like someone else got there first, and really does use it up.
      refused(await bob.call('acceptFriendInvite', { code: hers, noticeVersion: NOTICE }), 'invite_used', 'the blocked person accepting');
      refused(await alice.call('acceptFriendInvite', { code: his, noticeVersion: NOTICE }), 'invite_used', 'the blocker accepting');
      refused(await guest.call('previewInvite', { code: hers }), 'invite_used', 'a guest afterwards should agree');
      refused(await world.signIn('rainbow', 'carol').call('acceptFriendInvite', { code: hers, noticeVersion: NOTICE }), 'invite_used', 'nobody else can use it now');
      check((await friendsOf(alice)).length === 0 && (await friendsOf(bob)).length === 0, 'no friendship should have come of it');

      const blocks = await blocksOf(alice);
      check(blocks.length === 1 && blocks[0].blockRef === blockRef && blocks[0].name === 'Bob', 'the blocker should see the block');
      check((await blocksOf(bob)).length === 0, 'the blocked person should not');
      await noEffect([alice, bob], 'the blocked person unblocking', async () => {
        refused(await bob.call('unblock', { blockRef }), 'not_found', 'the blocked person unblocking');
      });

      must(await alice.call('unblock', { blockRef }), 'unblock');
      refused(await alice.call('unblock', { blockRef }), 'not_found', 'unblocking twice');
      await befriend(alice, bob);
    }),

    scenario('denied: a block through a group ref ends a friendship and leaves the group alone', async (world) => {
      const alice = world.signIn('crosspuns', 'alice');
      const bob = world.signIn('rainbow', 'bob');
      must(await bob.call('setDisplayName', { name: 'Bob' }), 'setDisplayName');
      await befriend(alice, bob);
      const { groupId, inviteCode } = await makeGroup(alice);
      await join(bob, inviteCode, 'Bee');
      const row = await otherMember(alice, groupId);

      must(await alice.call('block', { ref: row.memberRef }), 'block');
      check((await friendsOf(alice)).length === 0 && (await friendsOf(bob)).length === 0, 'the friendship should be over');
      check((await blocksOf(alice))[0].name === 'Bee', 'the block should show the name the blocker saw');
      check((await membersOf(alice, groupId)).length === 2 && (await membersOf(bob, groupId)).length === 2, 'a block has no effect on shared groups');
    }),

    scenario('denied: a ref the caller can not see is not found', async (world) => {
      const alice = world.signIn('crosspuns', 'alice');
      const bob = world.signIn('crosspuns', 'bob');
      const outsider = world.signIn('wtf', 'carol');
      const { friendRef } = await befriend(alice, bob);
      const { groupId, inviteCode } = await makeGroup(alice);
      await join(bob, inviteCode);
      const row = await otherMember(alice, groupId);
      const [me] = (await membersOf(alice, groupId)).filter((m) => m.isMe);

      await noEffect([alice, bob, outsider], 'an outsider using refs', async () => {
        refused(await outsider.call('removeFriend', { friendRef }), 'not_found', "someone else's friendship");
        refused(await outsider.call('block', { ref: friendRef }), 'not_found', "blocking through someone else's friendship");
        refused(await outsider.call('block', { ref: row.memberRef }), 'not_found', 'blocking through a group the caller is not in');
      });

      const { blockRef } = must(await alice.call('block', { ref: row.memberRef }), 'block');
      await noEffect([alice, bob, outsider], 'using refs that lead nowhere', async () => {
        refused(await outsider.call('unblock', { blockRef }), 'not_found', "someone else's block");
        refused(await alice.call('block', { ref: me.memberRef }), 'not_found', 'blocking myself');
        refused(await alice.call('removeMember', { groupId, memberRef: 'no-such-ref' }), 'not_found', 'an unknown member');
        refused(await alice.call('letBackIn', { groupId, removedRef: 'no-such-ref' }), 'not_found', 'an unknown removal');
      });
    }),

    scenario('denied: refs die with the friendship or membership they belonged to', async (world) => {
      const alice = world.signIn('crosspuns', 'alice');
      const bob = world.signIn('rainbow', 'bob');
      const { friendRef } = await befriend(alice, bob);
      must(await bob.call('removeFriend', { friendRef }), 'removeFriend');
      await noEffect([alice, bob], 'a dead friendRef', async () => {
        refused(await alice.call('removeFriend', { friendRef }), 'not_found', 'removing a friendship that ended');
        refused(await bob.call('block', { ref: friendRef }), 'not_found', 'blocking through a friendship that ended');
      });

      const { groupId, inviteCode } = await makeGroup(alice);
      await join(bob, inviteCode);
      const row = await otherMember(alice, groupId);
      must(await bob.call('leaveGroup', { groupId }), 'leaveGroup');
      await noEffect([alice, bob], 'a dead memberRef', async () => {
        refused(await alice.call('removeMember', { groupId, memberRef: row.memberRef }), 'not_found', 'removing someone who left');
        refused(await alice.call('block', { ref: row.memberRef }), 'not_found', 'blocking through a membership that ended');
      });

      await join(bob, inviteCode);
      check((await otherMember(alice, groupId)).memberRef !== row.memberRef, 'a new membership should get a new ref');
      refused(await alice.call('removeMember', { groupId, memberRef: row.memberRef }), 'not_found', 'the old ref should stay dead');
    }),

    scenario('denied: a code of the wrong kind does nothing', async (world) => {
      const alice = world.signIn('crosspuns', 'alice');
      const bob = world.signIn('rainbow', 'bob');
      const { inviteCode } = await makeGroup(alice);
      const { code } = await makeFriendInvite(alice);

      await noEffect([alice, bob], 'the wrong kind of code', async () => {
        refused(await bob.call('acceptFriendInvite', { code: inviteCode, noticeVersion: NOTICE }), 'invalid_code', 'a group code as a friend invite');
        refused(await bob.call('joinGroup', { code, myName: 'Bee', noticeVersion: NOTICE }), 'invalid_code', 'a friend code as a group invite');
      });
      must(await bob.call('acceptFriendInvite', { code, noticeVersion: NOTICE }), 'the friend code should still be good');
      await join(bob, inviteCode);
    }),

    // -- Lifecycle and limits -----------------------------------------------
    scenario('lifecycle (provisional, D11): ownership passes to the longest-standing member, and the last one out closes the group', async (world) => {
      const owner = world.signIn('crosspuns', 'alice');
      const first = world.signIn('rainbow', 'bob');
      const second = world.signIn('wtf', 'carol');
      const { groupId, inviteCode } = await makeGroup(owner);
      world.advance(1000);
      await join(first, inviteCode, 'First');
      world.advance(1000);
      await join(second, inviteCode, 'Second');

      check(must(await owner.call('leaveGroup', { groupId }), 'leaveGroup').closed === false, 'the group should stay open');
      const [firstsGroup] = await groupsOf(first);
      check(firstsGroup.isOwner && firstsGroup.inviteCode === inviteCode, 'the earliest joiner should own it now, code and all');
      const [secondsGroup] = await groupsOf(second);
      check(!secondsGroup.isOwner && secondsGroup.inviteCode === null, 'the later joiner should not');

      check(must(await second.call('leaveGroup', { groupId }), 'leaveGroup').closed === false, 'one member still remains');
      check(must(await first.call('leaveGroup', { groupId }), 'leaveGroup').closed === true, 'the last one out closes it');
      refused(await second.call('joinGroup', { code: inviteCode, myName: 'Second', noticeVersion: NOTICE }), 'invalid_code', 'the code of a closed group');
      refused(await first.call('listMembers', { groupId }), 'not_a_member', 'a closed group');
    }),

    scenario('lifecycle (provisional, D11): people who joined at the same moment hand over in joining order', async (world) => {
      const owner = world.signIn('crosspuns', 'alice');
      const first = world.signIn('crosspuns', 'bob');
      const second = world.signIn('crosspuns', 'carol');
      const { groupId, inviteCode } = await makeGroup(owner);
      await join(first, inviteCode);
      await join(second, inviteCode);
      must(await owner.call('leaveGroup', { groupId }), 'leaveGroup');
      check((await groupsOf(first))[0].isOwner, 'the earlier of the two should own it');
    }),

    scenario('lifecycle: a member list comes in joining order, a page at a time, with nobody missed or repeated', async (world) => {
      const owner = world.signIn('crosspuns', 'alice');
      const { groupId, inviteCode } = await makeGroup(owner, 'Club', 'alice');
      const others = ['bob', 'carol', 'dave', 'erin'];
      const players = others.map((person) => world.signIn('rainbow', person));
      for (let i = 0; i < others.length; i++) {
        world.advance(1000);
        await join(players[i], inviteCode, others[i]);
      }
      const inOrder = JSON.stringify(['alice', ...others]);
      const names = (rows: MemberRow[]) => JSON.stringify(rows.map((r) => r.name));

      check(names(await pageThrough(owner, groupId)) === inOrder, 'the default page size should keep joining order');
      check(names(await pageThrough(owner, groupId, 1)) === inOrder, 'limit 1 should walk the same order');
      check(names(await pageThrough(owner, groupId, 500)) === inOrder, 'a limit past the page size should walk the same order');

      const firstPage: MemberRow[] = must(await owner.call('listMembers', { groupId, limit: 1 }), 'listMembers');
      check(firstPage.length === 1, 'limit 1 should give one row');
      const big: MemberRow[] = must(await owner.call('listMembers', { groupId, limit: 500 }), 'listMembers');
      check(big.length === 2, 'a page should stop at the page size');

      // The cursor is a position and not a member, so it outlives them.
      const leaving = big[1];
      must(await players[0].call('leaveGroup', { groupId }), 'leaveGroup');
      const rest: MemberRow[] = must(await owner.call('listMembers', { groupId, after: { joinedAt: leaving.joinedAt, memberRef: leaving.memberRef } }), 'listMembers');
      check(names(rest) === JSON.stringify(['carol', 'dave']), 'paging should survive the last-seen member leaving');
    }, { limits: { memberPage: 2 } }),

    scenario('lifecycle: a friend invite works once', async (world) => {
      const alice = world.signIn('cluevoyance', 'alice');
      const bob = world.signIn('wtf', 'bob');
      const carol = world.signIn('rainbow', 'carol');
      const { code } = await makeFriendInvite(alice);
      must(await bob.call('acceptFriendInvite', { code, noticeVersion: NOTICE }), 'acceptFriendInvite');
      await noEffect([alice, bob, carol], 'a used invite', async () => {
        refused(await carol.call('acceptFriendInvite', { code, noticeVersion: NOTICE }), 'invite_used', 'a second person using it');
        refused(await carol.call('previewInvite', { code }), 'invite_used', 'previewing a used invite');
      });
    }),

    scenario('lifecycle: a friend invite expires after 14 days', async (world) => {
      const alice = world.signIn('cluevoyance', 'alice');
      const bob = world.signIn('wtf', 'bob');
      const { code, expiresAt } = await makeFriendInvite(alice);
      check(Date.parse(expiresAt) - world.now() === LIMITS.friendInviteDays * DAY_MS, 'it should expire in 14 days');

      world.advance(LIMITS.friendInviteDays * DAY_MS);
      must(await bob.call('previewInvite', { code }), 'still good at the last moment');
      world.advance(1);
      await noEffect([alice, bob], 'an expired invite', async () => {
        refused(await bob.call('acceptFriendInvite', { code, noticeVersion: NOTICE }), 'invite_expired', 'accepting');
        refused(await bob.call('previewInvite', { code }), 'invite_expired', 'previewing');
      });
    }),

    scenario('lifecycle: nobody can accept their own friend invite', async (world) => {
      const alice = world.signIn('cluevoyance', 'alice');
      const { code } = await makeFriendInvite(alice);
      refused(await world.signIn('wtf', 'alice').call('acceptFriendInvite', { code, noticeVersion: NOTICE }), 'own_invite', 'the same person in another game');
    }),

    scenario('lifecycle: an invite from someone already a friend changes nothing and stays unused', async (world) => {
      const alice = world.signIn('cluevoyance', 'alice');
      const bob = world.signIn('wtf', 'bob');
      const carol = world.signIn('rainbow', 'carol');
      const { friendRef } = await befriend(alice, bob);
      const { code } = await makeFriendInvite(alice);
      check(must(await bob.call('acceptFriendInvite', { code, noticeVersion: NOTICE }), 'acceptFriendInvite').friendRef === friendRef, 'the same friendship should come back');
      must(await carol.call('acceptFriendInvite', { code, noticeVersion: NOTICE }), 'the invite should still be good for someone new');
    }),

    scenario('limits: groups created, 5 a day and 20 in all', async (world) => {
      const alice = world.signIn('crosspuns', 'alice');
      for (let i = 0; i < LIMITS.groupsCreatedTotal; i++) {
        if (i > 0 && i % LIMITS.groupsCreatedPerDay === 0) {
          refused(await alice.call('createGroup', { name: 'One too many', myName: 'Al', noticeVersion: NOTICE }), 'slow_down', 'the daily limit');
          world.advance(DAY_MS + 1);
        }
        await makeGroup(alice, `Club ${i}`);
      }
      world.advance(DAY_MS + 1);
      refused(await alice.call('createGroup', { name: 'One too many', myName: 'Al', noticeVersion: NOTICE }), 'too_many_created', 'the lifetime limit');
    }),

    scenario('limits: groups joined, 30 a day and 50 in all, and joining again costs nothing', async (world) => {
      const joiner = world.signIn('wtf', 'joiner');
      const codes: string[] = [];
      for (let i = 0; i <= LIMITS.groupsJoinedTotal; i++) {
        codes.push((await makeGroup(world.signIn('crosspuns', `owner${i}`), `Club ${i}`)).inviteCode);
      }

      for (let i = 0; i < LIMITS.groupsJoinedTotal; i++) {
        if (i > 0 && i % LIMITS.groupsJoinedPerDay === 0) {
          refused(await joiner.call('joinGroup', { code: codes[i], myName: 'Jo', noticeVersion: NOTICE }), 'slow_down', 'the daily limit');
          must(await joiner.call('joinGroup', { code: codes[0], myName: 'Jo', noticeVersion: NOTICE }), 'joining a group I am already in');
          world.advance(DAY_MS + 1);
        }
        await join(joiner, codes[i], 'Jo');
      }

      world.advance(DAY_MS + 1);
      refused(await joiner.call('joinGroup', { code: codes[LIMITS.groupsJoinedTotal], myName: 'Jo', noticeVersion: NOTICE }), 'too_many_groups', 'the lifetime limit');
      refused(await joiner.call('createGroup', { name: 'Mine', myName: 'Jo', noticeVersion: NOTICE }), 'too_many_groups', 'creating counts as joining');
      must(await joiner.call('joinGroup', { code: codes[0], myName: 'Jo', noticeVersion: NOTICE }), 'an existing member at the limit');
    }),

    scenario('limits: friend invites, 30 a day', async (world) => {
      const alice = world.signIn('cluevoyance', 'alice');
      for (let i = 0; i < LIMITS.friendInvitesPerDay; i++) await makeFriendInvite(alice);
      refused(await alice.call('createFriendInvite', { noticeVersion: NOTICE }), 'slow_down', 'the daily limit');
      world.advance(DAY_MS + 1);
      await makeFriendInvite(alice);
    }),

    scenario('limits: a full friends list refuses on either side and uses up nothing', async (world) => {
      const alice = world.signIn('cluevoyance', 'alice');
      const bob = world.signIn('wtf', 'bob');
      const carol = world.signIn('rainbow', 'carol');
      const dave = world.signIn('crosspuns', 'dave');
      const { friendRef } = await befriend(alice, bob);

      const carols = (await makeFriendInvite(carol)).code;
      const hers = (await makeFriendInvite(alice)).code;
      await noEffect([alice, bob, carol, dave], 'a full list', async () => {
        refused(await alice.call('acceptFriendInvite', { code: carols, noticeVersion: NOTICE }), 'too_many_friends', 'the accepter is full');
        refused(await dave.call('acceptFriendInvite', { code: hers, noticeVersion: NOTICE }), 'too_many_friends', 'the inviter is full');
      });

      must(await alice.call('removeFriend', { friendRef }), 'removeFriend');
      must(await dave.call('acceptFriendInvite', { code: hers, noticeVersion: NOTICE }), 'the invite should still work');
    }, { limits: { friends: 1 } }),

    scenario('limits: a full group refuses a new member', async (world) => {
      const owner = world.signIn('crosspuns', 'alice');
      const { inviteCode } = await makeGroup(owner);
      const bob = world.signIn('rainbow', 'bob');
      await join(bob, inviteCode);
      const carol = world.signIn('wtf', 'carol');
      await noEffect([owner, bob, carol], 'a full group', async () => {
        refused(await carol.call('joinGroup', { code: inviteCode, myName: 'Cee', noticeVersion: NOTICE }), 'group_full', 'one past the size');
      });
    }, { limits: { groupSize: 2 } }),

    scenario('lifecycle: deleting my social data erases me, hands over what I owned, and closes what only I was in', async (world) => {
      const alice = world.signIn('crosspuns', 'alice');
      const aliceElsewhere = world.signIn('rainbow', 'alice');
      const bob = world.signIn('wtf', 'bob');
      const carol = world.signIn('cluevoyance', 'carol');
      const dave = world.signIn('rainbow', 'dave');
      must(await alice.call('setDisplayName', { name: 'Alice' }), 'setDisplayName');

      const shared = await makeGroup(alice, 'Shared');
      await join(bob, shared.inviteCode);
      const alone = await makeGroup(alice, 'Alone');
      await befriend(carol, alice);
      const daveFriend = await befriend(dave, alice);
      must(await alice.call('block', { ref: daveFriend.friendRef }), 'block');
      const pending = (await makeFriendInvite(alice)).code;

      must(await aliceElsewhere.call('deleteMySocialData', {}), 'deleteMySocialData');
      check(world.hub.gameLinks(world.globalIdOf('alice')).length === 0, 'the game links should go with the person');

      const [handedOver] = await groupsOf(bob);
      check(handedOver.groupId === shared.groupId && handedOver.isOwner && handedOver.memberCount === 1, 'bob should own the shared group now');
      await join(dave, shared.inviteCode, 'Dee');
      refused(await bob.call('joinGroup', { code: alone.inviteCode, myName: 'Bee', noticeVersion: NOTICE }), 'invalid_code', 'a group only they were in');
      check((await friendsOf(carol)).length === 0, 'the friendship should be gone');
      refused(await bob.call('acceptFriendInvite', { code: pending, noticeVersion: NOTICE }), 'invalid_code', 'their open invite');

      const fresh = must(await alice.call('getMe', {}), 'getMe');
      check(fresh.displayName === null && fresh.friendCount === 0 && fresh.groupCount === 0, 'they should come back as nobody');
      check((await blocksOf(alice)).length === 0, 'their blocks should be gone');
      must(await alice.call('setDisplayName', { name: 'Alice' }), 'setDisplayName');
      await befriend(dave, alice);
    }),

    scenario('lifecycle: deleting my social data erases my friend code, my requests and my result cards', async (world) => {
      const alice = world.signIn('rainbow', 'alice');
      const bob = world.signIn('rainbow', 'bob');
      const carol = world.signIn('crosspuns', 'carol');
      const dave = world.signIn('wtf', 'dave');
      const erin = world.signIn('cluevoyance', 'erin');
      await befriend(alice, bob);
      const { groupId, inviteCode } = await makeGroup(bob);
      await join(alice, inviteCode, 'Al');
      await finish(world, 'rainbow', 'alice');
      await finish(world, 'rainbow', 'alice', OTHER_PUZZLE);
      await finish(world, 'rainbow', 'bob');
      check((await resultsOf(bob, 'rainbow')).length === 2 && (await resultsOf(bob, 'rainbow', PUZZLE, groupId)).length === 2, 'bob should see both results first');

      await sendRequest(alice, carol);
      await sendRequest(dave, alice);
      const held = await lookUp(erin, alice);
      const friendCode = await friendCodeOf(alice);
      const storedBefore = world.hub.storedResultCount();

      must(await alice.call('deleteMySocialData', {}), 'deleteMySocialData');

      // No operation reaches a deleted person's cards, so only the hub's count shows they went.
      const storedAfter = world.hub.storedResultCount();
      check(storedBefore === 3 && storedAfter === 1, `their two cards should go and only bob's should stay, got ${storedBefore} then ${storedAfter}`);
      const left = (await resultsOf(bob, 'rainbow')).concat(await resultsOf(bob, 'rainbow', PUZZLE, groupId));
      check(left.length === 2 && left.every((row) => row.isMe), 'only his own result should be left');
      check((await hasNoRequests(carol)) && (await hasNoRequests(dave)), 'their requests should be gone, in both directions');
      refused(await erin.call('findFriendByCode', { friendCode }), 'not_found', 'their friend code');
      refused(await erin.call('sendFriendRequest', { requestRef: held.requestRef, noticeVersion: NOTICE }), 'not_found', 'a lookup that found them');
      refused(await world.hub.serverFor('rainbow').recordCompletion(completion(world, 'rainbow', 'alice')), 'not_found', 'a result for someone who has gone');

      check((await friendCodeOf(alice)) !== friendCode, 'coming back should mean a new friend code');
      check((await resultsOf(alice, 'rainbow')).length === 0, 'their own result should be gone too');
    }),

    scenario('lifecycle (provisional, D13): deleting my data also erases blocks and removals other people made against me', async (world) => {
      const alice = world.signIn('crosspuns', 'alice');
      const carol = world.signIn('cluevoyance', 'carol');
      const erin = world.signIn('crosspuns', 'erin');
      const { friendRef } = await befriend(carol, alice);
      must(await carol.call('block', { ref: friendRef }), 'block');
      const erins = await makeGroup(erin, 'Erin');
      await join(alice, erins.inviteCode, 'Al');
      await removeOther(erin, erins.groupId);

      must(await alice.call('deleteMySocialData', {}), 'deleteMySocialData');

      check((await blocksOf(carol)).length === 0, "the block made against them should be gone from carol's list");
      check(must(await erin.call('listRemoved', { groupId: erins.groupId }), 'listRemoved').length === 0, "the removal should be gone from erin's list");
      must(await alice.call('setDisplayName', { name: 'Alice' }), 'setDisplayName');
      await befriend(carol, alice);
      await join(alice, erins.inviteCode, 'Al');
    }),

    scenario("lifecycle: one game's unlink drops that game's link and keeps the person's friends and groups", async (world) => {
      const alice = world.signIn('wtf', 'alice');
      const bob = world.signIn('rainbow', 'bob');
      await befriend(alice, bob);
      const { groupId } = await makeGroup(alice);
      const elsewhere = world.signIn('crosspuns', 'alice');
      await friendsOf(elsewhere);
      const id = world.globalIdOf('alice');
      const links = world.hub.gameLinks(id);
      check(links.length === 2 && links.includes('wtf') && links.includes('crosspuns'), 'first use in a game should link it');

      world.hub.unlinkGame('wtf', id);

      const left = world.hub.gameLinks(id);
      check(left.length === 1 && left[0] === 'crosspuns', "only that game's link should go");
      refused(await alice.call('getMe', {}), 'not_linked', 'the account in that game is gone');
      check((await friendsOf(elsewhere)).length === 1, 'the friendship should stay');
      check((await groupsOf(elsewhere))[0]?.groupId === groupId, 'the group should stay');
      check((await friendsOf(bob)).length === 1, 'the friend should notice nothing');
    }),

    scenario('lifecycle: names are trimmed and must fit', async (world) => {
      const alice = world.signIn('crosspuns', 'alice');
      const bob = world.signIn('rainbow', 'bob');
      const emptyish = ['', '   ', ' 　﻿'];

      for (const bad of [...emptyish, 'x'.repeat(LIMITS.groupNameMax + 1)]) {
        refused(await alice.call('createGroup', { name: bad, myName: 'Al', noticeVersion: NOTICE }), 'bad_name', `group name ${JSON.stringify(bad)}`);
      }
      for (const bad of [...emptyish, 'x'.repeat(LIMITS.nameMax + 1)]) {
        refused(await alice.call('createGroup', { name: 'Club', myName: bad, noticeVersion: NOTICE }), 'bad_my_name', `my name ${JSON.stringify(bad)}`);
        refused(await alice.call('setDisplayName', { name: bad }), 'bad_my_name', `display name ${JSON.stringify(bad)}`);
      }

      const longest = 'x'.repeat(LIMITS.groupNameMax);
      const myLongest = 'y'.repeat(LIMITS.nameMax);
      const { groupId, inviteCode } = must(await alice.call('createGroup', { name: `  ${longest}  `, myName: `  ${myLongest}  `, noticeVersion: NOTICE }), 'the longest names');
      const [row] = await groupsOf(alice);
      check(row.name === longest && row.myName === myLongest, 'names should be stored trimmed');

      refused(await bob.call('joinGroup', { code: inviteCode, myName: '  ', noticeVersion: NOTICE }), 'bad_my_name', 'joining without a name');
      refused(await alice.call('renameMeInGroup', { groupId, name: '  ' }), 'bad_my_name', 'renaming myself to nothing');
      refused(await alice.call('renameGroup', { groupId, name: '  ' }), 'bad_name', 'renaming the group to nothing');

      check(must(await alice.call('setDisplayName', { name: '  Sam  ' }), 'setDisplayName').displayName === 'Sam', 'a display name should be trimmed');
      must(await alice.call('setDisplayName', { name: '\u{1F9E9}'.repeat(LIMITS.nameMax) }), 'an emoji should count as one character');
    }),

    // -- Privacy ------------------------------------------------------------
    scenario('privacy: a full flow reaches every operation, with real rows in every list', async (world) => {
      await fullFlow(world);
      const covered = new Set<OpName>();
      const withRows = new Set<OpName>();

      for (const { op, answer } of world.answers) {
        check(answer.ok, `${op} failed during the flow`);
        covered.add(op);
        if (Array.isArray(answer.data) && answer.data.length > 0) withRows.add(op);
      }

      for (const op of ALL_OPS) check(covered.has(op), `the flow never reached ${op}`);
      for (const op of LIST_OPS) check(withRows.has(op), `the flow never saw a row from ${op}, so its fields went unchecked`);
    }),

    scenario('privacy: both kinds of preview hold exactly their own fields', async (world) => {
      const alice = world.signIn('crosspuns', 'alice');
      const friendCode = (await makeFriendInvite(alice)).code;
      const { inviteCode } = await makeGroup(alice);
      const guest = world.guest('rainbow');

      check(JSON.stringify(Object.keys(must(await guest.call('previewInvite', { code: friendCode }), 'friend preview'))) === JSON.stringify(FRIEND_PREVIEW_FIELDS), 'a friend preview should hold the inviter and their face alone');
      groupPreview(await guest.call('previewInvite', { code: inviteCode }), 'group preview');
    }),

    // -- Profiles -----------------------------------------------------------
    scenario('profiles: a new person shows as the setup default, and only approved avatars and colors are saved', async (world) => {
      const alice = world.signIn('crosspuns', 'alice', { nameless: true });
      const first = must(await alice.call('getMe', {}), 'getMe');
      check(first.displayName === null && first.animalId === 'fox' && first.backgroundColor === '#DED1F2', 'a new person should show as fox on the first color');

      const good = { displayName: 'Alice', animalId: 'otter', backgroundColor: '#CCE1F1' };
      await noEffect([alice], 'a bad profile', async () => {
        for (const displayName of ['', '   ', 'x'.repeat(LIMITS.nameMax + 1)]) refused(await alice.call('setProfile', { ...good, displayName }), 'bad_my_name', `the name ${JSON.stringify(displayName)}`);
        for (const animalId of ['dragon', 'Fox', '']) refused(await alice.call('setProfile', { ...good, animalId }), 'bad_avatar', `the avatar ${JSON.stringify(animalId)}`);
        for (const backgroundColor of ['#ded1f2', '#000000', '']) refused(await alice.call('setProfile', { ...good, backgroundColor }), 'bad_color', `the color ${JSON.stringify(backgroundColor)}`);
      });

      for (const animalId of AVATAR_IDS) must(await alice.call('setProfile', { ...good, animalId }), animalId);
      for (const backgroundColor of PROFILE_COLORS) must(await alice.call('setProfile', { ...good, backgroundColor }), backgroundColor);
      const saved = must(await alice.call('setProfile', { ...good, displayName: '  Alice  ' }), 'setProfile');
      check(JSON.stringify(saved) === JSON.stringify(good), 'the saved profile should come back, with the name trimmed');
    }),

    scenario('profiles: a chosen avatar follows the person to friends, members and other games', async (world) => {
      const alice = world.signIn('crosspuns', 'alice');
      const bob = world.signIn('rainbow', 'bob');
      must(await alice.call('setProfile', { displayName: 'Alice', animalId: 'owl', backgroundColor: '#F8E4A0' }), 'setProfile');
      await befriend(alice, bob);
      const { groupId, inviteCode } = await makeGroup(alice);
      await join(bob, inviteCode);

      const [friend] = await friendsOf(bob);
      check(friend.animalId === 'owl' && friend.backgroundColor === '#F8E4A0', 'a friend should see the avatar');
      const owner = await otherMember(bob, groupId);
      check(owner.animalId === 'owl' && owner.backgroundColor === '#F8E4A0', 'a member should see the avatar');
      const there = must(await world.signIn('wtf', 'alice').call('getMe', {}), 'getMe');
      check(there.animalId === 'owl' && there.backgroundColor === '#F8E4A0', 'another game should show the same avatar');
    }),

    scenario('profiles: everyone has one friend code from the approved letters, the same in every game and unique to them', async (world) => {
      const seen = new Set<string>();
      for (let i = 0; i < 40; i++) {
        const code = await friendCodeOf(world.signIn(ENABLED_GAMES[i % ENABLED_GAMES.length], `person${i}`));
        check(FRIEND_CODE.test(code), `a friend code should read ABC-234, got ${code}`);
        seen.add(code);
      }
      check(seen.size === 40, 'no two people should share a friend code');

      const codes = new Set<string>();
      for (const game of ENABLED_GAMES) codes.add(await friendCodeOf(world.signIn(game, 'alice')));
      check(codes.size === 1, 'one person should have one code in every game');
    }),

    // -- Friend requests ----------------------------------------------------
    scenario('requests: find, send and accept work across games, and a friendship appears only after accept', async (world) => {
      for (let i = 0; i < ENABLED_GAMES.length; i++) {
        const elsewhere = ENABLED_GAMES[(i + 2) % ENABLED_GAMES.length];
        const alice = world.signIn(ENABLED_GAMES[i], `alice${i}`);
        const bob = world.signIn(ENABLED_GAMES[(i + 1) % ENABLED_GAMES.length], `bob${i}`);
        const bothOfThem = [alice, bob, world.signIn(elsewhere, `alice${i}`), world.signIn(elsewhere, `bob${i}`)];
        const noFriends = async (label: string) => {
          for (const player of bothOfThem) check((await friendsOf(player)).length === 0, `${player.game}: nobody should be friends ${label}`);
        };

        const found = must(await alice.call('findFriendByCode', { friendCode: await friendCodeOf(bob) }), 'findFriendByCode');
        check(found.name === `bob${i}`, 'the lookup should show who it found');
        await noFriends('after a lookup');

        must(await alice.call('sendFriendRequest', { requestRef: found.requestRef, noticeVersion: NOTICE }), 'sendFriendRequest');
        await noFriends('after a send');

        const [aliceThere, bobThere] = bothOfThem.slice(2);
        check((await requestsOf(aliceThere)).outgoing[0]?.name === `bob${i}`, 'the sender should see the request in another game');
        const asked = await incomingRequest(bobThere);
        check(asked.name === `alice${i}`, 'the person asked should see who sent it, in another game');

        const accepted = must(await bobThere.call('acceptFriendRequest', { requestRef: asked.requestRef, noticeVersion: NOTICE }), 'acceptFriendRequest');
        check(accepted.name === `alice${i}`, 'accepting should say who the friend is');
        for (const player of bothOfThem) {
          const friends = await friendsOf(player);
          check(friends.length === 1 && friends[0].friendRef === accepted.friendRef, `${player.game}: the friendship should show for both`);
          check(await hasNoRequests(player), `${player.game}: the request should be gone once accepted`);
        }
      }
    }),

    scenario('requests: a code alone creates nothing, and shows who it found', async (world) => {
      const alice = world.signIn('crosspuns', 'alice');
      const bob = world.signIn('rainbow', 'bob');
      must(await bob.call('setProfile', { displayName: 'Bob', animalId: 'otter', backgroundColor: '#CCE1F1' }), 'setProfile');
      const friendCode = await friendCodeOf(bob);

      await noEffect([alice, bob], 'a lookup', async () => {
        const found = must(await alice.call('findFriendByCode', { friendCode }), 'findFriendByCode');
        check(found.name === 'Bob' && found.animalId === 'otter' && found.backgroundColor === '#CCE1F1', 'the lookup should show the name and avatar');
      });
    }),

    scenario('requests: a code reads the same in any case, with spaces or without its dash, and an unknown one is not found', async (world) => {
      const alice = world.signIn('crosspuns', 'alice');
      const bob = world.signIn('rainbow', 'bob');
      const code = await friendCodeOf(bob);
      const clean = code.replace('-', '');
      for (const typed of [code, clean, code.toLowerCase(), clean.toLowerCase(), `  ${code.slice(0, 3)} ${code.slice(4)}  `]) {
        check(must(await alice.call('findFriendByCode', { friendCode: typed }), typed).name === 'bob', `${typed} should find the same person`);
      }
      for (const typed of [NO_SUCH_FRIEND_CODE, '', 'ABC', `${clean}X`]) refused(await alice.call('findFriendByCode', { friendCode: typed }), 'not_found', typed);
    }),

    scenario('requests: a decline is silent: the sender sees no change, and finding them again says request_pending', async (world) => {
      const alice = world.signIn('crosspuns', 'alice');
      const bob = world.signIn('rainbow', 'bob');
      const { requestRef } = await sendRequest(alice, bob);
      const before = JSON.stringify(await requestsOf(alice));
      const asked = await incomingRequest(bob);

      must(await bob.call('declineFriendRequest', { requestRef: asked.requestRef }), 'declineFriendRequest');

      check((await requestsOf(bob)).incoming.length === 0, 'it should leave the list of the person who declined');
      check(JSON.stringify(await requestsOf(alice)) === before, "the sender's row should stay exactly as it was");
      refused(await alice.call('findFriendByCode', { friendCode: await friendCodeOf(bob) }), 'request_pending', 'finding them again');
      refused(await alice.call('sendFriendRequest', { requestRef, noticeVersion: NOTICE }), 'request_pending', 'sending again');
      refused(await bob.call('acceptFriendRequest', { requestRef: asked.requestRef, noticeVersion: NOTICE }), 'not_found', 'accepting after declining');
      refused(await bob.call('declineFriendRequest', { requestRef: asked.requestRef }), 'not_found', 'declining twice');
      check((await friendsOf(alice)).length === 0 && (await friendsOf(bob)).length === 0, 'nobody should be friends');
    }),

    scenario('requests: a cancel removes the request for both, and a new one can follow', async (world) => {
      const alice = world.signIn('crosspuns', 'alice');
      const bob = world.signIn('rainbow', 'bob');
      await sendRequest(alice, bob);
      const asked = await incomingRequest(bob);
      const [mine] = (await requestsOf(alice)).outgoing;

      must(await alice.call('cancelFriendRequest', { requestRef: mine.requestRef }), 'cancelFriendRequest');

      check((await hasNoRequests(alice)) && (await hasNoRequests(bob)), 'it should be gone for both');
      refused(await bob.call('acceptFriendRequest', { requestRef: asked.requestRef, noticeVersion: NOTICE }), 'not_found', 'accepting a cancelled request');
      refused(await alice.call('cancelFriendRequest', { requestRef: mine.requestRef }), 'not_found', 'cancelling twice');

      await sendRequest(alice, bob);
      must(await bob.call('declineFriendRequest', { requestRef: (await incomingRequest(bob)).requestRef }), 'declineFriendRequest');
      must(await alice.call('cancelFriendRequest', { requestRef: (await requestsOf(alice)).outgoing[0].requestRef }), 'cancelling after a decline');
      await sendRequest(bob, alice);
    }),

    scenario('requests: own_code, already_friends and request_pending, in both directions', async (world) => {
      const alice = world.signIn('crosspuns', 'alice');
      const bob = world.signIn('rainbow', 'bob');
      const hers = await friendCodeOf(alice);
      const his = await friendCodeOf(bob);

      refused(await alice.call('findFriendByCode', { friendCode: hers }), 'own_code', 'my own code');
      refused(await world.signIn('wtf', 'alice').call('findFriendByCode', { friendCode: hers.toLowerCase() }), 'own_code', 'my own code in another game');

      const stillGood = await lookUp(bob, alice);
      await sendRequest(alice, bob);
      refused(await alice.call('findFriendByCode', { friendCode: his }), 'request_pending', 'the sender finding them');
      refused(await bob.call('findFriendByCode', { friendCode: hers }), 'request_pending', 'the person asked finding the sender');
      refused(await bob.call('sendFriendRequest', { requestRef: stillGood.requestRef, noticeVersion: NOTICE }), 'request_pending', 'crossing requests');

      must(await bob.call('acceptFriendRequest', { requestRef: (await incomingRequest(bob)).requestRef, noticeVersion: NOTICE }), 'acceptFriendRequest');
      refused(await alice.call('findFriendByCode', { friendCode: his }), 'already_friends', 'one side');
      refused(await bob.call('findFriendByCode', { friendCode: hers }), 'already_friends', 'the other side');
      refused(await bob.call('sendFriendRequest', { requestRef: stillGood.requestRef, noticeVersion: NOTICE }), 'already_friends', 'a lookup from before');

      // A friendship made through a link counts, and clears any request between them.
      const carol = world.signIn('wtf', 'carol');
      await sendRequest(carol, alice);
      await befriend(alice, carol);
      check((await hasNoRequests(alice)) && (await hasNoRequests(carol)), 'a friendship should leave no request behind');
      refused(await carol.call('findFriendByCode', { friendCode: hers }), 'already_friends', 'friends through a link');
    }),

    scenario('requests: a lookup ref works only for that caller, and only for an hour', async (world) => {
      const alice = world.signIn('crosspuns', 'alice');
      const bob = world.signIn('rainbow', 'bob');
      const carol = world.signIn('wtf', 'carol');
      const dave = world.signIn('cluevoyance', 'dave');
      const toBob = await lookUp(alice, bob);
      const toDave = await lookUp(alice, dave);

      await noEffect([alice, bob, carol, dave], 'a lookup ref in the wrong hands', async () => {
        refused(await carol.call('sendFriendRequest', { requestRef: toBob.requestRef, noticeVersion: NOTICE }), 'not_found', 'someone else sending it');
        refused(await bob.call('sendFriendRequest', { requestRef: toBob.requestRef, noticeVersion: NOTICE }), 'not_found', 'the person found sending it');
        refused(await bob.call('acceptFriendRequest', { requestRef: toBob.requestRef, noticeVersion: NOTICE }), 'not_found', 'accepting a lookup');
        refused(await alice.call('sendFriendRequest', { requestRef: 'no-such-ref', noticeVersion: NOTICE }), 'not_found', 'a ref that never was');
      });

      world.advance(LIMITS.lookupRefHours * HOUR_MS);
      must(await world.signIn('wtf', 'alice').call('sendFriendRequest', { requestRef: toBob.requestRef, noticeVersion: NOTICE }), 'still good at the last moment, in any game');
      world.advance(1);
      await noEffect([alice, dave], 'an expired lookup', async () => {
        refused(await alice.call('sendFriendRequest', { requestRef: toDave.requestRef, noticeVersion: NOTICE }), 'not_found', 'an hour and a moment later');
      });
    }),

    scenario('requests: only the person asked can accept or decline, and only the sender can cancel', async (world) => {
      const alice = world.signIn('crosspuns', 'alice');
      const bob = world.signIn('rainbow', 'bob');
      const carol = world.signIn('wtf', 'carol');
      await sendRequest(alice, bob);
      const { requestRef } = await incomingRequest(bob);
      const sent = (await requestsOf(alice)).outgoing[0].requestRef;

      await noEffect([alice, bob, carol], 'the wrong person acting on a request', async () => {
        for (const ref of [requestRef, sent]) {
          refused(await carol.call('acceptFriendRequest', { requestRef: ref, noticeVersion: NOTICE }), 'not_found', 'a third person accepting');
          refused(await carol.call('declineFriendRequest', { requestRef: ref }), 'not_found', 'a third person declining');
          refused(await carol.call('cancelFriendRequest', { requestRef: ref }), 'not_found', 'a third person cancelling');
          refused(await alice.call('acceptFriendRequest', { requestRef: ref, noticeVersion: NOTICE }), 'not_found', 'the sender accepting their own');
          refused(await alice.call('declineFriendRequest', { requestRef: ref }), 'not_found', 'the sender declining their own');
          refused(await bob.call('cancelFriendRequest', { requestRef: ref }), 'not_found', 'the person asked cancelling');
        }
      });
    }),

    scenario('requests: a blocked pair gets not_found both ways, at find and at send, and a block removes requests both ways', async (world) => {
      const alice = world.signIn('crosspuns', 'alice');
      const bob = world.signIn('rainbow', 'bob');
      const hers = await friendCodeOf(alice);
      const his = await friendCodeOf(bob);
      const row = await makeGroupRef(alice, bob);
      const herLookup = await lookUp(alice, bob);
      const hisLookup = await lookUp(bob, alice);
      must(await bob.call('sendFriendRequest', { requestRef: hisLookup.requestRef, noticeVersion: NOTICE }), 'sendFriendRequest');

      const { blockRef } = must(await alice.call('block', { ref: row.memberRef }), 'block');

      check((await hasNoRequests(alice)) && (await hasNoRequests(bob)), 'a request to the blocker should be gone for both');
      const nobody = JSON.stringify(await bob.call('findFriendByCode', { friendCode: NO_SUCH_FRIEND_CODE }));
      const sides: [MockPlayer, string, string][] = [
        [alice, his, herLookup.requestRef],
        [bob, hers, hisLookup.requestRef],
      ];
      await noEffect([alice, bob], 'a blocked pair', async () => {
        for (const [caller, friendCode, requestRef] of sides) {
          const found = await caller.call('findFriendByCode', { friendCode });
          refused(found, 'not_found', 'finding across a block');
          check(JSON.stringify(found) === nobody, 'a block should look exactly like a code nobody holds');
          refused(await caller.call('sendFriendRequest', { requestRef, noticeVersion: NOTICE }), 'not_found', 'sending across a block');
        }
      });

      must(await alice.call('unblock', { blockRef }), 'unblock');
      await lookUp(bob, alice);

      // The other direction: the blocker's own request goes too.
      const carol = world.signIn('wtf', 'carol');
      const dave = world.signIn('cluevoyance', 'dave');
      const daveRow = await makeGroupRef(carol, dave);
      await sendRequest(carol, dave);
      must(await carol.call('block', { ref: daveRow.memberRef }), 'block');
      check((await hasNoRequests(carol)) && (await hasNoRequests(dave)), "the blocker's own request should be gone for both");
    }),

    scenario('requests: lookups share 30 a day across games, and a code nobody holds counts too', async (world) => {
      const alice = ENABLED_GAMES.map((game) => world.signIn(game, 'alice'));
      const friendCode = await friendCodeOf(world.signIn('rainbow', 'bob'));
      const { requestRef } = must(await alice[0].call('findFriendByCode', { friendCode }), 'the first lookup');
      for (let i = 1; i < LIMITS.friendLookupsPerDay; i++) {
        const answer = await alice[i % alice.length].call('findFriendByCode', { friendCode: i % 2 === 0 ? friendCode : NO_SUCH_FRIEND_CODE });
        check(answer.ok === true || answer.outcome === 'not_found', `lookup ${i} should still be allowed`);
      }

      for (const player of alice) {
        refused(await player.call('findFriendByCode', { friendCode }), 'slow_down', `${player.game}: looking up`);
        refused(await player.call('sendFriendRequest', { requestRef, noticeVersion: NOTICE }), 'slow_down', `${player.game}: sending`);
      }

      world.advance(DAY_MS + 1);
      must(await alice[1].call('findFriendByCode', { friendCode }), 'a day later');
    }),

    scenario('requests: a send spends the same allowance as a lookup', async (world) => {
      const alice = world.signIn('crosspuns', 'alice');
      const bob = world.signIn('rainbow', 'bob');
      const friendCode = await friendCodeOf(bob);
      await sendRequest(alice, bob);
      refused(await alice.call('findFriendByCode', { friendCode }), 'request_pending', 'the third attempt of the day');
      refused(await alice.call('findFriendByCode', { friendCode }), 'slow_down', 'the fourth');
    }, { limits: { friendLookupsPerDay: 3 } }),

    scenario('requests: a full friends list refuses on either side, and the request stays', async (world) => {
      const alice = world.signIn('crosspuns', 'alice');
      const bob = world.signIn('rainbow', 'bob');
      const carol = world.signIn('wtf', 'carol');
      const dave = world.signIn('cluevoyance', 'dave');
      const { friendRef } = await befriend(alice, bob);
      await sendRequest(carol, alice);
      await sendRequest(alice, dave);
      const toAlice = await incomingRequest(alice);
      const toDave = await incomingRequest(dave);

      await noEffect([alice, bob, carol, dave], 'a full list', async () => {
        refused(await alice.call('acceptFriendRequest', { requestRef: toAlice.requestRef, noticeVersion: NOTICE }), 'too_many_friends', 'the person asked is full');
        refused(await dave.call('acceptFriendRequest', { requestRef: toDave.requestRef, noticeVersion: NOTICE }), 'too_many_friends', 'the sender is full');
      });

      must(await alice.call('removeFriend', { friendRef }), 'removeFriend');
      must(await dave.call('acceptFriendRequest', { requestRef: toDave.requestRef, noticeVersion: NOTICE }), 'the request should still work');
    }, { limits: { friends: 1 } }),

    scenario('names: every Friends and Groups write needs a display name, and reading, declining and deleting do not', async (world) => {
      for (let i = 0; i < ENABLED_GAMES.length; i++) {
        const game = ENABLED_GAMES[i];
        const owner = world.signIn(game, `owner${i}`);
        const nameless = world.signIn(game, `nora${i}`, { nameless: true });
        const { inviteCode } = await makeGroup(owner);
        const { code } = await makeFriendInvite(owner);
        const friendCode = await friendCodeOf(owner);

        await noEffect([owner, nameless], `${game}: no name yet`, async () => {
          const attempts: [string, Result<unknown>][] = [
            ['createFriendInvite', await nameless.call('createFriendInvite', { noticeVersion: NOTICE })],
            ['acceptFriendInvite', await nameless.call('acceptFriendInvite', { code, noticeVersion: NOTICE })],
            ['findFriendByCode', await nameless.call('findFriendByCode', { friendCode })],
            ['sendFriendRequest', await nameless.call('sendFriendRequest', SAMPLE_ARGS.sendFriendRequest)],
            ['acceptFriendRequest', await nameless.call('acceptFriendRequest', SAMPLE_ARGS.acceptFriendRequest)],
            ['createGroup', await nameless.call('createGroup', { name: 'Club', myName: 'Nora', noticeVersion: NOTICE })],
            ['joinGroup', await nameless.call('joinGroup', { code: inviteCode, myName: 'Nora', noticeVersion: NOTICE })],
          ];
          for (const [op, answer] of attempts) refused(answer, 'needs_display_name', `${game}: ${op}`);
        });

        check((await sendRequest(owner, nameless)).name === null, 'someone with no name should show as null');
        const asked = await incomingRequest(nameless);
        refused(await nameless.call('acceptFriendRequest', { requestRef: asked.requestRef, noticeVersion: NOTICE }), 'needs_display_name', `${game}: accepting with no name`);
        must(await nameless.call('declineFriendRequest', { requestRef: asked.requestRef }), `${game}: declining with no name`);
        groupPreview(await nameless.call('previewInvite', { code: inviteCode }), `${game}: previewing with no name`);
        must(await nameless.call('deleteMySocialData', {}), `${game}: deleting with no name`);
      }
    }),

    // -- The notice ---------------------------------------------------------
    scenario('notice: joining, accepting and sending refuse a missing, stale or future version, and nothing happens', async (world) => {
      for (let i = 0; i < ENABLED_GAMES.length; i++) {
        const game = ENABLED_GAMES[i];
        const owner = world.signIn(game, `owner${i}`);
        const joiner = world.signIn(game, `joiner${i}`);
        const third = world.signIn(game, `third${i}`);
        const { inviteCode } = await makeGroup(owner);
        const { code } = await makeFriendInvite(owner);
        await sendRequest(owner, joiner);
        const asked = await incomingRequest(joiner);
        const { requestRef } = await lookUp(joiner, third);

        for (const sent of WRONG_NOTICES) {
          await noEffect([owner, joiner, third], `${game}: notice ${JSON.stringify(sent)}`, async () => {
            refused(await joiner.call('joinGroup', { code: inviteCode, myName: 'Jo', ...sent }), 'notice_required', 'joinGroup');
            refused(await joiner.call('acceptFriendInvite', { code, ...sent }), 'notice_required', 'acceptFriendInvite');
            refused(await joiner.call('sendFriendRequest', { requestRef, ...sent }), 'notice_required', 'sendFriendRequest');
            refused(await joiner.call('acceptFriendRequest', { requestRef: asked.requestRef, ...sent }), 'notice_required', 'acceptFriendRequest');
          });
        }

        await join(joiner, inviteCode, 'Jo');
        refused(await joiner.call('joinGroup', { code: inviteCode, myName: 'Jo', noticeVersion: NOTICE + 1 }), 'notice_required', `${game}: a member joining again`);
        must(await joiner.call('acceptFriendRequest', { requestRef: asked.requestRef, noticeVersion: NOTICE }), 'acceptFriendRequest');
        must(await joiner.call('acceptFriendInvite', { code, noticeVersion: NOTICE }), 'acceptFriendInvite');
        must(await joiner.call('sendFriendRequest', { requestRef, noticeVersion: NOTICE }), 'sendFriendRequest');
      }
    }),

    // No operation lists friend invites, so the one a day still being there is what shows none was made.
    scenario('notice: making a friend link refuses a missing, stale or future version, and nothing is made', async (world) => {
      for (let i = 0; i < ENABLED_GAMES.length; i++) {
        const game = ENABLED_GAMES[i];
        const maker = world.signIn(game, `maker${i}`);
        const nameless = world.signIn(game, `nora${i}`, { nameless: true });

        for (const sent of WRONG_NOTICES) {
          refused(await nameless.call('createFriendInvite', sent), 'needs_display_name', `${game}: the name comes first`);
          await noEffect([maker], `${game}: notice ${JSON.stringify(sent)}`, async () => {
            refused(await maker.call('createFriendInvite', sent), 'notice_required', 'createFriendInvite');
          });
        }

        await makeFriendInvite(maker);
        refused(await maker.call('createFriendInvite', { noticeVersion: NOTICE }), 'slow_down', `${game}: the day's one invite`);
      }
    }, { limits: { friendInvitesPerDay: 1 } }),

    scenario('notice: making a group refuses a missing, stale or future version, and nothing is made', async (world) => {
      for (let i = 0; i < ENABLED_GAMES.length; i++) {
        const game = ENABLED_GAMES[i];
        const maker = world.signIn(game, `maker${i}`);
        const nameless = world.signIn(game, `nora${i}`, { nameless: true });

        for (const sent of WRONG_NOTICES) {
          refused(await nameless.call('createGroup', { name: 'Club', myName: 'Nora', ...sent }), 'needs_display_name', `${game}: the name comes first`);
          await noEffect([maker], `${game}: notice ${JSON.stringify(sent)}`, async () => {
            refused(await maker.call('createGroup', { name: 'Club', myName: 'Al', ...sent }), 'notice_required', 'createGroup');
            refused(await maker.call('createGroup', { name: '  ', myName: 'Al', ...sent }), 'notice_required', 'before the group name');
          });
        }

        check((await groupsOf(maker)).length === 0, `${game}: no group should have been made`);
        await makeGroup(maker);
        check((await groupsOf(maker)).length === 1, `${game}: the notice shown should make the group`);
        refused(await maker.call('createGroup', { name: 'Club', myName: 'Al', noticeVersion: NOTICE }), 'slow_down', `${game}: the day's one group`);
      }
    }, { limits: { groupsCreatedPerDay: 1 } }),

    // -- Group invitations --------------------------------------------------
    scenario("joining: an invitation shows up to three faces, owner first, the owner's name in this group and the count, to guest and stranger alike", async (world) => {
      const owner = world.signIn('crosspuns', 'alice');
      must(await owner.call('setProfile', { displayName: 'Alice', animalId: 'bear', backgroundColor: '#F1CDDA' }), 'setProfile');
      const { groupId, inviteCode } = await makeGroup(owner, 'Club', 'Al');
      const joiners: [string, GameId, string, string][] = [
        ['bob', 'rainbow', 'owl', '#CCE6CA'],
        ['carol', 'wtf', 'otter', '#F8E4A0'],
        ['dave', 'cluevoyance', 'panda', '#CCE1F1'],
        ['erin', 'crosspuns', 'lion', '#F8D0BD'],
      ];
      for (const [person, game, animalId, backgroundColor] of joiners) {
        const player = world.signIn(game, person);
        must(await player.call('setProfile', { displayName: person, animalId, backgroundColor }), 'setProfile');
        world.advance(1000);
        await join(player, inviteCode, person);
      }

      const expected = JSON.stringify({
        faces: [
          { animalId: 'bear', backgroundColor: '#F1CDDA' },
          { animalId: 'owl', backgroundColor: '#CCE6CA' },
          { animalId: 'otter', backgroundColor: '#F8E4A0' },
        ],
        leadName: 'Al',
        memberCount: 5,
      });
      const viewers = [world.guest('rainbow'), world.guest('crosspuns'), world.signIn('wtf', 'stranger')];
      const seen: string[] = [];
      for (const viewer of viewers) {
        const preview = groupPreview(await viewer.call('previewInvite', { code: inviteCode }), `${viewer.game} preview`);
        check(JSON.stringify(preview.memberPreview) === expected, `${viewer.game}: the wrong memberPreview: ${JSON.stringify(preview.memberPreview)}`);
        check(!preview.isMember && !preview.isRemoved, `${viewer.game}: the flags should be false`);
        seen.push(JSON.stringify(preview));
      }
      check(new Set(seen).size === 1, 'a guest and a signed-in stranger should see the same thing');

      // Nothing about play reaches an invitation.
      await finish(world, 'crosspuns', 'alice');
      await finish(world, 'rainbow', 'bob');
      check(JSON.stringify(groupPreview(await viewers[0].call('previewInvite', { code: inviteCode }), 'after results')) === seen[0], 'a result should change nothing on an invitation');

      must(await owner.call('leaveGroup', { groupId }), 'leaveGroup');
      const after = groupPreview(await viewers[0].call('previewInvite', { code: inviteCode }), 'after the owner left').memberPreview;
      check(after?.leadName === 'bob' && after.faces[0].animalId === 'owl' && after.memberCount === 4, 'the new owner should lead the invitation');
    }),

    scenario('joining: a member and a removed person get no memberPreview, and a guest still does', async (world) => {
      const owner = world.signIn('crosspuns', 'alice');
      const member = world.signIn('rainbow', 'bob');
      const removed = world.signIn('wtf', 'carol');
      const { groupId, inviteCode } = await makeGroup(owner);
      await join(member, inviteCode, 'Bee');
      await join(removed, inviteCode, 'Cee');
      const row = (await membersOf(owner, groupId)).find((m) => m.name === 'Cee');
      check(row, 'carol should be listed');
      must(await owner.call('removeMember', { groupId, memberRef: row.memberRef }), 'removeMember');

      for (const player of [owner, member]) {
        const preview = groupPreview(await player.call('previewInvite', { code: inviteCode }), `${player.game} member preview`);
        check(preview.isMember && preview.memberPreview === null, `${player.game}: a member should get no memberPreview`);
      }
      const theirs = groupPreview(await removed.call('previewInvite', { code: inviteCode }), 'removed preview');
      check(theirs.isRemoved && !theirs.isMember && theirs.memberPreview === null, 'a removed person should get no memberPreview');

      const guest = groupPreview(await world.guest('wtf').call('previewInvite', { code: inviteCode }), 'guest preview');
      check(guest.memberPreview?.memberCount === 2, 'a guest should still see the count');
    }),

    scenario('joining: an unknown or replaced code shows no one', async (world) => {
      const owner = world.signIn('crosspuns', 'alice');
      const stranger = world.signIn('wtf', 'bob');
      const { groupId, inviteCode } = await makeGroup(owner);
      const fresh = must(await owner.call('replaceInvite', { groupId }), 'replaceInvite').inviteCode;

      for (const viewer of [world.guest('rainbow'), stranger]) {
        refused(await viewer.call('previewInvite', { code: inviteCode }), 'invalid_code', `${viewer.game}: the replaced code`);
        refused(await viewer.call('previewInvite', { code: 'no-such-code' }), 'invalid_code', `${viewer.game}: an unknown code`);
        check(groupPreview(await viewer.call('previewInvite', { code: fresh }), 'the new code').memberPreview?.memberCount === 1, `${viewer.game}: the new code should work`);
      }
    }),

    // -- Group appearance ---------------------------------------------------
    scenario('appearance: a new group starts on the campfire, and only its owner can change the look', async (world) => {
      const owner = world.signIn('crosspuns', 'alice');
      const member = world.signIn('rainbow', 'bob');
      const stranger = world.signIn('wtf', 'carol');
      const { groupId, inviteCode } = await makeGroup(owner);
      await join(member, inviteCode);

      const [row] = await groupsOf(owner);
      check(row.emblemId === 'campfire' && row.accentColor === '#DED1F2' && row.photo === null && row.photoVersion === 0, 'a new group should have the default look');

      const look = { groupId, emblemId: 'moon', photo: null, accentColor: '#CCE6CA' };
      await noEffect([owner, member, stranger], 'someone else changing the look', async () => {
        refused(await member.call('setGroupAppearance', look), 'not_the_creator', 'a member');
        refused(await stranger.call('setGroupAppearance', look), 'not_a_member', 'a stranger');
        refused(await owner.call('setGroupAppearance', { ...look, groupId: 'no-such-group' }), 'not_a_member', 'no such group');
      });
    }),

    scenario('appearance: every bad look has its own outcome and changes nothing', async (world) => {
      const owner = world.signIn('crosspuns', 'alice');
      const { groupId } = await makeGroup(owner);
      const edge = LIMITS.photoEdge;
      const look = { groupId, emblemId: 'moon', photo: null, accentColor: '#CCE6CA' };
      const textBytes = [...'<svg onload=alert(1)>'].map((letter) => letter.charCodeAt(0));
      const notPictures = [
        '',
        'a picture',
        toBase64(jpegBytes(edge, edge)),
        `data:image/png;base64,${toBase64(jpegBytes(edge, edge))}`,
        PHOTO_PREFIX,
        `${PHOTO_PREFIX}@@@not base64@@@`,
        photoFrom([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        photoFrom(textBytes),
        photoFrom([0xff, 0xd8, 0xff, 0xd9]),
      ];

      await noEffect([owner], 'a bad look', async () => {
        for (const emblemId of ['dragon', 'Moon', '']) refused(await owner.call('setGroupAppearance', { ...look, emblemId }), 'bad_emblem', `the emblem ${JSON.stringify(emblemId)}`);
        for (const accentColor of ['#cce6ca', 'red', '']) refused(await owner.call('setGroupAppearance', { ...look, accentColor }), 'bad_color', `the color ${JSON.stringify(accentColor)}`);
        for (const photo of notPictures) refused(await owner.call('setGroupAppearance', { ...look, photo }), 'not_a_picture', `the picture ${photo.slice(0, 40)}`);
        for (const [width, height] of [[edge - 1, edge], [edge, edge - 1], [4000, 4000]]) {
          refused(await owner.call('setGroupAppearance', { ...look, photo: photoFrom(jpegBytes(width, height)) }), 'wrong_size', `${width}x${height}`);
        }
        refused(await owner.call('setGroupAppearance', { ...look, photo: photoFrom(jpegBytes(edge, edge, LIMITS.photoBytes)) }), 'too_big', 'a picture over the limit');
        refused(await owner.call('setGroupAppearance', { ...look, photo: `${PHOTO_PREFIX}${'A'.repeat(90000)}` }), 'too_big', 'a huge upload');
      });
    }),

    scenario('appearance: a valid JPEG reaches members in every game and anyone with the link, and photoVersion moves only when the picture changes', async (world) => {
      const owner = world.signIn('crosspuns', 'alice');
      const member = world.signIn('rainbow', 'bob');
      const { groupId, inviteCode } = await makeGroup(owner);
      await join(member, inviteCode);

      const edge = LIMITS.photoEdge;
      const padding = LIMITS.photoBytes - (jpegBytes(edge, edge, 1).length - 1);
      const largest = photoFrom(jpegBytes(edge, edge, padding));
      const small = photoFrom(jpegBytes(edge, edge, 1000));
      const set = async (emblemId: string, photo: string | null, accentColor: string) => must(await owner.call('setGroupAppearance', { groupId, emblemId, photo, accentColor }), 'setGroupAppearance').photoVersion;

      refused(await owner.call('setGroupAppearance', { groupId, emblemId: 'moon', photo: photoFrom(jpegBytes(edge, edge, padding + 1)), accentColor: '#CCE6CA' }), 'too_big', 'one byte over');
      check((await set('moon', largest, '#CCE6CA')) === 1, 'the largest allowed picture should save, and bump the version');
      check((await set('moon', largest, '#CCE6CA')) === 1, 'the same picture again is no change');
      check((await set('cabin', largest, '#F8E4A0')) === 1, 'a new emblem and color are no change to the picture');
      check((await set('cabin', small, '#F8E4A0')) === 2, 'a new picture should bump the version');
      check((await set('cabin', null, '#F8E4A0')) === 3, 'clearing the picture should bump the version');
      check((await set('cabin', null, '#F8E4A0')) === 3, 'clearing it twice is no change');
      check((await set('book', small, '#F8D0BD')) === 4, 'a picture coming back should bump the version');

      for (const player of [owner, member, world.signIn('wtf', 'bob')]) {
        const [row] = await groupsOf(player);
        check(row.emblemId === 'book' && row.accentColor === '#F8D0BD' && row.photo === small && row.photoVersion === 4, `${player.game} should show the new look`);
      }
      const guest = groupPreview(await world.guest('wtf').call('previewInvite', { code: inviteCode }), 'guest preview');
      check(guest.emblemId === 'book' && guest.accentColor === '#F8D0BD' && guest.photo === small, 'anyone with the link should see the look');
    }),

    // -- Results ------------------------------------------------------------
    scenario('results: no browser token can record a result, in any game, and nothing is stored', async (world) => {
      const recording = 'recordCompletion' as OpName;
      const alice = world.signIn('rainbow', 'alice');
      const input = completion(world, 'rainbow', 'alice') as unknown as Record<string, never>;

      for (const game of ENABLED_GAMES) {
        const transport = world.hub.transportFor(game);
        refused(await transport.call(recording, input, world.signIn(game, 'alice').credential()), 'unavailable', `${game}: the player's own token`);
        refused(await transport.call(recording, input, null), 'unavailable', `${game}: no token`);
      }
      for (const game of DISABLED_GAMES) refused(await world.hub.transportFor(game).call(recording, input, null), 'game_disabled', `${game}: a disabled game`);
      check((await resultsOf(alice, 'rainbow')).length === 0, 'nothing should have been stored');
    }),

    scenario('results: a result that does not fit its game is refused and stores nothing', async (world) => {
      for (const game of ENABLED_GAMES) world.signIn(game, 'alice');
      const viewer = world.signIn('rainbow', 'alice');
      const rainbow = completion(world, 'rainbow', 'alice');
      const crosspuns = completion(world, 'crosspuns', 'alice');
      const wtf = completion(world, 'wtf', 'alice');
      const noDetail: Record<string, unknown> = { ...rainbow };
      delete noDetail.detail;

      const spoiled: [GameId, unknown][] = [
        ['rainbow', null],
        ['rainbow', 'a result'],
        ['rainbow', noDetail],
        ['rainbow', { ...rainbow, note: 'free text' }],
        ['rainbow', { ...rainbow, gameId: 'crosspuns' }],
        ['rainbow', { ...rainbow, puzzleId: '' }],
        ['rainbow', { ...rainbow, puzzleId: 'x'.repeat(LIMITS.puzzleIdMax + 1) }],
        ['rainbow', { ...rainbow, puzzleId: 'has a space' }],
        ['rainbow', { ...rainbow, globalUserId: 7 }],
        ['rainbow', { ...rainbow, completedAt: 'today' }],
        ['rainbow', { ...rainbow, completedAt: '2025-01-01T00:00:00Z' }],
        ['rainbow', { ...rainbow, completedAt: '2025-02-31T00:00:00.000Z' }],
        ['rainbow', { ...rainbow, completedAt: new Date(world.now() + 1).toISOString() }],
        ['rainbow', { ...rainbow, summary: null }],
        ['rainbow', { ...rainbow, summary: { solved: true } }],
        ['rainbow', { ...rainbow, summary: { solved: true, mistakes: 1, note: 'free text' } }],
        ['rainbow', { ...rainbow, summary: { solved: 'yes', mistakes: 1 } }],
        ['rainbow', { ...rainbow, summary: { solved: true, mistakes: -1 } }],
        ['rainbow', { ...rainbow, summary: { solved: true, mistakes: 1.5 } }],
        ['rainbow', { ...rainbow, summary: { solved: true, mistakes: '1' } }],
        ['rainbow', { ...rainbow, detail: null }],
        ['rainbow', { ...rainbow, detail: '' }],
        ['rainbow', { ...rainbow, detail: [true] }],
        ['rainbow', { ...rainbow, detail: 'x'.repeat(LIMITS.resultDetailMax + 1) }],
        ['crosspuns', { ...crosspuns, summary: { seconds: 'fast' } }],
        ['crosspuns', { ...crosspuns, summary: { score: 7 } }],
        ['crosspuns', { ...crosspuns, detail: 'a grid' }],
        ['wtf', { ...wtf, detail: null }],
        ['wtf', { ...wtf, detail: [] }],
        ['wtf', { ...wtf, detail: ['yes'] }],
        ['wtf', { ...wtf, detail: 'a grid' }],
        ['cluevoyance', { ...rainbow, gameId: 'cluevoyance' }],
        ['cluevoyance', { ...wtf, gameId: 'cluevoyance' }],
      ];
      for (const [game, input] of spoiled) refused(await world.hub.serverFor(game).recordCompletion(input as CompletionInput), 'bad_result', `${game}: ${JSON.stringify(input).slice(0, 120)}`);
      check((await resultsOf(viewer, 'rainbow')).length === 0, 'nothing should have been stored');

      const route = world.hub.serverFor('rainbow');
      for (const puzzleId of ['x', 'Daily:a_b-9', 'x'.repeat(LIMITS.puzzleIdMax)]) must(await route.recordCompletion({ ...rainbow, puzzleId }), `the puzzle id ${puzzleId}`);
      must(await route.recordCompletion({ ...rainbow, puzzleId: 'longest', detail: 'x'.repeat(LIMITS.resultDetailMax) }), 'the longest grid');
    }),

    scenario('results: a disabled game answers game_disabled, and a result needs a known person with an account in that game', async (world) => {
      const alice = world.signIn('rainbow', 'alice');
      for (const game of DISABLED_GAMES) {
        refused(await world.hub.serverFor(game).recordCompletion({ ...completion(world, 'crosspuns', 'alice'), gameId: game }), 'game_disabled', `${game}: a disabled game`);
      }
      refused(await world.hub.serverFor('rainbow').recordCompletion({ ...completion(world, 'rainbow', 'alice'), globalUserId: 'user_nobody000000' }), 'not_found', 'an unknown person');
      refused(await world.hub.serverFor('crosspuns').recordCompletion(completion(world, 'crosspuns', 'alice')), 'not_found', 'no account in that game');
      check((await resultsOf(alice, 'crosspuns')).length === 0, 'nothing should have been stored');
    }),

    scenario('results: the first result for a game, puzzle and person wins, and a replay changes nothing', async (world) => {
      const alice = world.signIn('rainbow', 'alice');
      const bob = world.signIn('rainbow', 'bob');
      await befriend(alice, bob);
      await finish(world, 'rainbow', 'alice');
      await finish(world, 'rainbow', 'bob');
      const before = JSON.stringify(await resultsOf(bob, 'rainbow'));

      world.advance(1000);
      const replay = { ...completion(world, 'rainbow', 'alice'), summary: { solved: false, mistakes: 4 }, detail: 'RRRR' };
      must(await world.hub.serverFor('rainbow').recordCompletion(replay), 'a replay');
      check(JSON.stringify(await resultsOf(bob, 'rainbow')) === before, 'a replay should not overwrite the first result');

      must(await world.hub.serverFor('rainbow').recordCompletion({ ...replay, puzzleId: OTHER_PUZZLE }), 'another puzzle');
      check(JSON.stringify(resultNamed(await resultsOf(alice, 'rainbow', OTHER_PUZZLE), 'alice').summary) === JSON.stringify(replay.summary), 'another puzzle is another result');
    }),

    scenario('results: detail is left out until the viewer finishes the same game and puzzle', async (world) => {
      const games: [ResultGame, ResultGame][] = [
        ['rainbow', 'wtf'],
        ['wtf', 'rainbow'],
      ];
      for (const [game, other] of games) {
        const first = `first${game}`;
        const second = `second${game}`;
        const player = world.signIn(game, first);
        const viewer = world.signIn(game, second);
        world.signIn(other, second);
        await befriend(player, viewer);
        const { groupId, inviteCode } = await makeGroup(player, 'Club', first);
        await join(viewer, inviteCode, second);
        world.advance(1000);
        await finish(world, game, first);

        const bothAudiences = async () => [await resultsOf(viewer, game), await resultsOf(viewer, game, PUZZLE, groupId)];
        const stillLocked = async (label: string) => {
          for (const rows of await bothAudiences()) {
            check(rows.length === 1, `${game}: ${label}: only the other player should have a row`);
            checkLocked(resultNamed(rows, first), `${game}: ${label}`);
          }
        };

        await stillLocked('nothing finished');
        await finish(world, game, second, OTHER_PUZZLE);
        await stillLocked('a different puzzle finished');
        await finish(world, other, second);
        await stillLocked('the same puzzle id finished in another game');

        await finish(world, game, second);
        for (const rows of await bothAudiences()) {
          checkUnlocked(resultNamed(rows, first), game, `${game}: the same puzzle finished`);
          checkUnlocked(resultNamed(rows, second), game, `${game}: my own row`);
        }
      }
    }),

    scenario('results: a viewer with no account in that game sees the summary, with the detail locked', async (world) => {
      const player = world.signIn('rainbow', 'alice');
      const { groupId, inviteCode } = await makeGroup(player, 'Club', 'Al');
      const viewers = ENABLED_GAMES.filter((game) => game !== 'rainbow').map((game) => world.signIn(game, `viewer${game}`));
      for (const viewer of viewers) {
        await befriend(player, viewer);
        await join(viewer, inviteCode, 'Vee');
      }
      world.advance(1000);
      await finish(world, 'rainbow', 'alice');

      for (const viewer of viewers) {
        const rows = [resultNamed(await resultsOf(viewer, 'rainbow'), 'alice'), resultNamed(await resultsOf(viewer, 'rainbow', PUZZLE, groupId), 'Al')];
        for (const row of rows) {
          checkLocked(row, `${viewer.game}: a game with no account`);
          check(JSON.stringify(row.summary) === JSON.stringify(SAMPLE_RESULTS.rainbow.summary), `${viewer.game}: the summary should show`);
        }
      }
    }),

    scenario('results: my own row always comes with its detail, and someone who has not played has no row', async (world) => {
      const alice = world.signIn('rainbow', 'alice');
      const bob = world.signIn('crosspuns', 'bob');
      const { friendRef } = await befriend(alice, bob);
      const { groupId, inviteCode } = await makeGroup(alice, 'Club', 'Al');
      await join(bob, inviteCode, 'Bee');
      check((await resultsOf(alice, 'rainbow')).length === 0, 'nobody has played yet');

      await finish(world, 'rainbow', 'alice');
      const [mine] = await resultsOf(alice, 'rainbow');
      check(mine.isMe && 'friendRef' in mine && mine.friendRef === null, 'in a friends list my own row has a null friendRef');
      checkUnlocked(mine, 'rainbow', 'my own row among friends');

      const [inGroup] = await resultsOf(alice, 'rainbow', PUZZLE, groupId);
      const me = (await membersOf(alice, groupId)).find((m) => m.isMe);
      check(inGroup.isMe && 'memberRef' in inGroup && inGroup.memberRef === me?.memberRef && inGroup.name === 'Al', 'in a group my row has my memberRef and my name there');
      checkUnlocked(inGroup, 'rainbow', 'my own row in a group');

      const [seen] = await resultsOf(bob, 'rainbow');
      check(!seen.isMe && 'friendRef' in seen && seen.friendRef === friendRef, 'a friend should get the friendRef to join on');
    }),

    scenario('results: a result with no detail says so to everyone, with nothing locked', async (world) => {
      const alice = world.signIn('crosspuns', 'alice');
      const bob = world.signIn('rainbow', 'bob');
      await befriend(alice, bob);
      await finish(world, 'crosspuns', 'alice');
      for (const viewer of [alice, bob]) {
        const row = resultNamed(await resultsOf(viewer, 'crosspuns'), 'alice');
        check('detail' in row && row.detail === null && row.detailLocked === false, `${viewer.game}: no detail should read as null, not locked`);
      }
    }),

    scenario('results: a stranger gets nothing, and a group they are not in looks like one that does not exist', async (world) => {
      const alice = world.signIn('rainbow', 'alice');
      const stranger = world.signIn('crosspuns', 'bob');
      const { groupId } = await makeGroup(alice);
      await finish(world, 'rainbow', 'alice');

      check((await resultsOf(stranger, 'rainbow')).length === 0, 'a stranger should get no rows');
      const real = await stranger.call('listResults', { gameId: 'rainbow', puzzleId: PUZZLE, groupId });
      const missing = await stranger.call('listResults', { gameId: 'rainbow', puzzleId: PUZZLE, groupId: 'no-such-group' });
      refused(real, 'not_a_member', 'a group the caller is not in');
      check(JSON.stringify(real) === JSON.stringify(missing), 'the two answers should be identical');

      // Straight at the hub: an identity in the args buys nothing.
      const sneaky = { gameId: 'rainbow', puzzleId: PUZZLE, globalUserId: world.globalIdOf('alice'), friendRef: 'no-such-ref' } as Operations['listResults']['args'];
      check(must(await world.hub.transportFor('crosspuns').call('listResults', sneaky, stranger.credential()), 'listResults').length === 0, 'the audience should come from the token alone');
    }),

    scenario('results: forward-only: a friend sees only what was completed at or after the friendship began', async (world) => {
      const alice = world.signIn('rainbow', 'alice');
      const bob = world.signIn('crosspuns', 'bob');
      await finish(world, 'rainbow', 'alice', 'before');
      world.advance(1000);
      const { friendRef } = await befriend(alice, bob);
      await finish(world, 'rainbow', 'alice', 'same-moment');
      world.advance(1);
      await finish(world, 'rainbow', 'alice', 'after');

      check((await resultsOf(bob, 'rainbow', 'before')).length === 0, 'a result from before should not show');
      check((await resultsOf(bob, 'rainbow', 'same-moment')).length === 1, 'a result from the same moment should show');
      check((await resultsOf(bob, 'rainbow', 'after')).length === 1, 'a result from after should show');
      check((await resultsOf(alice, 'rainbow', 'before'))[0]?.isMe === true, 'my own result is mine whatever its date');

      must(await bob.call('removeFriend', { friendRef }), 'removeFriend');
      world.advance(1000);
      await befriend(bob, alice);
      check((await resultsOf(bob, 'rainbow', 'after')).length === 0, 'a new friendship should start from its own moment');
    }),

    scenario('results: forward-only: in a group, from the later of the two people joining', async (world) => {
      const alice = world.signIn('rainbow', 'alice');
      const bob = world.signIn('rainbow', 'bob');
      const carol = world.signIn('crosspuns', 'carol');
      const { groupId, inviteCode } = await makeGroup(alice, 'Club', 'Al');
      world.advance(1000);
      await finish(world, 'rainbow', 'alice', 'before-bob');
      world.advance(1000);
      await join(bob, inviteCode, 'Bee');
      world.advance(1000);
      await finish(world, 'rainbow', 'alice', 'between');
      await finish(world, 'rainbow', 'bob', 'between');
      world.advance(1000);
      await join(carol, inviteCode, 'Cee');
      world.advance(1000);
      await finish(world, 'rainbow', 'alice', 'after');
      await finish(world, 'rainbow', 'bob', 'after');

      check((await resultsOf(bob, 'rainbow', 'before-bob', groupId)).length === 0, 'a result from before they joined should not show');
      check((await resultsOf(bob, 'rainbow', 'between', groupId)).length === 2, 'both should see each other once both were in');
      check((await resultsOf(alice, 'rainbow', 'between', groupId)).length === 2, 'the earlier member should see it too');
      check((await resultsOf(carol, 'rainbow', 'between', groupId)).length === 0, 'someone who joined later should not see the past');
      check((await resultsOf(carol, 'rainbow', 'after', groupId)).length === 2, 'someone who joined later should see what came after');
      check((await resultsOf(alice, 'rainbow', 'before-bob', groupId))[0]?.isMe === true, 'my own result is mine whatever its date');
    }),

    scenario('results: unfriending, leaving and removal hide rows at once, each from its own audience', async (world) => {
      const alice = world.signIn('rainbow', 'alice');
      const bob = world.signIn('rainbow', 'bob');
      const carol = world.signIn('crosspuns', 'carol');
      const { friendRef } = await befriend(alice, bob);
      const { groupId, inviteCode } = await makeGroup(alice, 'Club', 'Al');
      await join(bob, inviteCode, 'Bee');
      await join(carol, inviteCode, 'Cee');
      const carolRow = (await membersOf(alice, groupId)).find((m) => m.name === 'Cee');
      check(carolRow, 'carol should be listed');
      world.advance(1000);
      await finish(world, 'rainbow', 'alice');
      await finish(world, 'rainbow', 'bob');

      check((await resultsOf(alice, 'rainbow')).length === 2 && (await resultsOf(alice, 'rainbow', PUZZLE, groupId)).length === 2, 'both audiences should show both results');

      must(await bob.call('removeFriend', { friendRef }), 'removeFriend');
      check((await resultsOf(alice, 'rainbow')).every((row) => row.isMe) && (await resultsOf(bob, 'rainbow')).every((row) => row.isMe), 'unfriending should hide rows from both, at once');
      check((await resultsOf(bob, 'rainbow', PUZZLE, groupId)).length === 2, 'the shared group is its own audience');

      must(await bob.call('leaveGroup', { groupId }), 'leaveGroup');
      check((await resultsOf(alice, 'rainbow', PUZZLE, groupId)).every((row) => row.isMe), 'leaving should hide the row from the group, at once');
      refused(await bob.call('listResults', { gameId: 'rainbow', puzzleId: PUZZLE, groupId }), 'not_a_member', 'someone who left');

      must(await alice.call('removeMember', { groupId, memberRef: carolRow.memberRef }), 'removeMember');
      refused(await carol.call('listResults', { gameId: 'rainbow', puzzleId: PUZZLE, groupId }), 'not_a_member', 'someone removed');
      check((await resultsOf(carol, 'rainbow')).length === 0, 'someone removed should see nothing among friends either');
    }),

    scenario('results: a block hides rows both ways in every audience, though both stay members', async (world) => {
      const alice = world.signIn('rainbow', 'alice');
      const bob = world.signIn('rainbow', 'bob');
      const carol = world.signIn('crosspuns', 'carol');
      await befriend(alice, bob);
      const { groupId, inviteCode } = await makeGroup(alice, 'Club', 'Al');
      await join(bob, inviteCode, 'Bee');
      await join(carol, inviteCode, 'Cee');
      const row = (await membersOf(alice, groupId)).find((m) => m.name === 'Bee');
      check(row, 'bob should be listed');
      world.advance(1000);
      await finish(world, 'rainbow', 'alice');
      await finish(world, 'rainbow', 'bob');

      must(await alice.call('block', { ref: row.memberRef }), 'block');

      for (const player of [alice, bob]) {
        check((await resultsOf(player, 'rainbow')).every((r) => r.isMe), `${player.game}: nothing should show among friends across a block`);
        check((await resultsOf(player, 'rainbow', PUZZLE, groupId)).every((r) => r.isMe), `${player.game}: nothing should show in a shared group across a block`);
      }
      check((await membersOf(alice, groupId)).length === 3, 'a block has no effect on membership');
      check((await resultsOf(carol, 'rainbow', PUZZLE, groupId)).length === 2, 'everyone else should see both');
    }),

    scenario('results: rows hold no email, id or secret, in either audience', async (world) => {
      const alice = world.signIn('rainbow', 'alice');
      const bob = world.signIn('rainbow', 'bob');
      await befriend(alice, bob);
      const { groupId, inviteCode } = await makeGroup(alice);
      await join(bob, inviteCode);
      await finish(world, 'rainbow', 'alice');
      await finish(world, 'rainbow', 'bob');

      const rows = [...(await resultsOf(alice, 'rainbow')), ...(await resultsOf(alice, 'rainbow', PUZZLE, groupId))];
      check(rows.length === 4, 'both audiences should have both rows');
      const seen = JSON.stringify(rows);
      for (const secret of world.secrets()) check(!seen.includes(secret), 'a result row held a private value');
      for (const key of FORBIDDEN_RESPONSE_KEYS) check(!seen.includes(`"${key}"`), `a result row held the key ${key}`);
      check(!seen.includes('@'), 'a result row held what looks like an email');
    }),

    scenario('results: one client, passed between people, shows each their own view, and a late answer is dropped', async (world) => {
      for (let i = 0; i < ENABLED_GAMES.length; i++) {
        const game = ENABLED_GAMES[i];
        const first = `first${i}`;
        const second = `second${i}`;
        const ann = world.signIn('rainbow', `ann${i}`);
        world.signIn('rainbow', first);
        const player = world.signIn(game, first);
        await befriend(ann, player);
        world.become(player, second);
        await befriend(ann, player);
        world.advance(1000);
        await finish(world, 'rainbow', `ann${i}`);
        await finish(world, 'rainbow', first);

        world.become(player, first);
        checkUnlocked(resultNamed(await resultsOf(player, 'rainbow'), `ann${i}`), 'rainbow', `${game}: the one who finished`);
        lastCredentialIs(world, player, game);

        world.become(player, second);
        checkLocked(resultNamed(await resultsOf(player, 'rainbow'), `ann${i}`), `${game}: the one who has not`);
        lastCredentialIs(world, player, game);

        world.become(player, first);
        const release = world.hold(game);
        const pending = player.call('listResults', { gameId: 'rainbow', puzzleId: PUZZLE });
        world.become(player, second);
        release();
        refused(await pending, 'stale_session', `${game}: a result on its way when the person changed`);
      }
    }),

    // -- The client on its own ----------------------------------------------
    scenario('client: a transport that fails gives unavailable, and no session means no call', async () => {
      const getSession = () => ({ scope: 'visit', credential: 'token' });
      const rejecting = createSocialClient({ getSession, transport: { call: () => Promise.reject(new Error('down')) } });
      const throwing = createSocialClient({
        getSession,
        transport: {
          call() {
            throw new Error('down');
          },
        },
      });
      refused(await rejecting.call('getMe', {}), 'unavailable', 'a rejected call');
      refused(await throwing.call('getMe', {}), 'unavailable', 'a thrown call');

      let calls = 0;
      const counted: SocialTransport = {
        call: () => {
          calls += 1;
          return Promise.reject(new Error('should not be reached'));
        },
      };
      refused(await createSocialClient({ getSession: () => null, transport: counted }).call('getMe', {}), 'not_signed_in', 'no session');
      refused(await createSocialClient({ getSession: () => 'checking', transport: counted }).call('getMe', {}), 'still_checking', 'checking');
      refused(await createSocialClient({ getSession: () => 'checking', transport: counted }).call('previewInvite', SAMPLE_ARGS.previewInvite), 'still_checking', 'checking a preview');
      refused(await disabledSocialClient('unavailable').call('getMe', {}), 'unavailable', 'switched off');
      check(calls === 0, 'none of these should have reached a transport');
    }),

    scenario('client: a session source that throws gives unavailable and never a rejection, and an answer is not passed on', async () => {
      const broken = () => {
        throw new Error('no session');
      };
      let calls = 0;
      const counted = {
        call: () => {
          calls += 1;
          return Promise.resolve(TRANSPORT_ANSWER);
        },
      } as unknown as SocialTransport;
      refused(await createSocialClient({ getSession: broken, transport: counted }).call('getMe', {}), 'unavailable', 'before the call');
      check(calls === 0, 'a session source that throws should send nothing');

      let reads = 0;
      const brokenLater = () => {
        reads += 1;
        if (reads > 1) throw new Error('no session');
        return { scope: 'visit', credential: 'token' };
      };
      refused(await createSocialClient({ getSession: brokenLater, transport: counted }).call('getMe', {}), 'unavailable', 'after the call');
    }),
  ];
}
