/**
 * Phase 2 beta-data salvage: turn the hosted export into ONE restore script
 * for the launch baseline, rehearse it on the local stack, verify it, and
 * (through hosted-phase2.ts) apply the very same script to the hosted
 * project.
 *
 *   npm run phase2:restore -- plan   --from .runtime/phase2/export-before --out .runtime/phase2/restore
 *   npm run phase2:restore -- local  --dir .runtime/phase2/restore          (local stack only: prelude + restore)
 *   npm run phase2:restore -- verify --dir .runtime/phase2/restore --target local|hosted [--label <evidence label>]
 *
 * This is a ONE-TIME BEST-EFFORT salvage of beta playtest data, not a
 * migration framework. The export is loaded into the baseline's tables as it
 * is, with exactly these deterministic changes (see `plan`):
 *
 *   device_identities  58 devices retired before credentials existed have no
 *                      token_hash and no retirement reason. They get an
 *                      unverifiable sentinel hash (nobody holds the token, and
 *                      verify_device refuses retired devices anyway) and the
 *                      reason the baseline requires: `imported` + claimed_by
 *                      when an account owns that device's games, otherwise
 *                      `started_fresh`. decided_at = retired_at.
 *   puzzles            loaded with current_version_id NULL first, versions
 *                      next, then pointed at their current version (the
 *                      trigger validates the pair). The updated_at trigger is
 *                      paused for that one UPDATE so timestamps stay verbatim.
 *   account_onboarding NOT restored: the per-account decision is obsolete;
 *                      the baseline decides per device.
 *   game_results       NOT restored: a beta-era mirror; every row is already
 *                      represented by a completed game_sessions row.
 *   accounts           nothing to restore: no WorkOS identity exists yet.
 *                      Ownership columns (user_id, created_by) keep pointing
 *                      at the beta auth users, which are kept; history becomes
 *                      visible again to a person once GoTrue links their
 *                      WorkOS sign-in to that same-email user.
 *
 * Everything else is loaded verbatim, ids included, through
 * jsonb_populate_recordset so column names, not positions, do the mapping.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { REPO_ROOT, assertIsE2eStack, guardContext, loadE2eConfig } from "../env.ts";
import { assertDisposableTarget } from "../safety.ts";
import { HostedRunner } from "./hosted-phase2.ts";
import type { SqlQueryRunner } from "./lib/inventory.ts";

type Row = Record<string, unknown>;

/** Load order: every table after the ones it references. */
const RESTORE_ORDER = [
  "device_identities",
  "puzzles",
  "puzzle_versions",
  "puzzle_groups",
  "puzzle_aggregates",
  "luck_score_ceilings",
  "user_roles",
  "archive_access",
  "creator_profiles",
  "custom_puzzles",
  "custom_puzzle_stats",
  "custom_puzzle_favorites",
  "custom_puzzle_results",
  "game_sessions",
  "guess_events",
  "hint_events",
  "user_streaks",
  "puzzle_ratings",
  "feedback",
  "beta_playtests",
  "beta_feedback",
] as const;

const OMITTED: Record<string, string> = {
  account_onboarding: "obsolete per-account import decision; the baseline decides per device (table dropped)",
  game_results: "beta-era mirror of completed games; every row is represented by a completed game_sessions row (table dropped)",
};

const CHUNK = 250;
const TAG = "$rbjson$";

function readJsonl(dir: string, table: string): Row[] {
  const f = path.join(dir, `${table}.jsonl`);
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Row);
}

function chunkedInsert(table: string, rows: Row[], columnsOverride?: string[]): string {
  if (rows.length === 0) return `-- ${table}: nothing to restore\n`;
  const out: string[] = [`-- ${table}: ${rows.length} rows`];
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const json = JSON.stringify(slice);
    if (json.includes(TAG)) throw new Error(`dollar-quote tag collision in ${table}`);
    const cols = columnsOverride ? ` (${columnsOverride.map((c) => `"${c}"`).join(", ")})` : "";
    const select = columnsOverride ? columnsOverride.map((c) => `r."${c}"`).join(", ") : "r.*";
    out.push(
      `insert into public."${table}"${cols}\n  select ${select} from jsonb_populate_recordset(null::public."${table}", ${TAG}${json}${TAG}::jsonb) as r;`
    );
  }
  return out.join("\n") + "\n";
}

