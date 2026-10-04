/**
 * Rehearse the beta reset end to end, in-process, against a database that
 * looks like the SHARED beta project: Rainbow's beta-era schema PLUS other
 * tenants' objects PLUS a shared auth pool.
 *
 *   npm run db:rehearse-reset
 *
 * What it proves, every time it runs (it is part of `npm run verify`):
 *
 *   1. the generated teardown drops every Rainbow object (launch manifest ∪
 *      beta-era inventory) and NOTHING with another tenant's prefix — decoy
 *      xw_/cv_/wtf_ tables, a decoy function and a decoy policy all survive;
 *   2. the auth keep-list is honoured: the other tenant's admin survives with
 *      its FK row intact, Rainbow's beta users are gone;
 *   3. the baseline then applies on top of what is left, and the result is
 *      exactly the committed ownership manifest;
 *   4. the beta-era ledger rows are removed.
 *
 * Nothing here touches a real database: PGlite is an in-process PostgreSQL
 * that exists only for the duration of the run.
 */

import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../env.ts";
import { collectInventory, diffInventories, type Inventory } from "./lib/inventory.ts";
import { buildSchemaPlan } from "./lib/schema.ts";
import { buildTeardown } from "./teardown-sql.ts";

const BETA_DIR = path.join(REPO_ROOT, "supabase", "beta-era-migrations");
const MANIFEST = path.join(REPO_ROOT, "supabase", "rainbow-owned-objects.json");
const BETA_INVENTORY = path.join(BETA_DIR, "beta-era-inventory.json");
const EXTRAS = path.join(REPO_ROOT, "supabase", "ops", "beta-reset", "extra-objects.json");
const STUBS = path.join(REPO_ROOT, "e2e", "schema", "pglite", "000_supabase_stubs.sql");

const KEEP_USER = "11111111-1111-4111-8111-111111111111";
const BETA_USER = "22222222-2222-4222-8222-222222222222";

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/** The beta chain exactly as e2e/scripts/lib/schema.ts used to apply it. */
function betaEraPlan(): { label: string; sql: string }[] {
  const read = (...p: string[]) => readFileSync(path.join(BETA_DIR, ...p), "utf8");
  const steps: { label: string; sql: string }[] = [{ label: "pre-git tables", sql: read("pre-git", "010_pre_git_tables.sql") }];
  let columns = false;
  for (const f of readdirSync(BETA_DIR).filter((f) => /^2026.*\.sql$/.test(f)).sort()) {
    if (!columns && f >= "20260917120000") {
      columns = true;
      steps.push({ label: "pre-git columns", sql: read("pre-git", "020_pre_git_columns.sql") });
    }
    steps.push({ label: f, sql: read(f) });
  }
  steps.push({ label: "pre-git policies", sql: read("pre-git", "030_pre_git_policies.sql") });
  return steps;
}

const DECOYS = `
  -- What another tenant's objects look like in the shared project. None of
  -- these may be touched by Rainbow's teardown.
  create table public.xw_admins (user_id uuid primary key references auth.users(id) on delete cascade);
  create table public.xw_puzzles (id uuid primary key default gen_random_uuid(), publish_date date not null);
  create table public.cv_wordbank (id serial primary key, word text not null);
  create table public.wtf_players (id uuid primary key default gen_random_uuid(), email text);
  create function public.xw_is_admin() returns boolean language sql stable security definer as $$
    select exists (select 1 from public.xw_admins where user_id = auth.uid())
  $$;
  alter table public.xw_puzzles enable row level security;
  create policy "xw anyone reads published puzzles" on public.xw_puzzles for select using (publish_date <= current_date or public.xw_is_admin());
  -- The shared auth pool: the other tenant's admin (kept) and a Rainbow beta user (deleted).
  insert into auth.users (id, email) values ('${KEEP_USER}', 'crosspuns-admin@example.test');
  insert into auth.users (id, email) values ('${BETA_USER}', 'rainbow-beta-player@example.test');
  insert into public.xw_admins (user_id) values ('${KEEP_USER}');
  insert into public.account_onboarding (user_id, status, decided_at) values ('${BETA_USER}', 'legacy', now());
  -- The CLI's ledger, as the shared project has it.
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
  insert into supabase_migrations.schema_migrations (version) values ('20260322052030'), ('20260917000000'), ('20260929000000');
  -- Storage exists on a real project even though this backend has no Storage API.
  create schema storage;
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
`;

