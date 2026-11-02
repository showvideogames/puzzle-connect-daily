/**
 * The shared hub on the real local stack: real GoTrue tokens, the real
 * social-gateway over HTTP, Rainbow's real tables, the hub beside them.
 *
 *   npx tsx --tsconfig e2e/tsconfig.json --test e2e/social/realStack.test.ts
 *
 * Needs the stack up and seeded, e2e/scripts/social-setup.ts run, and the gateway
 * serving with its JWT check off. Each test makes its own people, so no test
 * depends on another or on the order they run in. A run leaves people and
 * future-dated puzzles behind: run `npm run e2e:reset` before the browser suite.
 *
 * Importing harness.ts is what refuses a target that isn't this machine's stack.
 */

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { OPERATIONS } from "../../supabase/functions/social-gateway/core.ts";
import {
  activity,
  allAtOnce,
  allow,
  assertGatewayUp,
  assertWire,
  befriend,
  blocksBetween,
  cards,
  closeStack,
  count,
  db,
  ensureAccount,
  friendships,
  GRID_ROW,
  gw,
  gwBody,
  hubPersons,
  hubRows,
  joinGroup,
  keysOf,
  leaksIn,
  makeAccount,
  makeAuthUser,
  makeGroup,
  memberRefOf,
  memberships,
  newPuzzle,
  NOTICE,
  ok,
  outcomeOf,
  people,
  person,
  play,
  refused,
  refuseUnlessLocal,
  requestFriend,
  requestsBetween,
  restartDatabase,
  results,
  resultsRaw,
  seededPuzzle,
  signIn,
  signOut,
  stack,
  tally,
  traffic,
  waitForGateway,
  type Person,
  type Wire,
} from "./harness.ts";

before(assertGatewayUp);
after(closeStack);

describe("The target", () => {
  test("this stack passes the guard", () => {
    assert.doesNotThrow(() => refuseUnlessLocal("check", stack));
  });

  const notLocal: [string, Partial<typeof stack>][] = [
    ["a hosted API", { apiUrl: "https://example.supabase.co" }],
    ["a remote database", { dbUrl: "postgresql://postgres:postgres@db.example.com:54422/postgres" }],
    ["a remote app", { appUrl: "https://example.vercel.app" }],
    ["a host named disposable in the environment", { apiUrl: "http://ci-host:54421", extraDisposableHosts: ["ci-host"] }],
    ["another local stack's ports", { apiUrl: "http://127.0.0.1:54321", dbUrl: "postgresql://postgres:postgres@127.0.0.1:54322/postgres" }],
    ["a real project key", { anonKey: "sb_publishable_notlocal" }],
  ];
  for (const [label, change] of notLocal) {
    test(`refuses ${label}`, () => {
      assert.throws(() => refuseUnlessLocal("check", { ...stack, ...change }));
    });
  }
});

describe("Saved", () => {
  test("profile, friend code, friendship, group and names survive a database restart", async (t) => {
    const owner = await makeAccount("Owner");
    const [member, friend] = await people("Member", "Friend");
    const profile = { displayName: "Harbour Master", animalId: "otter", backgroundColor: "#CCE6CA" };
    await ok(owner, "setProfile", profile);
    const friendRef = await befriend(owner, friend);
    const { groupId, inviteCode } = await ok(owner, "createGroup", { name: "Restart Crew", myName: "Captain", noticeVersion: NOTICE });
    await ok(member, "joinGroup", { code: inviteCode, myName: "Deckhand", noticeVersion: NOTICE });

    const snapshot = async () => ({
      me: await ok(owner, "getMe"),
      friends: await ok(owner, "listFriends"),
      theirFriends: await ok(friend, "listFriends"),
      groups: await ok(owner, "listMyGroups"),
      memberGroups: await ok(member, "listMyGroups"),
      members: await ok(member, "listMembers", { groupId }),
    });
    const saved = await snapshot();

    assert.equal(saved.me.displayName, profile.displayName);
    assert.equal(saved.me.animalId, profile.animalId);
    assert.equal(saved.me.backgroundColor, profile.backgroundColor);
    assert.match(saved.me.friendCode, /^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/);
    assert.deepEqual(saved.friends.map((row: { friendRef: string }) => row.friendRef), [friendRef]);
    assert.equal(saved.groups[0].name, "Restart Crew");
    assert.equal(saved.groups[0].inviteCode, inviteCode);
    assert.deepEqual(
      saved.members.map((row: { name: string; isOwner: boolean }) => [row.name, row.isOwner]),
      [["Captain", true], ["Deckhand", false]],
    );

    await restartDatabase();
    const { tries, abnormal } = await waitForGateway(owner);
    t.diagnostic(`gateway back after ${tries} tries, ${abnormal} of them not a normal answer`);

    assert.deepEqual(await snapshot(), saved);
    assert.equal(await friendships(owner, friend), 1);
    assert.equal(await memberships(groupId), 2);
  });
});

