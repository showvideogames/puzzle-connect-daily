/**
 * social-gateway, without the platform wiring (index.ts supplies that), so
 * every rule below runs under the unit tests.
 *
 * The one way a browser reaches the shared Friends and Groups hub. A request is
 * POST { op, args }, and every answer is { ok: true, data } or
 * { ok: false, outcome }. The rules, in order:
 *
 *   1. CORS, POST only, and `apikey` must be one of the project's CURRENT
 *      publishable or secret keys, as in submit-feedback.
 *   2. `op` must be a browser operation. recordCompletion and anything unknown
 *      answer `unavailable`, before any sign-in check.
 *   3. previewInvite needs no session: a usable token gets the two flags, and
 *      anything else gets the guest view.
 *   4. Everything else needs a token Supabase Auth accepts right now, never
 *      trusted on its own claims, and not an anonymous user: `not_signed_in`.
 *   5. The global id comes from Rainbow's own `accounts` row, found by the auth
 *      user id. No row: `not_linked`. Never from args.
 *   6. The beta allow-list, unless access is `everyone`. Anyone else gets
 *      `game_disabled`, so the feature behaves as if it doesn't exist.
 *   7. A strict check of the arguments, per operation: `unavailable`.
 *   8. One transaction as social_gateway: ensure_person, then the one mapped
 *      function. Its JSON goes back exactly.
 *
 * Tokens, global ids and args are never logged, and a database error's text is
 * never returned or logged: an SQLSTATE code at most.
 *
 * Results are shared automatically, so listResults for Rainbow first copies the
 * audience's finished official daily games into the hub. See shareCompletions.
 */

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export interface ApiKeys {
  publishable: string[];
  secret: string[];
}

/** Runs one statement. Text is always a constant from this file; values are bound. */
export interface Queries {
  query(text: string, params: unknown[]): Promise<Record<string, unknown>[]>;
}

export interface GatewayDb {
  /** One transaction, as the connection's own role until the work sets another. */
  transaction<T>(work: (tx: Queries) => Promise<T>): Promise<T>;
}

export interface GatewayDeps {
  /** The project's current API keys (see readApiKeys). */
  keys: ApiKeys;
  /**
   * Asks Supabase Auth whether this access token is a valid session now. Null
   * for a token it refuses. Rejects when Auth can't answer, which is not a
   * refusal.
   */
  verifyUserToken: (token: string) => Promise<{ id: string; isAnonymous: boolean } | null>;
  /** False once this instance has answered too many invitation previews (see createPreviewThrottle). */
  allowPreview: () => boolean;
  /**
   * Who may use Friends and Groups: the beta allow-list, or every signed-in
   * Rainbow account. Every other check is the same either way.
   */
  access: GatewayAccess;
  db: GatewayDb;
}

export type GatewayAccess = "allow-list" | "everyone";

/** The SOCIAL_ACCESS setting. Anything but exactly `everyone` keeps the allow-list. */
export function readAccess(value: string | undefined): GatewayAccess {
  return value === "everyone" ? "everyone" : "allow-list";
}

/**
 * Keeps a stuck lock or slow query from pinning this instance's one connection.
 * It has to run inside the transaction: settings on a role don't apply through
 * `set local role`.
 */
export const TRANSACTION_LIMITS_SQL =
  "select set_config('lock_timeout', '2s', true), set_config('statement_timeout', '5s', true)";

/**
 * The project's transaction pooler: the same host and password on its own port.
 * Each running instance of this function holds a connection, and one player's
 * page load can start several, so going direct would spend the connections the
 * live games share. The pooler caps them.
 */
export function transactionPoolerUrl(dbUrl: string): string {
  const url = new URL(dbUrl);
  url.port = "6543";
  return url.href;
}

/**
 * Auth turning a token down is a 4xx. Anything else, a 429 included, means it
 * couldn't answer, which must not read as a sign-out.
 */
export function authCouldNotAnswer(status: number | undefined): boolean {
  return !(status && status >= 400 && status < 500 && status !== 429);
}