async function main(): Promise<number> {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as Inventory;
  const beta = JSON.parse(readFileSync(BETA_INVENTORY, "utf8")) as Inventory;
  const extras = JSON.parse(readFileSync(EXTRAS, "utf8"));

  const db = new PGlite();
  console.log("1. building the beta-era Rainbow schema on a blank in-process Postgres…");
  await db.exec(readFileSync(STUBS, "utf8"));
  for (const step of betaEraPlan()) {
    try {
      await db.exec(step.sql);
    } catch (error) {
      throw new Error(`beta-era step failed — ${step.label}: ${(error as Error).message}`);
    }
  }
  console.log("2. adding other tenants' decoy objects and a shared auth pool…");
  await db.exec(DECOYS);

  const before = await collectInventory(db);
  const rainbowTablesBefore = before.tables.map((t) => t.name).filter((n) => !/^(xw|cv|wtf)_/.test(n));
  console.log(`   public now holds ${before.tables.length} tables (${rainbowTablesBefore.length} Rainbow, ${before.tables.length - rainbowTablesBefore.length} decoy)`);

  console.log("3. running the generated teardown (apply mode) with the keep-list…");
  const teardown = buildTeardown(manifest, beta, extras, [KEEP_USER], "apply");
  await db.exec(teardown);

  const after = await collectInventory(db);
  const tablesAfter = after.tables.map((t) => t.name);
  const functionsAfter = after.functions.map((f) => f.name);
  expect(tablesAfter.every((n) => /^(xw|cv|wtf)_/.test(n)), `Rainbow tables survived the teardown: ${tablesAfter.filter((n) => !/^(xw|cv|wtf)_/.test(n)).join(", ")}`);
  expect(["xw_admins", "xw_puzzles", "cv_wordbank", "wtf_players"].every((n) => tablesAfter.includes(n)), `a decoy table was dropped; left: ${tablesAfter.join(", ")}`);
  expect(functionsAfter.includes("xw_is_admin") && functionsAfter.length === 1, `functions after teardown should be exactly xw_is_admin, got: ${functionsAfter.join(", ")}`);
  expect(after.tables.find((t) => t.name === "xw_puzzles")!.policies.length === 1, "the decoy policy was dropped");
  expect(after.types.length === 0, `types after teardown: ${after.types.map((t) => t.name).join(", ")}`);

  const users = await db.query<{ id: string }>("select id from auth.users order by id");
  expect(users.rows.length === 1 && users.rows[0].id === KEEP_USER, `auth.users after teardown: ${users.rows.map((r) => r.id).join(", ")}`);
  const xwAdmin = await db.query<{ n: number }>("select count(*)::int as n from public.xw_admins where user_id = $1", [KEEP_USER]);
  expect(xwAdmin.rows[0].n === 1, "the other tenant's admin row did not survive");
  const ledger = await db.query<{ version: string }>("select version from supabase_migrations.schema_migrations order by 1");
  expect(ledger.rows.length === 0, `beta ledger rows remain: ${ledger.rows.map((r) => r.version).join(", ")}`);
  console.log("   ✓ every Rainbow object gone, every decoy intact, keep-list honoured, ledger cleared");

  console.log("4. applying the launch baseline on top of what is left…");
  for (const step of buildSchemaPlan({ includeSupabaseStubs: false, includeReset: false })) {
    try {
      await db.exec(step.sql);
    } catch (error) {
      throw new Error(`baseline step failed — ${step.label}: ${(error as Error).message}`);
    }
  }

  const rebuilt = await collectInventory(db);
  const rainbowOnly: Inventory = {
    ...rebuilt,
    tables: rebuilt.tables.filter((t) => !/^(xw|cv|wtf)_/.test(t.name)),
    functions: rebuilt.functions.filter((f) => !/^(xw|cv|wtf)_/.test(f.name)),
    sequences: rebuilt.sequences.filter((s) => !/^(xw|cv|wtf)_/.test(s)),
    storage: { available: false, buckets: [], policies: [] },
  };
  const diff = diffInventories({ ...manifest, storage: { available: false, buckets: [], policies: [] } }, rainbowOnly);
  if (diff.length) {
    console.error("   the rebuilt schema differs from the committed manifest:");
    for (const line of diff) console.error(`     - ${line}`);
    return 1;
  }
  const decoysStill = rebuilt.tables.map((t) => t.name).filter((n) => /^(xw|cv|wtf)_/.test(n));
  expect(decoysStill.length === 4, `decoys after rebuild: ${decoysStill.join(", ")}`);
  console.log(`   ✓ ${rainbowOnly.tables.length} tables, ${rainbowOnly.functions.length} functions, ${rainbowOnly.tables.reduce((n, t) => n + t.policies.length, 0)} policies: identical to the committed manifest; decoys untouched`);

  console.log("5. the rebuilt schema works: a guest device can be minted and a Rainbow account created…");
  const device = await db.query<{ device_id: string }>("select * from public.create_device_identity()");
  expect(!!device.rows[0]?.device_id, "create_device_identity() returned nothing");
  await db.query("insert into auth.users (id, email) values ($1, 'launch-player@example.test')", [BETA_USER]);
  await db.query("insert into auth.identities (user_id, provider, provider_id) values ($1, 'custom:platform', 'user_REHEARSAL0000000000000001')", [BETA_USER]);
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: BETA_USER, role: "authenticated" })]);
  const account = await db.query<{ global_user_id: string }>("select * from public.ensure_account()");
  expect(account.rows[0]?.global_user_id === "user_REHEARSAL0000000000000001", "ensure_account() did not link the rehearsal user");
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: KEEP_USER, role: "authenticated" })]);
  const foreign = await db.query<{ uid: string | null }>("select public.rainbow_uid() as uid");
  expect(foreign.rows[0].uid === null, "the other tenant's admin must not resolve to a Rainbow account");
  console.log("   ✓ account layer live; the other tenant's admin is a guest to Rainbow");

  console.log("\nBeta reset rehearsal PASSED.");
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`\nBeta reset rehearsal FAILED\n${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(1);
  }
);