describe("Account isolation", () => {
  test("a token reads its own lists and never anyone else's, however the tokens are swapped", async () => {
    const [a, b, friendOfA, friendOfB, asksA] = await people("Reader A", "Reader B", "Friend of A", "Friend of B", "Asks A");
    await befriend(a, friendOfA);
    await befriend(b, friendOfB);
    await requestFriend(asksA, a);
    const groupA = await makeGroup(a);
    const groupB = await makeGroup(b);

    const friendsOf = async (who: Person | string) =>
      (await ok(who, "listFriends")).map((row: { name: string }) => row.name);
    const groupsOf = async (who: Person | string) =>
      (await ok(who, "listMyGroups")).map((row: { groupId: string }) => row.groupId);

    // Whichever token the client happens to hold is who it is.
    for (const [token, friend, group, friendCode] of [
      [a.token, friendOfA.name, groupA.groupId, (await ok(a, "getMe")).friendCode],
      [b.token, friendOfB.name, groupB.groupId, (await ok(b, "getMe")).friendCode],
      [a.token, friendOfA.name, groupA.groupId, (await ok(a, "getMe")).friendCode],
    ]) {
      assert.deepEqual(await friendsOf(token), [friend]);
      assert.deepEqual(await groupsOf(token), [group]);
      assert.equal((await ok(token, "getMe")).friendCode, friendCode);
    }
    assert.equal((await ok(a, "listFriendRequests")).incoming.length, 1);
    assert.equal((await ok(b, "listFriendRequests")).incoming.length, 0);

    // The other person's group, by its real id.
    await refused(a, "listMembers", { groupId: groupB.groupId }, "not_a_member");
    await refused(b, "listMembers", { groupId: groupA.groupId }, "not_a_member");
    await refused(a, "listResults", { gameId: "rainbow", puzzleId: "any", groupId: groupB.groupId }, "not_a_member");

    // Side by side on pooled connections, nothing crosses over.
    const mixed = await allAtOnce(
      Array.from({ length: 20 }, (_, i) => () => gw(i % 2 ? b : a, "listFriends")),
    );
    mixed.forEach((answer, i) => {
      assert.deepEqual(
        answer.json.data.map((row: { name: string }) => row.name),
        [i % 2 ? friendOfB.name : friendOfA.name],
      );
    });
  });

  test("args carrying someone else's id are refused with unavailable", async () => {
    const [caller, other] = await people("Caller", "Other");
    const before = await ok(other, "getMe");

    const attempts: [string, Record<string, unknown>][] = [
      ["getMe", { globalUserId: other.globalId }],
      ["getMe", { global_user_id: other.globalId }],
      ["getMe", { userId: other.authUserId }],
      ["listFriends", { globalUserId: other.globalId }],
      ["listMyGroups", { personId: other.authUserId }],
      ["listFriendRequests", { accountId: other.authUserId }],
      ["setDisplayName", { name: "Hijacked", globalUserId: other.globalId }],
      ["createFriendInvite", { noticeVersion: NOTICE, globalUserId: other.globalId }],
      ["listResults", { gameId: "rainbow", puzzleId: "any", globalUserId: other.globalId }],
      ["deleteMySocialData", { globalUserId: other.globalId }],
    ];
    for (const [op, args] of attempts) await refused(caller, op, args, "unavailable");

    // And beside args, on the request itself.
    const sideways = await gwBody(caller, { op: "getMe", args: {}, globalUserId: other.globalId });
    assertWire(sideways);
    assert.equal(outcomeOf(sideways), "unavailable");

    assert.deepEqual(await ok(other, "getMe"), before);
  });

  test("an auth user with no Rainbow account gets not_linked", async () => {
    const stray = await makeAuthUser("Stray");
    const strayToken = await signIn(stray.email, stray.password);
    assert.equal((await ensureAccount(strayToken)).outcome, "not_platform_linked");
    await refused(strayToken, "getMe", {}, "not_linked");
    await refused(strayToken, "listFriends", {}, "not_linked");
  });

  test("garbage, forged and signed-out tokens get not_signed_in", async () => {
    const [holder, leaving] = await people("Holder", "Leaving");
    const [header, payload, signature] = holder.token.split(".");
    const now = Math.floor(Date.now() / 1000);

    const unusable: [string, string][] = [
      ["garbage", "not-a-token"],
      ["three garbage parts", "aaaa.bbbb.cccc"],
      ["a real token with a forged signature", `${header}.${payload}.${"A".repeat(signature.length)}`],
      ["the anon key", stack.anonKey],
      ["the publishable key", stack.publishableKey],
    ];
    for (const [label, token] of unusable) {
      const res = await gw(token, "getMe");
      assertWire(res, label);
      assert.equal(outcomeOf(res), "not_signed_in", label);
    }

    // A real expired token can't be made here: this stack signs with an ES256
    // key the test doesn't hold, and changing `exp` on a real token is the forged
    // case above. The gateway asks Supabase Auth, as submit-feedback does, so
    // expiry is Auth's own check. Changing a claim must still fail.
    const padded = JSON.parse(Buffer.from(payload, "base64url").toString());
    const stretched = Buffer.from(JSON.stringify({ ...padded, exp: now + 86400 })).toString("base64url");
    await refused(`${header}.${stretched}.${signature}`, "getMe", {}, "not_signed_in");

    // Still unexpired, but Auth no longer accepts it. A token isn't trusted on its claims.
    await ok(leaving, "getMe");
    await signOut(leaving.token);
    await refused(leaving.token, "getMe", {}, "not_signed_in");
  });

  test("a real account not on the allow-list gets game_disabled, and leaves no trace", async () => {
    const outsider = await makeAccount("Outsider", { allowed: false });
    await refused(outsider, "getMe", {}, "game_disabled");
    await refused(outsider, "listFriends", { unexpected: true }, "game_disabled");
    assert.equal(await hubPersons(outsider), 0);

    // Adding them is all it takes, so the refusal was the list and nothing else.
    await allow(outsider);
    await ok(outsider, "getMe");
    assert.equal(await hubPersons(outsider), 1);
  });

  test("a non-tester holding real invitations joins nothing", async () => {
    const owner = await person("Inviting owner");
    const outsider = await makeAccount("Holder of links", { allowed: false });
    const { code } = await ok(owner, "createFriendInvite", { noticeVersion: NOTICE });
    const { groupId, inviteCode } = await makeGroup(owner);
    const puzzle = await newPuzzle();

    await refused(outsider, "acceptFriendInvite", { code, noticeVersion: NOTICE }, "game_disabled");
    await refused(outsider, "joinGroup", { code: inviteCode, myName: "Holder", noticeVersion: NOTICE }, "game_disabled");
    await refused(outsider, "listResults", { gameId: "rainbow", puzzleId: puzzle.id, groupId }, "game_disabled");

    assert.equal(await hubPersons(outsider), 0);
    assert.equal(await memberships(groupId), 1);
  });

  test("taking someone off the list shuts them out at once, and their data stays until it's deleted", async () => {
    const [leaving, friend] = await people("Off the list", "Their friend");
    await befriend(leaving, friend);

    await db.query("delete from social.beta_testers where global_user_id = $1", [leaving.globalId]);

    await refused(leaving, "getMe", {}, "game_disabled");
    await refused(leaving, "listFriends", {}, "game_disabled");
    assert.equal(await hubPersons(leaving), 1);

    // The way a tester actually leaves: their hub data goes first, then the row.
    await db.query("select social.delete_person($1)", [leaving.globalId]);
    assert.equal(await hubPersons(leaving), 0);
    assert.equal((await ok(friend, "listFriends")).length, 0);
  });

  test("a held lock costs a refused request in seconds, not a stuck connection", async () => {
    const tester = await person("Waits on a lock");
    const blocker = await db.connect();
    try {
      await blocker.query("begin");
      await blocker.query("lock table social.persons in access exclusive mode");
      const started = Date.now();
      const res = await gw(tester, "getMe");
      const waited = Date.now() - started;
      assert.equal(outcomeOf(res), "unavailable");
      assert.ok(waited >= 1500 && waited < 4500, `waited ${waited} ms`);
    } finally {
      await blocker.query("rollback");
      blocker.release();
    }
    await ok(tester, "getMe");
  });

  test("no token on anything but previewInvite gets not_signed_in", async () => {
    const operations = Object.keys(OPERATIONS).filter((op) => op !== "previewInvite");
    assert.ok(operations.length >= 30, "the list of operations came back short");
    for (const op of operations) await refused(null, op, {}, "not_signed_in");
    await refused(null, "previewInvite", { code: "000000000000" }, "invalid_code");
  });

  test("recordCompletion over the gateway is unavailable and no card appears", async () => {
    const [viewer, friend] = await people("Viewer", "Forger");
    await befriend(viewer, friend);
    const puzzle = await newPuzzle();
    const forged = {
      gameId: "rainbow",
      puzzleId: puzzle.id,
      globalUserId: friend.globalId,
      completedAt: new Date().toISOString(),
      summary: { solved: true, mistakes: 0 },
      detail: "FORGEDGRID",
    };
    for (const who of [friend, viewer, null]) await refused(who, "recordCompletion", forged, "unavailable");

    assert.equal(await cards(friend, puzzle), 0);
    const res = await resultsRaw(viewer, puzzle.id);
    assertWire(res);
    assert.deepEqual(res.json.data, []);
    assert.ok(!res.text.includes("FORGEDGRID"));

    // The server-only functions by their own names, and names that aren't operations.
    for (const op of ["record_completion", "audience_global_ids", "__proto__", "constructor"]) {
      await refused(friend, op, {}, "unavailable");
    }
  });
});