/**
 * Guests reach previewInvite with no sign-in, and each one costs a transaction on
 * the database the live games share, so nothing else slows a flood of them. The
 * count is per running instance of the function: a limit on the damage, not an
 * exact rate.
 */
export function createPreviewThrottle(limit = 120, windowMs = 60_000, now: () => number = Date.now): () => boolean {
  let windowStart = now();
  let used = 0;
  return () => {
    const time = now();
    if (time - windowStart >= windowMs) {
      windowStart = time;
      used = 0;
    }
    used += 1;
    return used <= limit;
  };
}

/**
 * The platform injects the keys as JSON objects of name -> key
 * (SUPABASE_PUBLISHABLE_KEYS, SUPABASE_SECRET_KEYS). The local CLI stack has a
 * single key of each kind instead (SUPABASE_PUBLISHABLE_KEY,
 * SUPABASE_SECRET_KEY). Only values with the new key prefixes are kept, so a
 * legacy JWT can never end up on the accepted list. The same as submit-feedback,
 * copied so this function deploys on its own.
 */
export function readApiKeys(env: (name: string) => string | undefined): ApiKeys {
  const collect = (mapName: string, singleName: string, prefix: string) => {
    const values: string[] = [];
    const raw = env(mapName);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          for (const value of Object.values(parsed)) if (typeof value === "string") values.push(value);
        }
      } catch {
        // unparseable: treated as no keys, which fails closed
      }
    }
    const single = env(singleName);
    if (single) values.push(single);
    return [...new Set(values.filter((value) => value.startsWith(prefix)))];
  };
  return {
    publishable: collect("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_PUBLISHABLE_KEY", "sb_publishable_"),
    secret: collect("SUPABASE_SECRET_KEYS", "SUPABASE_SECRET_KEY", "sb_secret_"),
  };
}

/** The secret key the function itself uses: the one named `default`. */
export function serverSecretKey(env: (name: string) => string | undefined): string | null {
  try {
    const parsed = JSON.parse(env("SUPABASE_SECRET_KEYS") ?? "null");
    if (typeof parsed?.default === "string" && parsed.default.startsWith("sb_secret_")) return parsed.default;
  } catch {
    // fall through to the local single-key form
  }
  const single = env("SUPABASE_SECRET_KEY");
  return single?.startsWith("sb_secret_") ? single : null;
}

/** Constant-time for equal lengths; key lengths are not secret. */
function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function isCurrentApiKey(value: string, keys: ApiKeys): boolean {
  let match = false;
  for (const key of [...keys.publishable, ...keys.secret]) if (sameString(value, key)) match = true;
  return match;
}

// ── The strict argument check ──

type Args = Record<string, unknown>;

/** What one argument may be. The hub still judges the value: this is only its type. */
type Kind = "groupIds" | "boolean" | "text" | "textOrNull" | "code" | "whole" | "cursor" | "game" | "puzzle";

const GAME_IDS = ["rainbow", "crosspuns", "cluevoyance", "wtf", "yodel", "hamburgle", "priceiswhat"];
const INT4_MAX = 2147483647;
/** Well past any real code. Guests can reach these, and the hub hashes them. */
const CODE_MAX = 64;
/** A group picture is at most 60 KB of JPEG, so about 82 KB once encoded. */
const BODY_MAX = 128 * 1024;
const WIRE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const PUZZLE_ID = /^[A-Za-z0-9:_-]{1,64}$/;

const isText = (value: unknown): value is string => typeof value === "string";
const isPlainObject = (value: unknown): value is Args =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const has = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);

const FITS: Record<Kind, (value: unknown) => boolean> = {
  groupIds: (value) => Array.isArray(value) && value.length <= 50 && value.every(id => typeof id === "string" && id.length > 0 && id.length <= 64),
  boolean: (value) => typeof value === "boolean",
  text: isText,
  textOrNull: (value) => value === null || isText(value),
  code: (value) => isText(value) && value.length <= CODE_MAX,
  whole: (value) => Number.isInteger(value) && Math.abs(value as number) <= INT4_MAX,
  cursor: (value) =>
    isPlainObject(value) &&
    Object.keys(value).length === 2 &&
    isText(value.joinedAt) &&
    WIRE_TIME.test(value.joinedAt) &&
    isText(value.memberRef),
  game: (value) => isText(value) && GAME_IDS.includes(value),
  puzzle: (value) => isText(value) && PUZZLE_ID.test(value),
};

