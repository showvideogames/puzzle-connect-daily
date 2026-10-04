/**
 * Phase 2 operator tool for the HOSTED shared beta project.
 *
 * This is the ONE script in the repository that talks to the hosted project.
 * Every other e2e command is guarded to the disposable local stack; this one
 * is guarded the other way round: it only ever talks to the project named in
 * supabase/config.toml, over the Supabase Management API's SQL endpoint, with
 * the operator's personal access token, and it refuses to write unless three
 * independent things say so (see `sql --apply`).
 *
 *   npm run phase2:hosted -- --project-ref <ref> inventory --label before
 *   npm run phase2:hosted -- --project-ref <ref> classify  --label before
 *   npm run phase2:hosted -- --project-ref <ref> export    --out <dir>
 *   npm run phase2:hosted -- --project-ref <ref> sql --file <f>          (must end in ROLLBACK)
 *   npm run phase2:hosted -- --project-ref <ref> sql --file <f> --apply --i-mean-the-hosted-beta-project
 *                                                                        (+ PHASE2_HOSTED_WRITE=yes)
 *
 * Credentials: SUPABASE_ACCESS_TOKEN in the shell (the Supabase CLI's personal
 * access token). Never a database password, never written anywhere.
 *
 * Evidence (schema inventories, counts, classifications; no personal data)
 * goes to supabase/ops/beta-reset/hosted-evidence/<label>/ and is committed.
 * Data exports (which contain player rows and emails) go wherever --out says,
 * which must be inside the git-ignored .runtime/ directory.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../env.ts";
import {
  collectInventory,
  diffInventories,
  renderInventoryMarkdown,
  type Inventory,
  type SqlQueryRunner,
} from "./lib/inventory.ts";

const MANAGEMENT_API = "https://api.supabase.com";
const EVIDENCE_DIR = path.join(REPO_ROOT, "supabase", "ops", "beta-reset", "hosted-evidence");
const MANIFEST = path.join(REPO_ROOT, "supabase", "rainbow-owned-objects.json");
const BETA_INVENTORY = path.join(REPO_ROOT, "supabase", "beta-era-migrations", "beta-era-inventory.json");
const EXTRAS = path.join(REPO_ROOT, "supabase", "ops", "beta-reset", "extra-objects.json");
const FOREIGN_PREFIXES = ["xw_", "cv_", "wtf_"];

// ── Guard ────────────────────────────────────────────────────────────────

function configuredProjectRef(): string {
  const toml = readFileSync(path.join(REPO_ROOT, "supabase", "config.toml"), "utf8");
  const m = toml.match(/^project_id\s*=\s*"([a-z]+)"/m);
  if (!m) throw new Error("supabase/config.toml names no project_id");
  return m[1];
}

function accessToken(): string {
  const token = (process.env.SUPABASE_ACCESS_TOKEN ?? "").trim();
  if (!/^sbp_[0-9a-f]{20,}$/i.test(token)) {
    throw new Error("SUPABASE_ACCESS_TOKEN is missing or is not a Supabase personal access token (sbp_…). Export it in this shell only.");
  }
  return token;
}

class HostedRunner implements SqlQueryRunner {
  constructor(private readonly ref: string) {}
  async query<T = Record<string, unknown>>(sql: string): Promise<{ rows: T[] }> {
    const res = await fetch(`${MANAGEMENT_API}/v1/projects/${this.ref}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql }),
    });
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { message: text.slice(0, 500) }; }
    if (res.status >= 300) {
      const message = (json as { message?: string } | null)?.message ?? text.slice(0, 500);
      throw new Error(`hosted SQL failed (HTTP ${res.status}): ${message}`);
    }
    return { rows: (Array.isArray(json) ? json : []) as T[] };
  }
}

function runnerFor(args: Args): HostedRunner {
  const configured = configuredProjectRef();
  if (!args.projectRef) throw new Error("--project-ref <ref> is required and must equal supabase/config.toml's project_id");
  if (args.projectRef !== configured) {
    throw new Error(`REFUSING: --project-ref ${args.projectRef} is not the configured project (${configured}).`);
  }
  return new HostedRunner(configured);
}

// ── Args ─────────────────────────────────────────────────────────────────

interface Args {
  command: string;
  projectRef: string | null;
  label: string | null;
  from: string | null;
  out: string | null;
  file: string | null;
  apply: boolean;
  iMeanIt: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { command: "", projectRef: null, label: null, from: null, out: null, file: null, apply: false, iMeanIt: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--project-ref") args.projectRef = argv[++i] ?? null;
    else if (a === "--label") args.label = argv[++i] ?? null;
    else if (a === "--from") args.from = argv[++i] ?? null;
    else if (a === "--out") args.out = argv[++i] ?? null;
    else if (a === "--file") args.file = argv[++i] ?? null;
    else if (a === "--apply") args.apply = true;
    else if (a === "--i-mean-the-hosted-beta-project") args.iMeanIt = true;
    else if (!a.startsWith("--") && !args.command) args.command = a;
    else throw new Error(`unknown argument ${a}`);
  }
  return args;
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

// ── inventory ────────────────────────────────────────────────────────────

interface Counts { table: string; rows: number }

async function tableCounts(runner: HostedRunner): Promise<Counts[]> {
  const tables = (await runner.query<{ t: string }>(`select tablename as t from pg_tables where schemaname = 'public' order by 1`)).rows;
  if (tables.length === 0) return [];
  const sql = tables.map(({ t }) => `select '${t}' as "table", count(*)::int as rows from public."${t}"`).join(" union all ");
  return (await runner.query<Counts>(sql)).rows;
}

async function inventory(args: Args): Promise<number> {
  if (!args.label) throw new Error("inventory needs --label <name>");
  const runner = runnerFor(args);
  const dir = path.join(EVIDENCE_DIR, args.label);
  const inv = await collectInventory(runner);
  const counts = await tableCounts(runner);
  const auth = (await runner.query(`
    select (select count(*)::int from auth.users) as users,
           (select count(*)::int from auth.users where email_confirmed_at is not null) as confirmed_users,
           (select coalesce(json_agg(json_build_object('provider', p, 'identities', n) order by p), '[]'::json)
              from (select provider as p, count(*)::int as n from auth.identities group by provider) x) as identities_by_provider
  `)).rows[0];
  // Which auth users does Rainbow's data refer to, and how (ids only; no emails in evidence).
  const authRefs = (await runner.query(`
    with refs as (
      select user_id, 'game_sessions' as via from public.game_sessions where user_id is not null
      union all select user_id, 'user_streaks' from public.user_streaks where user_id is not null
      union all select user_id, 'puzzle_ratings' from public.puzzle_ratings where user_id is not null
      union all select user_id, 'user_roles' from public.user_roles
      union all select user_id, 'feedback' from public.feedback where user_id is not null
      union all select user_id, 'archive_access' from public.archive_access
      union all select created_by, 'puzzles.created_by' from public.puzzles where created_by is not null
      union all select created_by, 'puzzle_versions.created_by' from public.puzzle_versions where created_by is not null
    )
    select u.id, u.created_at, (u.email_confirmed_at is not null) as confirmed,
           (select array_agg(distinct i.provider order by i.provider) from auth.identities i where i.user_id = u.id) as providers,
           (select array_agg(distinct r.via order by r.via) from refs r where r.user_id = u.id) as referenced_via,
           exists (select 1 from public.xw_admins a where a.user_id = u.id) as crosspuns_admin
      from auth.users u
     order by u.created_at
  `)).rows;
  const ledger = (await runner.query(`select version, name from supabase_migrations.schema_migrations order by version`)).rows;
  const storageObjects = (await runner.query(`
    select bucket_id, count(*)::int as objects, coalesce(sum((metadata->>'size')::bigint), 0)::bigint as bytes
      from storage.objects group by bucket_id order by 1
  `)).rows;

  writeJson(path.join(dir, "inventory.json"), inv);
  writeFileSync(
    path.join(dir, "inventory.md"),
    renderInventoryMarkdown(inv, `Hosted project inventory: ${args.label}`, `\nRead from the hosted shared beta project on ${new Date().toISOString()} by \`npm run phase2:hosted -- inventory --label ${args.label}\`. Everything in \`public\`, every tenant.\n`),
    "utf8"
  );
  writeJson(path.join(dir, "counts.json"), counts);
  writeJson(path.join(dir, "auth.json"), { summary: auth, users: authRefs });
  writeJson(path.join(dir, "ledger.json"), ledger);
  writeJson(path.join(dir, "storage-objects.json"), storageObjects);

  console.log(`inventory "${args.label}": ${inv.tables.length} tables, ${inv.functions.length} functions, ${inv.tables.reduce((n, t) => n + t.policies.length, 0)} policies, ${inv.types.length} types; storage ${inv.storage.buckets.length} buckets, ${inv.storage.policies.length} policies`);
  console.log(`auth: ${JSON.stringify(auth)}`);
  console.log(`ledger: ${ledger.length} versions; written to ${path.relative(REPO_ROOT, dir)}`);
  return 0;
}

// ── classify ─────────────────────────────────────────────────────────────

interface Extras { tables?: string[]; functions?: { name: string; args: string }[]; types?: string[]; storagePolicies?: string[] }

function fnKey(f: { name: string; args: string }): string {
  return `${f.name}(${f.args})`;
}

function classify(args: Args): number {
  if (!args.label) throw new Error("classify needs --label <name>");
  const dir = path.join(EVIDENCE_DIR, args.label);
  const hosted = JSON.parse(readFileSync(path.join(dir, "inventory.json"), "utf8")) as Inventory;
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as Inventory;
  const beta = JSON.parse(readFileSync(BETA_INVENTORY, "utf8")) as Inventory;
  const extras = JSON.parse(readFileSync(EXTRAS, "utf8")) as Extras;

  const foreign = (name: string) => FOREIGN_PREFIXES.some((p) => name.startsWith(p));
  const manifestTables = new Set(manifest.tables.map((t) => t.name));
  const betaTables = new Set(beta.tables.map((t) => t.name));
  const extraTables = new Set(extras.tables ?? []);
  const manifestFns = new Set(manifest.functions.map(fnKey));
  const betaFns = new Set(beta.functions.map(fnKey));
  const extraFns = new Set((extras.functions ?? []).map(fnKey));
  const manifestTypes = new Set(manifest.types.map((t) => t.name));
  const betaTypes = new Set(beta.types.map((t) => t.name));

  const result = {
    label: args.label,
    tables: {
      foreign_untouched: [] as string[],
      rainbow_recreated: [] as string[],
      rainbow_dropped: [] as string[],
      rainbow_created_by_baseline: [] as string[],
      unknown: [] as string[],
    },
    functions: {
      foreign_untouched: [] as string[],
      rainbow_recreated: [] as string[],
      rainbow_dropped: [] as string[],
      rainbow_created_by_baseline: [] as string[],
      unknown: [] as string[],
    },
    types: { foreign_untouched: [] as string[], rainbow: [] as string[], unknown: [] as string[] },
    storage: {
      buckets: hosted.storage.buckets,
      policies_hosted: hosted.storage.policies.map((p) => p.name),
      policies_baseline: manifest.storage.policies.map((p) => p.name),
      policies_in_extras: extras.storagePolicies ?? [],
    },
  };

  for (const t of hosted.tables) {
    if (foreign(t.name)) result.tables.foreign_untouched.push(t.name);
    else if (manifestTables.has(t.name)) result.tables.rainbow_recreated.push(t.name);
    else if (betaTables.has(t.name) || extraTables.has(t.name)) result.tables.rainbow_dropped.push(t.name);
    else result.tables.unknown.push(t.name);
  }
  for (const name of manifestTables) if (!hosted.tables.some((t) => t.name === name)) result.tables.rainbow_created_by_baseline.push(name);

  for (const f of hosted.functions) {
    const key = fnKey(f);
    if (foreign(f.name)) result.functions.foreign_untouched.push(key);
    else if (manifestFns.has(key)) result.functions.rainbow_recreated.push(key);
    else if (betaFns.has(key) || extraFns.has(key)) result.functions.rainbow_dropped.push(key);
    else result.functions.unknown.push(key);
  }
  for (const key of manifestFns) if (!hosted.functions.some((f) => fnKey(f) === key)) result.functions.rainbow_created_by_baseline.push(key);

  for (const t of hosted.types) {
    if (foreign(t.name)) result.types.foreign_untouched.push(t.name);
    else if (manifestTypes.has(t.name) || betaTypes.has(t.name)) result.types.rainbow.push(t.name);
    else result.types.unknown.push(t.name);
  }

  writeJson(path.join(dir, "classification.json"), result);
  const show = (title: string, items: string[]) => console.log(`${title} (${items.length}): ${items.join(", ") || "-"}`);
  console.log(`classification of "${args.label}"`);
  show("D  foreign tables, MUST stay untouched", result.tables.foreign_untouched);
  show("A  Rainbow tables dropped and recreated by the baseline", result.tables.rainbow_recreated);
  show("A' Rainbow tables dropped, not recreated (beta-era only)", result.tables.rainbow_dropped);
  show("C  Rainbow tables the baseline creates new", result.tables.rainbow_created_by_baseline);
  show("?  UNKNOWN tables (STOP if any)", result.tables.unknown);
  show("D  foreign functions, MUST stay untouched", result.functions.foreign_untouched);
  show("A  Rainbow functions dropped and recreated", result.functions.rainbow_recreated);
  show("A' Rainbow functions dropped, not recreated", result.functions.rainbow_dropped);
  show("C  Rainbow functions the baseline creates new", result.functions.rainbow_created_by_baseline);
  show("?  UNKNOWN functions (STOP if any)", result.functions.unknown);
  show("types: foreign", result.types.foreign_untouched);
  show("types: rainbow", result.types.rainbow);
  show("?  UNKNOWN types", result.types.unknown);
  console.log(`storage policies on hosted: ${result.storage.policies_hosted.join(", ") || "-"} | baseline creates: ${result.storage.policies_baseline.join(", ")} | extras drop: ${result.storage.policies_in_extras.join(", ") || "-"}`);
  return result.tables.unknown.length + result.functions.unknown.length + result.types.unknown.length === 0 ? 0 : 1;
}

// ── export ───────────────────────────────────────────────────────────────

async function exportData(args: Args): Promise<number> {
  if (!args.out) throw new Error("export needs --out <dir> (inside .runtime/)");
  const out = path.resolve(REPO_ROOT, args.out);
  if (!out.startsWith(path.join(REPO_ROOT, ".runtime"))) throw new Error("REFUSING: exports contain player data and must be written inside the git-ignored .runtime/ directory");
  const runner = runnerFor(args);
  const beta = JSON.parse(readFileSync(BETA_INVENTORY, "utf8")) as Inventory;
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as Inventory;
  const rainbowTables = Array.from(new Set([...beta.tables, ...manifest.tables].map((t) => t.name))).sort();
  const hostedTables = new Set((await runner.query<{ t: string }>(`select tablename as t from pg_tables where schemaname = 'public'`)).rows.map((r) => r.t));

  mkdirSync(out, { recursive: true });
  const summary: Record<string, number> = {};
  for (const table of rainbowTables) {
    if (FOREIGN_PREFIXES.some((p) => table.startsWith(p))) throw new Error(`refusing to export foreign table ${table}`);
    if (!hostedTables.has(table)) { summary[table] = -1; continue; }
    const rows = (await runner.query<{ row: unknown }>(`select row_to_json(t) as row from public."${table}" t`)).rows.map((r) => r.row);
    writeFileSync(path.join(out, `${table}.jsonl`), rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""), "utf8");
    summary[table] = rows.length;
  }
  // The auth users Rainbow's rows refer to: enough to classify ownership and
  // to recognise the same person later. Emails included; this file is in .runtime/.
  const users = (await runner.query(`
    select u.id, u.email, u.created_at, u.last_sign_in_at, (u.email_confirmed_at is not null) as confirmed,
           (select array_agg(distinct i.provider order by i.provider) from auth.identities i where i.user_id = u.id) as providers,
           exists (select 1 from public.xw_admins a where a.user_id = u.id) as crosspuns_admin
      from auth.users u order by u.created_at
  `)).rows;
  writeJson(path.join(out, "auth-users.json"), users);
  const objects = (await runner.query(`select id, bucket_id, name, owner, created_at, updated_at, metadata from storage.objects order by bucket_id, name`)).rows;
  writeJson(path.join(out, "storage-objects.json"), objects);
  const ledger = (await runner.query(`select version, name, statements from supabase_migrations.schema_migrations order by version`)).rows;
  writeJson(path.join(out, "schema-migrations.json"), ledger);
  writeJson(path.join(out, "export-summary.json"), { exportedAt: new Date().toISOString(), tables: summary, authUsers: users.length, storageObjects: objects.length, ledgerVersions: ledger.length });
  console.log(`exported to ${path.relative(REPO_ROOT, out)}:`);
  for (const [t, n] of Object.entries(summary)) console.log(`  ${String(n < 0 ? "absent" : n).padStart(7)}  ${t}`);
  console.log(`  ${String(users.length).padStart(7)}  auth users (all)\n  ${String(objects.length).padStart(7)}  storage objects\n  ${String(ledger.length).padStart(7)}  ledger versions`);
  return 0;
}

// ── deps ─────────────────────────────────────────────────────────────────

/**
 * Every dependency recorded in pg_depend from an object that is NOT
 * Rainbow's onto a Rainbow table, function or the app_role type. The
 * teardown refuses to broaden, so this must be empty before it runs.
 * Rainbow = everything in public that does not carry a foreign prefix,
 * minus rls_auto_enable() (project-wide).
 */