describe("The hub's own walls", () => {
  test("PostgREST can't read or call the social schema with any credential", async () => {
    const hidden = await person("Hidden");
    const { friendCode } = await ok(hidden, "getMe");
    const body = JSON.stringify({ p_global_user_id: hidden.globalId, p_game: "rainbow" });
    const social = { "Accept-Profile": "social", "Content-Profile": "social" };
    const json = { "Content-Type": "application/json" };

    const attempts: [string, string, RequestInit][] = [
      ["read persons", "persons?select=*", { headers: { "Accept-Profile": "social" } }],
      ["read beta_testers", "beta_testers?select=*", { headers: { "Accept-Profile": "social" } }],
      ["read result_cards", "result_cards?select=*", { headers: { "Accept-Profile": "social" } }],
      ["read persons by default", "persons?select=*", {}],
      ["call ensure_person", "rpc/ensure_person", { method: "POST", headers: { ...social, ...json }, body }],
      ["call list_friends", "rpc/list_friends", { method: "POST", headers: { ...social, ...json }, body: JSON.stringify({ p_global_user_id: hidden.globalId }) }],
      ["call is_beta_tester", "rpc/is_beta_tester", { method: "POST", headers: { ...social, ...json }, body: JSON.stringify({ p_global_user_id: hidden.globalId }) }],
      ["call ensure_person by default", "rpc/ensure_person", { method: "POST", headers: json, body }],
    ];

    const credentials: [string, string, string][] = [
      ["a real user JWT", stack.anonKey, hidden.token],
      ["the anon key", stack.anonKey, stack.anonKey],
      ["the service key", stack.serviceRoleKey, stack.serviceRoleKey],
    ];
    for (const [credential, apikey, bearer] of credentials) {
      const headers = { apikey, Authorization: `Bearer ${bearer}` };

      // The control: this credential does reach PostgREST.
      const control = await fetch(`${stack.apiUrl}/rest/v1/rpc/ping`, { method: "POST", headers: { ...headers, ...json }, body: "{}" });
      await control.body?.cancel();
      assert.equal(control.status, 200, `${credential} didn't reach PostgREST`);

      for (const [label, path, init] of attempts) {
        const response = await fetch(`${stack.apiUrl}/rest/v1/${path}`, { ...init, headers: { ...headers, ...(init.headers as object) } });
        const text = await response.text();
        const what = `${label} with ${credential}`;
        assert.ok(response.status >= 400 && response.status < 500, `${what}: HTTP ${response.status}`);
        for (const secret of [hidden.name, hidden.globalId, friendCode]) {
          assert.ok(!text.includes(secret), `${what}: the answer held hub data`);
        }
      }
    }
  });

  /** One transaction as this role. Each attempt can fail without ending it. */
  async function asRole(role: string, work: (attempt: (sql: string) => Promise<string | null>) => Promise<void>) {
    const client = await db.connect();
    try {
      await client.query("begin");
      await client.query(`set local role ${role}`);
      const { rows } = await client.query<{ acting: string }>("select current_user as acting");
      assert.equal(rows[0].acting, role, "set local role didn't take");
      await work(async (sql) => {
        await client.query("savepoint attempt");
        const code = await client.query(sql).then(
          () => null,
          (error: { code?: string }) => error.code ?? "no code",
        );
        await client.query("rollback to savepoint attempt");
        return code;
      });
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }
  }

  async function hubObjects() {
    const tables = await db.query<{ tablename: string }>("select tablename from pg_tables where schemaname = 'social'");
    const functions = await db.query<{ proname: string; args: string[] }>(
      `select p.proname,
              array(select format_type(u.t, null) from unnest(p.proargtypes::oid[]) with ordinality u(t, i) order by u.i) as args
         from pg_proc p
        where p.pronamespace = 'social'::regnamespace`,
    );
    assert.ok(tables.rows.length >= 13, "the hub's tables weren't found");
    assert.ok(functions.rows.length >= 30, "the hub's functions weren't found");
    return {
      selects: tables.rows.map(({ tablename }) => `select * from social.${tablename} limit 1`),
      calls: functions.rows.map(({ proname, args }) => `select social.${proname}(${args.map((arg) => `null::${arg}`).join(", ")})`),
    };
  }

  for (const role of ["anon", "authenticated", "service_role"]) {
    test(`through pg, ${role} is denied every table and function`, async () => {
      const { selects, calls } = await hubObjects();
      await asRole(role, async (attempt) => {
        // 42501 is the permission refusal itself, so nothing else can pass for one.
        assert.equal(await attempt("select 1"), null, "the role can't run anything");
        for (const sql of [...selects, ...calls]) {
          assert.equal(await attempt(sql), "42501", `${role} wasn't denied: ${sql}`);
        }
      });

      const { rows } = await db.query(
        `select has_schema_privilege($1::name, 'social', 'usage') as schema,
                (select count(*)::int from pg_class c
                  where c.relnamespace = 'social'::regnamespace and c.relkind = 'r'
                    and has_table_privilege($1::name, c.oid, 'select, insert, update, delete, truncate, references, trigger')) as tables,
                (select count(*)::int from pg_proc p
                  where p.pronamespace = 'social'::regnamespace
                    and has_function_privilege($1::name, p.oid, 'execute')) as functions`,
        [role],
      );
      assert.deepEqual(rows[0], { schema: false, tables: 0, functions: 0 });
    });
  }

  test("the gateway's own role has no tables and can't reach the server's functions", async () => {
    const { selects } = await hubObjects();
    await asRole("social_gateway", async (attempt) => {
      assert.equal(await attempt("select social.is_beta_tester(null::text)"), null, "the role can't run its own function");
      for (const sql of selects) assert.equal(await attempt(sql), "42501", `social_gateway wasn't denied: ${sql}`);
      assert.equal(await attempt("select social.audience_global_ids(null::text, null::text)"), "42501");
      assert.equal(await attempt("select social.record_completion(null::text, null::text, null::text, null::text, null::jsonb, null::jsonb)"), "42501");
    });
  });

  test("no response anywhere contains an email, a global id or an auth user id", async () => {
    const from = traffic.length;
    const used = new Set<string>();
    const call = (who: Person | null, op: string, args: Record<string, unknown> = {}) => {
      used.add(op);
      return ok(who, op, args);
    };

    const [a, b, c, d] = await people("Leak A", "Leak B", "Leak C", "Leak D");
    const noticed = { noticeVersion: NOTICE };

    await call(a, "getMe");
    await call(a, "setDisplayName", { name: a.name });
    await call(a, "setProfile", { displayName: a.name, animalId: a.animalId, backgroundColor: a.backgroundColor });

    const { code } = await call(a, "createFriendInvite", noticed);
    await call(null, "previewInvite", { code });
    await call(b, "previewInvite", { code });
    const { friendRef } = await call(b, "acceptFriendInvite", { code, ...noticed });
    await call(a, "listFriends");

    const { friendCode } = await call(c, "getMe");
    const first = await call(a, "findFriendByCode", { friendCode });
    await call(a, "sendFriendRequest", { requestRef: first.requestRef, ...noticed });
    const asked = await call(c, "listFriendRequests");
    await call(c, "declineFriendRequest", { requestRef: asked.incoming[0].requestRef });
    const sent = await call(a, "listFriendRequests");
    await call(a, "cancelFriendRequest", { requestRef: sent.outgoing[0].requestRef });
    const again = await call(a, "findFriendByCode", { friendCode });
    await call(a, "sendFriendRequest", { requestRef: again.requestRef, ...noticed });
    const askedAgain = await call(c, "listFriendRequests");
    const accepted = await call(c, "acceptFriendRequest", { requestRef: askedAgain.incoming[0].requestRef, ...noticed });

    const { groupId, inviteCode } = await call(a, "createGroup", { name: "Leak Check", myName: a.name, ...noticed });
    await call(null, "previewInvite", { code: inviteCode });
    for (const who of [b, c, d]) await call(who, "joinGroup", { code: inviteCode, myName: who.name, ...noticed });
    await call(b, "listMyGroups");
    await call(b, "listMembers", { groupId });
    await call(a, "renameGroup", { groupId, name: "Leak Check Two" });
    await call(a, "setGroupAppearance", { groupId, emblemId: "moon", photo: null, accentColor: "#CCE1F1" });
    await call(a, "replaceInvite", { groupId });
    await call(a, "removeMember", { groupId, memberRef: await memberRefOf(a, groupId, d) });
    const [removed] = await call(a, "listRemoved", { groupId });
    await call(a, "letBackIn", { groupId, removedRef: removed.removedRef });
    await call(b, "renameMeInGroup", { groupId, name: "Renamed" });

    const { blockRef } = await call(a, "block", { ref: friendRef });
    await call(a, "listBlocks");
    await call(a, "unblock", { blockRef });
    await call(a, "removeFriend", { friendRef: accepted.friendRef });

    const puzzle = await newPuzzle();
    await play(b, puzzle);
    await play(c, puzzle);
    await call(c, "listResults", { gameId: "rainbow", puzzleId: puzzle.id, groupId });
    await call(c, "leaveGroup", { groupId });
    await call(b, "deleteMySocialData");

    assert.deepEqual(Object.keys(OPERATIONS).filter((op) => !used.has(op)), [], "operations this test didn't reach");
    const bodies = traffic.slice(from);
    assert.ok(bodies.length >= used.size);
    assert.deepEqual(leaksIn(bodies), []);
  });
});

