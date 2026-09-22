/**
 * Re-seed the disposable local database WITHOUT rebuilding the schema.
 *
 * `npm run e2e:seed`
 *
 * Truncates every table in `public`, clears `auth.users`, then runs the same
 * seed `e2e:reset` runs. Use it when only the fixtures changed; use
 * `e2e:reset` when a migration or the baseline changed.
 *
 * Like every other destructive command here, it will not run until
 * assertDisposableTarget() has passed.
 */

import pg from "pg";
import { guardContext, loadE2eConfig } from "../env.ts";
import { assertDisposableTarget, UnsafeTargetError } from "../safety.ts";
import { createSupabaseSeedBackend } from "./lib/seed-supabase.ts";
import { seedFixtures } from "./lib/seed-core.ts";
import { writeSeedManifest } from "../fixtures/manifest.ts";

/**
 * Empties every table in `public` in one statement. CASCADE is what makes
 * one TRUNCATE enough despite the foreign keys between puzzles, versions,
 * groups and sessions; RESTART IDENTITY keeps any sequence-backed column
 * starting from the same place every run.
 */
const TRUNCATE_PUBLIC = `
do $$
declare _tables text;
begin
  select string_agg(format('%I.%I', schemaname, tablename), ', ')
    into _tables
    from pg_tables
   where schemaname = 'public';
  if _tables is not null then
    execute 'truncate table ' || _tables || ' restart identity cascade';
  end if;
end $$;
delete from auth.users;
`;

async function main(): Promise<number> {
  const config = loadE2eConfig();
  try {
    assertDisposableTarget("e2e:seed", config, guardContext());
  } catch (error) {
    if (error instanceof UnsafeTargetError) {
      console.error(`\n${error.message}\n`);
      return 2;
    }
    throw error;
  }

  const client = new pg.Client({ connectionString: config.dbUrl });
  await client.connect();
  try {
    console.log("Clearing fixture data…");
    await client.query(TRUNCATE_PUBLIC);
  } finally {
    await client.end();
  }

  console.log("Seeding fixtures…");
  const manifest = await seedFixtures(createSupabaseSeedBackend(config), {
    apiUrl: config.apiUrl,
    log: (message) => console.log(`  ${message}`),
  });
  writeSeedManifest(manifest);
  console.log("\nDone.\n");
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`\n${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(1);
  }
);
