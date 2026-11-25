/**
 * 0011 My Puzzles (list_my_custom_puzzles) on disposable in-process
 * PostgreSQL. Fictional data only.
 *
 *   npm run e2e:db:my-puzzles
 *
 * Proves: additive (no data or listing change, rollback restores the exact
 * schema); owner-only from the server-side Rainbow identity (another account,
 * a guest, an auth user without a Rainbow account and the anon role get
 * nothing); every kind of own puzzle (older with no cover, Public link-only,
 * listed, Private, admin-hidden), never guest-made ones; newest first; library
 * fields only (no content or account fields); bounded, deterministic paging;
 * reading changes nothing.
 */
import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildSchemaPlan, applySchemaPlan } from "./lib/schema.ts";

const ROLLBACK = fs.readFileSync(new URL("../../supabase/ops/my-puzzles/rollback-0011.sql", import.meta.url), "utf8");
type Created = { puzzle_id: string; share_id: string; short_code: string };
type Item = Record<string, unknown> & { title: string; short_code: string };
type Page = { items: Item[]; has_more: boolean; total: number; limit: number; offset: number };

const db = new PGlite();

async function actAs(id: string | null) {
  await db.query("select set_config('request.jwt.claims',$1,false)", [id ? JSON.stringify({ sub: id, role: "authenticated" }) : ""]);
}
async function authUser() {
  const id = (await db.query<{ id: string }>("insert into auth.users default values returning id")).rows[0].id;
  const sub = "user_" + id.replaceAll("-", "");
  await db.query("insert into auth.identities(user_id,provider,provider_id,identity_data) values ($1,'custom:platform',$2,$3::jsonb)", [id, sub, JSON.stringify({ sub })]);
  return id;
}
async function account() {
  const id = await authUser();
  await actAs(id);
  await db.query("select * from public.ensure_account()");
  return id;
}
let n = 0;
async function create(as: string | null, title: string, visibility = "public", mode = "classic") {
  n++;
  const words = Array.from({ length: 16 }, (_, i) => `M${n}Q${String.fromCharCode(65 + i)}`);
  const content = { mode, groups: [0, 1, 2, 3].map((g) => ({ category: `Secret Category ${n}${g}`, words: words.slice(g * 4, g * 4 + 4), hint_word: null, category_emoji: null })), word_order: words, rainbow_herring: mode === "rainbow" ? [words[0], words[4], words[8], words[12]] : null, rainbow_category_name: mode === "rainbow" ? "Secret Rainbow" : null, rainbow_hint_word: null, rainbow_category_emoji: null, alphabetize_completed: true };
  await actAs(as);
  return (await db.query<{ r: Created }>("select public.create_custom_puzzle($1,$2,$3,$4::jsonb) as r", ["Fictional Designer", title, visibility, JSON.stringify(content)])).rows[0].r;
}
async function call<T>(as: string | null, sql: string, args: unknown[] = []): Promise<T> {
  await actAs(as);
  return (await db.query<{ r: T }>(`select ${sql} as r`, args)).rows[0].r;
}
const mine = (as: string | null, limit?: number, offset?: number) => call<Page>(as, "public.list_my_custom_puzzles($1,$2)", [limit ?? 24, offset ?? 0]);
async function rejects(p: Promise<unknown>, pattern: RegExp) {
  await assert.rejects(p, (e: Error) => pattern.test(e.message));
}
async function schema() {
  const q = async (sql: string) => (await db.query<Record<string, string>>(sql)).rows.map((r) => Object.values(r).join(" | ")).sort();
  return {
    tables: await q("select table_name from information_schema.tables where table_schema='public'"),
    columns: await q("select table_name, column_name, data_type, is_nullable, coalesce(column_default,'') from information_schema.columns where table_schema='public'"),
    indexes: await q("select indexname, indexdef from pg_indexes where schemaname='public'"),
    functions: await q("select p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)) from pg_proc p where p.pronamespace='public'::regnamespace"),
  };
}
const ROWS = "select id, share_id, short_code, title, visibility, created_by, moderation_status, community_listed, community_listed_at, cover_emoji, cover_emoji_2, cover_emoji_3, cover_background, created_at from public.custom_puzzles order by id";
const FIELDS = ["can_list", "cover_background", "cover_emoji", "cover_emoji_2", "cover_emoji_3", "created_at", "hidden", "listed", "mode", "share_id", "short_code", "title", "visibility"];

