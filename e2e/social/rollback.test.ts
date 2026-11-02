/**
 * Takes the shared hub out with its real uninstall.sql, confirms nothing of
 * Rainbow's or CrossPuns' moved, and puts the hub back.
 *
 *   npx tsx --tsconfig e2e/tsconfig.json --test e2e/social/rollback.test.ts
 *
 * Run it on its own. The uninstall deletes every friendship, group and card in
 * the hub, so nothing else may be using the hub while it runs. Whatever happens
 * below, the `after` hook gives the stack its hub and its beta list back.
 *
 * Importing harness.ts is what refuses a target that isn't this machine's stack.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { REPO_ROOT } from "../env.ts";
import { assertGatewayUp, assertWire, closeStack, count, db, ensureAccount, gw, ok, outcomeOf, person, type Who } from "./harness.ts";

// The same place e2e/scripts/social-setup.ts looks.
const hubDir = process.env.SOCIAL_HUB_DIR?.trim() || path.resolve(REPO_ROOT, "..", "crosspuns");
const hubFile = path.join(hubDir, "supabase", "drafts", "shared-social", "0001_social_hub.sql");
const uninstallFile = path.join(hubDir, "supabase", "drafts", "shared-social", "uninstall.sql");

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** What the public schema is, one statement per kind of object, each in a fixed order. */
const DEFINITIONS: Record<string, string> = {
  columns: `
    select table_name, column_name, ordinal_position, data_type, udt_name, is_nullable, column_default
      from information_schema.columns
     where table_schema = 'public'
     order by 1, 3`,
  constraints: `
    select c.conrelid::regclass::text as relation, c.conname, pg_get_constraintdef(c.oid) as definition
      from pg_constraint c
     where c.connamespace = 'public'::regnamespace
     order by 1, 2`,
  functions: `
    select p.oid::regprocedure::text as signature, p.prokind, p.prosecdef, p.provolatile, p.proconfig,
           p.proacl::text as acl,
           case when p.prokind in ('f', 'p') then pg_get_functiondef(p.oid) else p.prosrc end as definition
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
     order by 1`,
  indexes: `
    select tablename, indexname, indexdef
      from pg_indexes
     where schemaname = 'public'
     order by 1, 2`,
  policies: `
    select tablename, policyname, permissive, roles::text as roles, cmd, qual, with_check
      from pg_policies
     where schemaname = 'public'
     order by 1, 2`,
  triggers: `
    select t.tgrelid::regclass::text as relation, t.tgname, pg_get_triggerdef(t.oid) as definition
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
     where c.relnamespace = 'public'::regnamespace and not t.tgisinternal
     order by 1, 2`,
  views: `
    select viewname, definition
      from pg_views
     where schemaname = 'public'
     order by 1`,
  relations: `
    select c.relname, c.relkind, c.relrowsecurity, c.relacl::text as acl
      from pg_class c
     where c.relnamespace = 'public'::regnamespace
     order by 1`,
  types: `
    select t.typname, t.typtype
      from pg_type t
     where t.typnamespace = 'public'::regnamespace
     order by 1`,
};

/** Row counts of every public table, and a hash per kind of definition, so a difference names itself. */
async function fingerprint() {
  const { rows } = await db.query<{ tablename: string }>("select tablename from pg_tables where schemaname = 'public' order by 1");
  const rowCounts: Record<string, number> = {};
  for (const { tablename } of rows) {
    rowCounts[tablename] = await count(`select count(*)::int as n from public."${tablename.replaceAll('"', '""')}"`);
  }
  const definitions: Record<string, string> = {};
  for (const [kind, sql] of Object.entries(DEFINITIONS)) {
    definitions[kind] = sha256(JSON.stringify((await db.query(sql)).rows));
  }
  return { rowCounts, definitions };
}

async function hubState(): Promise<{ schema: boolean; roles: number; grants: number }> {
  const { rows } = await db.query(`
    select to_regnamespace('social') is not null as schema,
           (select count(*)::int from pg_roles r where r.rolname in ('social_gateway', 'social_game_server')) as roles,
           (select count(*)::int from pg_auth_members m
              join pg_roles r on r.oid = m.roleid
             where r.rolname in ('social_gateway', 'social_game_server')) as grants
  `);
  return rows[0];
}

