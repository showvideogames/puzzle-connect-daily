/**
 * Puts the shared hub on the disposable local database, so it mirrors the shared
 * project: Rainbow, the other game in that project, and the hub side by side.
 *
 *   npx tsx --tsconfig e2e/tsconfig.json e2e/scripts/social-setup.ts
 *
 * Run it after `npm run e2e:reset`, and as often as you like: whatever is already
 * there is skipped. The SQL comes from the sibling checkout that owns it, or from
 * SOCIAL_HUB_DIR if that is set.
 *
 * What counts as already there:
 *   * a migration: its name is in social_setup.applied, against the current
 *     `public` schema. e2e:reset rebuilds `public`, which takes those objects
 *     with it, so a list from before a reset no longer counts. The list has its
 *     own schema so that `public` holds exactly what the shared project's does.
 *   * the hub: the `social` schema exists. A reset leaves it alone, and it has no
 *     way to update in place, so a changed hub file is reported and not applied.
 *     uninstall.sql beside it takes the hub out.
 *
 * Nothing runs before assertDisposableTarget() and the local checks have passed.
 * Output is counts only.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { assertIsE2eStack, guardContext, loadE2eConfig, REPO_ROOT } from "../env.ts";
import { assertDisposableTarget, UnsafeTargetError } from "../safety.ts";

type Db = InstanceType<typeof pg.Client>;

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** assertDisposableTarget also allows hosts named in the environment. This script doesn't. */
function isLocal(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** Runs the work whole or not at all. No file applied here has its own BEGIN or COMMIT. */
async function atomically(db: Db, label: string, work: () => Promise<void>): Promise<void> {
  await db.query("begin");
  try {
    await work();
    await db.query("commit");
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw new Error(`${label} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function applyMigrations(db: Db, dir: string): Promise<{ found: number; applied: number }> {
  await db.query(`
    create schema if not exists social_setup;
    create table if not exists social_setup.applied (
      file text primary key,
      public_schema oid not null,
      applied_at timestamptz not null default now()
    );
    delete from social_setup.applied where public_schema <> 'public'::regnamespace::oid;
  `);
  const { rows } = await db.query<{ file: string }>("select file from social_setup.applied");
  const already = new Set(rows.map((row) => row.file));

  const files = readdirSync(dir).filter((file) => file.endsWith(".sql")).sort();
  let applied = 0;
  for (const file of files) {
    if (already.has(file)) continue;
    await atomically(db, `Migration ${file}`, async () => {
      await db.query(readFileSync(path.join(dir, file), "utf8"));
      await db.query("insert into social_setup.applied (file, public_schema) values ($1, 'public'::regnamespace::oid)", [file]);
    });
    applied += 1;
  }
  return { found: files.length, applied };
}

type HubState = "applied" | "already there" | "already there, from an older file: not applied";

async function applyHub(db: Db, file: string): Promise<HubState> {
  const sql = readFileSync(file, "utf8");
  const mark = `social-setup sha256 ${createHash("sha256").update(sql).digest("hex")}`;

  const { rows } = await db.query<{ there: boolean; installed: string | null }>(`
    select to_regnamespace('social') is not null as there,
           obj_description(to_regnamespace('social')::oid, 'pg_namespace') as installed
  `);
  if (rows[0].there) return rows[0].installed === mark ? "already there" : "already there, from an older file: not applied";

  await atomically(db, "The hub", async () => {
    await db.query(sql);
    await db.query(`comment on schema social is '${mark}'`);
  });
  return "applied";
}

async function main(): Promise<number> {
  const config = loadE2eConfig();

  try {
    assertDisposableTarget("social-setup", config, guardContext());
    assertIsE2eStack(config.apiUrl, config.dbUrl);
  } catch (error) {
    console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
    return error instanceof UnsafeTargetError ? 2 : 5;
  }
  if (!isLocal(config.apiUrl) || !isLocal(config.dbUrl)) {
    console.error("\nRefusing to run: the configured target is not on this machine. Nothing was changed.\n");
    return 2;
  }

  const hubDir = process.env.SOCIAL_HUB_DIR?.trim() || path.resolve(REPO_ROOT, "..", "crosspuns");
  const migrationsDir = path.join(hubDir, "supabase", "migrations");
  const hubFile = path.join(hubDir, "supabase", "drafts", "shared-social", "0001_social_hub.sql");
  if (!existsSync(migrationsDir) || !existsSync(hubFile)) {
    console.error("\nThe hub's SQL was not found. Set SOCIAL_HUB_DIR to the checkout that holds it. Nothing was changed.\n");
    return 3;
  }

  const db = new pg.Client({ connectionString: config.dbUrl });
  await db.connect();
  try {
    const migrations = await applyMigrations(db, migrationsDir);
    console.log(`Migrations: ${migrations.found} found, ${migrations.applied} applied, ${migrations.found - migrations.applied} already there.`);
    console.log(`Hub: ${await applyHub(db, hubFile)}.`);
  } finally {
    await db.end();
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
);
