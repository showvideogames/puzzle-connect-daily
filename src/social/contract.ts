/**
 * The shared Friends / Groups contract, version 0: draft, mock only.
 * docs/shared-social/CONTRACT.md is the authority; this file is its code form.
 *
 * PORTABLE: copied unchanged into every game, so it imports nothing and uses
 * nothing from a particular app. Change requests go to the architecture lead.
 */

export const CONTRACT_VERSION = 0;

export type GameId = 'rainbow' | 'crosspuns' | 'cluevoyance' | 'wtf' | 'yodel' | 'hamburgle' | 'priceiswhat';

export type GameStatus = 'mock' | 'disabled';

/** Yodel has no accounts, Hamburgle's are off and Price Is What's are unfinished. */
export const GAME_STATUS: Record<GameId, GameStatus> = {
  rainbow: 'mock',
  crosspuns: 'mock',
  cluevoyance: 'mock',
  wtf: 'mock',
  yodel: 'disabled',
  hamburgle: 'disabled',
  priceiswhat: 'disabled',
};

/** The sharing notice the hub asks for. Its wording is in section 6 of the contract. */
export const CURRENT_NOTICE_VERSION = 1;

/** The stored values. A game supplies its own art and labels. */
export const AVATAR_IDS = [
  'bear',
  'owl',
  'fox',
  'frog',
  'cat',
  'saint-bernard',
  'rabbit',
  'raccoon',
  'penguin',
  'koala',
  'red-panda',
  'otter',
  'hedgehog',
  'panda',
  'tiger',
  'lion',
  'elephant',
  'giraffe',
  'mouse',
  'squirrel',
  'sloth',
  'deer',
  'basketball',
  'football',
  'soccer',
  'baseball-bat',
  'pizza',
  'hamburger',
  'ghost',
  'frankenstein',
] as const;

/** For a person's background and a group's accent alike. */
export const PROFILE_COLORS = ['#DED1F2', '#F1CDDA', '#F8D0BD', '#F8E4A0', '#CCE6CA', '#CCE1F1'] as const;

export const GROUP_EMBLEM_IDS = ['campfire', 'cabin', 'mountains', 'cards-dice', 'coffee', 'book', 'picnic', 'flowers', 'moon'] as const;

/** Who a person shows as until they choose, the setup default. */
export const DEFAULT_AVATAR = 'fox';
export const DEFAULT_COLOR = '#DED1F2';
export const DEFAULT_EMBLEM = 'campfire';

export const LIMITS = {
  /** Characters in a group's name. */
  groupNameMax: 40,
  groupDescriptionMax: 500,
  /** Characters in a display name, or a name in a group. */
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
  /** Friend code lookups and friend requests, counted together. */
  friendLookupsPerDay: 30,
  /** How long the requestRef from a lookup works. */
  lookupRefHours: 1,
  /** Faces on a group invitation. */
  previewFaces: 3,
  /** A group picture's width and height. */
  photoEdge: 256,
  /** A group picture's size: 60 KB, counted as CrossPuns counts it. */
  photoBytes: 61440,
  /** Characters in a puzzle id. */
  puzzleIdMax: 64,
  /** Characters in a text grid, or entries in a list of true or false. */
  resultDetailMax: 500,
} as const;

export type Limits = { [K in keyof typeof LIMITS]: number };

export const OUTCOMES = [
  'not_signed_in',
  'not_linked',
  'still_checking',
  'game_disabled',
  'unavailable',
  'stale_session',
  'invalid_code',
  'invite_expired',
  'invite_used',
  'own_invite',
  'bad_name',
  'bad_description',
  'bad_my_name',
  'too_many_created',
  'too_many_groups',
  'too_many_friends',
  'slow_down',
  'group_full',
  'removed',
  'not_a_member',
  'not_the_creator',
  'cannot_remove_self',
  'not_found',
  'own_code',
  'already_friends',
  'request_pending',
  'needs_display_name',
  'notice_required',
  'bad_avatar',
  'bad_color',
  'bad_emblem',
  'bad_result',
  'not_a_picture',
  'wrong_size',
  'too_big',
] as const;

export type Outcome = (typeof OUTCOMES)[number];

export type Result<T> = { ok: true; data: T } | { ok: false; outcome: Outcome };

type NoArgs = Record<string, never>;
type NoData = Record<string, never>;

/** How someone shows, on any list. */
export interface Face {
  animalId: string;
  backgroundColor: string;
}

export interface Profile extends Face {
  displayName: string;
}

export interface FriendRow extends Face {
  friendRef: string;
  /** Null while the friend hasn't chosen a display name; the game supplies its own wording. */
  name: string | null;
  since: string;
}

