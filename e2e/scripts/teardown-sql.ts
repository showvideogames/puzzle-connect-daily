/**
 * Generate the SCOPED teardown for the shared beta project.
 *
 *   npm run db:teardown-sql -- --keep-auth-users <file.json> [--out <dir>]
 *
 * Writes two SQL files (default: supabase/ops/beta-reset/):
 *
 *   10_teardown.REHEARSAL.sql   the same statements inside a transaction that
 *                               ends with ROLLBACK and prints what it would
 *                               have dropped and deleted
 *   10_teardown.sql             the real thing, ending with COMMIT
 *
 * WHAT IT DROPS, AND ONLY THAT
 * ----------------------------
 * Every statement names one object, and every name comes from one of three
 * repository-controlled lists:
 *
 *   1. supabase/rainbow-owned-objects.json            the launch manifest
 *   2. supabase/beta-era-migrations/beta-era-inventory.json
 *                                                      what the beta chain
 *                                                      built (game_results,
 *                                                      account_onboarding,
 *                                                      the old RPC overloads)
 *   3. supabase/ops/beta-reset/extra-objects.json      objects the Phase 2
 *                                                      read-only comparison
 *                                                      finds in the live
 *                                                      project that neither
 *                                                      list knows (created by
 *                                                      hand in the dashboard)
 *
 * There is no `drop schema`, no wildcard, no `cascade` on tables. If some
 * object OUTSIDE these lists depends on a Rainbow table, the drop fails and
 * the transaction rolls back — refusing to broaden is the point. A name that
 * begins with another tenant's prefix (xw_, cv_, wtf_) is rejected even if
 * it somehow appears in a list.
 *
 * Auth users: the beta reset deletes Rainbow's beta users. Because the
 * auth pool is shared, the OWNER supplies the ids to keep (the other tenant's
 * admin); the script never reads another tenant's tables to find them. The
 * keep-list file is required, must parse, and every id in it must exist.
 *
 * What it never touches: storage OBJECTS (the emoji artwork is content and is
 * kept), any table or function not in the lists, and the content tables'
 * DATA is not preserved by this file — export it first (see the runbook in
 * docs/PHASE-2-HOSTED-CHANGE-PREVIEW.md).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../env.ts";
import type { Inventory } from "./lib/inventory.ts";

const MANIFEST = path.join(REPO_ROOT, "supabase", "rainbow-owned-objects.json");
const BETA_INVENTORY = path.join(REPO_ROOT, "supabase", "beta-era-migrations", "beta-era-inventory.json");
const DEFAULT_OUT = path.join(REPO_ROOT, "supabase", "ops", "beta-reset");
const EXTRAS = path.join(DEFAULT_OUT, "extra-objects.json");

/** The beta-era ledger versions, i.e. the files in supabase/beta-era-migrations/. */
const BETA_LEDGER_VERSIONS = [
  "20260322052030", "20260322053806", "20260322054635", "20260323045030", "20260323051752",
  "20260704120000", "20260731120000", "20260915231813", "20260916120000", "20260916150000",
  "20260916220000", "20260916230000", "20260917000000", "20260917010000", "20260917120000",
  "20260918003000", "20260918010000", "20260918020000", "20260918030000", "20260918040000",
  "20260919000000", "20260919020000", "20260920000000", "20260921000000", "20260922000000",
  "20260923000000", "20260924000000", "20260925000000", "20260926000000", "20260927000000",
  "20260928000000", "20260929000000",
];

/** Prefixes that can never be Rainbow's, whatever a list says. */
const FOREIGN_PREFIXES = ["xw_", "cv_", "wtf_"];
const IDENT = /^[a-z][a-z0-9_]*$/;

interface Extras {
  tables?: string[];
  functions?: { name: string; args: string }[];
  types?: string[];
  storagePolicies?: string[];
}

function parseArgs(argv: string[]) {
  const args = { keep: null as string | null, out: DEFAULT_OUT, live: null as string | null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--keep-auth-users") args.keep = argv[++i] ?? null;
    else if (argv[i] === "--out") args.out = path.resolve(argv[++i] ?? DEFAULT_OUT);
    else if (argv[i] === "--live-inventory") args.live = argv[++i] ?? null;
  }
  return args;
}

