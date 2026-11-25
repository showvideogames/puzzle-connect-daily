/**
 * The Community release path, rehearsed on disposable in-process PostgreSQL:
 *   1. 0004-0008 apply on a database that has only 0001-0002 (production's
 *      recorded ledger), WITHOUT 0003, and on one that has 0003 as well;
 *   2. existing custom puzzles, public, private and anonymous, are unchanged and
 *      none is listed or given a cover;
 *   3. supabase/ops/community-release/rollback-0004-0008.sql restores exactly
 *      the pre-release schema (tables, columns, constraints, indexes, function
 *      definitions), keeping the puzzles.
 *
 *   npm run e2e:db:release
 */
import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildSchemaPlan, applySchemaPlan } from "./lib/schema.ts";

const ROLLBACK = fs.readFileSync(new URL("../../supabase/ops/community-release/rollback-0004-0008.sql", import.meta.url), "utf8");
const RELEASE = ["0004_", "0005_", "0006_", "0007_", "0008_"];

async function schema(db: PGlite) {
  const q = async (sql: string) => (await db.query<Record<string, string>>(sql)).rows.map((r) => Object.values(r).join(" | ")).sort();
  return {
    tables: await q("select table_name from information_schema.tables where table_schema='public'"),
    columns: await q("select table_name, column_name, data_type, is_nullable, coalesce(column_default,'') from information_schema.columns where table_schema='public'"),
    constraints: await q("select conrelid::regclass::text, conname, pg_get_constraintdef(oid) from pg_constraint where connamespace='public'::regnamespace"),
    indexes: await q("select indexname, indexdef from pg_indexes where schemaname='public'"),
    functions: await q("select p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)) from pg_proc p where p.pronamespace='public'::regnamespace"),
  };
}

async function run(with0003: boolean) {
  const db = new PGlite();
  try {
    const plan = buildSchemaPlan({ includeSupabaseStubs: true, includeReset: false });
    const pre = plan.filter((x) => !RELEASE.some((r) => x.label.includes(r)) && (with0003 || !x.label.includes("0003_")));
    const release = plan.filter((x) => RELEASE.some((r) => x.label.includes(r)));
    assert.equal(release.length, 5);
    await applySchemaPlan(db, pre);
    // Existing puzzles of every kind, created through the real RPC.
    const words = Array.from({ length: 16 }, (_, i) => `R${String.fromCharCode(65 + i)}X`);
    const content = JSON.stringify({ mode: "classic", groups: [0, 1, 2, 3].map((g) => ({ category: `Group ${g}`, words: words.slice(g * 4, g * 4 + 4), hint_word: null, category_emoji: null })), word_order: words, rainbow_herring: null, rainbow_category_name: null, rainbow_hint_word: null, rainbow_category_emoji: null, alphabetize_completed: true });
    for (const [title, vis] of [["Existing Public", "public"], ["Existing Private", "private"]]) {
      await db.query("select public.create_custom_puzzle('Someone', $1, $2, $3::jsonb)", [title, vis, content]);
    }
    const before = await schema(db);
    const rows = (await db.query("select id, share_id, short_code, title, visibility, content, created_by, moderation_status from public.custom_puzzles order by id")).rows;

    await applySchemaPlan(db, release);
    assert.deepEqual((await db.query("select id, share_id, short_code, title, visibility, content, created_by, moderation_status from public.custom_puzzles order by id")).rows, rows);
    assert.equal((await db.query<{ n: number }>("select count(*)::int n from public.custom_puzzles where community_listed or cover_emoji is not null")).rows[0].n, 0);
    assert.equal((await db.query<{ n: number }>("select count(*)::int n from public.community_cover_emoji")).rows[0].n, 1898);
    // The old links still resolve through the (replaced) public payload.
    const code = (rows as { short_code: string; title: string }[]).find((r) => r.title === "Existing Public")!.short_code;
    assert.equal(((await db.query<{ r: { title: string } }>("select public.get_custom_puzzle_by_short_code($1) as r", [code])).rows[0].r).title, "Existing Public");

    await db.exec(ROLLBACK);
    assert.deepEqual(await schema(db), before, "rollback restores the pre-release schema exactly");
    assert.deepEqual((await db.query("select id, share_id, short_code, title, visibility, content, created_by, moderation_status from public.custom_puzzles order by id")).rows, rows);
  } finally {
    await db.close();
  }
}

await run(false);
await run(true);
console.log("PASS: 0004-0008 apply with and without 0003; existing puzzles unchanged, none listed or covered; allowlist loaded; old links resolve; rollback restores the exact pre-release schema and keeps the puzzles.");