interface PlanEntry {
  table: string;
  exported: number;
  restored: number;
  transformed: number;
  omitted: number;
  note: string;
}

function plan(args: Args): number {
  if (!args.from || !args.out) throw new Error("plan needs --from <export dir> --out <dir>");
  const from = path.resolve(REPO_ROOT, args.from);
  const out = path.resolve(REPO_ROOT, args.out);
  if (!out.startsWith(path.join(REPO_ROOT, ".runtime"))) throw new Error("--out must be inside .runtime/");
  mkdirSync(out, { recursive: true });

  const entries: PlanEntry[] = [];
  const parts: string[] = [];

  const sessions = readJsonl(from, "game_sessions");
  const ownerOfDevice = new Map<string, Map<string, number>>();
  for (const s of sessions) {
    if (!s.device_id || !s.user_id) continue;
    const m = ownerOfDevice.get(String(s.device_id)) ?? new Map<string, number>();
    m.set(String(s.user_id), (m.get(String(s.user_id)) ?? 0) + 1);
    ownerOfDevice.set(String(s.device_id), m);
  }

  for (const table of RESTORE_ORDER) {
    const rows = readJsonl(from, table);
    let transformed = 0;
    let note = "verbatim";

    if (table === "device_identities") {
      for (const d of rows) {
        if (d.retired_at) {
          const owners = ownerOfDevice.get(String(d.device_id));
          const owner = owners ? [...owners.entries()].sort((a, b) => b[1] - a[1])[0][0] : null;
          if (d.token_hash == null) {
            d.token_hash = createHash("sha256").update(`retired:${d.device_id}`).digest("hex");
          }
          d.retired_reason = owner ? "imported" : "started_fresh";
          d.claimed_by = owner;
          d.decided_at = d.retired_at;
          transformed++;
        } else {
          if (d.token_hash == null) throw new Error(`live device ${d.device_id} has no token_hash; cannot be restored`);
          d.retired_reason = null;
          d.claimed_by = null;
          d.decided_at = null;
        }
      }
      note = `${transformed} pre-credential retired devices given a sentinel token_hash and a derived retirement reason`;
      parts.push(chunkedInsert(table, rows));
    } else if (table === "puzzles") {
      const stripped = rows.map((p) => ({ ...p, current_version_id: null }));
      parts.push(chunkedInsert(table, stripped));
      note = "loaded with current_version_id NULL; pointed at the version after puzzle_versions (below)";
    } else if (table === "puzzle_versions") {
      parts.push(chunkedInsert(table, rows));
      const puzzles = readJsonl(from, "puzzles").filter((p) => p.current_version_id);
      const pairs = puzzles.map((p) => ({ id: p.id, current_version_id: p.current_version_id, updated_at: p.updated_at }));
      parts.push(
        `-- puzzles.current_version_id: ${pairs.length} pointers (the check trigger validates each pair; the updated_at trigger is paused so timestamps stay verbatim)\n` +
          `alter table public.puzzles disable trigger update_puzzles_updated_at;\n` +
          `update public.puzzles p set current_version_id = r.current_version_id\n  from jsonb_to_recordset(${TAG}${JSON.stringify(pairs)}${TAG}::jsonb) as r(id uuid, current_version_id uuid, updated_at timestamptz)\n where p.id = r.id;\n` +
          `alter table public.puzzles enable trigger update_puzzles_updated_at;\n`
      );
    } else {
      parts.push(chunkedInsert(table, rows));
    }
    entries.push({ table, exported: rows.length, restored: rows.length, transformed, omitted: 0, note });
  }
  for (const [table, why] of Object.entries(OMITTED)) {
    const n = readJsonl(from, table).length;
    entries.push({ table, exported: n, restored: 0, transformed: 0, omitted: n, note: why });
  }
  entries.push({ table: "accounts", exported: 0, restored: 0, transformed: 0, omitted: 0, note: "new in the baseline; no WorkOS identities exist yet, so no rows" });

  const body = parts.join("\n");
  const header = `-- Phase 2 beta-data restore, generated ${new Date().toISOString()} from ${path.relative(REPO_ROOT, from)}\n-- One transaction. Every insert names its table; nothing is dropped or truncated here.\n`;
  writeFileSync(path.join(out, "restore.sql"), `${header}begin;\n\n${body}\ncommit;\n`, "utf8");
  writeFileSync(path.join(out, "restore.REHEARSAL.sql"), `${header}begin;\n\n${body}\n-- counts the rehearsal would have left behind\nselect 'game_sessions' as t, count(*) as n from public.game_sessions union all select 'guess_events', count(*) from public.guess_events union all select 'puzzles', count(*) from public.puzzles union all select 'device_identities', count(*) from public.device_identities;\nrollback;\n`, "utf8");

  // Local-only prelude: the auth users the data refers to must exist for the
  // FKs. On the hosted project they already do; this file is never sent there.
  const users = JSON.parse(readFileSync(path.join(from, "auth-users.json"), "utf8")) as Row[];
  const prelude =
    `-- LOCAL REHEARSAL ONLY: stand-ins for the hosted auth users Rainbow rows refer to.\nbegin;\n` +
    users
      .map(
        (u) =>
          `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_sso_user)\n` +
          `  values ('${u.id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rehearsal-${String(u.id).slice(0, 8)}@rainbow.test', '', ${u.confirmed ? "now()" : "null"}, '${u.created_at}', '${u.created_at}', '{"provider":"email","providers":["email"]}', '{}', false)\n  on conflict (id) do nothing;`
      )
      .join("\n") +
    `\ncommit;\n`;
  writeFileSync(path.join(out, "local-prelude.sql"), prelude, "utf8");
  writeFileSync(path.join(out, "restore-plan.json"), JSON.stringify({ generatedAt: new Date().toISOString(), from: path.relative(REPO_ROOT, from), entries }, null, 2) + "\n", "utf8");

  console.log(`restore plan written to ${path.relative(REPO_ROOT, out)} (${(readFileSync(path.join(out, "restore.sql")).length / 1024).toFixed(0)} KB)`);
  console.log("table".padEnd(26) + "exported restored transformed omitted  note");
  for (const e of entries) console.log(`${e.table.padEnd(26)}${String(e.exported).padStart(8)} ${String(e.restored).padStart(8)} ${String(e.transformed).padStart(11)} ${String(e.omitted).padStart(7)}  ${e.note}`);
  return 0;
}