describe("Invitations", () => {
  test("find, send and accept between two people, with no friendship before the accept", async () => {
    const [from, to] = await people("Sender", "Receiver");
    const { friendCode } = await ok(to, "getMe");

    const found = await ok(from, "findFriendByCode", { friendCode });
    assert.deepEqual(keysOf(found), ["animalId", "backgroundColor", "name", "requestRef"]);
    assert.equal(found.name, to.name);
    await refused(from, "findFriendByCode", { friendCode: (await ok(from, "getMe")).friendCode }, "own_code");

    await ok(from, "sendFriendRequest", { requestRef: found.requestRef, noticeVersion: NOTICE });
    assert.equal(await friendships(from, to), 0);
    assert.deepEqual(await ok(from, "listFriends"), []);
    assert.deepEqual(await ok(to, "listFriends"), []);

    const { incoming } = await ok(to, "listFriendRequests");
    assert.deepEqual(incoming.map((row: { name: string }) => row.name), [from.name]);
    assert.equal((await ok(from, "listFriendRequests")).outgoing.length, 1);

    const accepted = await ok(to, "acceptFriendRequest", { requestRef: incoming[0].requestRef, noticeVersion: NOTICE });
    assert.equal(accepted.name, from.name);
    assert.equal(await friendships(from, to), 1);
    assert.equal(await requestsBetween(from, to), 0);
    assert.deepEqual((await ok(from, "listFriends")).map((row: { friendRef: string }) => row.friendRef), [accepted.friendRef]);
    assert.deepEqual((await ok(to, "listFriends")).map((row: { friendRef: string }) => row.friendRef), [accepted.friendRef]);
  });

  test("the wrong person can't accept, decline, cancel or reuse a request", async () => {
    const [from, to, stranger] = await people("Sender", "Receiver", "Stranger");
    const { friendCode } = await ok(to, "getMe");
    const { requestRef: lookupRef } = await ok(from, "findFriendByCode", { friendCode });
    await ok(from, "sendFriendRequest", { requestRef: lookupRef, noticeVersion: NOTICE });
    const { incoming } = await ok(to, "listFriendRequests");
    const requestRef = incoming[0].requestRef;

    await refused(stranger, "acceptFriendRequest", { requestRef, noticeVersion: NOTICE }, "not_found");
    await refused(from, "acceptFriendRequest", { requestRef, noticeVersion: NOTICE }, "not_found");
    await refused(stranger, "declineFriendRequest", { requestRef }, "not_found");
    await refused(stranger, "cancelFriendRequest", { requestRef }, "not_found");
    await refused(to, "cancelFriendRequest", { requestRef }, "not_found");
    // A lookup's ref is good for the caller who made it, and the two kinds of ref don't mix.
    await refused(stranger, "sendFriendRequest", { requestRef: lookupRef, noticeVersion: NOTICE }, "not_found");
    await refused(to, "acceptFriendRequest", { requestRef: lookupRef, noticeVersion: NOTICE }, "not_found");

    assert.equal(await friendships(from, to), 0);
    assert.equal(await requestsBetween(from, to), 1);
    assert.deepEqual(await ok(stranger, "listFriends"), []);
  });

  test("a decline leaves the sender's row, and a cancel removes it", async () => {
    const [from, to] = await people("Sender", "Receiver");
    const requestRef = await requestFriend(from, to);
    const sentBefore = (await ok(from, "listFriendRequests")).outgoing;

    await ok(to, "declineFriendRequest", { requestRef });
    assert.deepEqual((await ok(to, "listFriendRequests")).incoming, []);
    assert.deepEqual((await ok(from, "listFriendRequests")).outgoing, sentBefore);
    assert.equal(await requestsBetween(from, to), 1);
    assert.equal(await friendships(from, to), 0);

    await ok(from, "cancelFriendRequest", { requestRef });
    assert.deepEqual((await ok(from, "listFriendRequests")).outgoing, []);
    assert.equal(await requestsBetween(from, to), 0);
  });

  test("a friend link shows a guest the name and avatar only, and works once", async () => {
    const [inviter, first, second] = await people("Inviter", "First", "Second");
    const { code } = await ok(inviter, "createFriendInvite", { noticeVersion: NOTICE });

    const preview = await ok(null, "previewInvite", { code });
    assert.deepEqual(keysOf(preview), ["animalId", "backgroundColor", "inviterName"]);
    assert.deepEqual(preview, { inviterName: inviter.name, animalId: inviter.animalId, backgroundColor: inviter.backgroundColor });

    await refused(inviter, "acceptFriendInvite", { code, noticeVersion: NOTICE }, "own_invite");
    const accepted = await ok(first, "acceptFriendInvite", { code, noticeVersion: NOTICE });
    assert.equal(accepted.name, inviter.name);

    await refused(second, "acceptFriendInvite", { code, noticeVersion: NOTICE }, "invite_used");
    await refused(null, "previewInvite", { code }, "invite_used");
    assert.equal(await friendships(inviter, first), 1);
    assert.equal(await friendships(inviter, second), 0);
  });

  test("a group link: guest preview, join, replaced code, removal and letting back in", async () => {
    const [owner, joiner, late] = await people("Owner", "Joiner", "Late");
    const { groupId, inviteCode } = await makeGroup(owner);

    const preview = await ok(null, "previewInvite", { code: inviteCode });
    assert.deepEqual(keysOf(preview), ["accentColor", "emblemId", "isMember", "isRemoved", "memberPreview", "name", "photo"]);
    assert.deepEqual(keysOf(preview.memberPreview), ["faces", "leadName", "memberCount"]);
    assert.deepEqual(preview.memberPreview, {
      faces: [{ animalId: owner.animalId, backgroundColor: owner.backgroundColor }],
      leadName: owner.name,
      memberCount: 1,
    });
    assert.equal(preview.isMember, false);
    assert.equal(preview.isRemoved, false);

    await joinGroup(joiner, inviteCode);
    assert.equal(await memberships(groupId), 2);

    // The old code stops at once, for everyone. Members stay.
    const { inviteCode: fresh } = await ok(owner, "replaceInvite", { groupId });
    await refused(null, "previewInvite", { code: inviteCode }, "invalid_code");
    await refused(late, "joinGroup", { code: inviteCode, myName: late.name, noticeVersion: NOTICE }, "invalid_code");
    assert.equal(await memberships(groupId), 2);
    await joinGroup(late, fresh);
    assert.equal(await memberships(groupId), 3);

    // Removed: out with any code, and shown as such, until the owner lets them back in.
    await refused(joiner, "removeMember", { groupId, memberRef: await memberRefOf(joiner, groupId, late) }, "not_the_creator");
    await ok(owner, "removeMember", { groupId, memberRef: await memberRefOf(owner, groupId, late) });
    await refused(late, "joinGroup", { code: fresh, myName: late.name, noticeVersion: NOTICE }, "removed");
    const barred = await ok(late, "previewInvite", { code: fresh });
    assert.equal(barred.isRemoved, true);
    assert.equal(barred.memberPreview, null);

    const removed = await ok(owner, "listRemoved", { groupId });
    assert.deepEqual(removed.map((row: { name: string }) => row.name), [late.name]);
    await ok(owner, "letBackIn", { groupId, removedRef: removed[0].removedRef });
    await joinGroup(late, fresh);
    assert.equal(await memberships(groupId), 3);
    assert.deepEqual(await ok(owner, "listRemoved", { groupId }), []);
  });

  test("all six operations refuse without the current notice, and nothing is created", async () => {
    const [owner, asker, receiver, newcomer] = await people("Owner", "Asker", "Receiver", "Newcomer");
    const { code: friendLink } = await ok(owner, "createFriendInvite", { noticeVersion: NOTICE });
    const { inviteCode } = await makeGroup(owner);
    const incomingRef = await requestFriend(asker, receiver);
    const { friendCode } = await ok(receiver, "getMe");
    const { requestRef: lookupRef } = await ok(newcomer, "findFriendByCode", { friendCode });

    const operations: [Person, string, Record<string, unknown>][] = [
      [newcomer, "createFriendInvite", {}],
      [newcomer, "acceptFriendInvite", { code: friendLink }],
      [newcomer, "sendFriendRequest", { requestRef: lookupRef }],
      [receiver, "acceptFriendRequest", { requestRef: incomingRef }],
      [newcomer, "createGroup", { name: "Unnoticed", myName: newcomer.name }],
      [newcomer, "joinGroup", { code: inviteCode, myName: newcomer.name }],
    ];
    const everyone = [owner, asker, receiver, newcomer];
    const rowsBefore = await hubRows(...everyone);

    for (const [who, op, args] of operations) {
      // A version that isn't the current one is the hub's refusal, whether never shown (0) or stale.
      for (const noticeVersion of [0, 2]) await refused(who, op, { ...args, noticeVersion }, "notice_required");
      // No usable version at all stops at the gateway's type check, before the hub.
      await refused(who, op, args, "unavailable");
      for (const noticeVersion of [null, "1", 1.5]) await refused(who, op, { ...args, noticeVersion }, "unavailable");
    }
    assert.deepEqual(await hubRows(...everyone), rowsBefore);

    // The control: with the notice, every one of those calls goes through.
    for (const [who, op, args] of operations) await ok(who, op, { ...args, noticeVersion: NOTICE });
    assert.notDeepEqual(await hubRows(...everyone), rowsBefore);
  });
});

