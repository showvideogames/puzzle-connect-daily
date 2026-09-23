/**
 * One check before any browser starts: is this actually the disposable local
 * environment, and has it been seeded?
 *
 * Failing here costs two seconds and prints one instruction. Failing later
 * costs a confusing wall of browser assertions — or, without the guard, a
 * suite quietly driving the real site.
 */

import { existsSync } from "node:fs";
import { guardContext, loadE2eConfig, SEED_MANIFEST_FILE } from "../env.ts";
import { assertDisposableTarget } from "../safety.ts";
import { readSeedManifest } from "../fixtures/manifest.ts";

export default async function globalSetup(): Promise<void> {
  const config = loadE2eConfig();

  // Throws with the specific reasons; Playwright prints them and stops.
  assertDisposableTarget("the E2E browser suite", config, guardContext());

  if (!existsSync(SEED_MANIFEST_FILE)) {
    throw new Error(
      "The local test database has not been seeded.\n\n" +
        "  npm run e2e:up      start the disposable Supabase stack\n" +
        "  npm run e2e:reset   apply the schema and seed the fixtures\n\n" +
        "See e2e/README.md."
    );
  }

  const manifest = readSeedManifest();
  if (manifest.apiUrl !== config.apiUrl) {
    throw new Error(
      "The seed manifest was written against a different Supabase instance.\n" +
        `  manifest: ${manifest.apiUrl}\n` +
        `  current:  ${config.apiUrl}\n\n` +
        "Re-run `npm run e2e:reset`."
    );
  }

  // A reachable API is part of "the environment is ready", and a fetch here
  // fails in one place with one message rather than in every test.
  const probe = await fetch(`${config.apiUrl}/rest/v1/`, {
    headers: { apikey: config.anonKey },
  }).catch((error: unknown) => error as Error);

  if (probe instanceof Error) {
    throw new Error(
      `The local Supabase API at ${config.apiUrl} is not reachable.\n  ${probe.message}\n\n` +
        "Start it with `npm run e2e:up`."
    );
  }
}