function assertRainbowName(kind: string, name: string): void {
  if (!IDENT.test(name)) throw new Error(`${kind} "${name}" is not a plain identifier; refusing.`);
  for (const prefix of FOREIGN_PREFIXES) {
    if (name.startsWith(prefix)) throw new Error(`${kind} "${name}" belongs to another tenant (${prefix}*); refusing.`);
  }
}

const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function buildTeardown(
  manifest: Inventory,
  beta: Inventory,
  extras: Extras,
  keepAuthUsers: string[],
  mode: "rehearsal" | "apply",
  /**
   * The LIVE project's inventory (npm run phase2:hosted -- inventory), when
   * generating for a real reset. It adds nothing to the set of TABLES,
   * FUNCTIONS or TYPES — those stay list-driven — but a policy, trigger or
   * foreign key that the live project holds on a Rainbow table under a name
   * the lists do not know (a hand-made rename, a reconstructed policy) is
   * dropped by its real name, so the function drops that follow cannot be
   * blocked by it. Found on 2026-10-04: the live trigger puzzles_updated_at
   * versus the inventories' update_puzzles_updated_at.
   */
  live: Inventory | null = null
): string {
  const tables = new Set<string>();
  const functions = new Map<string, string>(); // "name(args)" -> args
  const types = new Set<string>();
  const storagePolicies = new Set<string>();
  const fks: { table: string; name: string }[] = [];

  for (const inv of [manifest, beta]) {
    for (const t of inv.tables) {
      tables.add(t.name);
      for (const c of t.constraints) if (c.type === "f") fks.push({ table: t.name, name: c.name });
    }
    for (const f of inv.functions) functions.set(`${f.name}(${f.args})`, f.args);
    for (const t of inv.types) types.add(t.name);
    for (const p of inv.storage.policies) storagePolicies.add(p.name);
  }
  for (const t of extras.tables ?? []) tables.add(t);
  for (const f of extras.functions ?? []) functions.set(`${f.name}(${f.args})`, f.args);
  for (const t of extras.types ?? []) types.add(t);
  for (const p of extras.storagePolicies ?? []) storagePolicies.add(p);

  for (const t of tables) assertRainbowName("table", t);
  for (const key of functions.keys()) assertRainbowName("function", key.slice(0, key.indexOf("(")));
  for (const t of types) assertRainbowName("type", t);

  // Tables in an order that drops referencing tables before referenced ones.
  // Every FK is dropped explicitly first anyway; the ordering only keeps the
  // output readable and robust to an FK the lists missed.
  const refs = new Map<string, Set<string>>();
  for (const inv of [manifest, beta]) {
    for (const t of inv.tables) {
      for (const c of t.constraints) {
        if (c.type !== "f") continue;
        const m = c.definition.match(/REFERENCES (?:public\.)?([a-z0-9_]+)/i);
        if (m && tables.has(m[1]) && m[1] !== t.name) {
          if (!refs.has(t.name)) refs.set(t.name, new Set());
          refs.get(t.name)!.add(m[1]);
        }
      }
    }
  }
  const ordered: string[] = [];
  const remaining = new Set(tables);
  while (remaining.size) {
    // a table can be dropped once nothing remaining references it
    const droppable = [...remaining].filter((t) => ![...remaining].some((o) => o !== t && refs.get(o)?.has(t)));
    if (!droppable.length) { ordered.push(...[...remaining].sort()); break; }
    droppable.sort();
    for (const t of droppable) { ordered.push(t); remaining.delete(t); }
  }

  const sortedFunctions = [...functions.entries()].sort(([a], [b]) => a.localeCompare(b));
  const out: string[] = [];
  const say = (s: string) => out.push(s);

  say(`-- ${mode === "rehearsal" ? "REHEARSAL" : "APPLY"}: Rainbow/Mini beta-era teardown for the SHARED beta project.`);
  say(`-- GENERATED by \`npm run db:teardown-sql\` from the ownership manifest and the beta-era inventory.`);
  say(`-- Do not edit by hand. Every statement names one object; there is no cascade and no wildcard.`);
  say(`-- Tables: ${ordered.length}. Functions: ${sortedFunctions.length}. Types: ${types.size}. Storage policies: ${storagePolicies.size}.`);
  say(`-- Auth users kept: ${keepAuthUsers.length}.`);
  say(``);
  say(`begin;`);
  say(`set local lock_timeout = '10s';`);
  say(`set local statement_timeout = '10min';`);
  say(``);

  say(`-- 0. Refuse to run if the keep-list does not match reality.`);
  say(`do $$`);
  say(`declare _missing integer; _to_delete integer;`);
  say(`begin`);
  if (keepAuthUsers.length) {
    say(`  select count(*) into _missing from unnest(array[${keepAuthUsers.map(lit).join(", ")}]::uuid[]) k(id)`);
    say(`   where not exists (select 1 from auth.users u where u.id = k.id);`);
    say(`  if _missing > 0 then raise exception 'Aborting: % keep-list auth user(s) do not exist in this project', _missing; end if;`);
  }
  say(`  select count(*) into _to_delete from auth.users u where u.id <> all(array[${keepAuthUsers.map(lit).join(", ") || "'00000000-0000-0000-0000-000000000000'"}]::uuid[]);`);
  say(`  raise notice 'auth users that will be deleted: %', _to_delete;`);
  say(`end $$;`);
  say(``);

  if (storagePolicies.size) {
    say(`-- 1. Storage policies on storage.objects (the bucket and its objects are content and stay).`);
    for (const p of [...storagePolicies].sort()) say(`drop policy if exists ${q(p)} on storage.objects;`);
    say(``);
  } else {
    say(`-- 1. Storage policies: none listed yet (the Phase 2 comparison fills extra-objects.json).`);
    say(``);
  }

  // Dependency order, made explicit because nothing here uses CASCADE:
  //   policies and triggers reference functions  -> drop them first
  //   functions may take a table's row type       -> functions before tables
  //   foreign keys tie tables together            -> drop them before tables
  say(`-- 2. Row-level-security policies and triggers on Rainbow tables (they reference Rainbow functions).`);
  const policies = new Set<string>();
  const triggers = new Set<string>();
  for (const inv of [manifest, beta]) {
    for (const t of inv.tables) {
      for (const p of t.policies) policies.add(`drop policy if exists ${q(p.name)} on public.${q(t.name)};`);
      for (const tr of t.triggers) triggers.add(`drop trigger if exists ${q(tr.name)} on public.${q(t.name)};`);
    }
  }
  // The live names on exactly those tables, if a live inventory was given.
  for (const t of live?.tables ?? []) {
    if (!tables.has(t.name)) continue;
    for (const p of t.policies) policies.add(`drop policy if exists ${q(p.name)} on public.${q(t.name)};`);
    for (const tr of t.triggers) triggers.add(`drop trigger if exists ${q(tr.name)} on public.${q(t.name)};`);
  }
  for (const s of [...policies].sort()) say(s);
  for (const s of [...triggers].sort()) say(s);
  say(``);

  say(`-- 3. Foreign keys between Rainbow tables, so the tables below can be dropped in any order without cascade.`);
  for (const t of live?.tables ?? []) {
    if (!tables.has(t.name)) continue;
    for (const c of t.constraints) if (c.type === "f") fks.push({ table: t.name, name: c.name });
  }
  const seenFk = new Set<string>();
  for (const fk of fks.sort((a, b) => `${a.table}.${a.name}`.localeCompare(`${b.table}.${b.name}`))) {
    const key = `${fk.table}.${fk.name}`;
    if (seenFk.has(key)) continue;
    seenFk.add(key);
    say(`alter table if exists public.${q(fk.table)} drop constraint if exists ${q(fk.name)};`);
  }
  say(``);

  say(`-- 4. Functions, by exact signature (before tables: some take a Rainbow table's row type).`);
  for (const [key, args] of sortedFunctions) {
    const name = key.slice(0, key.indexOf("("));
    say(`drop function if exists public.${q(name)}(${args});`);
  }
  say(``);

  say(`-- 5. Tables (indexes and remaining constraints go with them). NO cascade: an outside dependency aborts the transaction.`);
  for (const t of ordered) say(`drop table if exists public.${q(t)};`);
  say(``);

  say(`-- 6. Types.`);
  for (const t of [...types].sort()) say(`drop type if exists public.${q(t)};`);
  say(``);

  say(`-- 7. Beta users. Everything not on the owner's keep-list. GoTrue's cascades remove identities, sessions and refresh tokens.`);
  say(`delete from auth.users where id <> all(array[${keepAuthUsers.map(lit).join(", ") || "'00000000-0000-0000-0000-000000000000'"}]::uuid[]);`);
  say(``);

  say(`-- 8. The migration ledger: the beta-era chain is superseded by the baseline (0001/0002 are recorded when the baseline is applied).`);
  say(`delete from supabase_migrations.schema_migrations where version in (${BETA_LEDGER_VERSIONS.map(lit).join(", ")});`);
  say(``);

  say(`-- 9. What is left of Rainbow in public after this? Nothing, if the lists were complete.`);
  say(`do $$`);
  say(`declare _left text;`);
  say(`begin`);
  say(`  select string_agg(tablename, ', ' order by tablename) into _left from pg_tables where schemaname = 'public'`);
  say(`     and tablename = any(array[${ordered.map(lit).join(", ")}]);`);
  say(`  if _left is not null then raise exception 'Aborting: Rainbow tables still present: %', _left; end if;`);
  say(`  select string_agg(tablename, ', ' order by tablename) into _left from pg_tables where schemaname = 'public';`);
  say(`  raise notice 'tables remaining in public (must all be other tenants''): %', coalesce(_left, '(none)');`);
  say(`end $$;`);
  say(``);
  say(mode === "rehearsal" ? `rollback;  -- REHEARSAL: nothing above was kept.` : `commit;`);
  say(``);
  return out.join("\n");
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  if (!args.keep) {
    console.error(
      "\nUsage: npm run db:teardown-sql -- --keep-auth-users <file.json> [--out <dir>]\n\n" +
        "The keep-list is REQUIRED: a JSON array of auth user ids (uuids) that must survive the\n" +
        "beta reset (the other tenant's admin). Pass [] explicitly to delete every auth user.\n"
    );
    return 2;
  }
  const keep = JSON.parse(readFileSync(args.keep, "utf8")) as unknown;
  if (!Array.isArray(keep) || !keep.every((k) => typeof k === "string" && /^[0-9a-f-]{36}$/i.test(k))) {
    console.error("\nThe keep-list must be a JSON array of uuid strings.\n");
    return 2;
  }
  if (!existsSync(MANIFEST)) { console.error(`\nMissing ${MANIFEST}; run \`npm run db:manifest\` first.\n`); return 3; }
  if (!existsSync(BETA_INVENTORY)) { console.error(`\nMissing ${BETA_INVENTORY}.\n`); return 3; }
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as Inventory;
  const beta = JSON.parse(readFileSync(BETA_INVENTORY, "utf8")) as Inventory;
  const extras = existsSync(EXTRAS) ? (JSON.parse(readFileSync(EXTRAS, "utf8")) as Extras) : {};

  mkdirSync(args.out, { recursive: true });
  const live = args.live ? (JSON.parse(readFileSync(args.live, "utf8")) as Inventory) : null;
  if (live) console.log(`Using the live inventory ${args.live} for policy, trigger and foreign-key names on Rainbow tables.`);
  const rehearsal = buildTeardown(manifest, beta, extras, keep as string[], "rehearsal", live);
  const apply = buildTeardown(manifest, beta, extras, keep as string[], "apply", live);
  writeFileSync(path.join(args.out, "10_teardown.REHEARSAL.sql"), rehearsal, "utf8");
  writeFileSync(path.join(args.out, "10_teardown.sql"), apply, "utf8");
  console.log(`Wrote ${path.join(args.out, "10_teardown.REHEARSAL.sql")} and 10_teardown.sql`);
  return 0;
}

if (process.argv[1] && /teardown-sql\.ts$/.test(process.argv[1].replace(/\\/g, "/"))) {
  process.exit(main());
}