/**
 * Clearly before anything connected from here on. By this machine's clock, and
 * the hub refuses a future time, so this is wide enough to outlast a container's drift.
 */
const tenMinutesAgo = () => new Date(Date.now() - 10 * 60_000).toISOString();

const namesIn = (rows: { name: string }[]) => rows.map((row) => row.name).sort();

function assertLocked(res: Wire, marker: string): void {
  assertWire(res);
  assert.ok(!res.text.includes('"detail"'), "the raw body has a detail key");
  assert.ok(!res.text.includes(marker), "the raw body has the grid");
  assert.ok(!res.text.includes(GRID_ROW), "the raw body has the grid");
}

describe("Locked details", () => {
  test("a viewer who hasn't finished sees the summary and no detail, as a friend and in a group", async () => {
    const [viewer, friend] = await people("Viewer", "Finisher");
    await befriend(viewer, friend);
    const { groupId, inviteCode } = await makeGroup(friend);
    await joinGroup(viewer, inviteCode);

    const puzzle = await newPuzzle();
    const { marker, official } = await play(friend, puzzle, { mistakes: 2 });
    assert.equal(official, true);

    for (const view of [undefined, groupId]) {
      const res = await resultsRaw(viewer, puzzle.id, view);
      assertLocked(res, marker);
      assert.equal(res.json.data.length, 1);
      const [row] = res.json.data;
      assert.equal(row.name, friend.name);
      assert.equal(row.isMe, false);
      assert.equal(row.detailLocked, true);
      assert.deepEqual(row.summary, { solved: true, mistakes: 2 });
      assert.ok(!("detail" in row));
    }
  });

  test("a viewer still playing, or who finished it from the archive, stays locked", async () => {
    const [viewer, friend] = await people("Mid-game viewer", "Finisher");
    await befriend(viewer, friend);

    const midGame = await newPuzzle();
    const { marker } = await play(friend, midGame);
    await play(viewer, midGame, { status: "in_progress" });
    assertLocked(await resultsRaw(viewer, midGame.id), marker);

    const fromArchive = await newPuzzle();
    const archived = await play(friend, fromArchive);
    await play(viewer, fromArchive, { entryContext: "archive_calendar" });
    assertLocked(await resultsRaw(viewer, fromArchive.id), archived.marker);
  });

  test("finishing the same puzzle opens it, and a different puzzle doesn't", async () => {
    const [viewer, friend] = await people("Viewer", "Finisher");
    await befriend(viewer, friend);
    const { groupId, inviteCode } = await makeGroup(friend);
    await joinGroup(viewer, inviteCode);

    const theirs = await newPuzzle();
    const another = await newPuzzle();
    const { grid, marker } = await play(friend, theirs, { status: "lost", mistakes: 4 });

    await play(viewer, another);
    assert.equal((await results(viewer, another.id)).length, 1, "the viewer's own row on the other puzzle");
    for (const view of [undefined, groupId]) assertLocked(await resultsRaw(viewer, theirs.id, view), marker);

    const mine = await play(viewer, theirs, { mistakes: 1 });
    for (const view of [undefined, groupId]) {
      const rows = await results(viewer, theirs.id, view);
      assert.equal(rows.length, 2);
      const theirRow = rows.find((row) => !row.isMe);
      assert.equal(theirRow.detail, grid);
      assert.equal(theirRow.detailLocked, false);
      assert.deepEqual(theirRow.summary, { solved: false, mistakes: 4 });
      assert.equal(rows.find((row) => row.isMe).detail, mine.grid);
    }
  });

  test("a result is read for a friend who hasn't called the gateway since finishing", async () => {
    const [viewer, quiet, quietInGroup] = await people("Viewer", "Quiet", "Quiet in group");
    await befriend(viewer, quiet);
    const { groupId, inviteCode } = await makeGroup(viewer);
    await joinGroup(quietInGroup, inviteCode);

    const puzzle = await newPuzzle();
    await play(quiet, puzzle);
    await play(quietInGroup, puzzle);
    assert.equal(await cards(quiet, puzzle), 0, "nothing has read it yet");
    assert.equal(await cards(quietInGroup, puzzle), 0, "nothing has read it yet");

    // Only the viewer asks, and neither of them has made a call since finishing.
    assert.deepEqual(namesIn(await results(viewer, puzzle.id)), [quiet.name]);
    assert.equal(await cards(quiet, puzzle), 1);
    assert.deepEqual(namesIn(await results(viewer, puzzle.id, groupId)), [quietInGroup.name]);
    assert.equal(await cards(quietInGroup, puzzle), 1);
  });

  test("rows that aren't an official daily never appear", async (t) => {
    const [viewer, friend] = await people("Viewer", "Friend");
    await befriend(viewer, friend);

    const assertShows = async () => {
      const puzzle = await newPuzzle();
      await play(friend, puzzle);
      assert.deepEqual(namesIn(await results(viewer, puzzle.id)), [friend.name]);
    };
    // Each case changes one thing from this, so a pass can't mean results are simply off.
    await assertShows();

    const cases: [string, () => Promise<{ puzzle: { id: string; date: string }; marker?: string }>][] = [
      ["an unofficial replay", async () => {
        const puzzle = await newPuzzle();
        // Rainbow's trigger keeps the first finish as official, whatever a later row claims.
        assert.equal((await play(friend, puzzle, { entryContext: "archive_calendar" })).official, true);
        const replay = await play(friend, puzzle);
        assert.equal(replay.official, false);
        return { puzzle, marker: replay.marker };
      }],
      ["a game in progress", async () => {
        const puzzle = await newPuzzle();
        await play(friend, puzzle, { status: "in_progress" });
        return { puzzle };
      }],
      ...["archive_calendar", "free_collection", "archive_direct", null].map((entryContext) =>
        [`entry_context ${entryContext}`, async () => {
          const puzzle = await newPuzzle();
          return { puzzle, marker: (await play(friend, puzzle, { entryContext })).marker };
        }] as [string, () => Promise<{ puzzle: { id: string; date: string }; marker?: string }>],
      ),
      ["a beta puzzle", async () => {
        const puzzle = await newPuzzle({ published: false, beta: true });
        return { puzzle, marker: (await play(friend, puzzle)).marker };
      }],
      ["a free puzzle", async () => {
        const puzzle = await newPuzzle({ free: true });
        return { puzzle, marker: (await play(friend, puzzle)).marker };
      }],
      ["an unpublished puzzle", async () => {
        const puzzle = await newPuzzle({ published: false });
        return { puzzle, marker: (await play(friend, puzzle)).marker };
      }],
      ["a mini", async () => {
        const puzzle = await newPuzzle({ format: "mini" });
        return { puzzle, marker: (await play(friend, puzzle, { format: "mini" })).marker };
      }],
      ["a mini whose session claims to be the full game", async () => {
        const puzzle = await newPuzzle({ format: "mini" });
        return { puzzle, marker: (await play(friend, puzzle)).marker };
      }],
      ["a seeded daily finished long after its date", async () => {
        const puzzle = seededPuzzle("fullRainbow");
        return { puzzle, marker: (await play(friend, puzzle)).marker };
      }],
    ];

    for (const [label, arrange] of cases) {
      await t.test(label, async () => {
        const { puzzle, marker } = await arrange();
        const res = await resultsRaw(viewer, puzzle.id);
        assertWire(res);
        assert.deepEqual(res.json.data, []);
        if (marker) assert.ok(!res.text.includes(marker));
        assert.equal(await cards(friend, puzzle), 0, "no card should exist");
      });
    }

    // Still connected, still working.
    await assertShows();
  });

  test("the cut-off is the start of the second day after the puzzle's date, in UTC", async () => {
    const puzzle = seededPuzzle("fullClassic");
    const [viewer, inTime, tooLate] = await people("Viewer", "In time", "Too late");
    const refs = [await befriend(viewer, inTime), await befriend(viewer, tooLate)];
    // Connected before the puzzle, so forward-only has no say in this.
    await db.query("update social.friendships set since = $2::date - 30 where id = any($1::uuid[])", [refs, puzzle.date]);

    const cutOff = Date.parse(`${puzzle.date}T00:00:00.000Z`) + 2 * 24 * 60 * 60 * 1000;
    await play(inTime, puzzle, { completedAt: new Date(cutOff - 1).toISOString() });
    await play(tooLate, puzzle, { completedAt: new Date(cutOff).toISOString() });

    assert.deepEqual(namesIn(await results(viewer, puzzle.id)), [inTime.name]);
    assert.equal(await cards(tooLate, puzzle), 0);
  });

  test("a result finished before two people connected doesn't show", async () => {
    const [viewer, friend, groupViewer] = await people("Viewer", "Early", "Group viewer");
    const { groupId, inviteCode } = await makeGroup(friend);
    const puzzle = await newPuzzle();
    const { marker } = await play(friend, puzzle, { completedAt: tenMinutesAgo() });

    await befriend(viewer, friend);
    await joinGroup(groupViewer, inviteCode);
    await play(viewer, puzzle);
    await play(groupViewer, puzzle);

    const res = await resultsRaw(viewer, puzzle.id);
    assertWire(res);
    assert.deepEqual(namesIn(res.json.data), [viewer.name]);
    assert.ok(!res.text.includes(marker));
    assert.deepEqual(namesIn(await results(groupViewer, puzzle.id, groupId)), [groupViewer.name]);
    assert.equal(await cards(friend, puzzle), 1, "the card exists, so it's the rule hiding it");

    // The control: a game finished after connecting shows to both.
    const later = await newPuzzle();
    await play(friend, later);
    assert.deepEqual(namesIn(await results(viewer, later.id)), [friend.name]);
    assert.deepEqual(namesIn(await results(groupViewer, later.id, groupId)), [friend.name]);
  });

  test("unfriending hides a result at once, on both sides", async () => {
    const [viewer, friend] = await people("Viewer", "Friend");
    const friendRef = await befriend(viewer, friend);
    const puzzle = await newPuzzle();
    await play(friend, puzzle);
    await play(viewer, puzzle);
    assert.equal((await results(viewer, puzzle.id)).length, 2);

    await ok(viewer, "removeFriend", { friendRef });
    assert.deepEqual(namesIn(await results(viewer, puzzle.id)), [viewer.name]);
    assert.deepEqual(namesIn(await results(friend, puzzle.id)), [friend.name]);
  });

  test("leaving a group hides a result at once", async () => {
    const [viewer, member] = await people("Viewer", "Member");
    const { groupId, inviteCode } = await makeGroup(viewer);
    await joinGroup(member, inviteCode);
    const puzzle = await newPuzzle();
    await play(member, puzzle);
    assert.deepEqual(namesIn(await results(viewer, puzzle.id, groupId)), [member.name]);

    await ok(member, "leaveGroup", { groupId });
    assert.deepEqual(await results(viewer, puzzle.id, groupId), []);
    await refused(member, "listResults", { gameId: "rainbow", puzzleId: puzzle.id, groupId }, "not_a_member");
  });

  test("removal from a group hides a result at once", async () => {
    const [owner, member] = await people("Owner", "Member");
    const { groupId, inviteCode } = await makeGroup(owner);
    await joinGroup(member, inviteCode);
    const puzzle = await newPuzzle();
    await play(member, puzzle);
    assert.deepEqual(namesIn(await results(owner, puzzle.id, groupId)), [member.name]);

    await ok(owner, "removeMember", { groupId, memberRef: await memberRefOf(owner, groupId, member) });
    assert.deepEqual(await results(owner, puzzle.id, groupId), []);
    await refused(member, "listResults", { gameId: "rainbow", puzzleId: puzzle.id, groupId }, "not_a_member");
  });

  test("a block hides a result at once, whoever made it, and in a shared group", async () => {
    const [blocker, blocked, sharing] = await people("Blocker", "Blocked", "Sharing");
    const friendRef = await befriend(blocker, blocked);
    const { groupId, inviteCode } = await makeGroup(blocker);
    await joinGroup(blocked, inviteCode);
    await joinGroup(sharing, inviteCode);

    const puzzle = await newPuzzle();
    await play(blocker, puzzle);
    await play(blocked, puzzle);
    await play(sharing, puzzle);
    assert.equal((await results(blocker, puzzle.id)).length, 2);
    assert.equal((await results(blocked, puzzle.id, groupId)).length, 3);

    await ok(blocker, "block", { ref: friendRef });

    assert.deepEqual(namesIn(await results(blocker, puzzle.id)), [blocker.name]);
    assert.deepEqual(namesIn(await results(blocked, puzzle.id)), [blocked.name]);
    // In the group, the two lose each other and nobody else.
    assert.deepEqual(namesIn(await results(blocker, puzzle.id, groupId)), [blocker.name, sharing.name].sort());
    assert.deepEqual(namesIn(await results(blocked, puzzle.id, groupId)), [blocked.name, sharing.name].sort());
    assert.equal((await results(sharing, puzzle.id, groupId)).length, 3);
  });

  test("deleteMySocialData removes the person's cards, counted in the database", async () => {
    const [viewer, leaver] = await people("Viewer", "Leaver");
    await befriend(viewer, leaver);
    const puzzles = [await newPuzzle(), await newPuzzle()];
    for (const puzzle of puzzles) {
      await play(leaver, puzzle);
      assert.deepEqual(namesIn(await results(viewer, puzzle.id)), [leaver.name]);
    }

    const { rows } = await db.query<{ id: string }>("select id from social.persons where global_user_id = $1", [leaver.globalId]);
    const cardsOf = () => count("select count(*)::int as n from social.result_cards where person_id = $1", [rows[0].id]);
    assert.equal(await cardsOf(), 2);

    await ok(leaver, "deleteMySocialData");

    assert.equal(await cardsOf(), 0);
    assert.equal(await hubPersons(leaver), 0);
    assert.deepEqual(await ok(viewer, "listFriends"), []);
    assert.deepEqual(await results(viewer, puzzles[0].id), []);
    assert.equal(await cardsOf(), 0, "a read mustn't bring a card back");
  });
});