// ── The operations ──

interface Operation {
  required: Readonly<Record<string, Kind>>;
  optional?: Readonly<Record<string, Kind>>;
  /** Null for getMe, which ensure_person already answers. $1 is always the caller's global id. */
  sql: string | null;
  /** The values for $2 onward, in the order of that function's arguments. */
  params: (args: Args) => unknown[];
}

const noParams = () => [];

/**
 * Every browser operation, with the one SQL function it may reach. Nothing in
 * these statements comes from a request, and recordCompletion is not here: it
 * belongs to the server's route and the browser's role can't run it.
 */
export const OPERATIONS: Readonly<Record<string, Operation>> = {
  getMe: { required: {}, sql: null, params: noParams },
  setDisplayName: {
    required: { name: "text" },
    sql: "select social.set_display_name($1::text, $2::text) as result",
    params: (a) => [a.name],
  },
  setProfile: {
    required: { displayName: "text", animalId: "text", backgroundColor: "text" },
    sql: "select social.set_profile($1::text, $2::text, $3::text, $4::text) as result",
    params: (a) => [a.displayName, a.animalId, a.backgroundColor],
  },
  createFriendInvite: {
    required: { noticeVersion: "whole" },
    sql: "select social.create_friend_invite($1::text, $2::int) as result",
    params: (a) => [a.noticeVersion],
  },
  previewInvite: {
    required: { code: "code" },
    sql: "select social.preview_invite($1::text, $2::text) as result",
    params: (a) => [a.code],
  },
  acceptFriendInvite: {
    required: { code: "code", noticeVersion: "whole" },
    sql: "select social.accept_friend_invite($1::text, $2::text, $3::int) as result",
    params: (a) => [a.code, a.noticeVersion],
  },
  findFriendByCode: {
    required: { friendCode: "code" },
    sql: "select social.find_friend_by_code($1::text, $2::text) as result",
    params: (a) => [a.friendCode],
  },
  sendFriendRequest: {
    required: { requestRef: "text", noticeVersion: "whole" },
    sql: "select social.send_friend_request($1::text, $2::text, $3::int) as result",
    params: (a) => [a.requestRef, a.noticeVersion],
  },
  listFriendRequests: {
    required: {},
    sql: "select social.list_friend_requests($1::text) as result",
    params: noParams,
  },
  acceptFriendRequest: {
    required: { requestRef: "text", noticeVersion: "whole" },
    sql: "select social.accept_friend_request($1::text, $2::text, $3::int) as result",
    params: (a) => [a.requestRef, a.noticeVersion],
  },
  declineFriendRequest: {
    required: { requestRef: "text" },
    sql: "select social.decline_friend_request($1::text, $2::text) as result",
    params: (a) => [a.requestRef],
  },
  cancelFriendRequest: {
    required: { requestRef: "text" },
    sql: "select social.cancel_friend_request($1::text, $2::text) as result",
    params: (a) => [a.requestRef],
  },
  listFriends: { required: {}, sql: "select social.list_friends($1::text) as result", params: noParams },
  listFriendPreferences: { required: {}, sql: "select social.list_friend_preferences($1::text) as result", params: noParams },
  setFriendPreference: {
    required: { friendRef: "text", favorite: "boolean", nickname: "textOrNull" },
    sql: "select social.set_friend_preference($1::text, $2::text, $3::boolean, $4::text) as result",
    params: (a) => [a.friendRef, a.favorite, a.nickname],
  },
  removeFriend: {
    required: { friendRef: "text" },
    sql: "select social.remove_friend($1::text, $2::text) as result",
    params: (a) => [a.friendRef],
  },
  block: {
    required: { ref: "text" },
    sql: "select social.block($1::text, $2::text) as result",
    params: (a) => [a.ref],
  },
  unblock: {
    required: { blockRef: "text" },
    sql: "select social.unblock($1::text, $2::text) as result",
    params: (a) => [a.blockRef],
  },
  listBlocks: { required: {}, sql: "select social.list_blocks($1::text) as result", params: noParams },
  createGroup: {
    required: { name: "text", myName: "text", noticeVersion: "whole" },
    sql: "select social.create_group($1::text, $2::text, $3::text, $4::int) as result",
    params: (a) => [a.name, a.myName, a.noticeVersion],
  },
  joinGroup: {
    required: { code: "code", myName: "text", noticeVersion: "whole" },
    sql: "select social.join_group($1::text, $2::text, $3::text, $4::int) as result",
    params: (a) => [a.code, a.myName, a.noticeVersion],
  },
  listGroupOrder: { required: {}, sql: "select social.list_group_order($1::text) as result", params: noParams },
  setGroupOrder: { required: { groupIds: "groupIds" }, sql: "select social.set_group_order($1::text, $2::text[]) as result", params: a => [a.groupIds] },
  listMyGroups: { required: {}, sql: "select social.list_my_groups($1::text) as result", params: noParams },
  listMembers: {
    required: { groupId: "text" },
    optional: { after: "cursor", limit: "whole" },
    sql: "select social.list_members($1::text, $2::text, $3::timestamptz, $4::text, $5::int) as result",
    params: (a) => {
      const after = a.after as { joinedAt: string; memberRef: string } | undefined;
      return [a.groupId, after?.joinedAt ?? null, after?.memberRef ?? null, a.limit ?? null];
    },
  },
  leaveGroup: {
    required: { groupId: "text" },
    sql: "select social.leave_group($1::text, $2::text) as result",
    params: (a) => [a.groupId],
  },
  renameMeInGroup: {
    required: { groupId: "text", name: "text" },
    sql: "select social.rename_me_in_group($1::text, $2::text, $3::text) as result",
    params: (a) => [a.groupId, a.name],
  },
  crossPunsStandings: { required: { groupId: "text", offset: "whole" }, sql: "select social.crosspuns_standings($1::text, $2::text, $3::int) as result", params: a => [a.groupId,a.offset] },
  getGroupDescription: { required: { groupId: "text" }, sql: "select social.get_group_description($1::text, $2::text) as result", params: a => [a.groupId] },
  setGroupDescription: { required: { groupId: "text", description: "textOrNull" }, sql: "select social.set_group_description($1::text, $2::text, $3::text) as result", params: a => [a.groupId, a.description] },
  renameGroup: {
    required: { groupId: "text", name: "text" },
    sql: "select social.rename_group($1::text, $2::text, $3::text) as result",
    params: (a) => [a.groupId, a.name],
  },
  setGroupAppearance: {
    required: { groupId: "text", emblemId: "text", photo: "textOrNull", accentColor: "text" },
    sql: "select social.set_group_appearance($1::text, $2::text, $3::text, $4::text, $5::text) as result",
    params: (a) => [a.groupId, a.emblemId, a.photo, a.accentColor],
  },
  getGroupInvitation: { required: { groupId: "text" }, sql: "select social.get_group_invitation($1::text, $2::text) as result", params: a => [a.groupId] },
  setMemberInvitePermission: { required: { groupId: "text", memberRef: "text", allowed: "boolean" }, sql: "select social.set_member_invite_permission($1::text, $2::text, $3::text, $4::boolean) as result", params: a => [a.groupId,a.memberRef,a.allowed] },
  transferGroupOwnership: { required: { groupId: "text", memberRef: "text" }, sql: "select social.transfer_group_ownership($1::text, $2::text, $3::text) as result", params: a => [a.groupId,a.memberRef] },
  deleteGroup: { required: { groupId: "text" }, sql: "select social.delete_group($1::text, $2::text) as result", params: a => [a.groupId] },
  removeMember: {
    required: { groupId: "text", memberRef: "text" },
    sql: "select social.remove_member($1::text, $2::text, $3::text) as result",
    params: (a) => [a.groupId, a.memberRef],
  },
  listRemoved: {
    required: { groupId: "text" },
    sql: "select social.list_removed($1::text, $2::text) as result",
    params: (a) => [a.groupId],
  },
  letBackIn: {
    required: { groupId: "text", removedRef: "text" },
    sql: "select social.let_back_in($1::text, $2::text, $3::text) as result",
    params: (a) => [a.groupId, a.removedRef],
  },
  replaceInvite: {
    required: { groupId: "text" },
    sql: "select social.replace_invite($1::text, $2::text) as result",
    params: (a) => [a.groupId],
  },
  listResults: {
    required: { gameId: "game", puzzleId: "puzzle" },
    optional: { groupId: "text" },
    sql: "select social.list_results($1::text, $2::text, $3::text, $4::text) as result",
    params: (a) => [a.gameId, a.puzzleId, a.groupId ?? null],
  },
  deleteMySocialData: { required: {}, sql: "select social.delete_person($1::text) as result", params: noParams },
};