try {
  const plan = buildSchemaPlan({ includeSupabaseStubs: true, includeReset: false });
  const at = plan.findIndex((x) => x.label.includes("0011_"));
  assert.ok(at > 0, "0011 is in the migration plan");
  await applySchemaPlan(db, plan.slice(0, at));

  // ── Fictional fixtures, made before 0011 through the real RPCs ────────────
  const wren = await account();
  const odie = await account();
  const music = await create(wren, "Mixtape Memories"); // older puzzle: never listed, no cover
  await db.query("update public.custom_puzzles set created_at = '2025-03-14T10:00:00Z' where id = $1", [music.puzzle_id]);
  const listed = await create(wren, "Garden Party");
  await call(wren, "public.set_custom_puzzle_community_listing($1,true)", [listed.share_id]);
  await call(wren, "public.set_custom_puzzle_cover_emojis($1,$2,$3)", [listed.share_id, ["1F438", "1F337"], "lime-checks"]);
  const linkOnly = await create(wren, "Night Owls", "public", "rainbow");
  await call(wren, "public.set_custom_puzzle_cover_emojis($1,$2,$3)", [linkOnly.share_id, ["1F989"], "indigo-stars"]);
  const privateOne = await create(wren, "Private Parlour Games", "private");
  const hidden = await create(wren, "Moderated Mischief");
  await db.query("update public.custom_puzzles set moderation_status = 'hidden' where id = $1", [hidden.puzzle_id]);
  const odiesOwn = await create(odie, "Turn Of The Tides");
  const guestMade = await create(null, "Anonymous Airship");
  // Distinct, known creation times (newest first: hidden, private, linkOnly, listed, music).
  for (const [i, p] of [listed, linkOnly, privateOne, hidden].entries()) {
    await db.query("update public.custom_puzzles set created_at = $2 where id = $1", [p.puzzle_id, `2026-11-${20 + i}T12:00:00Z`]);
  }
  await db.query("update public.custom_puzzles set created_at = '2026-11-22T09:00:00Z' where id = $1", [odiesOwn.puzzle_id]);

  // ── 0011 is additive and reversible ───────────────────────────────────────
  const before = await schema();
  const rows = (await db.query(ROWS)).rows;
  await applySchemaPlan(db, plan.slice(at, at + 1));
  assert.deepEqual((await db.query(ROWS)).rows, rows, "0011 changes no puzzle data");

  // ── The owner's library: every kind of own puzzle, newest first ───────────
  const lib = await mine(wren);
  assert.deepEqual(lib.items.map((i) => i.title), ["Moderated Mischief", "Private Parlour Games", "Night Owls", "Garden Party", "Mixtape Memories"]);
  assert.equal(lib.total, 5);
  assert.equal(lib.has_more, false);
  for (const i of lib.items) assert.deepEqual(Object.keys(i).sort(), FIELDS, "library fields only");
  const json = JSON.stringify(lib);
  for (const leak of ["Secret Category", "Secret Rainbow", "M1QA", "Fictional Designer", wren, odie, music.puzzle_id, "word", "group", "created_by", "creator", "content"]) {
    assert.ok(!json.includes(leak), `no ${leak} in the library payload`);
  }
  const by = (t: string) => lib.items.find((i) => i.title === t)!;
  assert.deepEqual(
    [by("Mixtape Memories"), by("Garden Party"), by("Night Owls"), by("Private Parlour Games"), by("Moderated Mischief")].map((i) => [i.visibility, i.hidden, i.listed, i.can_list, i.cover_emoji, i.cover_emoji_2, i.cover_background, i.mode]),
    [
      ["public", false, false, true, null, null, null, "classic"],
      ["public", false, true, true, "1F438", "1F337", "lime-checks", "classic"],
      ["public", false, false, true, "1F989", null, "indigo-stars", "rainbow"],
      ["private", false, false, false, null, null, null, "classic"],
      ["public", true, false, false, null, null, null, "classic"],
    ],
  );
  assert.equal(by("Mixtape Memories").short_code, music.short_code);
  assert.equal(by("Mixtape Memories").share_id, music.share_id);

  // ── Nobody else's, and nothing for anyone without a Rainbow account ───────
  assert.deepEqual((await mine(odie)).items.map((i) => i.title), ["Turn Of The Tides"]);
  const fresh = await account();
  assert.deepEqual(await mine(fresh), { items: [], has_more: false, total: 0, limit: 24, offset: 0 });
  await rejects(mine(null), /sign in to see your puzzles/);
  const noAccount = await authUser(); // signed in to auth, but no Rainbow account
  await rejects(mine(noAccount), /sign in to see your puzzles/);
  assert.ok(!JSON.stringify(await mine(wren)).includes("Anonymous Airship"), "guest-made puzzles belong to nobody");
  assert.ok(!JSON.stringify(await mine(odie)).includes(guestMade.short_code));

  // ── Bounded, deterministic paging ─────────────────────────────────────────
  const paged: string[] = [];
  for (let off = 0; ; off += 2) {
    const pg = await mine(wren, 2, off);
    assert.ok(pg.items.length <= 2);
    paged.push(...pg.items.map((i) => i.title));
    if (!pg.has_more) break;
  }
  assert.deepEqual(paged, lib.items.map((i) => i.title));
  assert.equal((await mine(wren, 0)).limit, 1);
  assert.equal((await mine(wren, 1000)).limit, 48);
  assert.equal((await mine(wren, 24, -5)).offset, 0);
  assert.equal((await mine(wren, 24, 999999)).offset, 10000);
  assert.deepEqual((await mine(wren, 24, 99)).items, []);
  // Same created_at: short code breaks the tie, every time.
  await db.query("update public.custom_puzzles set created_at = '2026-11-21T12:00:00Z' where id = any($1)", [[linkOnly.puzzle_id, listed.puzzle_id]]);
  const tie = (await mine(wren)).items.filter((i) => ["Night Owls", "Garden Party"].includes(i.title)).map((i) => i.short_code);
  assert.deepEqual(tie, [...tie].sort());

  // ── Reading changes nothing ───────────────────────────────────────────────
  const snap = (await db.query(ROWS)).rows;
  for (const as of [wren, odie, fresh]) await mine(as);
  assert.deepEqual((await db.query(ROWS)).rows, snap, "reading lists, publishes or covers nothing");

  // ── Grants: authenticated only ────────────────────────────────────────────
  await actAs(null);
  await db.exec("SET ROLE anon");
  await rejects(db.query("select public.list_my_custom_puzzles()"), /permission denied/);
  await db.exec("RESET ROLE");
  await db.exec("SET ROLE authenticated");
  await actAs(wren);
  assert.equal((await db.query<{ r: Page }>("select public.list_my_custom_puzzles() as r")).rows[0].r.total, 5);
  await db.exec("RESET ROLE");

  // ── Rollback restores the exact schema and keeps every puzzle ─────────────
  const kept = (await db.query(ROWS)).rows;
  await db.exec(ROLLBACK);
  assert.deepEqual(await schema(), before, "rollback restores the pre-0011 schema exactly");
  assert.deepEqual((await db.query(ROWS)).rows, kept);

  console.log("PASS: 0011 additive and reversible; owner-only from rainbow_uid (other account, fresh account, guest, auth-only user and anon role get nothing of anyone's); older/no-cover, link-only, listed, private and hidden own puzzles, never guest-made; newest first with short-code ties; library fields only (no content, designer or account data); bounded deterministic paging; reading changes nothing.");
} finally {
  await db.close();
}
