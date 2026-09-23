/**
 * The local-only safety guard.
 *
 * Every destructive E2E operation — dropping the schema, applying migrations
 * from scratch, seeding, truncating, creating auth users — goes through
 * {@link assertDisposableTarget} first. Its job is to make "the E2E harness
 * wrote to production" a structurally impossible accident rather than a
 * mistake we promise not to make.
 *
 * The rule it enforces is deliberately NOT "the URL looks like a test URL".
 * It is a three-part check, and every part must pass:
 *
 *   1. ALLOW  — every configured endpoint's host must be loopback
 *               (localhost / 127.0.0.1 / ::1 / *.localhost) or a host the
 *               operator has explicitly designated disposable.
 *   2. DENY   — no configured value may match a production marker, even if
 *               part 1 somehow passed. Deny always beats allow.
 *   3. CREDENTIALS — no configured key may be a production-shaped credential,
 *               and no value may equal anything found in the repo's own
 *               `.env` (which holds the real project's URL and service-role
 *               key). This is what enforces "do not copy production
 *               credentials into test configuration".
 *
 * A failure throws. Nothing falls back, nothing degrades, nothing retries
 * against a different target: if the local stack is not there, the E2E
 * commands stop with a diagnostic instead of quietly finding production.
 */

import { readFileSync } from "node:fs";

/** Hosts that are always disposable. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

/**
 * Substrings that mark a value as pointing at real infrastructure. Checked
 * against every configured value, not just hostnames, so a production ref
 * smuggled in through a key or a connection string is caught too.
 *
 * Deliberately broad: a false positive here costs one confusing error
 * message, a false negative costs production data.
 */
const PRODUCTION_MARKERS = [
  ".supabase.co",
  ".supabase.in",
  ".supabase.red",
  "supabase.com",
  "rainbowcategories.com",
  "minicategories.com",
  ".lovable.app",
  ".lovableproject.com",
  ".vercel.app",
];

/**
 * Credential prefixes Supabase uses for real project keys. The local stack
 * issues demo JWTs (`iss: supabase-demo`), never these.
 */
const PRODUCTION_KEY_PREFIXES = ["sb_secret_", "sb_publishable_"];

export interface DisposableTarget {
  /** The Supabase API gateway the app and the seeder talk to. */
  apiUrl: string;
  /** The Postgres connection string schema/seed operations use. */
  dbUrl: string;
  /** The app under test. */
  appUrl: string;
  /** Local anon (publishable) key. */
  anonKey: string;
  /** Local service-role key. Only ever used against the validated dbUrl/apiUrl. */
  serviceRoleKey: string;
  /**
   * Extra hosts the operator has designated disposable, e.g. a container
   * hostname on a CI docker network. Never a way past the deny list.
   */
  extraDisposableHosts?: string[];
}

export class UnsafeTargetError extends Error {
  readonly reasons: string[];

  constructor(operation: string, reasons: string[]) {
    super(
      `Refusing to run "${operation}": the configured target is not a disposable local test environment.\n` +
        reasons.map((r) => `  • ${r}`).join("\n") +
        "\n\nThe E2E harness only ever talks to a local Supabase stack " +
        "(see e2e/README.md). Nothing was changed."
    );
    this.name = "UnsafeTargetError";
    this.reasons = reasons;
  }
}

function hostOf(value: string): string | null {
  // Postgres connection strings parse fine with the WHATWG URL parser.
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isDisposableHost(host: string, extra: string[]): boolean {
  if (LOOPBACK_HOSTS.has(host)) return true;
  // `foo.localhost` resolves to loopback per RFC 6761.
  if (host.endsWith(".localhost")) return true;
  return extra.map((h) => h.trim().toLowerCase()).filter(Boolean).includes(host);
}

/**
 * Values from the repository's own `.env`, which holds the PRODUCTION
 * Supabase URL and service-role key. Any E2E value equal to one of these is
 * a copied production credential, which is refused outright.
 *
 * Read lazily and never logged. Missing file is fine (CI has no `.env`).
 */
function productionEnvValues(envPath: string): string[] {
  let raw: string;
  try {
    raw = readFileSync(envPath, "utf8");
  } catch {
    return [];
  }
  return parseDotEnv(raw)
    .map(([, value]) => value.trim())
    .filter((value) => value.length >= 8);
}

/**
 * A deliberately small `.env` parser: `KEY=value`, `#` comments, optional
 * surrounding quotes. Small enough to read in one sitting, and it keeps the
 * safety guard free of a runtime dependency it would have to trust.
 */
export function parseDotEnv(raw: string): [string, string][] {
  const out: [string, string][] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    if (key) out.push([key, value]);
  }
  return out;
}

