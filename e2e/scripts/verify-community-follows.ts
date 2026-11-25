/**
 * Community Puzzles part 2 (creator discovery, Follow, Following, card lookups
 * for Favorites) against the real SQL in a disposable in-process PostgreSQL
 * (PGlite). Never connects to a hosted database. Fictional data only.
 *
 * `npm run e2e:db:follows`
 */
import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import { buildSchemaPlan, applySchemaPlan } from "./lib/schema.ts";

const db = new PGlite();
const CARD_KEYS = ["creator_name", "creator_slug", "favorite_count", "finished_plays", "listed_at", "mode", "short_code", "title"];
const CREATOR_KEYS = ["display_name", "followed_by_me", "follower_count", "is_me", "listed_count", "public_slug"];
type Created = { puzzle_id: string; share_id: string; short_code: string };
type Card = Record<string, unknown> & { title: string; short_code: string };
type Creator = Record<string, unknown> & { display_name: string; public_slug: string; follower_count: number; followed_by_me: boolean; listed_count: number };

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
function content() {
  n++;
  const words = Array.from({ length: 16 }, (_, i) => `W${n}X${String.fromCharCode(65 + i)}`);
  return {
    mode: "classic",
    groups: [0, 1, 2, 3].map((g) => ({ category: `Secret Group ${n}-${g}`, words: words.slice(g * 4, g * 4 + 4), hint_word: null, category_emoji: null })),
    word_order: words, rainbow_herring: null, rainbow_category_name: null, rainbow_hint_word: null, rainbow_category_emoji: null, alphabetize_completed: true,
  };
}
async function create(as: string | null, title: string, creator: string, visibility: "public" | "private" = "public") {
  await actAs(as);
  return (await db.query<{ r: Created }>("select public.create_custom_puzzle($1,$2,$3,$4::jsonb) as r", [creator, title, visibility, JSON.stringify(content())])).rows[0].r;
}
async function list(as: string, p: Created, listed = true) {
  await actAs(as);
  await db.query("select public.set_custom_puzzle_community_listing($1,$2)", [p.share_id, listed]);
}
async function call<T>(as: string | null, sql: string, args: unknown[] = []): Promise<T> {
  await actAs(as);
  return (await db.query<{ r: T }>(`select ${sql} as r`, args)).rows[0].r;
}
const creators = (as: string | null, q: string | null = null) => call<{ items: Creator[]; has_more: boolean }>(as, "public.search_community_creators($1)", [q]);
const names = async (as: string | null, q: string | null = null) => (await creators(as, q)).items.map((c) => c.display_name);
const follow = (as: string | null, slug: string, on = true) => call<{ following: boolean; follower_count: number }>(as, "public.set_creator_follow($1,$2)", [slug, on]);
const feed = (as: string) => call<{ items: Card[]; creators: Creator[]; has_more: boolean }>(as, "public.get_following_feed()");
const feedTitles = async (as: string) => (await feed(as)).items.map((i) => i.title);
const explore = async () => (await call<{ items: Card[] }>(null, "public.list_community_puzzles(null,'newest',48,0)")).items.map((i) => i.title);
async function rejects(p: Promise<unknown>, pattern: RegExp) {
  await assert.rejects(p, (e: Error) => pattern.test(e.message));
}
const slugOf = async (uid: string) => (await db.query<{ s: string }>("select public_slug s from public.creator_profiles where user_id=$1", [uid])).rows[0].s;

