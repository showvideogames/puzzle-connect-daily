/**
 * Creator covers (0008) against the real SQL in a disposable in-process
 * PostgreSQL (PGlite): additive, keys-only, allowlisted, owner-only, and
 * independent of listing, links and curation. Fictional data only.
 *
 *   npm run e2e:db:covers
 */
import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildSchemaPlan, applySchemaPlan } from "./lib/schema.ts";

const db = new PGlite();
type Created = { puzzle_id: string; share_id: string; short_code: string };
const catalog = JSON.parse(fs.readFileSync(new URL("../../src/lib/coverEmoji.json", import.meta.url), "utf8")) as { emoji: [string, string, number, string][] };
/** 0008's own 24 background keys (0009 widens the list; see verify-community-v2.ts). */
const BACKGROUNDS = ["lilac", "butter", "mint", "sunflower", "tangerine", "coral", "bubblegum", "ocean", "forest", "charcoal", "lime-checks", "apricot-stripes", "lilac-dots", "indigo-stars", "teal-waves", "pink-waves", "sky-grid", "cream-confetti", "berry-stripes", "cherry-polka", "sunset-split", "peach-rings", "mint-checks", "rainbow-bands"];

async function actAs(id: string | null) {
  await db.query("select set_config('request.jwt.claims',$1,false)", [id ? JSON.stringify({ sub: id, role: "authenticated" }) : ""]);
}
async function account(admin = false) {
  const id = (await db.query<{ id: string }>("insert into auth.users default values returning id")).rows[0].id;
  const sub = "user_" + id.replaceAll("-", "");
  await db.query("insert into auth.identities(user_id,provider,provider_id,identity_data) values ($1,'custom:platform',$2,$3::jsonb)", [id, sub, JSON.stringify({ sub })]);
  await actAs(id);
  await db.query("select * from public.ensure_account()");
  if (admin) await db.query("insert into public.user_roles(user_id, role) values ($1,'admin')", [id]);
  return id;
}
let n = 0;
async function create(as: string | null, title: string, visibility = "public") {
  n++;
  const words = Array.from({ length: 16 }, (_, i) => `V${n}Q${String.fromCharCode(65 + i)}`);
  const content = { mode: "classic", groups: [0, 1, 2, 3].map((g) => ({ category: `G${n}${g}`, words: words.slice(g * 4, g * 4 + 4), hint_word: null, category_emoji: null })), word_order: words, rainbow_herring: null, rainbow_category_name: null, rainbow_hint_word: null, rainbow_category_emoji: null, alphabetize_completed: true };
  await actAs(as);
  return (await db.query<{ r: Created }>("select public.create_custom_puzzle($1,$2,$3,$4::jsonb) as r", ["Fictional Maker", title, visibility, JSON.stringify(content)])).rows[0].r;
}
async function call<T>(as: string | null, sql: string, args: unknown[] = []): Promise<T> {
  await actAs(as);
  return (await db.query<{ r: T }>(`select ${sql} as r`, args)).rows[0].r;
}
const setCover = (as: string | null, p: Created, emoji: string | null, bg: string | null) => call(as, "public.set_custom_puzzle_cover($1,$2,$3)", [p.share_id, emoji, bg]);
async function rejects(p: Promise<unknown>, pattern: RegExp) {
  await assert.rejects(p, (e: Error) => pattern.test(e.message));
}