/**
 * The Supabase project ref this repository is linked to, read from
 * `supabase/config.toml`. Treated as a production marker in its own right:
 * if that string appears anywhere in the E2E configuration, something has
 * been copied from the real project.
 */
export function linkedProjectRef(configTomlPath: string): string | null {
  try {
    const raw = readFileSync(configTomlPath, "utf8");
    const match = raw.match(/^\s*project_id\s*=\s*"([^"]+)"/m);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/** Decodes a JWT payload without verifying it. Returns null for non-JWTs. */
function jwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const parsed = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export interface GuardContext {
  /** Absolute path to the repository's `.env` (production values). */
  productionEnvPath?: string;
  /** Absolute path to `supabase/config.toml` (the linked production ref). */
  linkedConfigPath?: string;
}

/**
 * Collects every reason the target is not safe. Exported separately from
 * {@link assertDisposableTarget} so the reasons can be unit-tested without
 * catching exceptions.
 */
export function disposableTargetViolations(
  target: DisposableTarget,
  context: GuardContext = {}
): string[] {
  const reasons: string[] = [];
  const extra = target.extraDisposableHosts ?? [];

  const endpoints: [string, string][] = [
    ["apiUrl", target.apiUrl],
    ["dbUrl", target.dbUrl],
    ["appUrl", target.appUrl],
  ];

  for (const [name, value] of endpoints) {
    if (!value) {
      reasons.push(`${name} is not set`);
      continue;
    }
    const host = hostOf(value);
    if (host === null) {
      reasons.push(`${name} is not a parseable URL`);
      continue;
    }
    if (!isDisposableHost(host, extra)) {
      reasons.push(`${name} points at "${host}", which is not a loopback or designated disposable host`);
    }
  }

  // ── Deny list: beats every allowance above ──
  const allValues: [string, string][] = [
    ...endpoints,
    ["anonKey", target.anonKey],
    ["serviceRoleKey", target.serviceRoleKey],
  ];

  for (const [name, value] of allValues) {
    if (!value) continue;
    const lowered = value.toLowerCase();
    for (const marker of PRODUCTION_MARKERS) {
      if (lowered.includes(marker)) {
        reasons.push(`${name} contains the production marker "${marker}"`);
      }
    }
  }

  const ref = context.linkedConfigPath ? linkedProjectRef(context.linkedConfigPath) : null;
  if (ref) {
    for (const [name, value] of allValues) {
      if (value && value.includes(ref)) {
        reasons.push(`${name} contains this repository's linked Supabase project ref`);
      }
    }
  }

  // ── Credential shape ──
  for (const [name, key] of [
    ["anonKey", target.anonKey],
    ["serviceRoleKey", target.serviceRoleKey],
  ] as const) {
    if (!key) {
      reasons.push(`${name} is not set`);
      continue;
    }
    for (const prefix of PRODUCTION_KEY_PREFIXES) {
      if (key.startsWith(prefix)) {
        reasons.push(`${name} looks like a real Supabase project key ("${prefix}…")`);
      }
    }
    const payload = jwtPayload(key);
    if (payload) {
      // Local demo keys are issued by "supabase-demo" and carry no project
      // ref. A `ref` claim means a real hosted project.
      if (typeof payload.ref === "string" && payload.ref.length > 0) {
        reasons.push(`${name} is a hosted-project JWT (it carries a "ref" claim)`);
      }
      if (payload.iss !== undefined && payload.iss !== "supabase-demo") {
        reasons.push(`${name} was issued by "${String(payload.iss)}", not the local demo stack`);
      }
    }
  }

  // ── Copied production credentials ──
  if (context.productionEnvPath) {
    const secrets = productionEnvValues(context.productionEnvPath);
    for (const [name, value] of allValues) {
      if (value && secrets.includes(value.trim())) {
        reasons.push(`${name} is copied verbatim from the repository's .env (production configuration)`);
      }
    }
  }

  return reasons;
}

/**
 * Throws unless every part of `target` describes a disposable local stack.
 * Call this immediately before any destructive operation, not once at
 * process start — the point is that the values actually being used are the
 * values that were checked.
 */
export function assertDisposableTarget(
  operation: string,
  target: DisposableTarget,
  context: GuardContext = {}
): void {
  const reasons = disposableTargetViolations(target, context);
  if (reasons.length > 0) throw new UnsafeTargetError(operation, reasons);
}