interface Tester {
  global_user_id: string;
  added_at: string;
}

const readTesters = async () =>
  (await db.query<Tester>("select global_user_id, added_at::text as added_at from social.beta_testers order by 1")).rows;

async function restoreTesters(testers: Tester[]): Promise<void> {
  for (const { global_user_id, added_at } of testers) {
    await db.query(
      "insert into social.beta_testers (global_user_id, added_at) values ($1, $2::timestamptz) on conflict do nothing",
      [global_user_id, added_at],
    );
  }
}

const installMark = () => `social-setup sha256 ${sha256(readFileSync(hubFile, "utf8"))}`;

/** As e2e/scripts/social-setup.ts does it: whole or not at all, with the mark that script looks for. */
async function installHub(): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("begin");
    await client.query(readFileSync(hubFile, "utf8"));
    await client.query(`comment on schema social is '${installMark()}'`);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Set from just before the uninstall until the beta list is confirmed back. */
let testersToRestore: Tester[] | null = null;

before(async () => {
  assert.ok(existsSync(hubFile) && existsSync(uninstallFile), "The hub's SQL wasn't found. Set SOCIAL_HUB_DIR to the checkout that holds it.");
  await assertGatewayUp();
});

after(async () => {
  try {
    if (testersToRestore) {
      if (!(await hubState()).schema) await installHub();
      await restoreTesters(testersToRestore);
    }
  } finally {
    await closeStack();
  }
});

test("uninstall removes the hub and nothing else, and a reinstall puts it back", async (t) => {
  const { rows } = await db.query<{ acting: string }>("select current_user as acting");
  assert.equal(rows[0].acting, "postgres");

  const tester = await person("Rollback");
  await ok(tester, "getMe");

  const prior = await fingerprint();
  for (const table of ["game_sessions", "accounts", "puzzles", "xw_puzzles", "xw_accounts", "xw_groups"]) {
    assert.ok(table in prior.rowCounts, `${table} isn't in the fingerprint`);
  }
  const installed = await hubState();
  assert.deepEqual(installed, { schema: true, roles: 2, grants: installed.grants });
  assert.ok(installed.grants >= 2, "postgres should hold both roles");
  const { rows: comments } = await db.query<{ mark: string | null }>("select obj_description('social'::regnamespace::oid, 'pg_namespace') as mark");
  if (comments[0].mark !== installMark()) {
    t.diagnostic("the installed hub wasn't from the current file; the reinstall below uses the current file");
  }

  const testers = await readTesters();
  assert.ok(testers.some((row) => row.global_user_id === tester.globalId));

  // ── Out ──

  testersToRestore = testers;
  const uninstall = readFileSync(uninstallFile, "utf8");
  await db.query(uninstall);

  const gone = { schema: false, roles: 0, grants: 0 };
  assert.deepEqual(await hubState(), gone);
  assert.deepEqual(await fingerprint(), prior);

  // Its own header says this is safe.
  await db.query(uninstall);
  assert.deepEqual(await hubState(), gone);

  // A normal answer from a gateway that has lost its hub, not a crash.
  const calls: [Who, string, Record<string, unknown>][] = [
    [tester, "getMe", {}],
    [tester, "listFriends", {}],
    [tester, "listResults", { gameId: "rainbow", puzzleId: "any" }],
    [null, "previewInvite", { code: "000000000000" }],
  ];
  for (const [who, op, args] of calls) {
    const res = await gw(who, op, args);
    assertWire(res, op);
    assert.equal(outcomeOf(res), "unavailable", op);
  }

  // Rainbow itself didn't notice.
  assert.equal((await ensureAccount(tester.token)).outcome, "ok");
  assert.deepEqual(await fingerprint(), prior);

  // ── Back in ──

  await installHub();
  assert.deepEqual(await hubState(), installed);
  assert.deepEqual(await fingerprint(), prior);

  await restoreTesters(testers);
  assert.deepEqual(await readTesters(), testers);
  testersToRestore = null;

  // The hub starts empty, so this person is new to it, and still on the list.
  const me = await ok(tester, "getMe");
  assert.equal(me.displayName, null);
  assert.equal(me.friendCount, 0);
  await assertGatewayUp();
  assert.deepEqual(await fingerprint(), prior);
});