/** Exactly the operation's fields, each of the right type. Unknown fields, so any identity, fail. */
function argsFit(operation: Operation, args: unknown): args is Args {
  if (!isPlainObject(args)) return false;
  const optional = operation.optional ?? {};
  for (const key of Object.keys(args)) {
    const kind = has(operation.required, key) ? operation.required[key] : has(optional, key) ? optional[key] : null;
    if (kind === null || !FITS[kind](args[key])) return false;
  }
  return Object.keys(operation.required).every((key) => has(args, key));
}

// ── The fixed statements ──

const AS_GATEWAY = "set local role social_gateway";
const AS_GAME_SERVER = "set local role social_game_server";
const READ_ONLY = "set transaction read only";

const ACCOUNT_SQL = "select global_user_id from public.accounts where user_id = $1::uuid";
const BETA_TESTER_SQL = "select social.is_beta_tester($1::text) as allowed";
const ENSURE_PERSON_SQL = "select social.ensure_person($1::text, 'rainbow') as result";
const AUDIENCE_SQL = "select social.audience_global_ids($1::text, $2::text) as result";
const RECORD_COMPLETION_SQL =
  "select social.record_completion($1::text, $2::text, $3::text, $4::text, $5::text::jsonb, $6::text::jsonb) as result";

/**
 * Finished official games of the full daily, and nothing else: no game in
 * progress, no mini, no custom or archive play. $1 is a JSON list of global ids.
 *
 * entry_context comes from the browser, and the custom and beta pages send
 * daily_home too, so it can't stand alone. The puzzle's own row has the say: it
 * must be published, not beta, not free, and the full format, and the game must
 * finish before the puzzle's date plus 2 days in UTC, which allows for local
 * midnight and refuses a later archive play. The one exception is the puzzle the
 * home page serves now, the newest published full puzzle dated today or
 * earlier: while no new daily is published it stays the daily, whatever its
 * date. Archive and Unlimited plays of it still send their own entry_context.
 *
 * Rainbow's server doesn't replay games, so mistakes and the grid are only as
 * trustworthy as Rainbow's own stats: a player can affect only their own row.
 */
