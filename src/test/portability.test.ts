/**
 * Portability guards: Rainbow must be movable to another Supabase project by
 * changing environment values, and must never depend on another game's
 * objects while it shares a project with them.
 *
 * These are static checks over the repository, so they run everywhere the
 * unit suite runs and fail the build the moment a foreign table, a project
 * ref or a hosted address creeps into code, SQL or edge functions.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (entry === "node_modules" || entry === ".git" || entry === "dist" || entry === "dist-e2e") continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const SOURCE_FILES = [
  ...walk(path.join(ROOT, "src")),
  ...walk(path.join(ROOT, "supabase", "migrations")),
  ...walk(path.join(ROOT, "supabase", "functions")),
].filter((f) => /\.(ts|tsx|sql|js|mjs)$/.test(f) && !/[\\/]src[\\/]test[\\/]/.test(f));

/** Another tenant's table/function prefixes in the shared beta project. */
const FOREIGN_PREFIXES = [/\bxw_[a-z]/, /\bcv_[a-z]/, /\bwtf_[a-z]/];

/** Anything that names a Supabase project or a hosted address. */
const PROJECT_MARKERS = [/[a-z]{20}\.supabase\.co/, /supabase\.co\b/, /zmauemcjcrdrgfjzkvgd/];

function offenders(patterns: RegExp[]): string[] {
  const hits: string[] = [];
  for (const file of SOURCE_FILES) {
    const text = readFileSync(file, "utf8");
    for (const pattern of patterns) {
      const m = text.match(pattern);
      if (m) hits.push(`${path.relative(ROOT, file)}: ${m[0]}`);
    }
  }
  return hits;
}

describe("portability", () => {
  it("Rainbow code, SQL and functions never reference another tenant's objects", () => {
    expect(offenders(FOREIGN_PREFIXES)).toEqual([]);
  });

  it("no Supabase project ref or hosted address is written into code, SQL or functions", () => {
    expect(offenders(PROJECT_MARKERS)).toEqual([]);
  });

  it("the Supabase connection comes only from the two environment values", () => {
    const client = readFileSync(path.join(ROOT, "src", "integrations", "supabase", "client.ts"), "utf8");
    expect(client).toMatch(/import\.meta\.env\.VITE_SUPABASE_URL/);
    expect(client).toMatch(/import\.meta\.env\.VITE_SUPABASE_PUBLISHABLE_KEY/);
    expect(client).toMatch(/flowType: 'pkce'/);
    expect(client).toMatch(/detectSessionInUrl: false/);
  });

  it("the shared sign-in service is configuration, not code", () => {
    const signIn = readFileSync(path.join(ROOT, "src", "lib", "platformSignIn.ts"), "utf8");
    expect(signIn).toMatch(/import\.meta\.env\.VITE_PLATFORM_DISCOVERY_URL/);
    expect(signIn).not.toMatch(/authkit\.app|workos\.com/);
  });

  it("the baseline builds the whole schema from supabase/migrations alone (no splices left in the harness)", () => {
    const schemaDir = path.join(ROOT, "e2e", "schema");
    const files = readdirSync(schemaDir).filter((f) => f.endsWith(".sql"));
    expect(files).toEqual(["000_reset.sql"]);
    const migrations = readdirSync(path.join(ROOT, "supabase", "migrations")).filter((f) => f.endsWith(".sql"));
    expect(migrations[0]).toBe("0001_rainbow_baseline.sql");
  });

  it("no Rainbow function still enumerates every auth user or keys on account_onboarding", () => {
    const baseline = readFileSync(path.join(ROOT, "supabase", "migrations", "0001_rainbow_baseline.sql"), "utf8");
    expect(baseline).not.toMatch(/account_onboarding\b(?!, removed\))/);
    expect(baseline).not.toMatch(/from auth\.users u\s*\n?\s*(where|$)(?![\s\S]{0,80}public\.accounts)/);
    // Every caller-identity read goes through the account boundary. The only
    // raw auth.uid() calls in SQL (comments and COMMENT ON strings aside) are
    // the three that DEFINE that boundary: rainbow_uid, ensure_account,
    // my_account.
    const sqlOnly = baseline
      .split(/\r?\n/)
      .filter((line) => !/^\s*--/.test(line) && !/^\s*COMMENT ON /.test(line))
      .join("\n");
    const raw = sqlOnly.match(/auth\.uid\(\)/g) ?? [];
    expect(raw.length).toBe(3);
  });
});
