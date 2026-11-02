/* eslint-disable @typescript-eslint/no-explicit-any -- test helpers reading untyped JSON answers */
/**
 * What the real-stack social tests share.
 *
 * Importing this file is the safety check: `stack` below is built at module
 * load, so if the target isn't this machine's E2E stack the import throws and no
 * test, query or request ever starts.
 *
 * Everything real that can be real is: accounts come from GoTrue, tokens from
 * its password grant, the Rainbow account from the ensure_account RPC, and every
 * social call is an HTTP request to the running social-gateway. pg is used only
 * for what a browser can't do: the beta list, finished games, and counting rows.
 *
 * Keys and tokens never reach a message. Failures name a status or a label.
 */

import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import pg from "pg";
import { AVATAR_IDS, CURRENT_NOTICE_VERSION, FORBIDDEN_RESPONSE_KEYS, OUTCOMES, PROFILE_COLORS } from "../../src/social/contract.ts";
import { assertIsE2eStack, E2E_PORTS, E2E_PROJECT_DIR, E2E_SUPABASE_CONFIG, guardContext, loadE2eConfig } from "../env.ts";
import { ACCOUNTS, FULL_CLASSIC, MINI_CLASSIC } from "../fixtures/catalog.ts";
import { readSeedManifest } from "../fixtures/manifest.ts";
import { officialContent } from "../fixtures/payloads.ts";
import { assertDisposableTarget, disposableTargetViolations, linkedProjectRef, UnsafeTargetError, type DisposableTarget } from "../safety.ts";
import { containerRuntime, runCapture, supabaseCapture } from "../scripts/lib/process.ts";
import { attachPlatformIdentity } from "../scripts/lib/seed-supabase.ts";

