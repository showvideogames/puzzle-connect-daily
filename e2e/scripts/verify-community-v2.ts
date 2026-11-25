/**
 * 0009 (1-3 emoji covers, 35 backgrounds, Most Liked) and 0010 (custom puzzle
 * ratings) on disposable in-process PostgreSQL. Fictional data only.
 *
 *   npm run e2e:db:v2
 */
import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildSchemaPlan, applySchemaPlan } from "./lib/schema.ts";

const db = new PGlite();
type Created = { puzzle_id: string; share_id: string; short_code: string };
type Dev = { device_id: string; device_token: string };
const catalog = JSON.parse(fs.readFileSync(new URL("../../src/lib/coverEmoji.json", import.meta.url), "utf8")) as { emoji: [string][] };
const ALL_KEYS = catalog.emoji.map((e) => e[0]);
const BACKGROUNDS = [...fs.readFileSync(new URL("../../src/lib/coverBackgrounds.ts", import.meta.url), "utf8").matchAll(/\{ key: "([a-z-]+)"/g)].map((m) => m[1]);

async function actAs(id: string | null) {
  await db.query("select set_config('request.jwt.claims',$1,false)", [id ? JSON.stringify({ sub: id, role: "authenticated" }) : ""]);
}
async function account() {
  const id = (await db.query<{ id: string }>("insert into auth.users default values returning id")).rows[0].id;
  const sub = "user_" + id.replaceAll("-", "");
  await db.query("insert into auth.identities(user_id,provider,provider_id,identity_data) values ($1,'custom:platform',$2,$3::jsonb)", [id, sub, JSON.stringify({ sub })]);
  await actAs(id);
  await db.query("select * from public.ensure_account()");
  return id;
}
let n = 0;
async function create(as: string | null, title: string, visibility = "public") {
  n++;
  const words = Array.from({ length: 16 }, (_, i) => `T${n}Z${String.fromCharCode(65 + i)}`);
  const content = { mode: "classic", groups: [0, 1, 2, 3].map((g) => ({ category: `G${n}${g}`, words: words.slice(g * 4, g * 4 + 4), hint_word: null, category_emoji: null })), word_order: words, rainbow_herring: null, rainbow_category_name: null, rainbow_hint_word: null, rainbow_category_emoji: null, alphabetize_completed: true };
  await actAs(as);
  return (await db.query<{ r: Created }>("select public.create_custom_puzzle($1,$2,$3,$4::jsonb) as r", ["Fictional Maker", title, visibility, JSON.stringify(content)])).rows[0].r;
}
async function call<T>(as: string | null, sql: string, args: unknown[] = []): Promise<T> {
  await actAs(as);
  return (await db.query<{ r: T }>(`select ${sql} as r`, args)).rows[0].r;
}
const setCover = (as: string | null, p: Created, emojis: unknown, bg: string | null) => call(as, "public.set_custom_puzzle_cover_emojis($1,$2,$3)", [p.share_id, emojis, bg]);
async function rejects(p: Promise<unknown>, pattern: RegExp) {
  await assert.rejects(p, (e: Error) => pattern.test(e.message));
}
async function device(): Promise<Dev> {
  return (await db.query<Dev>("select * from public.create_device_identity()")).rows[0];
}
async function finish(p: Created, d: Dev, won = true) {
  await db.query("select public.submit_custom_puzzle_result($1,$2,$3,$4,6::smallint,gen_random_uuid())", [p.share_id, d.device_id, d.device_token, won]);
}
const coverOf = (o: Record<string, unknown>) => [o.cover_emoji, o.cover_emoji_2, o.cover_emoji_3, o.cover_background];

try {
  const plan = buildSchemaPlan({ includeSupabaseStubs: true, includeReset: false });
  const at = plan.findIndex((x) => x.label.includes("0009_"));
  await applySchemaPlan(db, plan.slice(0, at));
  const wren = await account();
  const legacy = await create(wren, "Legacy One Emoji");
  await actAs(wren);
  await db.query("select public.set_custom_puzzle_community_listing($1,true)", [legacy.share_id]);
  await call(wren, "public.set_custom_puzzle_cover($1,$2,$3)", [legacy.share_id, "1F438", "rainbow-bands"]);
  const before = (await db.query("select id, cover_emoji, cover_background, community_listed_at from public.custom_puzzles order by id")).rows;
  await applySchemaPlan(db, plan.slice(at));

  // ── 0009: additive and compatible ─────────────────────────────────────────
  assert.deepEqual((await db.query("select id, cover_emoji, cover_background, community_listed_at from public.custom_puzzles order by id")).rows, before);
  assert.deepEqual(coverOf(await call<Record<string, unknown>>(null, "public.get_custom_puzzle($1)", [legacy.share_id])), ["1F438", null, null, "rainbow-bands"]);
  // One, two, three; the same on every payload.
  const p = await create(wren, "Multi Cover");
  await actAs(wren);
  await db.query("select public.set_custom_puzzle_community_listing($1,true)", [p.share_id]);
  const odie = await account();
  await call(odie, "public.set_custom_puzzle_favorite($1,true)", [p.share_id]);
  for (const [emojis, bg] of [[["1F989"], "indigo-stars"], [["1F438", "1F337"], "lime-checks"], [["1FA90", "1F680", "2B50-FE0F"], "lilac-dots"]] as [string[], string][]) {
    const want = [emojis[0], emojis[1] ?? null, emojis[2] ?? null, bg];
    assert.deepEqual(coverOf(await setCover(wren, p, emojis, bg) as Record<string, unknown>), want);
    assert.deepEqual(coverOf(await call<Record<string, unknown>>(null, "public.get_custom_puzzle_by_short_code($1)", [p.short_code])), want);
    const pick = (list: Record<string, unknown>[]) => coverOf(list.find((x) => x.short_code === p.short_code)!);
    assert.deepEqual(pick((await call<{ items: Record<string, unknown>[] }>(null, "public.list_community_puzzles()")).items), want);
    assert.deepEqual(pick((await call<{ items: Record<string, unknown>[] }>(null, "public.list_community_newest()")).items), want);
    assert.deepEqual(coverOf((await call<Record<string, unknown>[]>(odie, "public.get_my_favorites()"))[0]), want);
  }
  // The 0008 single-emoji call still works and means exactly one.
  await call(wren, "public.set_custom_puzzle_cover($1,$2,$3)", [p.share_id, "1F37F", "apricot-stripes"]);
  assert.deepEqual(coverOf(await call<Record<string, unknown>>(null, "public.get_custom_puzzle($1)", [p.share_id])), ["1F37F", null, null, "apricot-stripes"]);
  // Defensive: sizes, repeats, nulls, shapes, unknown keys and backgrounds, ownership.
  for (const [emojis, bg, why] of [
    [[], "lilac", /one to three emoji and one background/], [["1F438"], null, /one to three emoji and one background/],
    [["1F438", "1F337", "2B50-FE0F", "1F989"], "lilac", /at most three/], [["1F438", "1F438"], "lilac", /used once/],
    [["1F438", null], "lilac", /one to three emoji and one background/], [[["1F438"], ["1F337"]], "lilac", /simple list/],
    [["🐸"], "lilac", /not available/], [["1F438", "<b>x</b>"], "lilac", /not available/], [["1F3FB"], "lilac", /not available/],
    [["1F438"], "https://example.com/x.png", /background is not available/], [["1F438"], "neon", /background is not available/],
  ] as [unknown, string | null, RegExp][]) {
    await rejects(setCover(wren, p, emojis, bg), why);
  }
  await rejects(setCover(odie, p, ["1F438"], "lilac"), /only the puzzle's creator/);
  await rejects(setCover(null, p, ["1F438"], "lilac"), /sign in to add a cover/);
  await rejects(db.query("update public.custom_puzzles set cover_emoji_2 = null, cover_emoji_3 = '2B50-FE0F' where id = $1", [p.puzzle_id]), /custom_puzzles_cover_emoji_order/);
  await rejects(db.query("update public.custom_puzzles set cover_emoji_2 = cover_emoji where id = $1", [p.puzzle_id]), /custom_puzzles_cover_emoji_distinct/);
  // Every allowlisted key, three at a time, and every background, is accepted.
  for (let i = 0; i < ALL_KEYS.length; i += 3) {
    const batch = ALL_KEYS.slice(i, i + 3);
    await setCover(wren, p, batch, BACKGROUNDS[(i / 3) % BACKGROUNDS.length]);
  }
  for (const bg of BACKGROUNDS) await setCover(wren, p, ["1F438"], bg);
  assert.equal(BACKGROUNDS.length, 35);
  // Remove.
  assert.deepEqual(coverOf(await setCover(wren, p, null, null) as Record<string, unknown>), [null, null, null, null]);

  // ── 0009: Most Played and Most Liked over the whole listed pool ───────────
  const fans: string[] = [];
  for (let i = 0; i < 4; i++) fans.push(await account()); // one at a time: they share the session setting
  const mk = async (title: string, plays: number, likes: number) => {
    const x = await create(wren, title);
    await actAs(wren);
    await db.query("select public.set_custom_puzzle_community_listing($1,true)", [x.share_id]);
    for (let i = 0; i < plays; i++) await finish(x, await device());
    for (let i = 0; i < likes; i++) await call(fans[i], "public.set_custom_puzzle_favorite($1,true)", [x.share_id]);
    return x;
  };
  await mk("Played A Lot", 6, 0);
  await mk("Loved A Lot", 1, 4);
  await mk("In Between", 3, 2);
  const hidden = await mk("Hidden Popular", 9, 4);
  await db.query("update public.custom_puzzles set moderation_status = 'hidden' where id = $1", [hidden.puzzle_id]);
  const priv = await create(wren, "Private Loved", "private");
  for (let i = 0; i < 4; i++) await call(fans[i], "public.set_custom_puzzle_favorite($1,true)", [priv.share_id]);
  const order = async (sort: string) => (await call<{ items: { title: string }[] }>(null, "public.list_community_puzzles(null,$1,48,0)", [sort])).items.map((i) => i.title);
  const plays = await order("plays");
  const likes = await order("likes");
  const newest = await order("newest");
  assert.deepEqual(plays.slice(0, 3), ["Played A Lot", "In Between", "Loved A Lot"]);
  assert.deepEqual(likes.slice(0, 3), ["Loved A Lot", "In Between", "Multi Cover"]);
  assert.notDeepEqual(plays, likes);
  assert.deepEqual(newest.slice(0, 3), ["In Between", "Loved A Lot", "Played A Lot"]);
  assert.deepEqual(await order("anything"), newest); // default
  for (const list of [plays, likes, newest]) {
    assert.ok(!list.includes("Hidden Popular") && !list.includes("Private Loved"));
  }
  // Ties are deterministic: newest listing, then short code; paging covers everything once.
  const paged: string[] = [];
  for (let off = 0; off < likes.length; off += 2) paged.push(...(await call<{ items: { title: string }[] }>(null, "public.list_community_puzzles(null,'likes',2,$1)", [off])).items.map((i) => i.title));
  assert.deepEqual(paged, likes);
  assert.ok(!JSON.stringify(await call(null, "public.list_community_puzzles(null,'likes',48,0)")).match(/user_id|fan|follower/));

  // ── 0010: ratings ─────────────────────────────────────────────────────────
  const rateMe = await create(wren, "Rate Me");
  const pia = await account();
  const piaDev = await device();
  const rate = (as: string | null, r: unknown, d: Dev = piaDev, x: Created = rateMe) =>
    call<{ rating: number }>(as, "public.set_custom_puzzle_rating($1,$2,$3,$4)", [x.share_id, r, d.device_id, d.device_token]);
  await rejects(rate(null, 4), /sign in to rate/);
  await rejects(rate(pia, 4), /finish the puzzle to rate it/); // not finished (abandoned or never played)
  await finish(rateMe, piaDev, false); // played to the end and lost still counts as finished
  for (const bad of [0, 6, -1, null]) await rejects(rate(pia, bad), /whole number from 1 to 5/);
  await rejects(rate(pia, 3.5), /invalid input syntax|integer/);
  await rejects(rate(pia, 4, { ...piaDev, device_token: "wrong" }), /finish the puzzle to rate it/);
  const wrenDev = await device();
  await finish(rateMe, wrenDev);
  await rejects(rate(wren, 5, wrenDev), /can't rate your own puzzle/);
  assert.deepEqual(await rate(pia, 4), { rating: 4 });
  assert.deepEqual(await call(pia, "public.get_my_custom_puzzle_rating($1)", [rateMe.share_id]), { rating: 4, can_rate: true });
  assert.deepEqual(await rate(pia, 2), { rating: 2 }); // edit
  assert.deepEqual(await call(pia, "public.get_my_custom_puzzle_rating($1)", [rateMe.share_id]), { rating: 2, can_rate: true });
  assert.equal((await db.query<{ n: number }>("select count(*)::int n from public.custom_puzzle_ratings")).rows[0].n, 1);
  assert.deepEqual(await call(odie, "public.get_my_custom_puzzle_rating($1)", [rateMe.share_id]), { rating: null, can_rate: true }); // nobody else's
  assert.deepEqual(await call(wren, "public.get_my_custom_puzzle_rating($1)", [rateMe.share_id]), { rating: null, can_rate: false }); // the author
  assert.deepEqual(await call(pia, "public.get_my_custom_puzzle_rating($1)", ["nope"]), { rating: null, can_rate: false });
  await db.query("update public.custom_puzzles set moderation_status = 'hidden' where id = $1", [rateMe.puzzle_id]);
  await rejects(rate(pia, 5), /puzzle not found/);
  assert.deepEqual(await call(pia, "public.get_my_custom_puzzle_rating($1)", [rateMe.share_id]), { rating: 2, can_rate: false });
  await db.query("update public.custom_puzzles set moderation_status = 'active' where id = $1", [rateMe.puzzle_id]);
  // Ratings never reach any public payload.
  for (const sql of ["public.get_custom_puzzle($1)", "public.get_custom_puzzle_stats($1)"]) {
    assert.ok(!JSON.stringify(await call(null, sql, [rateMe.share_id])).includes("rating"), sql);
  }
  await actAs(null);
  await db.exec("SET ROLE anon");
  await rejects(db.query("select * from public.custom_puzzle_ratings"), /permission denied/);
  await rejects(db.query("select public.set_custom_puzzle_rating($1,4,'x','y')", [rateMe.share_id]), /permission denied/);
  await rejects(db.query("select public.get_my_custom_puzzle_rating($1)", [rateMe.share_id]), /permission denied/);
  await db.exec("RESET ROLE");
  await db.exec("SET ROLE authenticated");
  await actAs(pia);
  await rejects(db.query("select * from public.custom_puzzle_ratings"), /permission denied/);
  await db.exec("RESET ROLE");

  console.log(`PASS: 0009 additive (0008 covers unchanged), 1/2/3 emoji consistent on every payload, legacy call = one emoji, all ${ALL_KEYS.length} keys and ${BACKGROUNDS.length} backgrounds accepted, junk/sizes/repeats/gaps/ownership refused; Most Played vs Most Liked differ over the whole pool, deterministic paging, hidden/private excluded, Newest default; 0010 ratings: account + finish (win or loss) + not author + 1-5, edit, private, no public payload.`);
} finally {
  await db.close();
}