async function deps(args: Args): Promise<number> {
  const runner = runnerFor(args);
  const rows = (await runner.query<{ dependent: string; kind: string; rainbow_object: string; deptype: string }>(`
    with rainbow as (
      select c.oid, c.relname as name, 'table' as kind from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname !~ '^(xw|cv|wtf)_'
      union all
      select p.oid, p.proname, 'function' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname !~ '^(xw|cv|wtf)_' and p.proname <> 'rls_auto_enable'
      union all
      select t.oid, t.typname, 'type' from pg_type t join pg_namespace n on n.oid = t.typnamespace
       where n.nspname = 'public' and t.typname = 'app_role'
    ),
    deps as (
      select d.classid::regclass::text as dep_class, d.objid, r.name as rainbow_object, r.kind, d.deptype
        from pg_depend d join rainbow r on r.oid = d.refobjid
       where d.deptype in ('n', 'a')
    )
    select rainbow_object, kind, deptype,
           case dep_class
             when 'pg_policy' then (select 'policy "' || pol.polname || '" on ' || rc.relname from pg_policy pol join pg_class rc on rc.oid = pol.polrelid where pol.oid = deps.objid)
             when 'pg_constraint' then (select 'constraint ' || con.conname || ' on ' || rc.relname from pg_constraint con join pg_class rc on rc.oid = con.conrelid where con.oid = deps.objid)
             when 'pg_trigger' then (select 'trigger ' || tg.tgname || ' on ' || rc.relname from pg_trigger tg join pg_class rc on rc.oid = tg.tgrelid where tg.oid = deps.objid)
             when 'pg_proc' then (select 'function ' || pr.proname from pg_proc pr where pr.oid = deps.objid)
             when 'pg_class' then (select 'relation ' || rc.relname from pg_class rc where rc.oid = deps.objid)
             when 'pg_attrdef' then (select 'default on ' || rc.relname from pg_attrdef ad join pg_class rc on rc.oid = ad.adrelid where ad.oid = deps.objid)
             when 'pg_rewrite' then (select 'view ' || rc.relname from pg_rewrite rw join pg_class rc on rc.oid = rw.ev_class where rw.oid = deps.objid)
             else dep_class end as dependent
      from deps order by 1, 4
  `)).rows;
  const foreign = rows.filter((r) => r.dependent && /(^| )(xw_|cv_|wtf_)|on (xw|cv|wtf)_/.test(r.dependent));
  console.log(`dependencies onto Rainbow objects: ${rows.length}; from NON-Rainbow objects: ${foreign.length}`);
  for (const r of foreign) console.log(`  ${r.dependent} -> ${r.kind} ${r.rainbow_object} (deptype ${r.deptype})`);
  if (args.label) writeJson(path.join(EVIDENCE_DIR, args.label, "dependencies-from-non-rainbow.json"), { scannedAt: new Date().toISOString(), total: rows.length, fromNonRainbow: foreign });
  return foreign.length === 0 ? 0 : 1;
}

