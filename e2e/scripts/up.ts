/**
 * Start the disposable local Supabase stack and write `.env.e2e`.
 *
 * `npm run e2e:up`
 *
 * Applies no schema — `e2e/supabase/migrations/` is deliberately empty, so
 * the CLI brings up Postgres/GoTrue/PostgREST/Kong and nothing else. Schema
 * and fixtures are `npm run e2e:reset`'s job, because the ordering they need
 * is not the ordering `supabase start` would use (see e2e/scripts/lib/schema.ts).
 */

import { E2E_PROJECT_DIR, assertIsE2eStack, loadE2eConfig, guardContext } from "../env.ts";
import { assertDisposableTarget, UnsafeTargetError } from "../safety.ts";
import { containerRuntime, supabaseInherit } from "./lib/process.ts";
import { readStackStatus, writeE2eEnvFile } from "./lib/stack.ts";

/**
 * Supabase services the E2E environment never uses.
 *
 * Disabling something in `config.toml` stops the CLI STARTING it, but the
 * CLI still pre-pulls its image — which is how a Storage image this suite has
 * no use for came to be the thing that filled a disk and took the engine down
 * with it. Excluding them by name skips the pull entirely.
 *
 * What is deliberately kept: db, auth (GoTrue), rest (PostgREST) and kong —
 * the real data and authentication path the tests exist to exercise — plus
 * studio and postgres-meta, because being able to open the local database in
 * a browser is worth an image when a test result looks wrong, and mailpit,
 * which a password-reset test will need (see e2e/README.md, next cases).
 */
const EXCLUDED_SERVICES = [
  "storage-api",
  "imgproxy",
  "realtime",
  "edge-runtime",
  "logflare",
  "vector",
  "supavisor",
];

async function main(): Promise<number> {
  const runtime = containerRuntime();
  if (!runtime) {
    console.error(
      "\nNo container runtime found on PATH (looked for `docker` and `podman`).\n\n" +
        "The E2E environment is a genuine local Supabase stack — Postgres,\n" +
        "GoTrue and PostgREST in containers — because that is the only way the\n" +
        "browser tests exercise the app's real authentication and RLS paths.\n" +
        "There is no mock fallback, and there is deliberately no fallback to\n" +
        "the hosted project.\n\n" +
        "Install Docker Desktop (Windows/macOS) or Docker Engine/Podman (Linux),\n" +
        "then re-run `npm run e2e:up`.\n\n" +
        "Already installed? On Windows, Docker Desktop adds itself to your user\n" +
        "PATH, which a terminal that was already open will not pick up. Close\n" +
        "the terminal, open a new one, and try again.\n\n" +
        "In the meantime `npm run e2e:db:verify` still works: it applies every\n" +
        "migration to a clean in-process Postgres and runs the whole seed\n" +
        "against it. It proves the schema and fixtures, not the browser.\n"
    );
    return 3;
  }

  console.log(`Starting the E2E Supabase stack with ${runtime}…`);
  const code = await supabaseInherit(E2E_PROJECT_DIR, ["start", "-x", EXCLUDED_SERVICES.join(",")]);
  if (code !== 0) {
    console.error("\n`supabase start` failed. See the output above.\n");
    return code;
  }

  const status = readStackStatus();
  if (!status.ok) {
    console.error(`\nThe stack started but its status could not be read.\n  ${status.error}\n`);
    return 4;
  }

  // Before anything is written: is this the stack this suite owns, or did
  // the CLI quietly fall back to another project directory? Loopback alone
  // does not answer that — the ports do. See assertIsE2eStack.
  try {
    assertIsE2eStack(status.keys.apiUrl, status.keys.dbUrl);
  } catch (error) {
    console.error(`
${error instanceof Error ? error.message : String(error)}
`);
    return 5;
  }

  // Write the file, then validate what is actually in it — the guard has to
  // see the same values the app and the seeder will.
  const file = writeE2eEnvFile(status.keys);
  try {
    assertDisposableTarget("e2e:up", loadE2eConfig(), guardContext());
  } catch (error) {
    if (error instanceof UnsafeTargetError) {
      console.error(`\n${error.message}\n`);
      return 2;
    }
    throw error;
  }

  console.log(
    `\nStack up. Wrote ${file}.\n` +
      `  API    ${status.keys.apiUrl}\n` +
      `  DB     ${status.keys.dbUrl.replace(/:[^:@/]*@/, ":****@")}\n\n` +
      "Next: `npm run e2e:reset` to apply the schema and seed the fixtures.\n"
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