export interface FriendPreference {
  friendRef: string;
  favorite: boolean;
  /** Private to the viewer; never a public profile edit. Null clears it. */
  nickname: string | null;
}

export interface FriendRequestRow extends Face {
  requestRef: string;
  name: string | null;
  sentAt: string;
}

export interface BlockRow {
  blockRef: string;
  /** The name the blocker saw when they blocked. */
  name: string | null;
}

export interface GroupRow {
  groupId: string;
  name: string;
  emblemId: string;
  accentColor: string;
  /** A data:image/jpeg;base64, or data:image/png;base64, URL or null. When set, it shows instead of the emblem. */
  photo: string | null;
  photoVersion: number;
  memberCount: number;
  isOwner: boolean;
  myName: string;
  /** Always present, and always null for non-owners. It can be null for an owner too (D12), so never build a link from it. */
  inviteCode: string | null;
}

export interface MemberRow extends Face {
  memberRef: string;
  name: string;
  isOwner: boolean;
  isMe: boolean;
  joinedAt: string;
}

export interface RemovedRow {
  removedRef: string;
  name: string;
}

export interface FriendInvitePreview extends Face {
  inviterName: string | null;
}

/** All a valid group invitation shows of the people in it. */
export interface MemberPreview {
  /** At most LIMITS.previewFaces: the owner first, then in joining order. */
  faces: Face[];
  /** The owner's name in this group. */
  leadName: string;
  memberCount: number;
}

export interface GroupInvitePreview {
  name: string;
  emblemId: string;
  accentColor: string;
  photo: string | null;
  /** Null for someone already a member, or removed. */
  memberPreview: MemberPreview | null;
  isMember: boolean;
  isRemoved: boolean;
}

/** One summary per game, of numbers and yes-or-no only. Cluevoyance has no shape yet. */
export interface GameSummaries {
  rainbow: { solved: boolean; mistakes: number };
  crosspuns: { seconds: number };
  wtf: { score: number };
  yodel: { score: number };
  hamburgle: { guesses: number };
  priceiswhat: { score: number };
}

export type ResultSummary = GameSummaries[keyof GameSummaries];

/** A text grid, or a list of true or false. Null where a game has no detail. */
export type ResultDetail = string | boolean[];

export interface ResultShape {
  /** The exact keys of a summary. A count is a whole number of at least 0. Nothing here can hold free text. */
  summary: Readonly<Record<string, 'boolean' | 'count'>>;
  /** 'none' means detail is null, 'grid' a text grid, 'answers' a list of true or false. */
  detail: 'none' | 'grid' | 'answers';
}

/** What a game server's result must look like. Null: no shape yet, so results are refused. */
export const RESULT_SHAPES: Readonly<Record<GameId, ResultShape | null>> = {
  rainbow: { summary: { solved: 'boolean', mistakes: 'count' }, detail: 'grid' },
  crosspuns: { summary: { seconds: 'count' }, detail: 'none' },
  wtf: { summary: { score: 'count' }, detail: 'answers' },
  yodel: { summary: { score: 'count' }, detail: 'none' },
  hamburgle: { summary: { guesses: 'count' }, detail: 'none' },
  priceiswhat: { summary: { score: 'count' }, detail: 'none' },
  cluevoyance: null,
};

interface ResultRowFields extends Face {
  isMe: boolean;
  name: string | null;
  summary: ResultSummary;
  /** Left out, not blanked, while detailLocked is true. Null when the result has no detail. */
  detail?: ResultDetail | null;
  detailLocked: boolean;
}

/** In a friends list. The caller's own row has a null friendRef. */
export type FriendResultRow = ResultRowFields & { friendRef: string | null };

export type MemberResultRow = ResultRowFields & { memberRef: string };

export type ResultRow = FriendResultRow | MemberResultRow;