// ── compare ──────────────────────────────────────────────────────────────

/**
 * After the rebuild: (1) Rainbow's objects on the hosted project must equal
 * the committed manifest; (2) nothing else may have changed between the
 * `before` and `after` inventories except what the owner approved.
 */
function compare(args: Args): number {
  const before = args.from ?? "before";
  const after = args.label ?? "after";
  const read = <T>(label: string, file: string) => JSON.parse(readFileSync(path.join(EVIDENCE_DIR, label, file), "utf8")) as T;
  const invB = read<Inventory>(before, "inventory.json");
  const invA = read<Inventory>(after, "inventory.json");
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as Inventory;
  const foreign = (name: string) => FOREIGN_PREFIXES.some((p) => name.startsWith(p));
  const lines: string[] = [];
  let problems = 0;

  // 1. Rainbow vs manifest (public objects; storage is compared separately because
  //    the manifest was read from a stack without the storage service).
  const rainbowAfter: Inventory = {
    ...invA,
    tables: invA.tables.filter((t) => !foreign(t.name)),
    functions: invA.functions.filter((f) => !foreign(f.name) && f.name !== "rls_auto_enable"),
    types: invA.types.filter((t) => !foreign(t.name)),
    storage: manifest.storage,
    extensions: manifest.extensions,
    views: invA.views.filter((v) => !foreign(v)),
    sequences: invA.sequences.filter((s) => !foreign(s)),
  };
  const manifestDiff = diffInventories(manifest, rainbowAfter);
  lines.push(`## Rainbow objects on the hosted project vs the committed manifest`, "", manifestDiff.length ? manifestDiff.map((d) => `- ${d}`).join("\n") : "- identical: 22 tables, 59 functions, 25 policies, every column, constraint, index, trigger, policy and grant", "");
  problems += manifestDiff.length;

  // 2. Non-Rainbow objects before vs after.
  const strip = (t: Inventory["tables"][number]) => JSON.stringify({ ...t, policies: undefined });
  const policiesOf = (t: Inventory["tables"][number]) => t.policies.map((p) => p.name).sort();
  const foreignDiffs: string[] = [];
  for (const tb of invB.tables.filter((t) => foreign(t.name))) {
    const ta = invA.tables.find((t) => t.name === tb.name);
    if (!ta) { foreignDiffs.push(`table ${tb.name}: MISSING after`); continue; }
    if (strip(ta) !== strip(tb)) foreignDiffs.push(`table ${tb.name}: structure/grants/triggers differ`);
    const removed = policiesOf(tb).filter((p) => !policiesOf(ta).includes(p));
    const added = policiesOf(ta).filter((p) => !policiesOf(tb).includes(p));
    for (const p of removed) foreignDiffs.push(`table ${tb.name}: policy removed "${p}"`);
    for (const p of added) foreignDiffs.push(`table ${tb.name}: policy ADDED "${p}"`);
  }
  for (const ta of invA.tables.filter((t) => foreign(t.name))) if (!invB.tables.some((t) => t.name === ta.name)) foreignDiffs.push(`table ${ta.name}: NEW after`);
  const fnKeyOf = (f: { name: string; args: string }) => `${f.name}(${f.args})`;
  const foreignFns = (inv: Inventory) => inv.functions.filter((f) => foreign(f.name) || f.name === "rls_auto_enable");
  for (const fb of foreignFns(invB)) {
    const fa = foreignFns(invA).find((f) => fnKeyOf(f) === fnKeyOf(fb));
    if (!fa) foreignDiffs.push(`function ${fnKeyOf(fb)}: MISSING after`);
    else if (JSON.stringify(fa) !== JSON.stringify(fb)) foreignDiffs.push(`function ${fnKeyOf(fb)}: definition/grants differ`);
  }
  for (const fa of foreignFns(invA)) if (!foreignFns(invB).some((f) => fnKeyOf(f) === fnKeyOf(fa))) foreignDiffs.push(`function ${fnKeyOf(fa)}: NEW after`);
  const approved = new Set([
    `table cv_puzzles: policy removed "Admins can manage cv puzzles"`,
    `table cv_wordbank: policy removed "Admins can manage cv wordbank"`,
    `table wtf_games: policy removed "Admins can manage wtf games"`,
  ]);
  const unexplained = foreignDiffs.filter((d) => !approved.has(d));
  lines.push(`## Non-Rainbow objects, before vs after`, "", foreignDiffs.length ? foreignDiffs.map((d) => `- ${d}${approved.has(d) ? " (owner-approved, step 0)" : " **UNEXPLAINED**"}`).join("\n") : "- no difference", "", `Unexplained differences: ${unexplained.length}`, "");
  problems += unexplained.length;

  // 3. Row counts of non-Rainbow tables, auth users, storage, ledger.
  const cB = read<{ table: string; rows: number }[]>(before, "counts.json");
  const cA = read<{ table: string; rows: number }[]>(after, "counts.json");
  const countDiffs = cB.filter((b) => foreign(b.table)).map((b) => ({ ...b, after: cA.find((a) => a.table === b.table)?.rows ?? -1 })).filter((x) => x.after !== x.rows);
  lines.push(`## Non-Rainbow row counts`, "", countDiffs.length ? countDiffs.map((x) => `- ${x.table}: ${x.rows} -> ${x.after}`).join("\n") : `- unchanged (${cB.filter((b) => foreign(b.table)).length} tables)`, "");
  problems += countDiffs.length;
  const uB = read<{ users: { id: string }[] }>(before, "auth.json").users.map((u) => u.id).sort();
  const uA = read<{ users: { id: string }[] }>(after, "auth.json").users.map((u) => u.id).sort();
  const sameUsers = JSON.stringify(uB) === JSON.stringify(uA);
  lines.push(`## Auth users`, "", sameUsers ? `- unchanged: the same ${uA.length} user ids` : `- **CHANGED**: ${uB.length} before, ${uA.length} after`, "");
  if (!sameUsers) problems++;
  const sB = read<{ bucket_id: string; objects: number; bytes: number }[]>(before, "storage-objects.json");
  const sA = read<{ bucket_id: string; objects: number; bytes: number }[]>(after, "storage-objects.json");
  const sameStorage = JSON.stringify(sB) === JSON.stringify(sA) && JSON.stringify(invB.storage.buckets) === JSON.stringify(invA.storage.buckets);
  lines.push(`## Storage`, "", sameStorage ? `- objects and buckets unchanged: ${sA.map((s) => `${s.bucket_id} ${s.objects} objects`).join(", ")}` : `- **CHANGED**: before ${JSON.stringify(sB)} after ${JSON.stringify(sA)}`, `- policies on storage.objects after: ${invA.storage.policies.map((p) => `"${p.name}"`).join(", ") || "none"}`, "");
  if (!sameStorage) problems++;
  const ledger = read<{ version: string; name: string }[]>(after, "ledger.json");
  lines.push(`## Migration ledger after`, "", ledger.map((l) => `- ${l.version} ${l.name}`).join("\n"), "");

  const md = `# Hosted comparison: ${before} -> ${after}\n\nGenerated ${new Date().toISOString()}.\n\n${lines.join("\n")}\nProblems: ${problems}\n`;
  writeFileSync(path.join(EVIDENCE_DIR, after, "comparison.md"), md, "utf8");
  console.log(md);
  return problems === 0 ? 0 : 1;
}