// ── The target ──

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function isLocal(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * The guard, this project's own stack, and then this machine.
 * assertDisposableTarget also allows hosts named in the environment; these tests don't.
 */
export function refuseUnlessLocal(operation: string, target: DisposableTarget): void {
  assertDisposableTarget(operation, target, guardContext());
  assertIsE2eStack(target.apiUrl, target.dbUrl);
  for (const url of [target.apiUrl, target.dbUrl, target.appUrl]) {
    if (!isLocal(url)) {
      throw new UnsafeTargetError(operation, ["an endpoint is not on this machine"]);
    }
  }
}

export interface Stack extends DisposableTarget {
  gatewayUrl: string;
  /** The gateway accepts only this kind of apikey. */
  publishableKey: string;
  /** Null when `supabase status` doesn't report one. Only the expired-token test needs it. */
  jwtSecret: string | null;
}

/** `supabase status -o env`, parsed as e2e/scripts/lib/stack.ts does. */
function readStatus(): Record<string, string> {
  const result = supabaseCapture(E2E_PROJECT_DIR, ["status", "-o", "env"]);
  if (result.code !== 0) {
    // Its output isn't repeated, because it can hold keys.
    throw new Error("`supabase status` failed. Start the stack with `npm run e2e:up`.");
  }
  const values: Record<string, string> = {};
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

function openStack(operation: string): Stack {
  // Before the CLI or the database is touched at all.
  const config = loadE2eConfig();
  refuseUnlessLocal(operation, config);

  const status = readStatus();
  const target: DisposableTarget = {
    ...config,
    apiUrl: (status.API_URL ?? config.apiUrl).replace("//localhost:", "//127.0.0.1:"),
    dbUrl: (status.DB_URL ?? config.dbUrl).replace("@localhost:", "@127.0.0.1:"),
    anonKey: status.ANON_KEY ?? "",
    serviceRoleKey: status.SERVICE_ROLE_KEY ?? "",
  };
  // Again, because these are the values that will actually be used.
  refuseUnlessLocal(operation, target);

  const publishableKey = status.PUBLISHABLE_KEY ?? "";
  if (!publishableKey.startsWith("sb_publishable_")) {
    throw new Error("`supabase status` reported no sb_publishable_ key, and the gateway accepts no other kind.");
  }
  // The guard refuses this prefix everywhere, so it can only be asked about everything else.
  const others = disposableTargetViolations({ ...target, anonKey: publishableKey }, guardContext())
    .filter((reason) => !reason.includes("sb_publishable_"));
  if (others.length > 0) throw new UnsafeTargetError(operation, others);

  return {
    ...target,
    gatewayUrl: `${target.apiUrl}/functions/v1/social-gateway`,
    publishableKey,
    jwtSecret: status.JWT_SECRET || null,
  };
}

export const stack: Stack = openStack("social real-stack tests");

/** Owns the database connections. An idle one dying in a restart is expected, not a crash. */
export const db = new pg.Pool({ connectionString: stack.dbUrl, max: 6 });
db.on("error", () => undefined);

export const closeStack = () => db.end();

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export const hex = (bytes: number) => randomBytes(bytes).toString("hex");

export async function count(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await db.query<{ n: number }>(sql, params);
  return Number(rows[0].n);
}

// ── People ──

export interface AuthUser {
  email: string;
  password: string;
  authUserId: string;
}

export interface Person extends AuthUser {
  label: string;
  globalId: string;
  token: string;
  /** The display name, avatar and colour, once `person` has set them. */
  name: string;
  animalId: string;
  backgroundColor: string;
}

/** Everything that must never come back from the gateway, per person. */
const known: { label: string; email: string; authUserId: string; globalId?: string }[] = [];

const jsonHeaders = (apikey: string, token: string) => ({
  apikey,
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
});

/** A confirmed auth user from GoTrue's admin API. Nothing else: no identity, no account. */
export async function makeAuthUser(label: string): Promise<AuthUser> {
  const email = `e2e-social-${hex(8)}@rainbow.test`;
  const password = hex(18);
  const response = await fetch(`${stack.apiUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: jsonHeaders(stack.serviceRoleKey, stack.serviceRoleKey),
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!response.ok) throw new Error(`GoTrue refused to create "${label}": ${response.status}`);
  const user = (await response.json()) as { id: string };
  known.push({ label, email, authUserId: user.id });
  return { email, password, authUserId: user.id };
}

/**
 * A real JWT from the password grant. GoTrue limits this route by IP, and a run
 * makes more people than its burst allows, so a 429 waits rather than fails.
 */
export async function signIn(email: string, password: string): Promise<string> {
  const deadline = Date.now() + 5 * 60_000;
  for (;;) {
    const response = await fetch(`${stack.apiUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: stack.anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (response.ok) return ((await response.json()) as { access_token: string }).access_token;
    await response.body?.cancel();
    if (response.status !== 429 || Date.now() > deadline) {
      throw new Error(`Local GoTrue refused a sign-in: ${response.status}`);
    }
    await sleep(2500);
  }
}

export async function signOut(token: string): Promise<void> {
  const response = await fetch(`${stack.apiUrl}/auth/v1/logout?scope=local`, {
    method: "POST",
    headers: jsonHeaders(stack.anonKey, token),
  });
  await response.body?.cancel();
  assert.ok(response.ok, `GoTrue refused a sign-out: ${response.status}`);
}

/** A public RPC through PostgREST, as that token. */
export async function rpc(name: string, args: unknown, token: string): Promise<{ status: number; json: any }> {
  const response = await fetch(`${stack.apiUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: jsonHeaders(stack.anonKey, token),
    body: JSON.stringify(args),
  });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Left null: the caller is looking at the status.
  }
  return { status: response.status, json };
}

export async function ensureAccount(token: string): Promise<{ outcome: string; global_user_id: string | null }> {
  const { status, json } = await rpc("ensure_account", {}, token);
  assert.equal(status, 200, "ensure_account failed");
  return Array.isArray(json) ? json[0] : json;
}

export async function allow(person: Pick<Person, "globalId">): Promise<void> {
  await db.query("insert into social.beta_testers (global_user_id) values ($1) on conflict do nothing", [person.globalId]);
}

/**
 * A real Rainbow account: GoTrue user, custom:platform identity, password grant,
 * ensure_account. On the beta list unless told otherwise. It has no display
 * name yet: `person` is the usual way in.
 */
export async function makeAccount(label: string, options: { allowed?: boolean } = {}): Promise<Person> {
  const user = await makeAuthUser(label);
  const globalId = `user_E2ESOCIAL${hex(10).toUpperCase()}`;
  known.find((entry) => entry.authUserId === user.authUserId)!.globalId = globalId;
  await attachPlatformIdentity(stack.dbUrl, user.authUserId, user.email, globalId);
  const token = await signIn(user.email, user.password);
  const account = await ensureAccount(token);
  assert.equal(account.outcome, "ok", `ensure_account didn't make an account for "${label}"`);
  assert.equal(account.global_user_id, globalId, `ensure_account linked "${label}" to the wrong id`);
  const made: Person = { ...user, label, globalId, token, name: "", animalId: "", backgroundColor: "" };
  if (options.allowed !== false) await allow(made);
  return made;
}

let faces = 0;

/** A beta tester with a real profile, set through the gateway. */
export async function person(label: string): Promise<Person> {
  const made = await makeAccount(label);
  const profile = {
    displayName: `${label.slice(0, 18)} ${hex(2)}`,
    animalId: AVATAR_IDS[faces % AVATAR_IDS.length],
    backgroundColor: PROFILE_COLORS[faces % PROFILE_COLORS.length],
  };
  faces += 1;
  await ok(made, "setProfile", profile);
  made.name = profile.displayName;
  made.animalId = profile.animalId;
  made.backgroundColor = profile.backgroundColor;
  return made;
}

/** One at a time, so a test's setup doesn't spend the sign-in burst all at once. */
export async function people(...labels: string[]): Promise<Person[]> {
  const made: Person[] = [];
  for (const label of labels) made.push(await person(label));
  return made;
}

// ── The gateway, over real HTTP ──

/** A person, a raw token, or null for no Authorization header at all. */
export type Who = Person | string | null;

export interface Wire {
  status: number;
  /** The raw body, exactly as it arrived. */
  text: string;
  /** The same body parsed, or null if it isn't JSON. */
  json: any;
}

/** Every body the gateway has sent this run, for the leak search. */
export const traffic: string[] = [];

export const NOTICE = CURRENT_NOTICE_VERSION;

export async function gwBody(who: Who, body: unknown): Promise<Wire> {
  const token = who === null ? null : typeof who === "string" ? who : who.token;
  const response = await fetch(stack.gatewayUrl, {
    method: "POST",
    headers: {
      apikey: stack.publishableKey,
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  const text = await response.text();
  traffic.push(text);
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Left null: assertWire reports it.
  }
  return { status: response.status, text, json };
}

export const gw = (who: Who, op: string, args: unknown = {}): Promise<Wire> => gwBody(who, { op, args });

/** A normal answer: 200, and { ok: true, data } or { ok: false, outcome } with a known outcome. */
export function assertWire(res: Wire, context = "gateway"): void {
  assert.equal(res.status, 200, `${context}: HTTP ${res.status}: ${res.text.slice(0, 300)}`);
  assert.equal(typeof res.json?.ok, "boolean", `${context}: not a wire answer: ${res.text.slice(0, 300)}`);
  if (res.json.ok) {
    assert.ok("data" in res.json, `${context}: ok with no data`);
  } else {
    assert.ok((OUTCOMES as readonly string[]).includes(res.json.outcome), `${context}: unknown outcome: ${res.text.slice(0, 300)}`);
  }
}

/** "ok", or the refusal's outcome. */
export const outcomeOf = (res: Wire): string => (res.json.ok ? "ok" : res.json.outcome);

export async function ok(who: Who, op: string, args: unknown = {}): Promise<any> {
  const res = await gw(who, op, args);
  assertWire(res, op);
  assert.equal(outcomeOf(res), "ok", `${op}: ${res.text.slice(0, 300)}`);
  return res.json.data;
}

export async function refused(who: Who, op: string, args: unknown, outcome: string): Promise<void> {
  const res = await gw(who, op, args);
  assertWire(res, op);
  assert.equal(outcomeOf(res), outcome, `${op}: ${res.text.slice(0, 300)}`);
}

/** Starts every call together, and insists each one came back as a normal answer. */
export async function allAtOnce(calls: (() => Promise<Wire>)[]): Promise<Wire[]> {
  const answers = await Promise.all(calls.map((call) => call()));
  answers.forEach((answer) => assertWire(answer, "a concurrent call"));
  return answers;
}

/** How many of each outcome, for comparing as a whole. */
export function tally(answers: Wire[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const answer of answers) counts[outcomeOf(answer)] = (counts[outcomeOf(answer)] ?? 0) + 1;
  return counts;
}

/** Stops with a clear reason if the gateway isn't there, or a JWT check stands in front of it. */
export async function assertGatewayUp(): Promise<void> {
  const res = await gw(null, "previewInvite", { code: "000000000000" });
  assert.ok(
    res.status === 200 && res.json?.outcome === "invalid_code",
    `The gateway didn't answer a guest's preview (HTTP ${res.status}). It must be serving at ${stack.gatewayUrl} with the JWT check off, ` +
      "and the hub must be installed (e2e/scripts/social-setup.ts).",
  );
}

/**
 * What must never appear in a raw body: anyone's email, global id or auth user
 * id, or anything shaped like one, or a forbidden key. Answers with what was
 * found, by label and never by value.
 */
export function leaksIn(bodies: string[]): string[] {
  const found = new Set<string>();
  const keys = FORBIDDEN_RESPONSE_KEYS.map((key) => `"${key}"`);
  for (const body of bodies) {
    for (const who of known) {
      if (body.includes(who.email)) found.add(`email of ${who.label}`);
      if (body.includes(who.authUserId)) found.add(`auth user id of ${who.label}`);
      if (who.globalId && body.includes(who.globalId)) found.add(`global id of ${who.label}`);
    }
    if (/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(body)) found.add("something shaped like an email");
    if (/user_[0-9A-Za-z]{10,64}/.test(body)) found.add("something shaped like a global id");
    for (const key of keys) if (body.includes(key)) found.add(`the key ${key}`);
  }
  return [...found];
}

// ── Getting people connected, the way the app does ──

export const keysOf = (object: object) => Object.keys(object).sort();

/** A friend link made by `a` and accepted by `b`. Answers the friendRef both sides see. */
export async function befriend(a: Person, b: Person): Promise<string> {
  const { code } = await ok(a, "createFriendInvite", { noticeVersion: NOTICE });
  const { friendRef } = await ok(b, "acceptFriendInvite", { code, noticeVersion: NOTICE });
  return friendRef;
}

/** `from` finds `to` by friend code and asks. Answers the requestRef both now see on their lists. */
export async function requestFriend(from: Person, to: Person): Promise<string> {
  const { friendCode } = await ok(to, "getMe");
  const { requestRef } = await ok(from, "findFriendByCode", { friendCode });
  await ok(from, "sendFriendRequest", { requestRef, noticeVersion: NOTICE });
  const { incoming } = await ok(to, "listFriendRequests");
  const row = incoming.find((request: { name: string }) => request.name === from.name);
  assert.ok(row, "the request didn't reach the person asked");
  return row.requestRef;
}

export async function makeGroup(owner: Person): Promise<{ groupId: string; inviteCode: string }> {
  return ok(owner, "createGroup", { name: `Group ${hex(3)}`, myName: owner.name, noticeVersion: NOTICE });
}

export const joinGroup = (who: Person, code: string) =>
  ok(who, "joinGroup", { code, myName: who.name, noticeVersion: NOTICE });

/** The target's memberRef, as `viewer` sees it. */
export async function memberRefOf(viewer: Person, groupId: string, target: Person): Promise<string> {
  const members = await ok(viewer, "listMembers", { groupId });
  const row = members.find((member: { name: string }) => member.name === target.name);
  assert.ok(row, "that person isn't in the group");
  return row.memberRef;
}

export const resultsRaw = (who: Who, puzzleId: string, groupId?: string): Promise<Wire> =>
  gw(who, "listResults", { gameId: "rainbow", puzzleId, ...(groupId ? { groupId } : {}) });

export const results = (who: Who, puzzleId: string, groupId?: string): Promise<any[]> =>
  ok(who, "listResults", { gameId: "rainbow", puzzleId, ...(groupId ? { groupId } : {}) });

// ── Puzzles and finished games ──

let adminToken: string | null = null;

export interface Puzzle {
  id: string;
  date: string;
}

/**
 * A new puzzle through the real admin_save_puzzle, signed in as the fixture
 * admin. Its date comes after every other puzzle of that format, because dates
 * are unique per format and a game finished now must fall before date + 2 days.
 */
export async function newPuzzle(
  options: { format?: "full" | "mini"; published?: boolean; beta?: boolean; free?: boolean } = {},
): Promise<Puzzle> {
  const format = options.format ?? "full";
  adminToken ??= await signIn(ACCOUNTS.admin.email, ACCOUNTS.admin.password);
  const { rows } = await db.query<{ date: string }>(
    "select (greatest(current_date, coalesce(max(date), current_date)) + 1)::text as date from public.puzzles where format = $1",
    [format],
  );
  const { date } = rows[0];
  const { status, json } = await rpc(
    "admin_save_puzzle",
    {
      _puzzle_id: null,
      _metadata: {
        date,
        title: `Social ${hex(3)}`,
        is_published: options.published ?? true,
        is_beta: options.beta ?? false,
        designer_name: "E2E Fixture",
        emoji_puzzle_icon: null,
        is_free_puzzle: options.free ?? false,
        free_puzzle_order: options.free ? 1 : null,
      },
      _content: officialContent(format === "mini" ? MINI_CLASSIC : FULL_CLASSIC),
    },
    adminToken,
  );
  assert.equal(status, 200, "admin_save_puzzle failed");
  assert.ok(json?.puzzle_id, "admin_save_puzzle returned no id");
  return { id: json.puzzle_id, date };
}

/** A puzzle from the seed. Their dates are fixed and in the past. */
export function seededPuzzle(key: string): Puzzle {
  const puzzle = readSeedManifest().official[key];
  assert.ok(puzzle, `no seeded puzzle "${key}": run npm run e2e:reset`);
  return { id: puzzle.id, date: puzzle.date };
}

/** A grid's second line. Every grid has one, so a raw body can be searched for it. */
export const GRID_ROW = "🟪🟦🟩🟨";

export interface PlayOptions {
  status?: "won" | "lost" | "in_progress";
  mistakes?: number;
  /** Null is a real value here: Rainbow's old rows have none. */
  entryContext?: string | null;
  format?: "full" | "mini";
  /** ISO. The database's own clock if left out. */
  completedAt?: string;
}

/**
 * A row in Rainbow's real game_sessions, with its real trigger deciding
 * is_official. Answers what the row says, and a marker unique to this grid.
 */
export async function play(who: Person, puzzle: Puzzle, options: PlayOptions = {}) {
  const status = options.status ?? "won";
  const marker = `GRID${hex(6)}`;
  const grid = `${marker}\n${GRID_ROW}`;
  const finished = status !== "in_progress";
  const { rows } = await db.query<{ is_official: boolean }>(
    `insert into public.game_sessions
       (puzzle_id, user_id, status, won, mistakes, share_grid, entry_context, format, completed_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8,
             case when $9::boolean then coalesce($10::timestamptz, now()) end)
     returning is_official`,
    [
      puzzle.id,
      who.authUserId,
      status,
      finished ? status === "won" : null,
      options.mistakes ?? 0,
      finished ? grid : null,
      options.entryContext === undefined ? "daily_home" : options.entryContext,
      options.format ?? "full",
      finished,
      options.completedAt ?? null,
    ],
  );
  return { grid, marker, official: rows[0].is_official };
}

// ── Counting through pg ──

const PAIR = `
  join social.persons a on a.global_user_id = $1
  join social.persons b on b.global_user_id = $2`;

export const friendships = (a: Person, b: Person) =>
  count(
    `select count(*)::int as n from social.friendships f ${PAIR}
      where (f.person_a = a.id and f.person_b = b.id) or (f.person_a = b.id and f.person_b = a.id)`,
    [a.globalId, b.globalId],
  );

export const requestsBetween = (a: Person, b: Person) =>
  count(
    `select count(*)::int as n from social.friend_requests r ${PAIR}
      where (r.from_person = a.id and r.to_person = b.id) or (r.from_person = b.id and r.to_person = a.id)`,
    [a.globalId, b.globalId],
  );

export const blocksBetween = (a: Person, b: Person) =>
  count(
    `select count(*)::int as n from social.blocks x ${PAIR}
      where (x.blocker = a.id and x.blocked = b.id) or (x.blocker = b.id and x.blocked = a.id)`,
    [a.globalId, b.globalId],
  );

export const cards = (who: Person, puzzle: Puzzle) =>
  count(
    `select count(*)::int as n from social.result_cards c
       join social.persons p on p.id = c.person_id
      where p.global_user_id = $1 and c.puzzle_id = $2`,
    [who.globalId, puzzle.id],
  );

export const hubPersons = (who: Person) =>
  count("select count(*)::int as n from social.persons p where p.global_user_id = $1", [who.globalId]);

export const memberships = (groupId: string) =>
  count("select count(*)::int as n from social.memberships m where m.group_id = $1", [groupId]);

export const activity = (who: Person, kind: string) =>
  count(
    `select count(*)::int as n from social.activity x
       join social.persons p on p.id = x.person_id
      where p.global_user_id = $1 and x.kind = $2`,
    [who.globalId, kind],
  );

/** Everything these people have made in the hub, for comparing before and after. */
export async function hubRows(...who: Person[]): Promise<Record<string, number>> {
  const { rows } = await db.query(
    `with ids as (select p.id from social.persons p where p.global_user_id = any($1::text[]))
     select (select count(*) from social.friendships f where f.person_a in (select id from ids) or f.person_b in (select id from ids))::int as friendships,
            (select count(*) from social.friend_requests r where r.from_person in (select id from ids) or r.to_person in (select id from ids))::int as requests,
            (select count(*) from social.invites i where i.creator_id in (select id from ids))::int as invites,
            (select count(*) from social.groups g where g.owner_id in (select id from ids))::int as groups,
            (select count(*) from social.memberships m where m.person_id in (select id from ids))::int as memberships`,
    [who.map((one) => one.globalId)],
  );
  return rows[0];
}

// ── A token with different claims ──

/**
 * The same real token, claims changed, signed with the stack's own secret. That
 * is the only way to hold an expired token without waiting an hour. Callers pair
 * it with a live control, so a refusal can only be about the claim they changed.
 */
export function reissue(token: string, claims: Record<string, unknown>): string {
  assert.ok(stack.jwtSecret, "`supabase status` reported no JWT_SECRET, so an expired token can't be made.");
  const [header, payload] = token.split(".");
  const { alg } = JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as { alg: string };
  assert.equal(alg, "HS256", "This stack doesn't sign tokens with its JWT secret.");
  const merged = { ...JSON.parse(Buffer.from(payload, "base64url").toString("utf8")), ...claims };
  const body = `${header}.${Buffer.from(JSON.stringify(merged)).toString("base64url")}`;
  return `${body}.${createHmac("sha256", stack.jwtSecret).update(body).digest("base64url")}`;
}

// ── Restarting the database ──

/** The CLI's name for it, from this stack's own config, and only that. */
function databaseContainer(): string {
  const projectId = linkedProjectRef(E2E_SUPABASE_CONFIG);
  assert.equal(projectId, "rainbow-categories-e2e", "e2e/supabase/config.toml isn't the disposable project.");
  return `supabase_db_${projectId}`;
}

/** Restarts the container and waits until it reports healthy and pg can reach it. */
export async function restartDatabase(): Promise<void> {
  const runtime = containerRuntime();
  assert.ok(runtime, "No container runtime on PATH.");
  const container = databaseContainer();

  // The guard has checked the port. This checks the port is this container's.
  const port = runCapture(runtime, ["port", container, "5432/tcp"]);
  assert.ok(port.code === 0 && port.stdout.includes(`:${E2E_PORTS.db}`), `${container} isn't the database on port ${E2E_PORTS.db}.`);

  assert.equal(runCapture(runtime, ["restart", container]).code, 0, `${runtime} restart failed.`);

  const deadline = Date.now() + 120_000;
  for (;;) {
    const health = runCapture(runtime, ["inspect", "--format", "{{.State.Health.Status}}", container]);
    if (health.code === 0 && health.stdout.trim() === "healthy") break;
    assert.ok(Date.now() < deadline, `${container} didn't report healthy in two minutes.`);
    await sleep(1000);
  }
  for (;;) {
    try {
      await db.query("select 1");
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await sleep(1000);
    }
  }
}

/**
 * Asks the gateway until this person's getMe works again. Answers how many
 * tries that took, and how many of them weren't a normal answer: a gateway
 * still reconnecting may say `unavailable`, and anything else is worth seeing.
 */
export async function waitForGateway(who: Person): Promise<{ tries: number; abnormal: number }> {
  const deadline = Date.now() + 120_000;
  let tries = 0;
  let abnormal = 0;
  for (;;) {
    tries += 1;
    try {
      const res = await gw(who, "getMe");
      if (res.status === 200 && res.json?.ok === true) return { tries, abnormal };
      if (res.status !== 200 || res.json?.outcome !== "unavailable") abnormal += 1;
    } catch {
      abnormal += 1;
    }
    assert.ok(Date.now() < deadline, "The gateway didn't reconnect in two minutes.");
    await sleep(1000);
  }
}
