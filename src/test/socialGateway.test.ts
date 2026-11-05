/**
 * social-gateway's rules, through core.ts with fakes for Auth and the database.
 * The fake database records each statement with the role and the transaction it
 * ran in, so "as which role, in what order" is asserted, not assumed. It can't
 * show that the SQL runs: that is for the local stack.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpName, Operations } from "@/social/contract";
import {
  COMPLETIONS_SQL,
  OPERATIONS,
  authCouldNotAnswer,
  corsHeaders,
  createPreviewThrottle,
  handleSocialGateway,
  readAccess,
  readApiKeys,
  serverSecretKey,
  transactionPoolerUrl,
  type GatewayDb,
  type GatewayDeps,
  type Queries,
} from "../../supabase/functions/social-gateway/core";
import * as feedback from "../../supabase/functions/submit-feedback/core";

// Made-up keys in the new formats. Nothing here is a real credential.
const PUBLISHABLE = "sb_publishable_TEST_publishable_key_0001";
const SECRET = "sb_secret_TEST_secret_key_0001";
const TOKEN = "user-session-token-accepted-by-auth";
const USER_ID = "7f1c6a52-0000-4000-8000-000000000001";
const GLOBAL_ID = "user_01CALLERCALLERCALLER";
const FRIEND_ID = "user_01FRIENDFRIENDFRIEND";

const UNAVAILABLE = { ok: false, outcome: "unavailable" };
const HUB_ANSWER = { ok: true, data: { from: "the mapped function", list: [1, 2] } };
const ENSURED = { ok: true, data: { displayName: "Ada", friendCode: "ABC-234" } };

const signedIn = { apikey: PUBLISHABLE, authorization: `Bearer ${TOKEN}` };
const guest = { apikey: PUBLISHABLE };

interface Statement {
  role: string;
  text: string;
  params: unknown[];
  transaction: number;
}

interface World {
  account: boolean;
  tester: unknown;
  ensured: unknown;
  hubAnswer: unknown;
  audience: unknown;
  /** What the reader of finished games returns, or a function that filters by the statement it was given. */
  sessions: Record<string, unknown>[] | ((text: string) => Record<string, unknown>[]);
  /** A statement matching this throws. */
  failOn: RegExp | null;
  /** The first statement matching this throws, and no other. */
  failOnceOn: RegExp | null;
  /** record_completion throws for this global id. */
  recordFailsFor: string | null;
}

/** A database error quoting what it was given, as real ones can. */
const ERROR_TEXT = `database detail for ${GLOBAL_ID} with ${TOKEN} and private-argument-value`;
const databaseError = () => Object.assign(new Error(ERROR_TEXT), { code: "42501" });

function setup(overrides: Partial<World> = {}, deps: Partial<GatewayDeps> = {}) {
  const world: World = {
    account: true,
    tester: true,
    ensured: ENSURED,
    hubAnswer: HUB_ANSWER,
    audience: { ok: true, data: [GLOBAL_ID, FRIEND_ID] },
    sessions: [],
    failOn: null,
    failOnceOn: null,
    recordFailsFor: null,
    ...overrides,
  };
  const statements: Statement[] = [];
  let transactions = 0;

  const answer = (text: string, params: unknown[]): Record<string, unknown>[] => {
    if (world.failOn?.test(text)) throw databaseError();
    if (world.failOnceOn?.test(text)) {
      world.failOnceOn = null;
      throw databaseError();
    }
    if (text === "set transaction read only") return [];
    if (text.includes("from public.accounts where user_id")) return world.account ? [{ global_user_id: GLOBAL_ID }] : [];
    if (text.includes("social.is_beta_tester")) return [{ allowed: world.tester }];
    if (text.includes("social.ensure_person")) return [{ result: world.ensured }];
    if (text.includes("social.audience_global_ids")) return [{ result: world.audience }];
    if (text.includes("public.game_sessions")) {
      return typeof world.sessions === "function" ? world.sessions(text) : world.sessions;
    }
    if (text.includes("social.record_completion")) {
      if (params[0] === world.recordFailsFor) throw databaseError();
      return [{ result: { ok: true, data: {} } }];
    }
    return [{ result: world.hubAnswer }];
  };

  const db: GatewayDb = {
    async transaction<T>(work: (tx: Queries) => Promise<T>): Promise<T> {
      transactions += 1;
      const transaction = transactions;
      let role = "own";
      return work({
        async query(text, params) {
          const switched = /^set local role (\w+)$/.exec(text);
          if (switched) {
            role = switched[1];
            return [];
          }
          statements.push({ role, text, params, transaction });
          return answer(text, params);
        },
      });
    },
  };

  const verifyUserToken = vi.fn(async (token: string) => (token === TOKEN ? { id: USER_ID, isAnonymous: false } : null));
  const fullDeps: GatewayDeps = {
    keys: { publishable: [PUBLISHABLE], secret: [SECRET] },
    verifyUserToken,
    allowPreview: () => true,
    access: "allow-list",
    db,
    ...deps,
  };
  return { deps: fullDeps, statements, verifyUserToken, world };
}

function request(body: unknown, headers: Record<string, string> = signedIn, method = "POST") {
  return new Request("http://localhost/functions/v1/social-gateway", {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: method === "POST" ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
  });
}

async function post(deps: GatewayDeps, body: unknown, headers: Record<string, string> = signedIn) {
  const response = await handleSocialGateway(request(body, headers), deps);
  const text = await response.text();
  return { status: response.status, headers: response.headers, text, body: JSON.parse(text) };
}

const send = (deps: GatewayDeps, op: string, args: unknown, headers?: Record<string, string>) => post(deps, { op, args }, headers);

/** The first object a statement names. The finished-games read has its own name, for reading sequences. */
const named = ({ text }: Statement) =>
  text === COMPLETIONS_SQL ? "read finished games" : (/(?:social|public)\.\w+/.exec(text)?.[0] ?? text);

const last = (statements: Statement[]) => statements[statements.length - 1];

const spyOnConsoleError = () => vi.spyOn(console, "error").mockImplementation(() => {});
let consoleError: ReturnType<typeof spyOnConsoleError>;