try {
  const plan = buildSchemaPlan({ includeSupabaseStubs: true, includeReset: false });
  const at = plan.findIndex((x) => x.label.includes("0008_"));
  await applySchemaPlan(db, plan.slice(0, at));
  const wren = await account();
  const old = await create(wren, "Old Public Puzzle");
  const oldPrivate = await create(wren, "Old Private Puzzle", "private");
  const anonOld = await create(null, "Old Anonymous Puzzle");
  await actAs(wren);
  await db.query("select public.set_custom_puzzle_community_listing($1,true)", [old.share_id]);
  const before = (await db.query("select id, share_id, short_code, title, content, visibility, community_listed, community_listed_at from public.custom_puzzles order by id")).rows;
  await applySchemaPlan(db, plan.slice(at, at + 1)); // exactly 0008; later migrations have their own checks

  // Additive: nothing existing changes, every existing puzzle has no cover.
  assert.deepEqual((await db.query("select id, share_id, short_code, title, content, visibility, community_listed, community_listed_at from public.custom_puzzles order by id")).rows, before);
  assert.equal((await db.query<{ n: number }>("select count(*)::int n from public.custom_puzzles where cover_emoji is not null or cover_background is not null")).rows[0].n, 0);
  // The server allowlist is exactly the picker's catalog; backgrounds match the app's presets.
  const keys = (await db.query<{ key: string }>("select key from public.community_cover_emoji order by key")).rows.map((r) => r.key);
  assert.deepEqual(keys, catalog.emoji.map((e) => e[0]).sort());
  assert.ok(keys.length > 1800, `near-full repertoire (${keys.length})`);
  for (const k of ["1F438", "1F989", "1F37F", "1FA90", "263A-FE0F", "1F3F3-FE0F-200D-1F308", "1F1EF-1F1F5", "1F3F4-E0067-E0062-E0065-E006E-E0067-E007F", "1F468-200D-1F469-200D-1F467"]) assert.ok(keys.includes(k), `allowlist has ${k}`);
  assert.equal(BACKGROUNDS.length, 24);
  const checkDef = (await db.query<{ d: string }>("select pg_get_constraintdef(oid) d from pg_constraint where conname = 'custom_puzzles_cover_background_check'")).rows[0].d;
  for (const b of BACKGROUNDS) assert.ok(checkDef.includes(`'${b}'`), `background ${b} allowed by the server`);
  assert.equal([...checkDef.matchAll(/'([a-z-]+)'::text/g)].length, 24);

  // Payloads carry the two keys (null = no cover) on old puzzles.
  const pub = await call<Record<string, unknown>>(null, "public.get_custom_puzzle($1)", [old.share_id]);
  assert.equal(pub.cover_emoji, null);
  assert.equal(pub.cover_background, null);
  const feed = await call<{ items: Record<string, unknown>[] }>(null, "public.list_community_puzzles()");
  assert.deepEqual(Object.keys(feed.items[0]).sort(), ["cover_background", "cover_emoji", "creator_name", "creator_slug", "favorite_count", "finished_plays", "listed_at", "mode", "short_code", "title"]);

  // Owner only, keys only, both or neither.
  await rejects(setCover(null, old, "1F438", "lime-checks"), /sign in to add a cover/);
  const odie = await account();
  await rejects(setCover(odie, old, "1F438", "lime-checks"), /only the puzzle's creator/);
  await rejects(setCover(wren, anonOld, "1F438", "lime-checks"), /only the puzzle's creator/);
  await rejects(setCover(wren, old, "1F438", null), /one emoji and one background/);
  await rejects(setCover(wren, old, null, "lime-checks"), /one emoji and one background/);
  for (const bad of ["🐸", "frog", "1F438 1F989", "1F438,1F989", "<img src=x>", "1F438-1F989", "1FAE9", "1F3FB", "1F1E6"]) {
    await rejects(setCover(wren, old, bad, "lime-checks"), /not available for covers/);
  }
  for (const bad of ["https://example.com/a.png", "url(x)", "#ff0000", "lime", "Lime-Checks"]) {
    await rejects(setCover(wren, old, "1F438", bad), /background is not available/);
  }
  await rejects(setCover(wren, { ...old, share_id: "missing" }, "1F438", "lime-checks"), /puzzle not found/);
  // Even a direct write can't store anything outside the allowlists.
  await rejects(db.query("update public.custom_puzzles set cover_emoji = 'NOT-A-KEY', cover_background = 'lilac' where id = $1", [old.puzzle_id]), /violates/);
  await rejects(db.query("update public.custom_puzzles set cover_emoji = '1F438', cover_background = 'neon' where id = $1", [old.puzzle_id]), /violates/);
  await rejects(db.query("update public.custom_puzzles set cover_emoji = '1F438' where id = $1", [old.puzzle_id]), /custom_puzzles_cover_pair/);

  // Set: appears identically on the card feeds, the puzzle payload and favourites.
  assert.deepEqual(await setCover(wren, old, "1F438", "lime-checks"), { cover_emoji: "1F438", cover_background: "lime-checks" });
  const want = { cover_emoji: "1F438", cover_background: "lime-checks" };
  const pick = (o: Record<string, unknown>) => ({ cover_emoji: o.cover_emoji, cover_background: o.cover_background });
  assert.deepEqual(pick(await call<Record<string, unknown>>(null, "public.get_custom_puzzle_by_short_code($1)", [old.short_code])), want);
  assert.deepEqual(pick((await call<{ items: Record<string, unknown>[] }>(null, "public.list_community_puzzles()")).items[0]), want);
  assert.deepEqual(pick((await call<{ items: Record<string, unknown>[] }>(null, "public.list_community_newest()")).items[0]), want);
  await call(odie, "public.set_custom_puzzle_favorite($1,true)", [old.share_id]);
  assert.deepEqual(pick((await call<Record<string, unknown>[]>(odie, "public.get_my_favorites()"))[0]), want);
  // A private, unlisted puzzle can have a cover too; it still never appears in Community.
  await setCover(wren, oldPrivate, "1F37F", "apricot-stripes");
  assert.ok(!JSON.stringify(await call(null, "public.list_community_newest()")).includes(oldPrivate.short_code));
  assert.equal((await call<Record<string, unknown>>(null, "public.get_custom_puzzle($1)", [oldPrivate.share_id])).cover_emoji, "1F37F");
  // Covers never touch listing, links or visibility; unlisting keeps the cover for its link.
  await actAs(wren);
  await db.query("select public.set_custom_puzzle_community_listing($1,false)", [old.share_id]);
  assert.equal((await call<Record<string, unknown>>(null, "public.get_custom_puzzle_by_short_code($1)", [old.short_code])).cover_emoji, "1F438");
  await actAs(wren);
  await db.query("select public.set_custom_puzzle_community_listing($1,true)", [old.share_id]);
  // Editorial curation is unchanged by covers (and covers aren't editorial).
  const admin = await account(true);
  await call(admin, "public.admin_set_community_curation($1,$2)", [old.short_code, []]);
  assert.equal((await call<{ featured: { title: string } }>(null, "public.get_community_explore()")).featured.title, "Old Public Puzzle");
  // Remove: back to the standard cover.
  assert.deepEqual(await setCover(wren, old, null, null), { cover_emoji: null, cover_background: null });
  assert.equal((await call<Record<string, unknown>>(null, "public.get_custom_puzzle($1)", [old.share_id])).cover_emoji, null);

  // Grants: guests can't set covers or read the allowlist table directly.
  await actAs(null);
  await db.exec("SET ROLE anon");
  await rejects(db.query("select public.set_custom_puzzle_cover($1,'1F438','lilac')", [old.share_id]), /permission denied/);
  await rejects(db.query("select * from public.community_cover_emoji"), /permission denied/);
  await db.exec("RESET ROLE");

  console.log(`PASS: additive (old puzzles unchanged, no cover), allowlist = picker catalog (${keys.length} emoji, 24 backgrounds), owner-only, keys only (no text/markup/URLs/multiple), both-or-neither, consistent on feeds/puzzle/favourites, private/unlisted unaffected, curation unchanged, remove, grants.`);
} finally {
  await db.close();
}