/** One entry per operation in section 5 of the contract, except recordCompletion. List operations answer with an array of rows. */
export interface Operations {
  getMe: { args: NoArgs; data: Face & { displayName: string | null; friendCode: string; friendCount: number; groupCount: number } };
  setDisplayName: { args: { name: string }; data: { displayName: string } };
  setProfile: { args: Profile; data: Profile };
  createFriendInvite: { args: { noticeVersion: number }; data: { code: string; expiresAt: string } };
  previewInvite: { args: { code: string }; data: FriendInvitePreview | GroupInvitePreview };
  acceptFriendInvite: { args: { code: string; noticeVersion: number }; data: { friendRef: string; name: string | null } };
  /** The requestRef works only for this caller, for this person, for LIMITS.lookupRefHours. */
  findFriendByCode: { args: { friendCode: string }; data: Face & { requestRef: string; name: string | null } };
  sendFriendRequest: { args: { requestRef: string; noticeVersion: number }; data: NoData };
  listFriendRequests: { args: NoArgs; data: { incoming: FriendRequestRow[]; outgoing: FriendRequestRow[] } };
  acceptFriendRequest: { args: { requestRef: string; noticeVersion: number }; data: { friendRef: string; name: string | null } };
  declineFriendRequest: { args: { requestRef: string }; data: NoData };
  cancelFriendRequest: { args: { requestRef: string }; data: NoData };
  listFriends: { args: NoArgs; data: FriendRow[] };
  listFriendPreferences: { args: NoArgs; data: FriendPreference[] };
  setFriendPreference: { args: FriendPreference; data: FriendPreference };
  removeFriend: { args: { friendRef: string }; data: NoData };
  block: { args: { ref: string }; data: { blockRef: string } };
  unblock: { args: { blockRef: string }; data: NoData };
  listBlocks: { args: NoArgs; data: BlockRow[] };
  createGroup: { args: { name: string; myName: string; noticeVersion: number }; data: { groupId: string; inviteCode: string } };
  joinGroup: { args: { code: string; myName: string; noticeVersion: number }; data: { groupId: string } };
  listGroupOrder: { args: NoArgs; data: { groupIds: string[] } };
  setGroupOrder: { args: { groupIds: string[] }; data: NoData };
  listMyGroups: { args: NoArgs; data: GroupRow[] };
  /** `after` is the last row of the previous page; rows come in joining order. */
  listMembers: { args: { groupId: string; after?: Pick<MemberRow, 'joinedAt' | 'memberRef'>; limit?: number }; data: MemberRow[] };
  leaveGroup: { args: { groupId: string }; data: { closed: boolean } };
  renameMeInGroup: { args: { groupId: string; name: string }; data: NoData };
  getGroupDescription: { args: { groupId: string }; data: { description: string | null } };
  setGroupDescription: { args: { groupId: string; description: string | null }; data: { description: string | null } };
  renameGroup: { args: { groupId: string; name: string }; data: NoData };
  setGroupAppearance: { args: { groupId: string; emblemId: string; photo: string | null; accentColor: string }; data: { photoVersion: number } };
  getGroupInvitation: { args: { groupId: string }; data: { canInvite: boolean; inviteCode: string | null; grantedMemberRefs: string[] } };
  setMemberInvitePermission: { args: { groupId: string; memberRef: string; allowed: boolean }; data: NoData };
  transferGroupOwnership: { args: { groupId: string; memberRef: string }; data: NoData };
  deleteGroup: { args: { groupId: string }; data: NoData };
  removeMember: { args: { groupId: string; memberRef: string }; data: NoData };
  listRemoved: { args: { groupId: string }; data: RemovedRow[] };
  letBackIn: { args: { groupId: string; removedRef: string }; data: NoData };
  replaceInvite: { args: { groupId: string }; data: { inviteCode: string } };
  /** Without a groupId, the caller's friends plus their own row. Only people with a result get a row. */
  listResults: { args: { gameId: GameId; puzzleId: string; groupId?: string }; data: ResultRow[] };
  deleteMySocialData: { args: NoArgs; data: NoData };
}

export type OpName = keyof Operations;

/** What a game server sends. The one place a global id is accepted, so it is never on the browser route. */
export interface CompletionInput {
  gameId: GameId;
  puzzleId: string;
  globalUserId: string;
  /** UTC ISO 8601 with milliseconds. */
  completedAt: string;
  summary: ResultSummary;
  detail: ResultDetail | null;
}

/** The game-server route. Apart from Operations on purpose: no browser transport can name it. */
export interface ServerOperations {
  recordCompletion: { args: CompletionInput; data: NoData };
}

export interface SocialServerRoute {
  recordCompletion(input: CompletionInput): Promise<Result<ServerOperations['recordCompletion']['data']>>;
}

/** The credential is the game's own token. No operation's args carry an identity. */
export interface SocialTransport {
  call<O extends OpName>(op: O, args: Operations[O]['args'], credential: string | null): Promise<Result<Operations[O]['data']>>;
}

export interface SocialSession {
  /** Unique to this signed-in person on this visit. */
  scope: string;
  credential: string;
}

/**
 * What a game's session source says. Null is a confirmed guest, or anyone who
 * is not an account in this game. 'checking' covers a session still being
 * checked and a failed check: that is not a sign-out, and nothing is sent.
 */
export type SessionState = SocialSession | 'checking' | null;

/** Key names that must never appear anywhere in a response. */
export const FORBIDDEN_RESPONSE_KEYS: readonly string[] = [
  'globalUserId',
  'global_user_id',
  'email',
  'accountId',
  'account_id',
  'authUserId',
  'auth_user_id',
  'playerKey',
  'player_key',
  'personId',
  'person_id',
];