export const COMPLETIONS_SQL = `
  select a.global_user_id,
         gs.status,
         gs.mistakes,
         gs.share_grid,
         to_char(gs.completed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as completed_at
    from public.accounts a
    join public.game_sessions gs on gs.user_id = a.user_id
    join public.puzzles p on p.id::text = gs.puzzle_id
   where a.global_user_id in (select jsonb_array_elements_text($1::text::jsonb))
     and gs.puzzle_id = $2::text
     and gs.is_official is true
     and gs.status in ('won', 'lost')
     and gs.format = 'full'
     and gs.entry_context = 'daily_home'
     and p.is_published is true
     and p.is_beta is false
     and p.is_free_puzzle is not true
     and p.format = 'full'
     and (gs.completed_at < (p.date + 2)::timestamp at time zone 'UTC'
          or p.id = (select h.id
                       from public.puzzles h
                      where h.is_published is true
                        and h.format = 'full'
                        and h.date <= (now() at time zone 'UTC')::date
                      order by h.date desc
                      limit 1))
`;

// ── Answers ──

type Answer = { ok: boolean; [key: string]: unknown };

const refuse = (outcome: string): Answer => ({ ok: false, outcome });
const UNAVAILABLE = refuse("unavailable");

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** A fixed line and at most an SQLSTATE code. An error's text can quote what a query was given. */
function logFailure(step: string, error: unknown): void {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  console.error(`social-gateway: ${step} failed`, isText(code) && /^[0-9A-Z]{5}$/.test(code) ? code : "");
}