// ── local apply ──────────────────────────────────────────────────────────

async function localClient(): Promise<pg.Client> {
  const config = loadE2eConfig();
  assertDisposableTarget("phase2:restore", config, guardContext());
  assertIsE2eStack(config.apiUrl, config.dbUrl);
  const client = new pg.Client({ connectionString: config.dbUrl });
  await client.connect();
  return client;
}

async function local(args: Args): Promise<number> {
  if (!args.dir) throw new Error("local needs --dir <restore dir>");
  const dir = path.resolve(REPO_ROOT, args.dir);
  const client = await localClient();
  try {
    await client.query(readFileSync(path.join(dir, "local-prelude.sql"), "utf8"));
    console.log("local prelude applied (auth user stand-ins)");
    await client.query(readFileSync(path.join(dir, "restore.sql"), "utf8"));
    console.log("restore.sql applied to the LOCAL stack");
  } finally {
    await client.end();
  }
  return 0;
}

// ── verify ───────────────────────────────────────────────────────────────

interface Check { name: string; sql: string; expect: (n: number) => boolean; want: string }

function checks(planned: Record<string, number>): Check[] {
  const eq = (n: number) => (x: number) => x === n;
  const zero = (x: number) => x === 0;
  const list: Check[] = [];
  for (const [table, n] of Object.entries(planned)) {
    list.push({ name: `${table} rows`, sql: `select count(*)::int as n from public."${table}"`, expect: eq(n), want: String(n) });
  }
  const rel: [string, string][] = [
    ["game_sessions.device_id without device_identities row", `select count(*)::int as n from public.game_sessions s where s.device_id is not null and not exists (select 1 from public.device_identities d where d.device_id = s.device_id)`],
    ["game_sessions.user_id without auth user", `select count(*)::int as n from public.game_sessions s where s.user_id is not null and not exists (select 1 from auth.users u where u.id = s.user_id)`],
    ["guess_events without session", `select count(*)::int as n from public.guess_events g where not exists (select 1 from public.game_sessions s where s.id = g.game_session_id)`],
    ["hint_events without session", `select count(*)::int as n from public.hint_events h where not exists (select 1 from public.game_sessions s where s.id = h.game_session_id)`],
    ["user_streaks without owner (user or device)", `select count(*)::int as n from public.user_streaks where user_id is null and device_id is null`],
    ["user_streaks.device_id without device", `select count(*)::int as n from public.user_streaks s where s.device_id is not null and not exists (select 1 from public.device_identities d where d.device_id = s.device_id)`],
    ["puzzle_versions without puzzle", `select count(*)::int as n from public.puzzle_versions v where not exists (select 1 from public.puzzles p where p.id = v.puzzle_id)`],
    ["puzzle_groups without puzzle", `select count(*)::int as n from public.puzzle_groups g where not exists (select 1 from public.puzzles p where p.id = g.puzzle_id)`],
    ["puzzles whose current_version is not theirs", `select count(*)::int as n from public.puzzles p where p.current_version_id is not null and not exists (select 1 from public.puzzle_versions v where v.id = p.current_version_id and v.puzzle_id = p.id)`],
    ["puzzles without a current version", `select count(*)::int as n from public.puzzles where current_version_id is null`],
    ["retired devices without a reason", `select count(*)::int as n from public.device_identities where retired_at is not null and retired_reason is null`],
    ["live devices with a reason", `select count(*)::int as n from public.device_identities where retired_at is null and retired_reason is not null`],
    ["devices claimed by a missing user", `select count(*)::int as n from public.device_identities d where d.claimed_by is not null and not exists (select 1 from auth.users u where u.id = d.claimed_by)`],
    ["beta_playtests without device", `select count(*)::int as n from public.beta_playtests b where not exists (select 1 from public.device_identities d where d.device_id = b.device_id)`],
    ["custom_puzzle_results without device", `select count(*)::int as n from public.custom_puzzle_results r where not exists (select 1 from public.device_identities d where d.device_id = r.device_id)`],
    ["puzzle_ratings without user", `select count(*)::int as n from public.puzzle_ratings r where not exists (select 1 from auth.users u where u.id = r.user_id)`],
    ["accounts rows (none expected yet)", `select count(*)::int as n from public.accounts`],
  ];
  for (const [name, sql] of rel) list.push({ name, sql, expect: zero, want: "0" });
  return list;
}