try {
  const plan = buildSchemaPlan({ includeSupabaseStubs: true, includeReset: false });
  const at = plan.findIndex((x) => x.label.includes("0005_"));
  await applySchemaPlan(db, plan.slice(0, at));

  const wren = await account();
  const offbeat = await create(wren, "A Little Offbeat", "Wren Halloway");
  const pantry = await create(wren, "Pantry Raid", "Wren Halloway");
  const wrenOldLink = await create(wren, "Wren Old Link", "Wren Halloway"); // public, never listed
  const wrenPrivate = await create(wren, "Wren Private", "Wren Halloway", "private");
  await list(wren, offbeat);
  await list(wren, pantry);
  const quin = await account(); // a creator with only an unlisted public puzzle
  await create(quin, "Quiet Quarry", "Quin Ferro");
  const anonPuzzle = await create(null, "Anonymous Airship", "Guest Puzzler");
  const before = (await db.query("select id, community_listed, community_listed_at from public.custom_puzzles order by id")).rows;

  await applySchemaPlan(db, plan.slice(at));
  assert.deepEqual((await db.query("select id, community_listed, community_listed_at from public.custom_puzzles order by id")).rows, before);
  assert.equal((await db.query<{ n: number }>("select count(*)::int n from public.creator_follows")).rows[0].n, 0);

  const pia = await account();
  await create(pia, "Pia Setup", "Pia Lindqvist"); // gives Pia a profile, unlisted
  const piaSlug = await slugOf(pia);
  const wrenSlug = await slugOf(wren);
  const quinSlug = await slugOf(quin);

  // Creator discovery: only creators with a puzzle in Community now.
  assert.deepEqual(await names(null), ["Wren Halloway"]);
  assert.deepEqual(await names(null, "wren"), ["Wren Halloway"]);
  assert.deepEqual(await names(null, wrenSlug.slice(-4)), ["Wren Halloway"]); // slug match
  assert.deepEqual(await names(null, "Quin"), []); // only an unlisted public puzzle
  assert.deepEqual(await names(null, quinSlug), []);
  assert.deepEqual(await names(null, "Guest"), []); // anonymous puzzles have no creator profile
  assert.deepEqual(await names(null, "%"), []);
  assert.deepEqual(await names(null, "Offbeat"), []); // creator search is names/slugs, not titles
  const c = (await creators(null)).items[0];
  assert.deepEqual(Object.keys(c).sort(), CREATOR_KEYS);
  assert.equal(c.listed_count, 2);
  assert.equal(c.follower_count, 0);
  const rawCreators = JSON.stringify(await creators(null));
  for (const secret of [wren, offbeat.share_id, offbeat.puzzle_id, "Secret Group"]) assert.ok(!rawCreators.includes(secret), `creator search leaked ${secret}`);

  // Follow: account only, not yourself, needs a creator with puzzles in Community.
  await rejects(follow(null, wrenSlug), /sign in to follow/);
  await rejects(follow(wren, wrenSlug), /cannot follow yourself/);
  await rejects(follow(pia, quinSlug), /no puzzles in Community yet/);
  await rejects(follow(pia, "no-such-creator"), /creator not found/);
  assert.deepEqual(await follow(pia, wrenSlug), { following: true, follower_count: 1 });
  assert.deepEqual(await follow(pia, wrenSlug), { following: true, follower_count: 1 }); // set, not toggle
  // Others see only the aggregate count, and their own (false) follow state.
  const asQuin = (await creators(quin)).items[0];
  assert.equal(asQuin.follower_count, 1);
  assert.equal(asQuin.followed_by_me, false);
  assert.equal((await creators(pia)).items[0].followed_by_me, true);
  const profile = await call<Record<string, unknown>>(null, "public.get_creator_community($1)", [wrenSlug]);
  assert.deepEqual(Object.keys(profile).sort(), [...CREATOR_KEYS, "puzzles"].sort());
  assert.ok(!JSON.stringify(profile).includes(pia), "creator page leaked a follower");
  assert.ok(!JSON.stringify(profile).includes(piaSlug), "creator page leaked a follower");
  assert.equal((await call<Record<string, unknown>>(wren, "public.get_creator_community($1)", [wrenSlug])).is_me, true);
  assert.equal(await call(null, "public.get_creator_community($1)", ["no-such-creator"]), null);

  // Following: newest listing first, only puzzles in Community now.
  assert.deepEqual(await feedTitles(pia), ["Pantry Raid", "A Little Offbeat"]);
  const fp = await feed(pia);
  assert.deepEqual(Object.keys(fp.items[0]).sort(), CARD_KEYS);
  assert.deepEqual(fp.creators.map((x) => x.public_slug), [wrenSlug]);
  for (const t of ["Wren Old Link", "Wren Private"]) assert.ok(!(await feedTitles(pia)).includes(t)); // never auto-listed
  assert.deepEqual(await feedTitles(quin), []); // follows nobody
  // A newly listed puzzle appears at the top.
  const tides = await create(wren, "Turn Of The Tides", "Wren Halloway");
  assert.ok(!(await feedTitles(pia)).includes("Turn Of The Tides"));
  await list(wren, tides);
  assert.equal((await feedTitles(pia))[0], "Turn Of The Tides");

  // Pia saves Pantry Raid (existing account Favorites) before it is unlisted.
  await call(pia, "public.set_custom_puzzle_favorite($1,true)", [pantry.share_id]);
  // Unlist: gone from Following, Explore, the creator's Community view; link and save intact.
  await list(wren, pantry, false);
  assert.ok(!(await feedTitles(pia)).includes("Pantry Raid"));
  assert.ok(!(await explore()).includes("Pantry Raid"));
  assert.ok(!JSON.stringify(await call(null, "public.get_creator_community($1)", [wrenSlug])).includes("Pantry Raid"));
  assert.equal((await call<{ title: string }>(null, "public.get_custom_puzzle_by_short_code($1)", [pantry.short_code])).title, "Pantry Raid");
  assert.equal((await call<{ title: string }>(null, "public.get_custom_puzzle($1)", [pantry.share_id])).title, "Pantry Raid");
  assert.ok((await call<{ title: string }[]>(pia, "public.get_my_favorites()")).some((f) => f.title === "Pantry Raid"));
  assert.equal((await creators(null)).items[0].listed_count, 2);

  // Unlisting everything removes the creator from search; the follow stays, unfollow still works.
  await list(wren, offbeat, false);
  await list(wren, tides, false);
  assert.deepEqual(await names(null), []);
  assert.deepEqual(await feedTitles(pia), []);
  assert.deepEqual((await feed(pia)).creators.map((x) => x.listed_count), [0]);
  assert.deepEqual(await follow(pia, wrenSlug, false), { following: false, follower_count: 0 });
  assert.deepEqual((await feed(pia)).creators, []);
  await list(wren, offbeat);
  await follow(pia, wrenSlug);

  // Admin hide drops a puzzle from Following and creator search counts.
  await db.query("update public.custom_puzzles set moderation_status='hidden' where id=$1", [offbeat.puzzle_id]);
  assert.deepEqual(await feedTitles(pia), []);
  assert.deepEqual(await names(null), []);
  await db.query("update public.custom_puzzles set moderation_status='active' where id=$1", [offbeat.puzzle_id]);
  assert.deepEqual(await feedTitles(pia), ["A Little Offbeat"]);

  // Guest bookmark lookups: cards for share ids the guest holds, any visibility
  // or listing, never hidden; order kept; card fields only; bounded.
  const cards = await call<Card[]>(null, "public.get_custom_puzzle_cards($1)", [[wrenPrivate.share_id, wrenOldLink.share_id, pantry.share_id, anonPuzzle.share_id, "missing"]]);
  assert.deepEqual(cards.map((x) => x.title), ["Wren Private", "Wren Old Link", "Pantry Raid", "Anonymous Airship"]);
  assert.deepEqual(Object.keys(cards[0]).sort(), [...CARD_KEYS, "share_id"].sort());
  assert.deepEqual(cards.map((x) => x.share_id), [wrenPrivate.share_id, wrenOldLink.share_id, pantry.share_id, anonPuzzle.share_id]); // only the caller's own input
  assert.ok(!JSON.stringify(cards).includes("Secret Group"));
  assert.ok(!JSON.stringify(cards).includes(offbeat.share_id));
  await db.query("update public.custom_puzzles set moderation_status='hidden' where id=$1", [wrenOldLink.puzzle_id]);
  assert.deepEqual((await call<Card[]>(null, "public.get_custom_puzzle_cards($1)", [[wrenOldLink.share_id]])), []);
  assert.equal(await call(null, "public.custom_puzzle_share_id($1)", [wrenOldLink.short_code]), null);
  await db.query("update public.custom_puzzles set moderation_status='active' where id=$1", [wrenOldLink.puzzle_id]);
  assert.equal(await call(null, "public.custom_puzzle_share_id($1)", [pantry.short_code]), pantry.share_id);
  assert.equal((await call<Card[]>(null, "public.get_custom_puzzle_cards($1)", [Array(500).fill(pantry.share_id)])).length, 200);

  // Account deletion removes follows on both sides.
  const dee = await account();
  await follow(dee, wrenSlug);
  assert.equal((await creators(null)).items[0].follower_count, 2);
  await actAs(dee);
  await db.query("select public.delete_my_account()");
  assert.equal((await creators(null)).items[0].follower_count, 1);

  // Grants: guests browse creators and creator pages; never the follow table,
  // following feeds or follow changes.
  await actAs(null);
  await db.exec("SET ROLE anon");
  assert.ok((await db.query<{ r: { items: unknown[] } }>("select public.search_community_creators() as r")).rows[0].r.items.length > 0);
  await rejects(db.query("select * from public.creator_follows"), /permission denied/);
  await rejects(db.query("select public.get_following_feed()"), /permission denied/);
  await rejects(db.query("select public.set_creator_follow($1,true)", [wrenSlug]), /permission denied/);
  await rejects(db.query("select public.custom_puzzle_card_json(cp) from public.custom_puzzles cp"), /permission denied/);
  await db.exec("RESET ROLE");
  await db.exec("SET ROLE authenticated");
  await actAs(pia);
  await rejects(db.query("select * from public.creator_follows"), /permission denied/);
  await db.exec("RESET ROLE");

  console.log(
    "PASS: additive (no listing changes), creator search by name/slug requires a puzzle in Community now, follow is account-only/one-way/not-self, " +
      "aggregate follower counts only, Following newest-first with only listed puzzles, unlist/hide removes from Following/Explore/search while links and saves survive, " +
      "guest bookmark card lookups, account deletion cascades, grants."
  );
} finally {
  await db.close();
}
