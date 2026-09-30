/**
 * The exact object-level difference between the beta-era Rainbow schema and
 * the launch baseline, as Markdown — the heart of the Phase 2 hosted-change
 * preview.
 *
 *   npm run db:change-preview            prints to stdout
 *   npm run db:change-preview -- --out <file>
 *
 * Inputs are the two committed inventories; nothing is read from any
 * database, so this is safe to run anywhere and reproducible from git.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../env.ts";
import type { Inventory, TableInfo } from "./lib/inventory.ts";

const BEFORE = path.join(REPO_ROOT, "supabase", "beta-era-migrations", "beta-era-inventory.json");
const AFTER = path.join(REPO_ROOT, "supabase", "rainbow-owned-objects.json");

function sig(f: { name: string; args: string }) {
  return `${f.name}(${f.args})`;
}

function grantsOf(t: TableInfo): string {
  return Object.entries(t.grants)
    .map(([r, p]) => `${r}=${p.join("/")}`)
    .join(", ") || "none";
}

export function renderChangePreview(before: Inventory, after: Inventory): string {
  const out: string[] = [];
  const beforeTables = new Map(before.tables.map((t) => [t.name, t]));
  const afterTables = new Map(after.tables.map((t) => [t.name, t]));

  out.push("### Tables", "");
  out.push("| Table | Change | Detail |", "|---|---|---|");
  for (const t of after.tables) {
    const b = beforeTables.get(t.name);
    if (!b) {
      out.push(`| \`${t.name}\` | **CREATE** | ${t.columns.length} columns; RLS ${t.rlsEnabled ? "on" : "off"}; grants ${grantsOf(t)} |`);
      continue;
    }
    const details: string[] = [];
    const bCols = new Map(b.columns.map((c) => [c.name, c]));
    for (const c of t.columns) {
      const bc = bCols.get(c.name);
      if (!bc) details.push(`add column \`${c.name}\` ${c.type}${c.notNull ? " not null" : ""}`);
      else if (bc.type !== c.type || bc.notNull !== c.notNull || (bc.default ?? null) !== (c.default ?? null))
        details.push(`alter column \`${c.name}\`: ${bc.type}${bc.notNull ? " not null" : ""} → ${c.type}${c.notNull ? " not null" : ""}`);
    }
    for (const c of b.columns) if (!t.columns.some((x) => x.name === c.name)) details.push(`drop column \`${c.name}\``);
    const bCons = new Set(b.constraints.map((c) => `${c.name} ${c.definition}`));
    const aCons = new Set(t.constraints.map((c) => `${c.name} ${c.definition}`));
    for (const c of t.constraints) if (!bCons.has(`${c.name} ${c.definition}`)) details.push(`add constraint \`${c.name}\` ${c.definition}`);
    for (const c of b.constraints) if (!aCons.has(`${c.name} ${c.definition}`)) details.push(`drop constraint \`${c.name}\``);
    const bIdx = new Set(b.indexes.map((i) => i.definition));
    const aIdx = new Set(t.indexes.map((i) => i.definition));
    for (const i of t.indexes) if (!bIdx.has(i.definition)) details.push(`create index \`${i.name}\``);
    for (const i of b.indexes) if (!aIdx.has(i.definition)) details.push(`drop index \`${i.name}\``);
    const pol = (p: TableInfo["policies"][number]) => `${p.name}|${p.command}|${p.roles.join(",")}|${p.using}|${p.withCheck}`;
    const bPol = new Set(b.policies.map(pol));
    const aPol = new Set(t.policies.map(pol));
    for (const p of t.policies) if (!bPol.has(pol(p))) details.push(`policy \`${p.name}\` (${b.policies.some((x) => x.name === p.name) ? "changed" : "new"})`);
    for (const p of b.policies) if (!aPol.has(pol(p)) && !t.policies.some((x) => x.name === p.name)) details.push(`drop policy \`${p.name}\``);
    if (grantsOf(b) !== grantsOf(t)) details.push(`grants: ${grantsOf(b)} → ${grantsOf(t)}`);
    const bTrg = new Set(b.triggers.map((x) => x.definition));
    for (const tr of t.triggers) if (!bTrg.has(tr.definition)) details.push(`trigger \`${tr.name}\``);
    if (details.length) out.push(`| \`${t.name}\` | ALTER | ${details.join("; ")} |`);
    else out.push(`| \`${t.name}\` | unchanged | |`);
  }
  for (const b of before.tables) if (!afterTables.has(b.name)) out.push(`| \`${b.name}\` | **DROP** | ${b.columns.length} columns, ${b.policies.length} policies |`);
  out.push("");

  out.push("### Functions", "");
  out.push("| Function | Change | Detail |", "|---|---|---|");
  const bFns = new Map(before.functions.map((f) => [sig(f), f]));
  const aFns = new Map(after.functions.map((f) => [sig(f), f]));
  const bByName = new Map<string, string[]>();
  for (const f of before.functions) bByName.set(f.name, [...(bByName.get(f.name) ?? []), sig(f)]);
  for (const f of after.functions) {
    const b = bFns.get(sig(f));
    if (!b) {
      const sameName = bByName.get(f.name);
      out.push(`| \`${sig(f)}\` | **CREATE** | ${sameName ? `replaces \`${sameName.join("`, `")}\`; ` : ""}executable by ${f.executableBy.join(", ") || "service_role only"} |`);
      continue;
    }
    const details: string[] = [];
    if (b.returns !== f.returns) details.push(`returns ${b.returns} → ${f.returns}`);
    if (b.securityDefiner !== f.securityDefiner) details.push(`security definer ${b.securityDefiner} → ${f.securityDefiner}`);
    if (b.executableBy.join(",") !== f.executableBy.join(",")) details.push(`executable by ${b.executableBy.join(",") || "(none)"} → ${f.executableBy.join(",") || "(none)"}`);
    out.push(`| \`${sig(f)}\` | ${details.length ? "ALTER" : "recreated"} | ${details.join("; ") || "same signature; body re-created from the baseline (auth.uid() → rainbow_uid() where applicable)"} |`);
  }
  for (const b of before.functions) if (!aFns.has(sig(b))) out.push(`| \`${sig(b)}\` | **DROP** | ${after.functions.some((f) => f.name === b.name) ? "replaced by a new signature" : "removed"} |`);
  out.push("");

  out.push("### Types", "");
  for (const t of after.types) out.push(`- \`${t.name}\`: ${before.types.some((x) => x.name === t.name) ? "unchanged" : "create"}`);
  for (const t of before.types) if (!after.types.some((x) => x.name === t.name)) out.push(`- \`${t.name}\`: drop`);
  out.push("");
  return out.join("\n");
}

function main(): number {
  const before = JSON.parse(readFileSync(BEFORE, "utf8")) as Inventory;
  const after = JSON.parse(readFileSync(AFTER, "utf8")) as Inventory;
  const md = renderChangePreview(before, after);
  const outIdx = process.argv.indexOf("--out");
  if (outIdx >= 0 && process.argv[outIdx + 1]) {
    writeFileSync(path.resolve(process.argv[outIdx + 1]), md, "utf8");
    console.log(`Wrote ${process.argv[outIdx + 1]}`);
  } else {
    console.log(md);
  }
  return 0;
}

if (process.argv[1] && /change-preview\.ts$/.test(process.argv[1].replace(/\\/g, "/"))) {
  process.exit(main());
}