const STATS: [string, string][] = [
  ["completed games (won+lost)", `select count(*)::int as n from public.game_sessions where status in ('won','lost')`],
  ["won games", `select count(*)::int as n from public.game_sessions where status = 'won'`],
  ["account-owned games", `select count(*)::int as n from public.game_sessions where user_id is not null`],
  ["guest games", `select count(*)::int as n from public.game_sessions where user_id is null`],
  ["mini games", `select count(*)::int as n from public.game_sessions where format = 'mini'`],
  ["sessions whose puzzle no longer exists (no FK; kept)", `select count(*)::int as n from public.game_sessions s where not exists (select 1 from public.puzzles p where p.id::text = s.puzzle_id)`],
  ["puzzle_aggregates total_plays", `select coalesce(sum(total_plays),0)::int as n from public.puzzle_aggregates`],
  ["published puzzles", `select count(*)::int as n from public.puzzles where is_published`],
  ["mini puzzles", `select count(*)::int as n from public.puzzles where format = 'mini'`],
  ["streak rows with an account", `select count(*)::int as n from public.user_streaks where user_id is not null`],
  ["best longest streak", `select coalesce(max(longest_streak),0)::int as n from public.user_streaks`],
  ["distinct account owners of games", `select count(distinct user_id)::int as n from public.game_sessions where user_id is not null`],
  ["retired devices imported / started_fresh", `select count(*) filter (where retired_reason='imported')::int * 1000 + count(*) filter (where retired_reason='started_fresh')::int as n from public.device_identities`],
];

