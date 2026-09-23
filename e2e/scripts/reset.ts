/**
 * Rebuild the disposable local database from nothing and seed the fixtures.
 *
 * `npm run e2e:reset`
 *
 * Idempotent by construction: it drops and recreates the `public` schema and
 * clears `auth.users` before doing anything else, so running it twice in a
 * row produces byte-identical state (only the manifest's `seededAt` and the
 * generated uuids differ).
 *
 * Nothing destructive happens before assertDisposableTarget() has passed.
 */

import pg from "pg";
import { assertIsE2eStack, guardContext, loadE2eConfig } from "../env.ts";
import { assertDisposableTarget, UnsafeTargetError } from "../safety.ts";
import { applySchemaPlan, buildSchemaPlan } from "./lib/schema.ts";
import { containerRuntime } from "./lib/process.ts";
import { readStackStatus } from "./lib/stack.ts";
import { createSupabaseSeedBackend } from "./lib/seed-supabase.ts";
import { seedFixtures } from "./lib/seed-core.ts";
import { writeSeedManifest } from "../fixtures/manifest.ts";

async function main(): Promise<number> {
  const config = loadE2eConfig();

  // ── The guard, before anything can be dropped ──
  try {
    assertDisposableTarget("e2e:reset", config, guardContext());
  } catch (error) {
    if (error instanceof UnsafeTargetError) {
      console.error(`\n${error.message}\n`);
      return 2;
    }
    throw error;
  }

  if (!containerRuntime()) {
    console.error(
      "\nNo container runtime found on PATH (looked for `docker` and `podman`).\n" +
        "The E2E environment is a real local Supabase stack, which needs one.\n" +
        "Install Docker Desktop (or Podman) and re-run `npm run e2e:up`.\n" +
        "\nWithout it you can still run `npm run e2e:db:verify`, which applies\n" +
        "every migration and the full seed to an in-process Postgres — see\n" +
        "e2e/README.md, 'Running without Docker'.\n"
    );
    return 3;
  }

  const status = readStackStatus();
  if (!status.ok) {
    console.error(
      `\nThe local Supabase stack is not reachable.\n  ${status.error}\n\n` +
        "Start it with `npm run e2e:up` first.\n"
    );
    return 4;
  }

  // The second question, after "is it disposable?": is it OURS? This is the
  // last checkpoint before the public schema is dropped.
  try {
    assertIsE2eStack(config.apiUrl, config.dbUrl);
  } catch (error) {
    console.error(`
${error instanceof Error ? error.message : String(error)}
`);
    return 5;
  }

  console.log(`Rebuilding ${config.dbUrl.replace(/:[^:@/]*@/, ":****@")}`);

  const client = new pg.Client({ connectionString: config.dbUrl });
  await client.connect();
  try {
    const plan = buildSchemaPlan({ includeSupabaseStubs: false, includeReset: true });
    // Each step is one multi-statement simple query, so a step is atomic:
    // a migration either lands whole or not at all. No migration in this
    // repository uses CONCURRENTLY or its own BEGIN/COMMIT, which is what
    // makes that safe.
    await applySchemaPlan(
      { exec: (sql) => client.query(sql) },
      plan,
      (label, index, total) => {
        // One line per step, padded so the migration list reads as a column.
        console.log(`  [${String(index).padStart(2, " ")}/${total}] ${label}`);
      }
    );
  } finally {
    await client.end();
  }

  console.log("Seeding fixtures…");
  const manifest = await seedFixtures(createSupabaseSeedBackend(config), {
    apiUrl: config.apiUrl,
    log: (message) => console.log(`  ${message}`),
  });
  writeSeedManifest(manifest);

  console.log(
    `\nReady. ${Object.keys(manifest.official).length} official puzzles, ` +
      `${Object.keys(manifest.custom).length} custom, ` +
      `${Object.keys(manifest.accounts).length} accounts.\n` +
      "Run `npm run e2e:smoke` or `npm run e2e:test`.\n"
  );
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`\n${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(1);
  }
);
