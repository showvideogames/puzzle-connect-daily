/**
 * Stop the disposable local Supabase stack.
 *
 * `npm run e2e:down`            stop the containers, keep the volume
 * `npm run e2e:down -- --purge` stop and delete the data volume too
 *
 * Only ever acts on the E2E project directory, never on the repository's
 * real `supabase/` one — a developer's own `supabase start` for this project
 * is untouched.
 */

import { E2E_PROJECT_DIR } from "../env.ts";
import { containerRuntime, supabaseInherit } from "./lib/process.ts";

async function main(): Promise<number> {
  if (!containerRuntime()) {
    console.log("No container runtime on PATH — nothing to stop.");
    return 0;
  }
  const purge = process.argv.includes("--purge");
  const args = purge ? ["stop", "--no-backup"] : ["stop"];
  console.log(purge ? "Stopping the E2E stack and deleting its data…" : "Stopping the E2E stack…");
  return supabaseInherit(E2E_PROJECT_DIR, args);
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(String(error));
    process.exit(1);
  }
);
