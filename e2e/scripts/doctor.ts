/**
 * Diagnose the E2E environment without changing anything.
 *
 * `npm run e2e:doctor`
 *
 * Read-only by design: it is the first thing to run when a command refuses,
 * and it must never be the thing that broke something. It reports what is
 * present, what the safety guard thinks of the current configuration, and
 * what to do next.
 */

import { existsSync } from "node:fs";
import {
  E2E_ENV_FILE,
  E2E_PROJECT_DIR,
  SEED_MANIFEST_FILE,
  guardContext,
  loadE2eConfig,
} from "../env.ts";
import { disposableTargetViolations } from "../safety.ts";
import { containerRuntime } from "./lib/process.ts";
import { readStackStatus } from "./lib/stack.ts";

function line(ok: boolean | null, label: string, detail = ""): void {
  const mark = ok === null ? "–" : ok ? "✓" : "✗";
  console.log(`  ${mark} ${label}${detail ? `  ${detail}` : ""}`);
}

async function main(): Promise<number> {
  console.log("\nRainbow Categories — E2E environment\n");

  const runtime = containerRuntime();
  line(!!runtime, "container runtime", runtime ?? "not found (docker/podman not on PATH)");

  line(existsSync(E2E_PROJECT_DIR), "E2E Supabase project directory", E2E_PROJECT_DIR);
  line(existsSync(E2E_ENV_FILE), ".env.e2e", existsSync(E2E_ENV_FILE) ? E2E_ENV_FILE : "run `npm run e2e:up`");

  if (runtime) {
    const status = readStackStatus();
    line(status.ok, "local Supabase stack", status.ok ? status.keys.apiUrl : status.error.split("\n")[0]);
  } else {
    line(null, "local Supabase stack", "cannot be checked without a container runtime");
  }

  const config = loadE2eConfig();
  const violations = disposableTargetViolations(config, guardContext());
  line(violations.length === 0, "safety guard", violations.length === 0 ? "target is a disposable local stack" : "");
  for (const violation of violations) console.log(`      • ${violation}`);

  line(
    existsSync(SEED_MANIFEST_FILE),
    "seed manifest",
    existsSync(SEED_MANIFEST_FILE) ? SEED_MANIFEST_FILE : "run `npm run e2e:reset`"
  );

  if (!runtime) {
    console.log(
      "\nNo container runtime, so the browser suite cannot run on this machine.\n" +
        "`npm run e2e:db:verify` still applies every migration and the whole seed\n" +
        "to an in-process Postgres — see e2e/README.md.\n"
    );
  }
  console.log();
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(String(error));
    process.exit(1);
  }
);