// ── smoke ────────────────────────────────────────────────────────────────

/**
 * What the client does, against the hosted project, with the publishable key
 * only (RAINBOW_HOSTED_ANON_KEY in the shell): a guest mints a device,
 * starts and finishes today's puzzle, reads stats; an unauthenticated caller
 * gets the expected answers from the account layer. The test rows are
 * removed again at the end.
 */
async function smoke(args: Args): Promise<number> {
  const runner = runnerFor(args);
  const anon = (process.env.RAINBOW_HOSTED_ANON_KEY ?? "").trim();
  if (!anon) throw new Error("RAINBOW_HOSTED_ANON_KEY (the publishable key) is required in the shell");
  const base = `https://${args.projectRef}.supabase.co`;
  const rpc = async (name: string, body: Record<string, unknown> = {}, token?: string) => {
    const res = await fetch(`${base}/rest/v1/rpc/${name}`, { method: "POST", headers: { apikey: anon, Authorization: `Bearer ${token ?? anon}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  };
  const results: string[] = [];
  const ok = (name: string, pass: boolean, detail: string) => { results.push(`| ${name} | ${pass ? "pass" : "**FAIL**"} | ${detail} |`); return pass; };
  let all = true;

  const ping = await rpc("ping");
  all = ok("ping()", ping.status === 200 && ping.json === true, `HTTP ${ping.status}`) && all;
  // Both account-layer RPCs are granted to authenticated only; an anonymous
  // caller must be refused by the grant (401/403), never answered.
  const resolve = await rpc("resolve_device_import", { _device_id: null, _device_token: null });
  all = ok("resolve_device_import() as anon is refused", resolve.status === 401 || resolve.status === 403, `HTTP ${resolve.status}`) && all;
  const ensure = await rpc("ensure_account");
  all = ok("ensure_account() as anon", ensure.status === 401 || ensure.status === 403 || ensure.json?.[0]?.outcome === "not_signed_in", `HTTP ${ensure.status} ${JSON.stringify(ensure.json).slice(0, 80)}`) && all;
  const archive = await rpc("get_archive_puzzles");
  all = ok("get_archive_puzzles()", archive.status === 200 && Array.isArray(archive.json) && archive.json.length > 0, `${Array.isArray(archive.json) ? archive.json.length : "?"} puzzles`) && all;

  // The latest published Full puzzle (the beta content need not have one dated today).
  const puzzleRes = await fetch(`${base}/rest/v1/puzzles?select=id,title,format,date&format=eq.full&is_published=eq.true&order=date.desc&limit=1`, { headers: { apikey: anon, Authorization: `Bearer ${anon}` } });
  const puzzles = (await puzzleRes.json()) as { id: string; title: string; format: string; date: string }[];
  const full = Array.isArray(puzzles) ? puzzles[0] : undefined;
  all = ok("published puzzles readable as anon", puzzleRes.status === 200 && !!full, full ? `latest Full: ${full.title} (${full.date})` : `HTTP ${puzzleRes.status}`) && all;

  const device = await rpc("create_device_identity");
  const dev = device.json?.[0] as { device_id: string; device_token: string } | undefined;
  all = ok("create_device_identity()", !!dev?.device_id && !!dev?.device_token, dev ? "device minted" : `HTTP ${device.status}`) && all;
  let sessionId: string | null = null;
  if (dev && full) {
    const created = await rpc("create_game_session", { _puzzle_id: full.id, _device_id: dev.device_id, _device_token: dev.device_token, _entry_context: "daily" });
    sessionId = typeof created.json === "string" ? created.json : null;
    all = ok("create_game_session() as a guest", !!sessionId, sessionId ? "session created" : `HTTP ${created.status} ${JSON.stringify(created.json).slice(0, 80)}`) && all;
    const own = await rpc("get_own_completed_sessions", { _device_id: dev.device_id, _device_token: dev.device_token, _format: "full" });
    all = ok("get_own_completed_sessions() for the new device", own.status === 200 && Array.isArray(own.json) && own.json.length === 0, `HTTP ${own.status}, ${Array.isArray(own.json) ? own.json.length : "?"} rows`) && all;
    const stats = await rpc("get_puzzle_stats", { _puzzle_id: full.id });
    all = ok("get_puzzle_stats() for today's puzzle", stats.status === 200, `HTTP ${stats.status}`) && all;
  } else {
    results.push(`| guest session flow | skipped | ${full ? "no device" : "no published Full puzzle"} |`);
  }

  // Clean up the smoke rows (Rainbow's own tables only).
  if (dev) {
    const cleanup = await runner.query<{ sessions: number; devices: number }>(`
      with s as (delete from public.game_sessions where device_id = '${dev.device_id}' returning 1),
           d as (delete from public.device_identities where device_id = '${dev.device_id}' returning 1)
      select (select count(*) from s)::int as sessions, (select count(*) from d)::int as devices
    `);
    results.push(`| cleanup | done | removed ${cleanup.rows[0].sessions} session(s), ${cleanup.rows[0].devices} device |`);
  }

  const md = `# Hosted smoke (publishable key, as the client)\n\nRun ${new Date().toISOString()}.\n\n| check | result | detail |\n|---|---|---|\n${results.join("\n")}\n\nAll passed: ${all}\n`;
  if (args.label) writeFileSync(path.join(EVIDENCE_DIR, args.label, "hosted-smoke.md"), md, "utf8");
  console.log(md);
  return all ? 0 : 1;
}

// ── sql ──────────────────────────────────────────────────────────────────

async function sql(args: Args): Promise<number> {
  if (!args.file) throw new Error("sql needs --file <path>");
  const file = path.resolve(REPO_ROOT, args.file);
  const text = readFileSync(file, "utf8");
  const trimmed = text.replace(/--[^\n]*/g, "").trim().replace(/;\s*$/, "").trim();
  const endsInRollback = /\brollback\s*$/i.test(trimmed);
  if (!args.apply) {
    if (!endsInRollback) throw new Error("REFUSING: without --apply the script must end in ROLLBACK (a rehearsal). Nothing was sent.");
  } else {
    if (endsInRollback) throw new Error("--apply given but the script ends in ROLLBACK; use the apply file.");
    if (!args.iMeanIt) throw new Error("REFUSING: --apply also needs --i-mean-the-hosted-beta-project.");
    if (process.env.PHASE2_HOSTED_WRITE !== "yes") throw new Error("REFUSING: --apply also needs PHASE2_HOSTED_WRITE=yes in the environment.");
  }
  const runner = runnerFor(args);
  console.log(`${args.apply ? "APPLYING" : "rehearsing (ROLLBACK)"} ${path.relative(REPO_ROOT, file)} (${text.length} chars) on the hosted project…`);
  const rows = (await runner.query(text)).rows;
  if (rows.length) console.log(JSON.stringify(rows, null, 2).slice(0, 20000));
  console.log(args.apply ? "applied." : "rehearsal complete; nothing was kept.");
  return 0;
}

// ── main ─────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  switch (args.command) {
    case "inventory": return inventory(args);
    case "classify": return classify(args);
    case "export": return exportData(args);
    case "deps": return deps(args);
    case "compare": return compare(args);
    case "smoke": return smoke(args);
    case "sql": return sql(args);
    default:
      console.error("usage: npm run phase2:hosted -- --project-ref <ref> inventory --label <l> | classify --label <l> | export --out <dir> | sql --file <f> [--apply --i-mean-the-hosted-beta-project]");
      return 2;
  }
}

// Only when run directly: phase2-restore.ts imports HostedRunner from here.
if (process.argv[1] && /hosted-phase2\.ts$/.test(process.argv[1].replace(/\\/g, "/"))) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    }
  );
}

export { EVIDENCE_DIR, HostedRunner };