/** One entry function's answer. Anything out of shape is a failure, not an answer to pass on. */
async function hubAnswer(tx: Queries, sql: string, params: unknown[]): Promise<Answer> {
  const [row] = await tx.query(sql, params);
  const answer = row?.result;
  if (!isPlainObject(answer) || typeof answer.ok !== "boolean") throw new Error("The hub's answer was out of shape.");
  return answer as Answer;
}

function asGateway<T>(db: GatewayDb, work: (tx: Queries) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query(AS_GATEWAY, []);
    return work(tx);
  });
}

function asGameServer<T>(db: GatewayDb, work: (tx: Queries) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query(AS_GAME_SERVER, []);
    return work(tx);
  });
}

// ── Who is calling ──

/** The caller's token. None for a missing or malformed header, or an API key, which means signed out. */
function bearerToken(req: Request, keys: ApiKeys): string | null {
  const match = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(\S+)$/i);
  return match && !isCurrentApiKey(match[1], keys) ? match[1] : null;
}

/** Rainbow's account boundary: an auth user is a Rainbow account only with a row here. */
async function readGlobalId(userId: string, db: GatewayDb): Promise<string | null> {
  const rows = await db.transaction((tx) => tx.query(ACCOUNT_SQL, [userId]));
  const globalId = rows[0]?.global_user_id;
  return isText(globalId) ? globalId : null;
}

async function isBetaTester(globalId: string, db: GatewayDb): Promise<boolean> {
  const rows = await asGateway(db, (tx) => tx.query(BETA_TESTER_SQL, [globalId]));
  return rows[0]?.allowed === true;
}

/** Every Rainbow account when access is `everyone`, otherwise only the allow-list. */
async function mayUse(globalId: string, deps: GatewayDeps): Promise<boolean> {
  return deps.access === "everyone" || isBetaTester(globalId, deps.db);
}

/** The global id for an invitation's flags. Null for anyone who isn't a usable account, however that came about. */
async function previewCaller(token: string | null, deps: GatewayDeps): Promise<string | null> {
  if (!token) return null;
  try {
    const user = await deps.verifyUserToken(token);
    if (!user || user.isAnonymous) return null;
    const globalId = await readGlobalId(user.id, deps.db);
    return globalId && (await mayUse(globalId, deps)) ? globalId : null;
  } catch (error) {
    logFailure("the preview's caller check", error);
    return null;
  }
}

// ── Automatic results ──

/** The arguments for record_completion, or null for a row that can't be a result. */
function completionParams(row: Record<string, unknown>, puzzleId: string): unknown[] | null {
  const { global_user_id: globalId, status, mistakes, share_grid: grid, completed_at: completedAt } = row;
  if (!isText(globalId) || !isText(completedAt) || !WIRE_TIME.test(completedAt)) return null;
  if (status !== "won" && status !== "lost") return null;
  if (!Number.isSafeInteger(mistakes) || (mistakes as number) < 0) return null;
  if (!isText(grid) || grid.trim() === "") return null;
  return [globalId, "rainbow", puzzleId, completedAt, JSON.stringify({ solved: status === "won", mistakes }), JSON.stringify(grid)];
}

/**
 * Copies the audience's finished official daily games into the hub, so results
 * are shared without anyone pressing Share. Runs only on the server's roles and
 * the connection's own, reads Rainbow's tables and writes nothing to them. The
 * audience ids stay in here. A failure at any point costs some results, never
 * the answer: listResults runs afterwards and still enforces everything.
 *
 * Each row is its own transaction, so a bad one can't stop the others and no
 * person's lock is held across the whole audience. record_completion keeps the
 * first result, so repeating this on every list changes nothing.
 */
