/**
 * Where the E2E harness reads its configuration from, and the one place that
 * decides what "the local test environment" means.
 *
 * Values come from `e2e/.env.e2e`, which is GENERATED (never committed) by
 * `npm run e2e:up` from the local stack's own `supabase status` output. That
 * matters for two reasons:
 *
 *   1. No key is ever hardcoded in the repository, so there is nothing to
 *      leak and nothing to go stale when the CLI rotates its demo keys.
 *   2. The file cannot accidentally describe production, because the only
 *      thing that writes it is the local-stack reader — and everything that
 *      reads it runs the safety guard first (see safety.ts).
 *
 * `.env.e2e.example` documents the shape for humans. It carries no secrets.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDotEnv, type DisposableTarget, type GuardContext } from "./safety.ts";

export const E2E_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(E2E_DIR, "..");

/**
 * What `supabase --workdir` is given.
 *
 * The CLI's `--workdir` takes the directory that CONTAINS `supabase/`, not
 * the `supabase/` directory itself. Pointing it one level too deep does not
 * fail — the CLI finds no config there, walks up, and silently uses the
 * repository root's project instead, which is the one linked to production.
 * The stack it starts is still local (`supabase start` cannot do anything
 * else), but it is the WRONG local stack: default ports, and none of the
 * isolation this directory exists to provide.
 *
 * So: `e2e`, never `e2e/supabase`. {@link assertIsE2eStack} is the backstop
 * that catches it if this is ever got wrong again.
 */
export const E2E_PROJECT_DIR = E2E_DIR;
/** The config file that directory must contain, for diagnostics. */
export const E2E_SUPABASE_CONFIG = path.join(E2E_DIR, "supabase", "config.toml");
/** Generated, git-ignored runtime configuration. */
export const E2E_ENV_FILE = path.join(REPO_ROOT, ".env.e2e");
/** Where the seed records the ids the database generated. */
export const SEED_MANIFEST_FILE = path.join(E2E_DIR, ".artifacts", "seed-manifest.json");

/**
 * Ports deliberately outside the Supabase CLI's defaults (54321-54329), so a
 * developer's ordinary `supabase start` for this project and the E2E stack
 * can never be the same thing — including by accident, when one is already
 * running and the other silently attaches to it.
 */
export const E2E_PORTS = {
  api: 54421,
  db: 54422,
  studio: 54423,
  mail: 54424,
  analytics: 54427,
  /** The Vite dev server Playwright drives. */
  app: 5183,
} as const;

export interface E2eConfig extends DisposableTarget {
  /** Absolute path to `.env.e2e`. */
  envFile: string;
  /** How long a single browser test may take, ms. */
  actionTimeoutMs: number;
}

function readEnvFile(file: string): Record<string, string> {
  if (!existsSync(file)) return {};
  return Object.fromEntries(parseDotEnv(readFileSync(file, "utf8")));
}

/**
 * The E2E configuration, with `process.env` allowed to override the file.
 *
 * The override exists for CI, which sets the values directly rather than
 * writing a file. It is NOT a fallback to ambient configuration: a missing
 * value stays missing and the safety guard refuses it, instead of inheriting
 * whatever `VITE_SUPABASE_URL` happens to be exported in the shell.
 */
export function loadE2eConfig(): E2eConfig {
  const file = readEnvFile(E2E_ENV_FILE);
  const pick = (key: string, fallback = "") =>
    (process.env[key] ?? file[key] ?? fallback).trim();

  return {
    envFile: E2E_ENV_FILE,
    apiUrl: pick("VITE_SUPABASE_URL", `http://127.0.0.1:${E2E_PORTS.api}`),
    dbUrl: pick("E2E_DB_URL", `postgresql://postgres:postgres@127.0.0.1:${E2E_PORTS.db}/postgres`),
    appUrl: pick("E2E_APP_URL", `http://127.0.0.1:${E2E_PORTS.app}`),
    anonKey: pick("VITE_SUPABASE_PUBLISHABLE_KEY"),
    serviceRoleKey: pick("E2E_SERVICE_ROLE_KEY"),
    extraDisposableHosts: pick("E2E_EXTRA_DISPOSABLE_HOSTS")
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean),
    actionTimeoutMs: Number(pick("E2E_ACTION_TIMEOUT_MS", "15000")),
  };
}

/**
 * Refuses anything that is not THIS project's stack.
 *
 * The safety guard in safety.ts asks "is this target disposable?" — loopback,
 * no production markers, no production credentials. That is necessary but not
 * sufficient: a Supabase stack started from the wrong project directory is
 * also on loopback, and would sail through. It would just be somebody else's
 * local database, on the CLI's default ports, about to have its `public`
 * schema dropped.
 *
 * This is the second question: "is it OURS?" — answered by the ports, which
 * are chosen in E2E_PORTS precisely so they cannot collide with an ordinary
 * `supabase start`.
 */
export function assertIsE2eStack(apiUrl: string, dbUrl: string): void {
  const portOf = (value: string) => {
    try {
      return Number(new URL(value).port);
    } catch {
      return NaN;
    }
  };
  const apiPort = portOf(apiUrl);
  const dbPort = portOf(dbUrl);
  if (apiPort === E2E_PORTS.api && dbPort === E2E_PORTS.db) return;

  throw new Error(
    "This is a local Supabase stack, but it is not the E2E one.\n" +
      `  API  ${apiUrl}  (expected port ${E2E_PORTS.api})\n` +
      `  DB   ${dbUrl.replace(/:[^:@/]*@/, ":****@")}  (expected port ${E2E_PORTS.db})\n\n` +
      "Those are the Supabase CLI's DEFAULT ports, which means the CLI did not\n" +
      `read ${E2E_SUPABASE_CONFIG} and fell back to another project directory.\n` +
      "Refusing to continue: the next step drops and rebuilds the `public`\n" +
      "schema, and it must only ever do that to this suite's own database.\n\n" +
      "Run `npm run e2e:down` and check that `--workdir` points at the\n" +
      "directory CONTAINING supabase/, not at supabase/ itself."
  );
}

/**
 * The paths the guard cross-checks against: the repository's production
 * `.env` and the linked project ref in `supabase/config.toml`.
 */
export function guardContext(): GuardContext {
  return {
    productionEnvPath: path.join(REPO_ROOT, ".env"),
    linkedConfigPath: path.join(REPO_ROOT, "supabase", "config.toml"),
  };
}
