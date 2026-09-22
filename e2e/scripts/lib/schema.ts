/**
 * The one description of how this project's schema is built from nothing.
 *
 * Used by BOTH backends, so they can never drift:
 *   * `npm run e2e:reset`     → a real local Supabase Postgres (needs Docker)
 *   * `npm run e2e:db:verify` → PGlite, in-process (no Docker)
 *
 * The order is not "run the migrations". It is:
 *
 *   1. reset             wipe `public`, restore Supabase's bootstrap grants
 *   2. pre-git tables    six tables that were created outside git
 *   3. migrations…       every file in supabase/migrations, filename order,
 *                        with (4) spliced in at the right moment
 *   4. pre-git columns   eight columns added outside git, applied once the
 *                        tables exist and before the first migration that
 *                        reads them
 *   5. pre-git policies  RLS for the three pre-git tables no migration owns
 *
 * Steps 2, 4 and 5 exist because a clean database plus this repository's
 * migrations is NOT the production schema — see e2e/schema/010_pre_git_tables.sql
 * for the full explanation. Encoding that here, once, is what makes "clean
 * checkout → documented commands → same result" true.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { E2E_DIR, REPO_ROOT } from "../../env.ts";

export const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase", "migrations");
export const SCHEMA_DIR = path.join(E2E_DIR, "schema");

/**
 * The pre-git columns land immediately before the first migration whose
 * filename sorts at or after this one — `20260917120000_puzzle_content_versioning`
 * is the first that reads them.
 */
const COLUMNS_BEFORE_MIGRATION = "20260917120000";

export interface SqlStep {
  /** Human label for progress output and error messages. */
  label: string;
  sql: string;
}

export interface SchemaPlanOptions {
  /**
   * Stand-ins for the parts of Supabase that live outside this repository
   * (auth schema, auth.uid(), the anon/authenticated/service_role roles).
   *
   * PGlite needs them; the real local stack must NEVER get them, because
   * GoTrue owns auth.users and auth.uid() there and redefining either would
   * break real authentication. That is the only difference between the two
   * backends' schema plans.
   */
  includeSupabaseStubs: boolean;
  /**
   * Whether to run 000_reset.sql. False for PGlite, which starts from a
   * genuinely empty database and has no `auth.users` to clear yet.
   */
  includeReset: boolean;
}

function readSchemaFile(...parts: string[]): string {
  return readFileSync(path.join(SCHEMA_DIR, ...parts), "utf8");
}

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/** The full ordered list of SQL steps that turns an empty database into this project's schema. */
export function buildSchemaPlan(options: SchemaPlanOptions): SqlStep[] {
  const steps: SqlStep[] = [];

  if (options.includeReset) {
    steps.push({ label: "reset public schema", sql: readSchemaFile("000_reset.sql") });
  }
  if (options.includeSupabaseStubs) {
    steps.push({
      label: "supabase stubs (pglite only)",
      sql: readSchemaFile("pglite", "000_supabase_stubs.sql"),
    });
  }

  steps.push({ label: "pre-git tables", sql: readSchemaFile("010_pre_git_tables.sql") });

  let columnsApplied = false;
  for (const file of migrationFiles()) {
    if (!columnsApplied && file >= COLUMNS_BEFORE_MIGRATION) {
      columnsApplied = true;
      steps.push({ label: "pre-git columns", sql: readSchemaFile("020_pre_git_columns.sql") });
    }
    steps.push({
      label: `migration ${file}`,
      sql: readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"),
    });
  }
  if (!columnsApplied) {
    steps.push({ label: "pre-git columns", sql: readSchemaFile("020_pre_git_columns.sql") });
  }

  steps.push({ label: "pre-git policies", sql: readSchemaFile("030_pre_git_policies.sql") });

  return steps;
}

export interface SqlRunner {
  exec(sql: string): Promise<unknown>;
}

/**
 * Applies a plan, stopping at the FIRST failure.
 *
 * Deliberately not tolerant: a migration that fails half way leaves a schema
 * that is neither the old one nor the new one, and continuing past it would
 * produce a database that looks seeded but is wrong — which is exactly the
 * kind of result an E2E suite must never quietly build on.
 */
export async function applySchemaPlan(
  runner: SqlRunner,
  steps: SqlStep[],
  onProgress?: (label: string, index: number, total: number) => void
): Promise<void> {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    onProgress?.(step.label, i + 1, steps.length);
    try {
      await runner.exec(step.sql);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Schema step failed — ${step.label}\n  ${message}`);
    }
  }
}