async function shareCompletions(globalId: string, puzzleId: string, groupId: string | null, db: GatewayDb): Promise<void> {
  try {
    // A result never creates a person, so someone new has to exist first.
    await asGateway(db, (tx) => hubAnswer(tx, ENSURE_PERSON_SQL, [globalId]));
    const audience = await asGameServer(db, (tx) => hubAnswer(tx, AUDIENCE_SQL, [globalId, groupId]));
    if (audience.ok !== true || !Array.isArray(audience.data)) return;
    const ids = audience.data.filter(isText);
    if (ids.length === 0) return;

    const rows = await db.transaction(async (tx) => {
      await tx.query(READ_ONLY, []);
      return tx.query(COMPLETIONS_SQL, [JSON.stringify(ids), puzzleId]);
    });

    for (const row of rows) {
      const params = completionParams(row, puzzleId);
      if (!params) continue;
      try {
        await asGameServer(db, (tx) => hubAnswer(tx, RECORD_COMPLETION_SQL, params));
      } catch (error) {
        logFailure("recording a result", error);
      }
    }
  } catch (error) {
    logFailure("sharing results", error);
  }
}

// ── The request ──

/** Exactly { op, args }, with op a string. Anything else is not a request. */
async function readRequest(req: Request): Promise<{ op: string; args: unknown } | null> {
  if (Number(req.headers.get("content-length") ?? 0) > BODY_MAX) return null;
  const text = await req.text().catch(() => "");
  if (text.length > BODY_MAX) return null;
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isPlainObject(body) || !isText(body.op)) return null;
  if (Object.keys(body).some((key) => key !== "op" && key !== "args")) return null;
  return { op: body.op, args: body.args };
}

/** Rules 1 to 8 from the top of this file. */
async function answerRequest(req: Request, deps: GatewayDeps): Promise<Answer> {
  if (deps.keys.publishable.length === 0 || deps.keys.secret.length === 0) {
    console.error("social-gateway: the project's publishable/secret API keys are not available");
    return UNAVAILABLE;
  }
  if (!isCurrentApiKey(req.headers.get("apikey") ?? "", deps.keys)) return UNAVAILABLE;

  const request = await readRequest(req);
  if (!request || !has(OPERATIONS, request.op)) return UNAVAILABLE;
  const { op, args } = request;
  const operation = OPERATIONS[op];
  const token = bearerToken(req, deps.keys);

  if (op === "previewInvite") {
    if (!argsFit(operation, args) || !deps.allowPreview()) return UNAVAILABLE;
    const caller = await previewCaller(token, deps);
    return asGateway(deps.db, (tx) => hubAnswer(tx, operation.sql!, [caller, ...operation.params(args)]));
  }

  if (!token) return refuse("not_signed_in");
  const user = await deps.verifyUserToken(token);
  if (!user || user.isAnonymous) return refuse("not_signed_in");

  const globalId = await readGlobalId(user.id, deps.db);
  if (!globalId) return refuse("not_linked");

  if (!(await mayUse(globalId, deps))) return refuse("game_disabled");

  if (!argsFit(operation, args)) return UNAVAILABLE;

  if (op === "listResults" && args.gameId === "rainbow") {
    await shareCompletions(globalId, args.puzzleId as string, (args.groupId as string | undefined) ?? null, deps.db);
  }

  return asGateway(deps.db, async (tx) => {
    const ensured = await hubAnswer(tx, ENSURE_PERSON_SQL, [globalId]);
    if (!ensured.ok || operation.sql === null) return ensured;
    return hubAnswer(tx, operation.sql, [globalId, ...operation.params(args)]);
  });
}

export async function handleSocialGateway(req: Request, deps: GatewayDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, UNAVAILABLE);
  try {
    return json(200, await answerRequest(req, deps));
  } catch (error) {
    logFailure("a request", error);
    return json(200, UNAVAILABLE);
  }
}