describe("Real concurrency", () => {
  test("two people accepting one friend link: one friendship, and the other gets invite_used", async () => {
    const inviter = await person("Inviter");
    const rounds = 3;
    for (let round = 0; round < rounds; round += 1) {
      const [first, second] = await people(`First ${round}`, `Second ${round}`);
      const { code } = await ok(inviter, "createFriendInvite", { noticeVersion: NOTICE });
      const answers = await allAtOnce(
        [first, second].map((who) => () => gw(who, "acceptFriendInvite", { code, noticeVersion: NOTICE })),
      );
      assert.deepEqual(tally(answers), { ok: 1, invite_used: 1 });
      assert.equal((await friendships(inviter, first)) + (await friendships(inviter, second)), 1);
    }
    assert.equal((await ok(inviter, "getMe")).friendCount, rounds);
  });

  test("accept against cancel on one request ends in one consistent state", async () => {
    const [from, to] = await people("Sender", "Receiver");
    for (let round = 0; round < 5; round += 1) {
      const requestRef = await requestFriend(from, to);
      const [accepted, cancelled] = await allAtOnce([
        () => gw(to, "acceptFriendRequest", { requestRef, noticeVersion: NOTICE }),
        () => gw(from, "cancelFriendRequest", { requestRef }),
      ]);
      const pair = [outcomeOf(accepted), outcomeOf(cancelled)].join(" then ");
      assert.ok(pair === "ok then not_found" || pair === "not_found then ok", `round ${round}: ${pair}`);

      const friends = await friendships(from, to);
      assert.equal(friends, outcomeOf(accepted) === "ok" ? 1 : 0, `round ${round}`);
      assert.equal(await requestsBetween(from, to), 0, `round ${round}`);

      // Back to strangers for the next round, through the front door.
      if (friends) await ok(to, "removeFriend", { friendRef: accepted.json.data.friendRef });
    }
  });

  test("a block racing an accept leaves no friendship", async () => {
    const [blocker, other] = await people("Blocker", "Other");
    const { groupId, inviteCode } = await makeGroup(blocker);
    await joinGroup(other, inviteCode);
    // A pending request isn't something to block by, so the two share a group.
    const ref = await memberRefOf(blocker, groupId, other);

    const race = async (accept: () => Promise<Wire>, allowed: string[], label: string) => {
      const [accepted, blocked] = await allAtOnce([accept, () => gw(blocker, "block", { ref })]);
      assert.equal(outcomeOf(blocked), "ok", label);
      assert.ok(allowed.includes(outcomeOf(accepted)), `${label}: ${outcomeOf(accepted)}`);
      assert.equal(await friendships(blocker, other), 0, label);
      assert.equal(await requestsBetween(blocker, other), 0, label);
      assert.equal(await blocksBetween(blocker, other), 1, label);
      await ok(blocker, "unblock", { blockRef: blocked.json.data.blockRef });
    };

    for (let round = 0; round < 4; round += 1) {
      const requestRef = await requestFriend(blocker, other);
      await race(
        () => gw(other, "acceptFriendRequest", { requestRef, noticeVersion: NOTICE }),
        ["ok", "not_found"],
        `request, round ${round}`,
      );

      const { code } = await ok(blocker, "createFriendInvite", { noticeVersion: NOTICE });
      await race(
        () => gw(other, "acceptFriendInvite", { code, noticeVersion: NOTICE }),
        ["ok", "invite_used"],
        `friend link, round ${round}`,
      );
    }
  });

  test("40 simultaneous finds: the 30-a-day limit holds exactly", async () => {
    const [seeker, target] = await people("Seeker", "Target");
    const { friendCode } = await ok(target, "getMe");
    const answers = await allAtOnce(
      Array.from({ length: 40 }, () => () => gw(seeker, "findFriendByCode", { friendCode })),
    );
    assert.deepEqual(tally(answers), { ok: 30, slow_down: 10 });
    assert.equal(await activity(seeker, "friend_lookup"), 30);
    await refused(seeker, "findFriendByCode", { friendCode }, "slow_down");
  });

  test("8 people joining one group at once all get in, and the count is exact", async () => {
    const owner = await person("Owner");
    const joiners = await people(...Array.from({ length: 8 }, (_, i) => `Joiner ${i}`));
    const { groupId, inviteCode } = await makeGroup(owner);

    const answers = await allAtOnce(
      joiners.map((who) => () => gw(who, "joinGroup", { code: inviteCode, myName: who.name, noticeVersion: NOTICE })),
    );
    assert.deepEqual(tally(answers), { ok: 8 });

    assert.equal(await memberships(groupId), 9);
    const [group] = await ok(owner, "listMyGroups");
    assert.equal(group.memberCount, 9);
    const members = await ok(owner, "listMembers", { groupId });
    assert.deepEqual(namesIn(members), [owner, ...joiners].map((who) => who.name).sort());
  });

  test("one person joining 5 times at once has one membership", async () => {
    const [owner, joiner] = await people("Owner", "Keen");
    const { groupId, inviteCode } = await makeGroup(owner);

    const answers = await allAtOnce(
      Array.from({ length: 5 }, () => () => gw(joiner, "joinGroup", { code: inviteCode, myName: joiner.name, noticeVersion: NOTICE })),
    );
    assert.deepEqual(tally(answers), { ok: 5 });
    assert.equal(await memberships(groupId), 2);
    assert.equal(await activity(joiner, "join"), 1);
  });

  test("first contact from 5 requests at once makes one person", async () => {
    const newcomer = await makeAccount("Newcomer");
    const answers = await allAtOnce(Array.from({ length: 5 }, () => () => gw(newcomer, "getMe")));
    assert.deepEqual(tally(answers), { ok: 5 });
    assert.equal(new Set(answers.map((answer) => answer.json.data.friendCode)).size, 1);
    assert.equal(await hubPersons(newcomer), 1);
  });

  test("the first result wins under simultaneous reads: exactly one card", async () => {
    const [friend, ...viewers] = await people("Finisher", "Reader 1", "Reader 2", "Reader 3");
    for (const viewer of viewers) await befriend(viewer, friend);
    const puzzle = await newPuzzle();
    await play(friend, puzzle, { mistakes: 1 });

    const readers = [friend, ...viewers, friend, ...viewers, friend, ...viewers];
    const answers = await allAtOnce(readers.map((who) => () => resultsRaw(who, puzzle.id)));
    for (const answer of answers) {
      assert.equal(answer.json.data.length, 1);
      assert.deepEqual(answer.json.data[0].summary, { solved: true, mistakes: 1 });
    }
    assert.equal(await cards(friend, puzzle), 1);

    // The card stands even if Rainbow's row later says otherwise.
    await db.query("update public.game_sessions set mistakes = 4 where puzzle_id = $1 and user_id = $2", [puzzle.id, friend.authUserId]);
    const [row] = await results(viewers[0], puzzle.id);
    assert.deepEqual(row.summary, { solved: true, mistakes: 1 });
    assert.equal(await cards(friend, puzzle), 1);
  });
});

test("nothing the gateway sent in this whole run holds an identity", () => {
  assert.ok(traffic.length > 0);
  assert.deepEqual(leaksIn(traffic), []);
});