async function verify(args: Args): Promise<number> {
  if (!args.dir || !args.target) throw new Error("verify needs --dir <restore dir> --target local|hosted");
  const dir = path.resolve(REPO_ROOT, args.dir);
  const planJson = JSON.parse(readFileSync(path.join(dir, "restore-plan.json"), "utf8")) as { entries: PlanEntry[] };
  const planned: Record<string, number> = {};
  for (const e of planJson.entries) if (!(e.table in OMITTED)) planned[e.table] = e.restored;

  let runner: SqlQueryRunner;
  let client: pg.Client | null = null;
  if (args.target === "local") {
    client = await localClient();
    const c = client;
    runner = { query: async <T,>(sql: string) => ({ rows: (await c.query(sql)).rows as T[] }) };
  } else if (args.target === "hosted") {
    if (!args.projectRef) throw new Error("--project-ref is required for --target hosted");
    runner = new HostedRunner(args.projectRef);
  } else throw new Error("--target must be local or hosted");

  const lines: string[] = [];
  let failures = 0;
  try {
    lines.push(`| check | expected | actual | ok |`, `|---|---|---|---|`);
    for (const c of checks(planned)) {
      const n = (await runner.query<{ n: number }>(c.sql)).rows[0]?.n ?? NaN;
      const ok = c.expect(Number(n));
      if (!ok) failures++;
      lines.push(`| ${c.name} | ${c.want} | ${n} | ${ok ? "yes" : "**NO**"} |`);
    }
    lines.push("", `| derived stat (${args.target}) | value |`, `|---|---|`);
    for (const [name, sql] of STATS) {
      const n = (await runner.query<{ n: number }>(sql)).rows[0]?.n;
      lines.push(`| ${name} | ${name.startsWith("retired devices") ? `${Math.floor(Number(n) / 1000)} / ${Number(n) % 1000}` : n} |`);
    }
  } finally {
    if (client) await client.end();
  }
  const md = `# Restore verification: ${args.target}\n\nRun ${new Date().toISOString()} against the ${args.target} database from \`${path.relative(REPO_ROOT, dir)}\`.\n\n${lines.join("\n")}\n\nFailures: ${failures}\n`;
  console.log(md);
  const outFile = args.label
    ? path.join(REPO_ROOT, "supabase", "ops", "beta-reset", "hosted-evidence", args.label, `restore-verification-${args.target}.md`)
    : path.join(dir, `verification-${args.target}.md`);
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, md, "utf8");
  console.log(`written to ${path.relative(REPO_ROOT, outFile)}`);
  return failures === 0 ? 0 : 1;
}

// ── main ─────────────────────────────────────────────────────────────────

interface Args { command: string; from: string | null; out: string | null; dir: string | null; target: string | null; label: string | null; projectRef: string | null }

function parseArgs(argv: string[]): Args {
  const a: Args = { command: "", from: null, out: null, dir: null, target: null, label: null, projectRef: null };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--from") a.from = argv[++i] ?? null;
    else if (x === "--out") a.out = argv[++i] ?? null;
    else if (x === "--dir") a.dir = argv[++i] ?? null;
    else if (x === "--target") a.target = argv[++i] ?? null;
    else if (x === "--label") a.label = argv[++i] ?? null;
    else if (x === "--project-ref") a.projectRef = argv[++i] ?? null;
    else if (!x.startsWith("--") && !a.command) a.command = x;
    else throw new Error(`unknown argument ${x}`);
  }
  return a;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  switch (args.command) {
    case "plan": return plan(args);
    case "local": return local(args);
    case "verify": return verify(args);
    default:
      console.error("usage: npm run phase2:restore -- plan --from <export> --out <dir> | local --dir <dir> | verify --dir <dir> --target local|hosted [--project-ref <ref>] [--label <l>]");
      return 2;
  }
}

if (process.argv[1] && /phase2-restore\.ts$/.test(process.argv[1].replace(/\\/g, "/"))) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    }
  );
}
