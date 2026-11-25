/**
 * 0012 (My Puzzles: Rename, and the owner's source for Duplicate & Edit) on
 * disposable in-process PostgreSQL. Fictional data only.
 *
 *   npm run e2e:db:my-puzzles-rename-copy
 *
 * Proves: rename changes the title only (same row id, share id, short code,
 * content, visibility, listing and listing time, cover, designer name,
 * results, stats, favourites, ratings and curation), with create's title rule;
 * guests, accounts without a Rainbow account, other accounts, hidden puzzles
 * and the anon role are refused. The source read returns the owner's own
 * content and visibility only, refuses everyone else and changes nothing.
 * Rollback restores the exact schema.
 */
import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildSchemaPlan, applySchemaPlan } from "./lib/schema.ts";

const ROLLBACK = fs.readFileSync(new URL("../../supabase/ops/my-puzzles/rollback-0012.sql", import.meta.url), "utf8");
type Created = { puzzle_id: string; share_id: string; short_code: string };
type Dev = { device_id: string; device_token: string };
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
const W = (s: string) => s.split(" ");
const BOARD = [W("ALTO BASS SOPRANO TENOR"), W("BALLAD HYMN LULLABY SHANTY"), W("CASSETTE RECORD REEL VINYL"), W("ENCORE GIG SETLIST TOUR")];
function content(mode: "classic" | "rainbow") {
  const words = BOARD.flat();
  // A board order and a Rainbow order of their own, so a copy must keep both.
  const order = [...words].reverse();
  return {
    mode,
    groups: BOARD.map((w, i) => ({ category: `Mixtape group ${i + 1}`, words: w, hint_word: i === 0 ? "Choir" : null, category_emoji: i === 1 ? "🎵" : null })),
    word_order: order,
    rainbow_herring: mode === "rainbow" ? ["REEL", "ALTO", "GIG", "HYMN"] : null,
    rainbow_category_name: mode === "rainbow" ? "Hidden mixtape" : null,
    rainbow_hint_word: null,
    rainbow_category_emoji: null,
    alphabetize_completed: true,
  };
}
async function create(as: string | null, title: string, visibility = "public", mode: "classic" | "rainbow" = "rainbow") {
  await actAs(as);
  return (await db.query<{ r: Created }>("select public.create_custom_puzzle($1,$2,$3,$4::jsonb) as r", ["Fictional Wren", title, visibility, JSON.stringify(content(mode))])).rows[0].r;
}
async function call<T>(as: string | null, sql: string, args: unknown[] = []): Promise<T> {
  await actAs(as);
  return (await db.query<{ r: T }>(`select ${sql} as r`, args)).rows[0].r;
}
async function rejects(p: Promise<unknown>, pattern: RegExp) {
  await assert.rejects(p, (e: Error) => pattern.test(e.message));
}
async function device(): Promise<Dev> {
  return (await db.query<Dev>("select * from public.create_device_identity()")).rows[0];
}
async function schema() {
  const q = async (sql: string) => (await db.query<Record<string, string>>(sql)).rows.map((r) => Object.values(r).join(" | ")).sort();
  return {
    tables: await q("select table_name from information_schema.tables where table_schema='public'"),
    columns: await q("select table_name, column_name, data_type, is_nullable, coalesce(column_default,'') from information_schema.columns where table_schema='public'"),
    indexes: await q("select indexname, indexdef from pg_indexes where schemaname='public'"),
    functions: await q("select p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)) from pg_proc p where p.pronamespace='public'::regnamespace"),
    comment: await q("select coalesce(obj_description('public.custom_puzzles'::regclass, 'pg_class'), '')"),
  };
}
/** Everything about a puzzle except its title, and everything that points at it. */
async function everythingButTitle(id: string) {
  const one = async (sql: string) => (await db.query(sql, [id])).rows;
  return {
    row: await one("select id, share_id, short_code, visibility, created_by, creator_name, moderation_status, content, created_at, community_listed, community_listed_at, cover_emoji, cover_emoji_2, cover_emoji_3, cover_background from public.custom_puzzles where id = $1"),
    stats: await one("select * from public.custom_puzzle_stats where custom_puzzle_id = $1"),
    results: await one("select * from public.custom_puzzle_results where custom_puzzle_id = $1 order by device_id"),
    favorites: await one("select * from public.custom_puzzle_favorites where custom_puzzle_id = $1 order by user_id"),
    ratings: await one("select * from public.custom_puzzle_ratings where custom_puzzle_id = $1 order by user_id"),
    curation: await one("select * from public.community_curation where custom_puzzle_id = $1"),
  };
}