beforeEach(() => {
  consoleError = spyOnConsoleError();
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("social-gateway: the request", () => {
  it("answers a preflight with the CORS headers and touches nothing", async () => {
    const { deps, statements, verifyUserToken } = setup();
    const response = await handleSocialGateway(request(null, guest, "OPTIONS"), deps);

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-headers")).toBe(corsHeaders["Access-Control-Allow-Headers"]);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(verifyUserToken).not.toHaveBeenCalled();
    expect(statements).toEqual([]);
  });

  it.each(["GET", "DELETE", "PATCH"])("refuses %s before anything else", async (method) => {
    const { deps, statements, verifyUserToken } = setup();
    const response = await handleSocialGateway(request(null, signedIn, method), deps);

    expect(response.status).toBe(405);
    expect(await response.json()).toEqual(UNAVAILABLE);
    expect(verifyUserToken).not.toHaveBeenCalled();
    expect(statements).toEqual([]);
  });

  it("puts the CORS headers on an answer", async () => {
    const { deps } = setup();
    const { headers } = await send(deps, "listFriends", {});
    expect(headers.get("access-control-allow-origin")).toBe("*");
  });

  it.each<[string, Record<string, string>]>([
    ["no apikey", { authorization: `Bearer ${TOKEN}` }],
    ["a made-up apikey", { apikey: "sb_publishable_not_this_project", authorization: `Bearer ${TOKEN}` }],
  ])("refuses %s before reading the operation", async (_label, headers) => {
    const { deps, statements, verifyUserToken } = setup();

    expect((await send(deps, "listFriends", {}, headers)).body).toEqual(UNAVAILABLE);

    expect(verifyUserToken).not.toHaveBeenCalled();
    expect(statements).toEqual([]);
  });

  it("refuses a legacy JWT apikey", async () => {
    const b64 = (value: object) => btoa(JSON.stringify(value)).replace(/=+$/, "");
    const legacy = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ role: "anon", iss: "supabase" })}.signature`;
    const { deps } = setup();

    expect((await send(deps, "listFriends", {}, { apikey: legacy, authorization: `Bearer ${TOKEN}` })).body).toEqual(UNAVAILABLE);
  });

  it("fails closed without the project's keys", async () => {
    const { deps, statements, verifyUserToken } = setup({}, { keys: { publishable: [], secret: [] } });

    expect((await send(deps, "listFriends", {})).body).toEqual(UNAVAILABLE);

    expect(verifyUserToken).not.toHaveBeenCalled();
    expect(statements).toEqual([]);
  });

  it.each<[string, unknown]>([
    ["recordCompletion", { op: "recordCompletion", args: { gameId: "rainbow", globalUserId: GLOBAL_ID } }],
    ["an unknown operation", { op: "dropEverything", args: {} }],
    ["a name every object inherits", { op: "constructor", args: {} }],
    ["another of those", { op: "__proto__", args: {} }],
    ["no operation", { args: {} }],
    ["an operation that isn't text", { op: 7, args: {} }],
    ["a field beside op and args", { op: "listFriends", args: {}, globalUserId: FRIEND_ID }],
    ["a body that isn't JSON", "{not json"],
    ["a JSON list", []],
    ["JSON null", "null"],
  ])("answers unavailable for %s, before any sign-in check", async (_label, body) => {
    const { deps, statements, verifyUserToken } = setup();

    const answer = await post(deps, body, guest);

    expect(answer.status).toBe(200);
    expect(answer.body).toEqual(UNAVAILABLE);
    expect(verifyUserToken).not.toHaveBeenCalled();
    expect(statements).toEqual([]);
  });
});

describe("social-gateway: the order of the checks", () => {
  /** The same bad-args call, so each step shows it comes before the argument check. */
  const badArgs = { nonsense: true };

  it("not signed in comes first: no token reaches nothing", async () => {
    const { deps, statements, verifyUserToken } = setup();

    expect((await send(deps, "setDisplayName", badArgs, guest)).body).toEqual({ ok: false, outcome: "not_signed_in" });

    expect(verifyUserToken).not.toHaveBeenCalled();
    expect(statements).toEqual([]);
  });

  it.each<[string, string]>([
    ["a token Auth refuses", "Bearer token-auth-refuses"],
    ["a malformed header", "Basic something"],
    ["a header with no token", "Bearer "],
    ["the API key, which means signed out", `Bearer ${PUBLISHABLE}`],
    ["the secret key, which means signed out too", `Bearer ${SECRET}`],
  ])("%s is not signed in", async (_label, authorization) => {
    const { deps, statements } = setup();

    const { body } = await send(deps, "setDisplayName", badArgs, { apikey: PUBLISHABLE, authorization });

    expect(body).toEqual({ ok: false, outcome: "not_signed_in" });
    expect(statements).toEqual([]);
  });

  it("an anonymous user is not signed in, whatever Auth says of the token", async () => {
    const { deps, statements } = setup({}, { verifyUserToken: async () => ({ id: USER_ID, isAnonymous: true }) });

    expect((await send(deps, "listFriends", {})).body).toEqual({ ok: false, outcome: "not_signed_in" });

    expect(statements).toEqual([]);
  });

  it("no accounts row is not linked, and the allow-list isn't asked", async () => {
    const { deps, statements } = setup({ account: false });

    expect((await send(deps, "setDisplayName", badArgs)).body).toEqual({ ok: false, outcome: "not_linked" });

    expect(statements.map(named)).toEqual(["public.accounts"]);
  });

  it.each([false, null, "true", 1])("someone the allow-list answers %j for gets game_disabled, and the hub never hears of them", async (tester) => {
    const { deps, statements } = setup({ tester });

    expect((await send(deps, "setDisplayName", badArgs)).body).toEqual({ ok: false, outcome: "game_disabled" });

    expect(statements.map(named)).toEqual(["public.accounts", "social.is_beta_tester"]);
    expect(statements[1].role).toBe("social_gateway");
  });

  it("the arguments come after the allow-list and before the hub", async () => {
    const { deps, statements } = setup();

    expect((await send(deps, "setDisplayName", badArgs)).body).toEqual(UNAVAILABLE);

    expect(statements.map(named)).toEqual(["public.accounts", "social.is_beta_tester"]);
  });

  it("then ensure_person and the mapped function, in one transaction as social_gateway", async () => {
    const { deps, statements } = setup();

    const { status, body } = await send(deps, "setDisplayName", { name: "Ada" });

    expect(status).toBe(200);
    expect(body).toEqual(HUB_ANSWER);
    expect(statements.map(named)).toEqual([
      "public.accounts",
      "social.is_beta_tester",
      "social.ensure_person",
      "social.set_display_name",
    ]);
    expect(statements[0].role).toBe("own");
    const [ensure, mapped] = statements.slice(2);
    expect([ensure.role, mapped.role]).toEqual(["social_gateway", "social_gateway"]);
    expect(ensure.transaction).toBe(mapped.transaction);
    expect(ensure.text).toContain("'rainbow'");
    expect(ensure.params).toEqual([GLOBAL_ID]);
    expect(mapped.params).toEqual([GLOBAL_ID, "Ada"]);
  });

  it("stops at ensure_person if it refuses, and returns that answer", async () => {
    const refusal = { ok: false, outcome: "not_linked" };
    const { deps, statements } = setup({ ensured: refusal });

    expect((await send(deps, "listFriends", {})).body).toEqual(refusal);

    expect(statements.map(named)).not.toContain("social.list_friends");
  });
});

describe("social-gateway: identity comes only from the token", () => {
  /** JWT-shaped, with claims of someone else. Only Auth's answer may count. */
  const b64 = (value: object) => btoa(JSON.stringify(value)).replace(/=+$/, "");
  const claiming = (claims: object) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64(claims)}.signature`;

  it("doesn't read a token's claims: a forged one Auth refuses is not signed in", async () => {
    const { deps, statements, verifyUserToken } = setup();
    const forged = claiming({ sub: USER_ID, role: "service_role", is_anonymous: false });

    const { body } = await send(deps, "listFriends", {}, { apikey: PUBLISHABLE, authorization: `Bearer ${forged}` });

    expect(body).toEqual({ ok: false, outcome: "not_signed_in" });
    expect(verifyUserToken).toHaveBeenCalledWith(forged);
    expect(statements).toEqual([]);
  });

  it("looks the account up by the id Auth gave, not by what the token claims", async () => {
    const authSays = "11111111-0000-4000-8000-000000000001";
    const claimed = claiming({ sub: "22222222-0000-4000-8000-000000000002" });
    const { deps, statements } = setup({}, { verifyUserToken: async () => ({ id: authSays, isAnonymous: false }) });

    await send(deps, "listFriends", {}, { apikey: PUBLISHABLE, authorization: `Bearer ${claimed}` });

    expect(statements[0].params).toEqual([authSays]);
  });

  it.each(["globalUserId", "global_user_id", "userId", "accountId", "email", "personId"])(
    "refuses an identity in the arguments: %s",
    async (field) => {
      const { deps, statements } = setup();

      const { body } = await send(deps, "setDisplayName", { name: "Ada", [field]: FRIEND_ID });

      expect(body).toEqual(UNAVAILABLE);
      expect(statements.map(named)).not.toContain("social.ensure_person");
      expect(JSON.stringify(statements)).not.toContain(FRIEND_ID);
    },
  );

  it("puts the caller's id first on every call, from the account row", async () => {
    const { deps, statements } = setup();

    await send(deps, "removeFriend", { friendRef: "ref-1" });

    expect(last(statements).params).toEqual([GLOBAL_ID, "ref-1"]);
  });
});

describe("social-gateway: strict arguments", () => {
  const PHOTO_ARGS = { groupId: "g", emblemId: "book", accentColor: "#DED1F2" };
  const AFTER = { joinedAt: "2026-10-30T18:00:00.000Z", memberRef: "m" };

  const BAD: [string, string, unknown][] = [
    ["an unknown field", "setDisplayName", { name: "Ada", extra: 1 }],
    ["a missing field", "setDisplayName", {}],
    ["the wrong type", "setDisplayName", { name: 42 }],
    ["null for text", "setDisplayName", { name: null }],
    ["no args at all", "getMe", undefined],
    ["a list for args", "getMe", []],
    ["null for args", "getMe", null],
    ["a field on an operation with none", "getMe", { name: "Ada" }],
    ["a noticeVersion that is text", "createFriendInvite", { noticeVersion: "1" }],
    ["a noticeVersion that is a fraction", "createFriendInvite", { noticeVersion: 1.5 }],
    ["a noticeVersion that is null", "createGroup", { name: "G", myName: "A", noticeVersion: null }],
    ["a noticeVersion that is missing", "joinGroup", { code: "c", myName: "A" }],
    ["a noticeVersion too big for the column", "sendFriendRequest", { requestRef: "r", noticeVersion: 2147483648 }],
    ["a photo left out", "setGroupAppearance", PHOTO_ARGS],
    ["a photo that is a number", "setGroupAppearance", { ...PHOTO_ARGS, photo: 1 }],
    ["a cursor that isn't one", "listMembers", { groupId: "g", after: "m" }],
    ["a cursor with a bad time", "listMembers", { groupId: "g", after: { ...AFTER, joinedAt: "yesterday" } }],
    ["a cursor with an extra field", "listMembers", { groupId: "g", after: { ...AFTER, extra: 1 } }],
    ["a cursor missing its ref", "listMembers", { groupId: "g", after: { joinedAt: AFTER.joinedAt } }],
    ["a limit that is text", "listMembers", { groupId: "g", limit: "5" }],
    ["a limit that is a fraction", "listMembers", { groupId: "g", limit: 2.5 }],
    ["an unknown game", "listResults", { gameId: "chess", puzzleId: "p" }],
    ["a puzzle id with a space", "listResults", { gameId: "rainbow", puzzleId: "p 1" }],
    ["a puzzle id too long", "listResults", { gameId: "rainbow", puzzleId: "p".repeat(65) }],
    ["a group that is null", "listResults", { gameId: "rainbow", puzzleId: "p", groupId: null }],
  ];

  it.each(BAD)("%s answers unavailable and reaches no hub function", async (_label, op, args) => {
    const { deps, statements } = setup();

    expect((await send(deps, op, args)).body).toEqual(UNAVAILABLE);

    expect(statements.map(named)).toEqual(["public.accounts", "social.is_beta_tester"]);
  });

  it("leaves a whole number to the hub, which judges the notice itself", async () => {
    const refusal = { ok: false, outcome: "notice_required" };
    const { deps, statements } = setup({ hubAnswer: refusal });

    expect((await send(deps, "createFriendInvite", { noticeVersion: 0 })).body).toEqual(refusal);

    expect(last(statements).params).toEqual([GLOBAL_ID, 0]);
  });

  it("accepts a photo of null, as a group with no picture has", async () => {
    const { deps, statements } = setup();

    expect((await send(deps, "setGroupAppearance", { ...PHOTO_ARGS, photo: null })).body).toEqual(HUB_ANSWER);

    expect(last(statements).params).toEqual([GLOBAL_ID, "g", "book", null, "#DED1F2"]);
  });

  it("sends null for what listMembers leaves out", async () => {
    const { deps, statements } = setup();

    await send(deps, "listMembers", { groupId: "g" });

    expect(last(statements).params).toEqual([GLOBAL_ID, "g", null, null, null]);
  });
});

// Typed against the contract, so an operation or field that changes there stops
// this compiling, and the key check below ties the same list to the gateway's table.
type Case<O extends OpName> = { args: Operations[O]["args"]; fn: string; params: unknown[] };

const NOTICE = 1;
const HOSTILE = "'; drop schema social cascade; --";
const AFTER_ROW = { joinedAt: "2026-10-30T18:00:00.000Z", memberRef: "m-1" };

const CASES: { [O in OpName]: Case<O> } = {
  getMe: { args: {}, fn: "social.ensure_person", params: [] },
  setDisplayName: { args: { name: HOSTILE }, fn: "social.set_display_name", params: [HOSTILE] },
  setProfile: {
    args: { displayName: "Ada", animalId: "fox", backgroundColor: "#DED1F2" },
    fn: "social.set_profile",
    params: ["Ada", "fox", "#DED1F2"],
  },
  createFriendInvite: { args: { noticeVersion: NOTICE }, fn: "social.create_friend_invite", params: [NOTICE] },
  previewInvite: { args: { code: "abc" }, fn: "social.preview_invite", params: ["abc"] },
  acceptFriendInvite: { args: { code: "abc", noticeVersion: NOTICE }, fn: "social.accept_friend_invite", params: ["abc", NOTICE] },
  findFriendByCode: { args: { friendCode: "ABC-234" }, fn: "social.find_friend_by_code", params: ["ABC-234"] },
  sendFriendRequest: { args: { requestRef: "r", noticeVersion: NOTICE }, fn: "social.send_friend_request", params: ["r", NOTICE] },
  listFriendRequests: { args: {}, fn: "social.list_friend_requests", params: [] },
  acceptFriendRequest: { args: { requestRef: "r", noticeVersion: NOTICE }, fn: "social.accept_friend_request", params: ["r", NOTICE] },
  declineFriendRequest: { args: { requestRef: "r" }, fn: "social.decline_friend_request", params: ["r"] },
  cancelFriendRequest: { args: { requestRef: "r" }, fn: "social.cancel_friend_request", params: ["r"] },
  listFriends: { args: {}, fn: "social.list_friends", params: [] },
  listFriendPreferences: { args: {}, fn: "social.list_friend_preferences", params: [] },
  setFriendPreference: { args: { friendRef: "ref", favorite: true, nickname: "Pal" }, fn: "social.set_friend_preference", params: ["ref", true, "Pal"] },
  removeFriend: { args: { friendRef: "f" }, fn: "social.remove_friend", params: ["f"] },
  block: { args: { ref: "f" }, fn: "social.block", params: ["f"] },
  unblock: { args: { blockRef: "b" }, fn: "social.unblock", params: ["b"] },
  listBlocks: { args: {}, fn: "social.list_blocks", params: [] },
  createGroup: { args: { name: "G", myName: "A", noticeVersion: NOTICE }, fn: "social.create_group", params: ["G", "A", NOTICE] },
  joinGroup: { args: { code: "c", myName: "A", noticeVersion: NOTICE }, fn: "social.join_group", params: ["c", "A", NOTICE] },
  listGroupOrder: { args: {}, fn: "social.list_group_order", params: [] },
  setGroupOrder: { args: { groupIds: ["g1", "g2"] }, fn: "social.set_group_order", params: [["g1", "g2"]] },
  listMyGroups: { args: {}, fn: "social.list_my_groups", params: [] },
  listMembers: {
    args: { groupId: "g", after: AFTER_ROW, limit: 5 },
    fn: "social.list_members",
    params: ["g", AFTER_ROW.joinedAt, AFTER_ROW.memberRef, 5],
  },
  leaveGroup: { args: { groupId: "g" }, fn: "social.leave_group", params: ["g"] },
  renameMeInGroup: { args: { groupId: "g", name: "A" }, fn: "social.rename_me_in_group", params: ["g", "A"] },
  getGroupDescription: { args: { groupId: "g1" }, fn: "social.get_group_description", params: ["g1"] },
  setGroupDescription: { args: { groupId: "g1", description: "Weekly puzzles" }, fn: "social.set_group_description", params: ["g1", "Weekly puzzles"] },
  renameGroup: { args: { groupId: "g", name: "G" }, fn: "social.rename_group", params: ["g", "G"] },
  setGroupAppearance: {
    args: { groupId: "g", emblemId: "book", photo: null, accentColor: "#DED1F2" },
    fn: "social.set_group_appearance",
    params: ["g", "book", null, "#DED1F2"],
  },
  removeMember: { args: { groupId: "g", memberRef: "m" }, fn: "social.remove_member", params: ["g", "m"] },
  listRemoved: { args: { groupId: "g" }, fn: "social.list_removed", params: ["g"] },
  letBackIn: { args: { groupId: "g", removedRef: "x" }, fn: "social.let_back_in", params: ["g", "x"] },
  replaceInvite: { args: { groupId: "g" }, fn: "social.replace_invite", params: ["g"] },
  // Not Rainbow, so no results are read first and the statement list stays this one call.
  listResults: { args: { gameId: "yodel", puzzleId: "p-1", groupId: "g" }, fn: "social.list_results", params: ["yodel", "p-1", "g"] },
  deleteMySocialData: { args: {}, fn: "social.delete_person", params: [] },
};

describe("social-gateway: the operation table", () => {
  it("covers exactly the contract's operations", () => {
    expect(Object.keys(OPERATIONS).sort()).toEqual(Object.keys(CASES).sort());
  });

  it("has no route for a result", () => {
    expect(JSON.stringify(Object.values(OPERATIONS).map((operation) => operation.sql))).not.toContain("record_completion");
    expect(Object.keys(OPERATIONS)).not.toContain("recordCompletion");
  });

  const mapped = (Object.keys(CASES) as OpName[]).filter((op) => op !== "getMe" && op !== "previewInvite");

  it.each(mapped)("%s reaches its one function, with its arguments in order", async (op) => {
    const { args, fn, params } = CASES[op];
    const { deps, statements } = setup();

    expect((await send(deps, op, args)).body).toEqual(HUB_ANSWER);

    const hub = statements.slice(2);
    expect(hub.map(named)).toEqual(["social.ensure_person", fn]);
    expect(hub[1].role).toBe("social_gateway");
    expect(hub[1].params).toEqual([GLOBAL_ID, ...params]);
    expect(new Set(hub[1].text.match(/\$\d+/g)).size).toBe(1 + params.length);
  });

  it.each(["true", 1, null, undefined])("refuses invalid favorite values before a database write: %s", async favorite => {
    const { deps, statements } = setup();
    expect((await send(deps, "setFriendPreference", { friendRef: "ref", favorite, nickname: null })).body).toEqual(UNAVAILABLE);
    expect(statements.map(named)).toEqual(["public.accounts", "social.is_beta_tester"]);
  });

  it("getMe is answered by ensure_person alone", async () => {
    const { deps, statements } = setup();

    expect((await send(deps, "getMe", {})).body).toEqual(ENSURED);

    expect(statements.map(named).slice(2)).toEqual(["social.ensure_person"]);
  });

  it("returns a hub refusal exactly", async () => {
    const refusal = { ok: false, outcome: "not_a_member" };
    const { deps } = setup({ hubAnswer: refusal });

    expect((await send(deps, "listMembers", { groupId: "g" })).body).toEqual(refusal);
  });

  it("binds what a caller sends: no statement's text changes with the input", async () => {
    const { deps, statements } = setup();

    await send(deps, "setDisplayName", CASES.setDisplayName.args);

    for (const statement of statements) expect(statement.text).not.toContain("drop schema");
    expect(last(statements).params).toEqual([GLOBAL_ID, HOSTILE]);
  });
});

describe("social-gateway: previewInvite", () => {
  const PREVIEW = { ok: true, data: { name: "Book club", isMember: false, isRemoved: false } };
  const preview = (deps: GatewayDeps, headers?: Record<string, string>) => send(deps, "previewInvite", { code: "abc" }, headers);

  it("needs no session: a guest gets the guest view, with no Auth call", async () => {
    const { deps, statements, verifyUserToken } = setup({ hubAnswer: PREVIEW });

    expect((await preview(deps, guest)).body).toEqual(PREVIEW);

    expect(verifyUserToken).not.toHaveBeenCalled();
    expect(statements.map(named)).toEqual(["social.preview_invite"]);
    expect(statements[0].role).toBe("social_gateway");
    expect(statements[0].params).toEqual([null, "abc"]);
  });

  it("gives a tester's token the flags, and creates nobody", async () => {
    const { deps, statements } = setup({ hubAnswer: PREVIEW });

    expect((await preview(deps)).body).toEqual(PREVIEW);

    expect(last(statements).params).toEqual([GLOBAL_ID, "abc"]);
    expect(statements.map(named)).not.toContain("social.ensure_person");
  });

  it.each<[string, Partial<World>, Partial<GatewayDeps>, string]>([
    ["a token Auth refuses", {}, {}, "Bearer token-auth-refuses"],
    ["the API key", {}, {}, `Bearer ${PUBLISHABLE}`],
    ["an anonymous user", {}, { verifyUserToken: async () => ({ id: USER_ID, isAnonymous: true }) }, `Bearer ${TOKEN}`],
    ["an auth user with no account row", { account: false }, {}, `Bearer ${TOKEN}`],
    ["someone not on the allow-list", { tester: false }, {}, `Bearer ${TOKEN}`],
    ["Auth being unreachable", {}, { verifyUserToken: () => Promise.reject(new Error(ERROR_TEXT)) }, `Bearer ${TOKEN}`],
    ["the account read failing", { failOn: /public\.accounts/ }, {}, `Bearer ${TOKEN}`],
  ])("gives the guest view to %s", async (_label, world, depsOverride, authorization) => {
    const { deps, statements } = setup({ hubAnswer: PREVIEW, ...world }, depsOverride);

    const { text, body } = await preview(deps, { apikey: PUBLISHABLE, authorization });

    expect(body).toEqual(PREVIEW);
    expect(last(statements).params).toEqual([null, "abc"]);
    expect(text).not.toContain("database detail");
  });

  it.each<[string, unknown]>([
    ["an unknown field", { code: "abc", globalUserId: FRIEND_ID }],
    ["no code", {}],
    ["a code that isn't text", { code: 7 }],
  ])("checks its arguments too: %s", async (_label, args) => {
    const { deps, statements } = setup();

    expect((await send(deps, "previewInvite", args, guest)).body).toEqual(UNAVAILABLE);

    expect(statements).toEqual([]);
  });

  it("returns an invalid code's answer exactly", async () => {
    const refusal = { ok: false, outcome: "invalid_code" };
    const { deps } = setup({ hubAnswer: refusal });

    expect((await preview(deps, guest)).body).toEqual(refusal);
  });

  it("refuses a preview past the throttle before any Auth or database work", async () => {
    const { deps, statements, verifyUserToken } = setup({}, { allowPreview: () => false });

    expect((await preview(deps)).body).toEqual(UNAVAILABLE);

    expect(statements).toEqual([]);
    expect(verifyUserToken).not.toHaveBeenCalled();
  });

  it("leaves everything but previews out of the throttle", async () => {
    const allowPreview = vi.fn(() => false);
    const { deps } = setup({}, { allowPreview });

    expect((await send(deps, "listFriends", {})).body).toEqual(HUB_ANSWER);

    expect(allowPreview).not.toHaveBeenCalled();
  });
});

describe("social-gateway: limits on what a request can cost", () => {
  it.each<[string, unknown, Record<string, string> | undefined]>([
    ["previewInvite", { code: "c".repeat(65) }, guest],
    ["acceptFriendInvite", { code: "c".repeat(65), noticeVersion: 1 }, undefined],
    ["joinGroup", { code: "c".repeat(65), myName: "Ada", noticeVersion: 1 }, undefined],
    ["findFriendByCode", { friendCode: "c".repeat(65) }, undefined],
  ])("%s refuses an overlong code before reaching the hub", async (op, args, headers) => {
    const { deps, statements } = setup();

    expect((await send(deps, op, args, headers)).body).toEqual(UNAVAILABLE);

    expect(statements.some(({ text }) => /preview_invite|accept_friend_invite|join_group|find_friend_by_code/.test(text))).toBe(false);
  });

  it("still takes a code at the limit", async () => {
    const { deps } = setup();

    expect((await send(deps, "previewInvite", { code: "c".repeat(64) }, guest)).body).toEqual(HUB_ANSWER);
  });

  it("refuses an oversized body by its header and by its real size, with no sign-in check", async () => {
    const { deps, statements, verifyUserToken } = setup();
    const oversized = { op: "listFriends", args: {}, padding: "x".repeat(128 * 1024) };

    expect((await post(deps, oversized)).body).toEqual(UNAVAILABLE);
    expect((await post(deps, { op: "listFriends", args: {} }, { ...signedIn, "content-length": "200000" })).body).toEqual(UNAVAILABLE);

    expect(statements).toEqual([]);
    expect(verifyUserToken).not.toHaveBeenCalled();
  });

  it("takes a request carrying the largest group picture", async () => {
    const { deps } = setup();
    const photo = `data:image/jpeg;base64,${"A".repeat(Math.ceil(61440 / 3) * 4)}`;
    const args = { groupId: "g", emblemId: "e", photo, accentColor: "#123456" };

    expect((await send(deps, "setGroupAppearance", args)).body).toEqual(HUB_ANSWER);
  });

  it("throttles previews by the minute, then lets them through again", () => {
    let time = 1_000;
    const allow = createPreviewThrottle(2, 60_000, () => time);

    expect([allow(), allow(), allow()]).toEqual([true, true, false]);
    time += 59_999;
    expect(allow()).toBe(false);
    time += 1;
    expect(allow()).toBe(true);
  });

  it("reaches the pooler on the same host and login, and keeps a password's escaping", () => {
    expect(transactionPoolerUrl("postgresql://postgres:p%40ss%2Fword@db.example.supabase.co:5432/postgres")).toBe(
      "postgresql://postgres:p%40ss%2Fword@db.example.supabase.co:6543/postgres",
    );
  });

  it.each<[number | undefined, boolean]>([
    [400, false],
    [401, false],
    [403, false],
    [429, true],
    [500, true],
    [undefined, true],
  ])("Auth status %s: could not answer is %s", (status, expected) => {
    expect(authCouldNotAnswer(status)).toBe(expected);
  });
});

describe("social-gateway: automatic results", () => {
  const LIST = { ok: true, data: [{ friendRef: "f-1", isMe: false, name: "Ben", summary: { solved: true, mistakes: 1 } }] };
  const PUZZLE = "11111111-2222-4333-8444-555555555555";
  const ARGS = { gameId: "rainbow", puzzleId: PUZZLE };

  const finished = (globalId: string, overrides: Record<string, unknown> = {}) => ({
    global_user_id: globalId,
    status: "won",
    mistakes: 1,
    share_grid: "🟦🟦\n🟥🟥",
    completed_at: "2026-10-30T18:00:00.123Z",
    ...overrides,
  });

  const world = (overrides: Partial<World> = {}) =>
    setup({ hubAnswer: LIST, sessions: [finished(GLOBAL_ID), finished(FRIEND_ID)], ...overrides });

  const records = (statements: Statement[]) => statements.filter((statement) => named(statement) === "social.record_completion");
  const recordedFor = (statements: Statement[]) => records(statements).map((statement) => statement.params[0]);

  it("records first, in the right roles, and answers with listResults", async () => {
    const { deps, statements } = world();

    expect((await send(deps, "listResults", ARGS)).body).toEqual(LIST);

    expect(statements.slice(2).map((statement) => [statement.role, named(statement)])).toEqual([
      ["social_gateway", "social.ensure_person"],
      ["social_game_server", "social.audience_global_ids"],
      ["own", "set transaction read only"],
      ["own", "read finished games"],
      ["social_game_server", "social.record_completion"],
      ["social_game_server", "social.record_completion"],
      ["social_gateway", "social.ensure_person"],
      ["social_gateway", "social.list_results"],
    ]);
  });

  it("asks for the audience of the caller and the group", async () => {
    const { deps, statements } = world();

    await send(deps, "listResults", { ...ARGS, groupId: "g-1" });

    const audience = statements.find((statement) => named(statement) === "social.audience_global_ids");
    expect(audience?.params).toEqual([GLOBAL_ID, "g-1"]);
    expect(last(statements).params).toEqual([GLOBAL_ID, "rainbow", PUZZLE, "g-1"]);
  });

  it("asks for the caller's friends with no group", async () => {
    const { deps, statements } = world();

    await send(deps, "listResults", ARGS);

    const audience = statements.find((statement) => named(statement) === "social.audience_global_ids");
    expect(audience?.params).toEqual([GLOBAL_ID, null]);
    expect(last(statements).params).toEqual([GLOBAL_ID, "rainbow", PUZZLE, null]);
  });

  it("reads those ids and that puzzle, in a read-only transaction of its own", async () => {
    const { deps, statements } = world();

    await send(deps, "listResults", ARGS);

    const read = statements.find((statement) => statement.text === COMPLETIONS_SQL);
    expect(read?.params).toEqual([JSON.stringify([GLOBAL_ID, FRIEND_ID]), PUZZLE]);
    const inThatTransaction = statements.filter((statement) => statement.transaction === read?.transaction);
    expect(inThatTransaction.map(named)).toEqual(["set transaction read only", "read finished games"]);
  });

  it("reads only official full daily games that finished", async () => {
    // A stand-in for the database that applies only the conditions the statement
    // really carries, so taking one out lets its row through and this test fails.
    const DAY = 24 * 60 * 60 * 1000;
    const CONDITIONS: [string, (row: Record<string, unknown>) => boolean][] = [
      ["gs.is_official is true", (row) => row.is_official === true],
      ["gs.status in ('won', 'lost')", (row) => row.status === "won" || row.status === "lost"],
      ["gs.format = 'full'", (row) => row.format === "full"],
      ["gs.entry_context = 'daily_home'", (row) => row.entry_context === "daily_home"],
      ["gs.puzzle_id = $2::text", (row) => row.puzzle_id === PUZZLE],
      ["join public.puzzles p on p.id::text = gs.puzzle_id", (row) => row.puzzle_exists === true],
      ["p.is_published is true", (row) => row.is_published === true],
      ["p.is_beta is false", (row) => row.is_beta === false],
      ["p.is_free_puzzle is not true", (row) => row.is_free_puzzle !== true],
      ["p.format = 'full'", (row) => row.puzzle_format === "full"],
      [
        "(gs.completed_at < (p.date + 2)::timestamp at time zone 'UTC' or p.id = (select h.id from public.puzzles h where h.is_published is true and h.format = 'full' and h.date <= (now() at time zone 'UTC')::date order by h.date desc limit 1))",
        (row) =>
          Date.parse(row.completed_at as string) < Date.parse(`${row.puzzle_date}T00:00:00.000Z`) + 2 * DAY ||
          row.home_daily === true,
      ],
    ];
    // The custom and beta pages send daily_home as well, so nearly every row here
    // does, and only the puzzle's own row can tell them apart.
    const daily = {
      is_official: true,
      format: "full",
      entry_context: "daily_home",
      puzzle_id: PUZZLE,
      puzzle_exists: true,
      is_published: true,
      is_beta: false,
      is_free_puzzle: false,
      puzzle_format: "full",
      puzzle_date: "2026-10-30",
    };
    const table = [
      finished("user_01OFFICIALDAILYGAME", daily),
      finished("user_01FREEFLAGNEVERSET0", { ...daily, is_free_puzzle: null }),
      finished("user_01LATEINLOCALEVENING", { ...daily, completed_at: "2026-10-31T23:59:59.999Z" }),
      finished("user_01NOTOFFICIALGAME00", { ...daily, is_official: false }),
      finished("user_01STILLINPROGRESS00", { ...daily, status: "in_progress" }),
      finished("user_01MINIFORMATGAME000", { ...daily, format: "mini" }),
      finished("user_01PLAYEDFROMARCHIVE", { ...daily, entry_context: "archive" }),
      finished("user_01ANOTHERPUZZLE0000", { ...daily, puzzle_id: "another-puzzle" }),
      finished("user_01CUSTOMNOPUZZLEROW", { ...daily, puzzle_exists: false }),
      finished("user_01UNPUBLISHEDPUZZLE", { ...daily, is_published: false }),
      finished("user_01BETAPAGEPLAYTEST0", { ...daily, is_beta: true }),
      finished("user_01FREEPUZZLEPLAYED0", { ...daily, is_free_puzzle: true }),
      finished("user_01MINIPUZZLEROW0000", { ...daily, puzzle_format: "mini" }),
      finished("user_01ARCHIVEATTHELIMIT", { ...daily, completed_at: "2026-11-01T00:00:00.000Z" }),
      finished("user_01ARCHIVEWEEKSLATER", { ...daily, completed_at: "2026-11-20T09:00:00.000Z" }),
      finished("user_01HOMEDAILYWEEKSLATER", { ...daily, completed_at: "2026-11-20T09:00:00.000Z", home_daily: true }),
      finished("user_01HOMEDAILYINARCHIVE0", { ...daily, completed_at: "2026-11-20T09:00:00.000Z", home_daily: true, entry_context: "archive_calendar" }),
      finished("user_01HOMEDAILYUNLIMITED0", { ...daily, completed_at: "2026-11-20T09:00:00.000Z", home_daily: true, entry_context: "free_collection" }),
    ];
    const reader = (text: string) => {
      const flat = text.replace(/\s+/g, " ");
      return table.filter((row) => CONDITIONS.every(([condition, holds]) => !flat.includes(condition) || holds(row)));
    };
    const { deps, statements } = world({ sessions: reader });

    await send(deps, "listResults", ARGS);

    expect(recordedFor(statements)).toEqual([
      "user_01OFFICIALDAILYGAME",
      "user_01FREEFLAGNEVERSET0",
      "user_01LATEINLOCALEVENING",
      "user_01HOMEDAILYWEEKSLATER",
    ]);
  });

  it("joins accounts to sessions by the local id and sessions to their puzzle, and writes nothing to them", () => {
    const flat = COMPLETIONS_SQL.replace(/\s+/g, " ");
    expect(flat).toContain(
      "from public.accounts a join public.game_sessions gs on gs.user_id = a.user_id join public.puzzles p on p.id::text = gs.puzzle_id",
    );
    expect(flat).not.toMatch(/\b(insert|update|delete|truncate|alter|drop|create|grant)\b/i);
  });

  it("sends exactly the summary, the detail and the millisecond time", async () => {
    const { deps, statements } = world({
      sessions: [finished(GLOBAL_ID), finished(FRIEND_ID, { status: "lost", mistakes: 4, share_grid: "🟥" })],
    });

    await send(deps, "listResults", ARGS);

    expect(records(statements).map((statement) => statement.params)).toEqual([
      [GLOBAL_ID, "rainbow", PUZZLE, "2026-10-30T18:00:00.123Z", '{"solved":true,"mistakes":1}', JSON.stringify("🟦🟦\n🟥🟥")],
      [FRIEND_ID, "rainbow", PUZZLE, "2026-10-30T18:00:00.123Z", '{"solved":false,"mistakes":4}', '"🟥"'],
    ]);
  });

  it("asks the database for milliseconds in UTC", () => {
    expect(COMPLETIONS_SQL).toContain(`to_char(gs.completed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);
  });

  it.each<[string, Record<string, unknown>]>([
    ["no grid", { share_grid: null }],
    ["a blank grid", { share_grid: "  \n " }],
    ["a grid that isn't text", { share_grid: 7 }],
    ["mistakes below zero", { mistakes: -1 }],
    ["mistakes that aren't whole", { mistakes: 1.5 }],
    ["mistakes that aren't a number", { mistakes: "2" }],
    ["a game still running", { status: "in_progress" }],
    ["no completion time", { completed_at: null }],
    ["a time without milliseconds", { completed_at: "2026-10-30T18:00:00Z" }],
  ])("skips a row with %s, and the others still go", async (_label, bad) => {
    const { deps, statements } = world({ sessions: [finished("user_01BADROWBADROW", bad), finished(FRIEND_ID)] });

    expect((await send(deps, "listResults", ARGS)).body).toEqual(LIST);

    expect(recordedFor(statements)).toEqual([FRIEND_ID]);
  });

  it("gives each row its own transaction, so one that throws can't stop the others", async () => {
    const { deps, statements } = world({ recordFailsFor: GLOBAL_ID });

    const { text, body } = await send(deps, "listResults", ARGS);

    expect(body).toEqual(LIST);
    expect(recordedFor(statements)).toEqual([GLOBAL_ID, FRIEND_ID]);
    expect(new Set(records(statements).map((statement) => statement.transaction)).size).toBe(2);
    expect(text).not.toContain("database detail");
  });

  it.each<[string, RegExp]>([
    ["making sure the caller exists", /social\.ensure_person/],
    ["the audience", /audience_global_ids/],
    ["the read", /public\.game_sessions/],
    ["recording", /record_completion/],
  ])("a failure at %s shows nothing, and listResults still decides what comes back", async (_label, failOnceOn) => {
    const { deps, statements } = world({ failOnceOn });

    const { text, body } = await send(deps, "listResults", ARGS);

    expect(body).toEqual(LIST);
    expect(text).not.toContain("database detail");
    expect(named(last(statements))).toBe("social.list_results");
  });

  it("records nothing when the caller can't see that group", async () => {
    const { deps, statements } = world({ audience: { ok: false, outcome: "not_a_member" }, hubAnswer: { ok: false, outcome: "not_a_member" } });

    const { body } = await send(deps, "listResults", { ...ARGS, groupId: "someone-elses" });

    expect(body).toEqual({ ok: false, outcome: "not_a_member" });
    expect(statements.map(named)).not.toContain("read finished games");
    expect(records(statements)).toEqual([]);
  });

  it("reads nothing for an audience out of shape", async () => {
    const { deps, statements } = world({ audience: { ok: true, data: "not a list" } });

    expect((await send(deps, "listResults", ARGS)).body).toEqual(LIST);

    expect(statements.map(named)).not.toContain("read finished games");
  });

  it("does this only for Rainbow", async () => {
    const { deps, statements } = world();

    expect((await send(deps, "listResults", { gameId: "wtf", puzzleId: PUZZLE })).body).toEqual(LIST);

    expect(statements.map(named).slice(2)).toEqual(["social.ensure_person", "social.list_results"]);
  });

  it.each<[string, Partial<World>, string]>([
    ["someone not on the allow-list", { tester: false }, "game_disabled"],
    ["someone with no account row", { account: false }, "not_linked"],
  ])("does nothing for %s", async (_label, overrides, outcome) => {
    const { deps, statements } = world(overrides);

    expect((await send(deps, "listResults", ARGS)).body).toEqual({ ok: false, outcome });

    expect(statements.map(named)).not.toContain("social.audience_global_ids");
    expect(statements.map(named)).not.toContain("read finished games");
  });

  it("does nothing for arguments that fail the check", async () => {
    const { deps, statements } = world();

    expect((await send(deps, "listResults", { ...ARGS, globalUserId: FRIEND_ID })).body).toEqual(UNAVAILABLE);

    expect(statements.map(named)).not.toContain("social.audience_global_ids");
  });

  it("never puts the audience's ids in a response or a log", async () => {
    const { deps } = world({ recordFailsFor: FRIEND_ID });

    const { text } = await send(deps, "listResults", ARGS);

    expect(text).not.toContain(FRIEND_ID);
    expect(text).not.toContain(GLOBAL_ID);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(FRIEND_ID);
  });
});

describe("social-gateway: failures show nothing", () => {
  const STEPS: [string, RegExp][] = [
    ["the account read", /public\.accounts/],
    ["the allow-list", /is_beta_tester/],
    ["ensure_person", /ensure_person/],
    ["the mapped function", /set_display_name/],
  ];

  it.each(STEPS)("a database failure at %s answers unavailable, with none of its text", async (_label, failOn) => {
    const { deps } = setup({ failOn });

    const { status, text, body } = await send(deps, "setDisplayName", { name: "private-argument-value" });

    expect(status).toBe(200);
    expect(body).toEqual(UNAVAILABLE);
    expect(text).not.toContain("database detail");
    expect(text).not.toContain("private-argument-value");
  });

  it.each(STEPS)("a failure at %s logs no token, global id, argument or error text", async (_label, failOn) => {
    const { deps } = setup({ failOn });

    await send(deps, "setDisplayName", { name: "private-argument-value" });

    expect(consoleError).toHaveBeenCalled();
    const logged = JSON.stringify(consoleError.mock.calls);
    for (const secret of [TOKEN, GLOBAL_ID, USER_ID, "private-argument-value", "database detail"]) {
      expect(logged).not.toContain(secret);
    }
  });

  it("logs an SQLSTATE and nothing more of the error", async () => {
    const { deps } = setup({ failOn: /ensure_person/ });

    await send(deps, "listFriends", {});

    expect(consoleError).toHaveBeenCalledWith("social-gateway: a request failed", "42501");
  });

  it("logs nothing at all on a success", async () => {
    const { deps } = setup();

    await send(deps, "listFriends", {});

    expect(consoleError).not.toHaveBeenCalled();
  });

  it("Auth being unreachable is unavailable, not a sign-out", async () => {
    const { deps, statements } = setup({}, { verifyUserToken: () => Promise.reject(new Error(ERROR_TEXT)) });

    const { text, body } = await send(deps, "listFriends", {});

    expect(body).toEqual(UNAVAILABLE);
    expect(text).not.toContain("database detail");
    expect(statements).toEqual([]);
  });

  it.each<[string, unknown]>([
    ["nothing", undefined],
    ["text", "ok"],
    ["no ok field", { data: {} }],
    ["an ok that isn't true or false", { ok: "yes" }],
  ])("a hub answer of %s is unavailable, not passed on", async (_label, hubAnswer) => {
    const { deps } = setup({ hubAnswer });

    expect((await send(deps, "listFriends", {})).body).toEqual(UNAVAILABLE);
  });
});

describe("social-gateway: reading the project's keys", () => {
  const ENVIRONMENTS: Record<string, string>[] = [
    {},
    { SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: PUBLISHABLE }), SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET }) },
    { SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE, SUPABASE_SECRET_KEY: SECRET },
    { SUPABASE_PUBLISHABLE_KEYS: "{not json", SUPABASE_SECRET_KEYS: "{not json" },
    { SUPABASE_PUBLISHABLE_KEY: "legacy.jwt.value", SUPABASE_SECRET_KEY: "legacy.jwt.value" },
  ];

  it.each(ENVIRONMENTS)("reads them as submit-feedback does: %j", (values) => {
    const env = (name: string) => values[name];
    expect(readApiKeys(env)).toEqual(feedback.readApiKeys(env));
    expect(serverSecretKey(env)).toEqual(feedback.serverSecretKey(env));
  });
});

describe("social-gateway: access for every Rainbow account", () => {
  it("reads only exactly `everyone` as open", () => {
    expect(readAccess("everyone")).toBe("everyone");
    for (const value of [undefined, "", "Everyone", "all", "true", " everyone"]) expect(readAccess(value)).toBe("allow-list");
  });

  it("lets a Rainbow account off the list in, without asking the list", async () => {
    const { deps, statements } = setup({ tester: false }, { access: "everyone" });

    expect((await send(deps, "listFriends", {})).body).toEqual(HUB_ANSWER);

    expect(statements.map(named)).not.toContain("social.is_beta_tester");
  });

  it("still refuses the same account while access is the allow-list", async () => {
    const { deps } = setup({ tester: false });

    expect((await send(deps, "listFriends", {})).body).toEqual({ ok: false, outcome: "game_disabled" });
  });

  it.each<[string, Partial<World>, Partial<GatewayDeps>, Record<string, string>, string]>([
    ["no token", {}, {}, guest, "not_signed_in"],
    ["a token Auth refuses", {}, {}, { apikey: PUBLISHABLE, authorization: "Bearer refused" }, "not_signed_in"],
    ["an anonymous user", {}, { verifyUserToken: async () => ({ id: USER_ID, isAnonymous: true }) }, signedIn, "not_signed_in"],
    ["an auth user with no Rainbow account", { account: false }, {}, signedIn, "not_linked"],
  ])("keeps every other check when open: %s", async (_label, world, depsOverride, headers, outcome) => {
    const { deps } = setup(world, { access: "everyone", ...depsOverride });

    expect((await send(deps, "listFriends", {}, headers)).body).toEqual({ ok: false, outcome });
  });

  it("gives an invitation's flags to any Rainbow account when open", async () => {
    const { deps, statements } = setup({ tester: false }, { access: "everyone" });

    await send(deps, "previewInvite", { code: "abc" });

    expect(last(statements).params).toEqual([GLOBAL_ID, "abc"]);
  });
});