try {
  const plan = buildSchemaPlan({ includeSupabaseStubs: true, includeReset: false });
  const at = plan.findIndex((x) => x.label.includes("0012_"));
  assert.ok(at > 0, "0012 is in the migration plan");
  await applySchemaPlan(db, plan.slice(0, at));

  // ── Fictional fixtures through the real RPCs ──────────────────────────────
  const wren = await account();
  const odie = await account();
  const pia = await account();
  const song = await create(wren, "Mixtape Memories");
  await call(wren, "public.set_custom_puzzle_community_listing($1,true)", [song.share_id]);
  await call(wren, "public.set_custom_puzzle_cover_emojis($1,$2,$3)", [song.share_id, ["1F3A7-FE0F"], "rainbow-bands"]);
  for (const [who, won] of [[odie, true], [pia, false]] as const) {
    const d = await device();
    await db.query("select public.submit_custom_puzzle_result($1,$2,$3,$4,6::smallint,gen_random_uuid())", [song.share_id, d.device_id, d.device_token, won]);
    await call(who, "public.set_custom_puzzle_favorite($1,true)", [song.share_id]);
    await call(who, "public.set_custom_puzzle_rating($1,$2,$3,$4)", [song.share_id, who === odie ? 5 : 3, d.device_id, d.device_token]);
  }
  const secret = await create(wren, "Private Parlour Games", "private", "classic");
  const hidden = await create(wren, "Moderated Mischief");
  await db.query("update public.custom_puzzles set moderation_status = 'hidden' where id = $1", [hidden.puzzle_id]);
  const odiesOwn = await create(odie, "Turn Of The Tides");

  const before = await schema();
  const data = (await db.query("select * from public.custom_puzzles order by id")).rows;
  await applySchemaPlan(db, plan.slice(at, at + 1));
  assert.deepEqual((await db.query("select * from public.custom_puzzles order by id")).rows, data, "0012 changes no data");

  // ── Rename: title only, same rule as create ───────────────────────────────
  const kept = await everythingButTitle(song.puzzle_id);
  assert.equal(kept.results.length, 2);
  assert.equal(kept.favorites.length, 2);
  assert.equal(kept.ratings.length, 2);
  assert.deepEqual(await call(wren, "public.rename_custom_puzzle($1,$2)", [song.share_id, "  Mixtape Memories, Side B  "]), { title: "Mixtape Memories, Side B" });
  assert.deepEqual(await everythingButTitle(song.puzzle_id), kept, "rename keeps the row, links, content, visibility, listing, cover, results, favourites and ratings");
  const pub = await call<{ title: string; content: unknown; share_id: string }>(null, "public.get_custom_puzzle_by_short_code($1)", [song.short_code]);
  assert.equal(pub.title, "Mixtape Memories, Side B");
  assert.equal(pub.share_id, song.share_id);
  assert.equal((await call<{ title: string }>(null, "public.get_custom_puzzle($1)", [song.share_id])).title, "Mixtape Memories, Side B");
  assert.ok((await call<{ items: { title: string }[] }>(null, "public.list_community_puzzles()")).items.some((i) => i.title === "Mixtape Memories, Side B"));
  const stats = await call<{ completed_plays: number }>(null, "public.get_custom_puzzle_stats($1)", [song.share_id]);
  assert.equal(stats.completed_plays, 2, "results still count");
  for (const bad of ["", "   ", null, "x".repeat(101)]) {
    await rejects(call(wren, "public.rename_custom_puzzle($1,$2)", [song.share_id, bad]), /needs a title|too long/);
  }
  assert.deepEqual(await call(wren, "public.rename_custom_puzzle($1,$2)", [secret.share_id, "y".repeat(100)]), { title: "y".repeat(100) });
  assert.equal((await db.query<{ visibility: string }>("select visibility from public.custom_puzzles where id = $1", [secret.puzzle_id])).rows[0].visibility, "private", "a private puzzle stays private");
  // Refused for everyone else, and for hidden puzzles.
  await rejects(call(odie, "public.rename_custom_puzzle($1,$2)", [song.share_id, "Odie Was Here"]), /only the puzzle's creator can rename it/);
  await rejects(call(null, "public.rename_custom_puzzle($1,$2)", [song.share_id, "Guest Was Here"]), /sign in to rename/);
  await rejects(call(await authUser(), "public.rename_custom_puzzle($1,$2)", [song.share_id, "No Account"]), /sign in to rename/);
  await rejects(call(wren, "public.rename_custom_puzzle($1,$2)", [hidden.share_id, "Back Again"]), /can't be renamed/);
  await rejects(call(wren, "public.rename_custom_puzzle($1,$2)", [odiesOwn.share_id, "Mine Now"]), /only the puzzle's creator/);
  await rejects(call(wren, "public.rename_custom_puzzle($1,$2)", ["nope", "Nothing"]), /puzzle not found/);
  assert.equal((await db.query<{ title: string }>("select title from public.custom_puzzles where id = $1", [song.puzzle_id])).rows[0].title, "Mixtape Memories, Side B");
  assert.equal((await db.query<{ title: string }>("select title from public.custom_puzzles where id = $1", [odiesOwn.puzzle_id])).rows[0].title, "Turn Of The Tides");

  // ── Source for Duplicate & Edit: the owner's own content only ─────────────
  const snap = (await db.query("select * from public.custom_puzzles order by id")).rows;
  const src = await call<{ title: string; creator_name: string; visibility: string; content: Record<string, unknown> }>(wren, "public.get_my_custom_puzzle_source($1)", [song.share_id]);
  assert.deepEqual(Object.keys(src).sort(), ["content", "creator_name", "title", "visibility"]);
  assert.equal(src.title, "Mixtape Memories, Side B");
  assert.equal(src.visibility, "public");
  assert.deepEqual(src.content.word_order, [...BOARD.flat()].reverse(), "the board order comes through as saved");
  assert.deepEqual(src.content.rainbow_herring, ["REEL", "ALTO", "GIG", "HYMN"], "the Rainbow words keep their own order");
  assert.equal((await call<{ visibility: string }>(wren, "public.get_my_custom_puzzle_source($1)", [secret.share_id])).visibility, "private");
  await rejects(call(odie, "public.get_my_custom_puzzle_source($1)", [song.share_id]), /only the puzzle's creator can copy it/);
  await rejects(call(odie, "public.get_my_custom_puzzle_source($1)", [secret.share_id]), /only the puzzle's creator can copy it/);
  await rejects(call(null, "public.get_my_custom_puzzle_source($1)", [song.share_id]), /sign in to copy/);
  await rejects(call(wren, "public.get_my_custom_puzzle_source($1)", [hidden.share_id]), /can't be copied/);
  assert.deepEqual((await db.query("select * from public.custom_puzzles order by id")).rows, snap, "reading the source changes nothing");

  // ── Grants: authenticated only ────────────────────────────────────────────
  await actAs(null);
  await db.exec("SET ROLE anon");
  await rejects(db.query("select public.rename_custom_puzzle($1,'x')", [song.share_id]), /permission denied/);
  await rejects(db.query("select public.get_my_custom_puzzle_source($1)", [song.share_id]), /permission denied/);
  await db.exec("RESET ROLE");

  // ── Rollback restores the exact schema ────────────────────────────────────
  const rows = (await db.query("select * from public.custom_puzzles order by id")).rows;
  await db.exec(ROLLBACK);
  assert.deepEqual(await schema(), before, "rollback restores the pre-0012 schema and comment exactly");
  assert.deepEqual((await db.query("select * from public.custom_puzzles order by id")).rows, rows);

  console.log("PASS: 0012 additive and reversible; rename is owner-only (guest, auth-only, other account, hidden and anon refused), uses create's title rule and changes the title only (same id, links, content, visibility, listing, cover, results, stats, favourites, ratings); the source read returns only the owner's own content and visibility (board and Rainbow orders intact), refuses everyone else and changes nothing.");
} finally {
  await db.close();
}
