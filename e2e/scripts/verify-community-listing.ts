/**
 * Community Puzzles listing rules, against the real SQL in a disposable
 * in-process PostgreSQL (PGlite). Never connects to a hosted database.
 *
 * `npm run e2e:db:community`
 *
 * Every puzzle and account here is fictional and created through the app's
 * own RPCs (create_custom_puzzle, ensure_account), with request.jwt.claims set
 * the same way auth.uid() reads it.
 */
import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import { buildSchemaPlan, applySchemaPlan } from "./lib/schema.ts";

const db = new PGlite();

const ALLOWED_KEYS = ["cover_background", "cover_emoji", "cover_emoji_2", "cover_emoji_3", "cover_sizes", "creator_name", "creator_slug", "favorite_count", "finished_plays", "listed_at", "mode", "short_code", "title"];

type Created = { puzzle_id: string; share_id: string; short_code: string };
type Feed = { items: Record<string, unknown>[]; has_more: boolean; limit: number; offset: number };

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

const WORDS = [
  ["AMBER", "BLUSH", "CORAL", "DUSK"],
  ["EMBER", "FROST", "GLOW", "HAZE"],
  ["IVORY", "JADE", "KHAKI", "LILAC"],
  ["MAUVE", "NAVY", "OCHRE", "PEACH"],
];
function content(mode: "classic" | "rainbow") {
  return {
    mode,
    groups: WORDS.map((words, i) => ({ category: `Fictional Group ${i + 1}`, words, hint_word: null, category_emoji: null })),
    word_order: WORDS.flat(),
    rainbow_herring: mode === "rainbow" ? [WORDS[0][0], WORDS[1][0], WORDS[2][0], WORDS[3][0]] : null,
    rainbow_category_name: mode === "rainbow" ? "Fictional Rainbow" : null,
    rainbow_hint_word: null,
    rainbow_category_emoji: null,
    alphabetize_completed: true,
  };
}

async function create(as: string | null, title: string, visibility: "public" | "private", creator = "Fictional Creator", mode: "classic" | "rainbow" = "classic") {
  await actAs(as);
  return (await db.query<{ r: Created }>("select public.create_custom_puzzle($1,$2,$3,$4::jsonb) as r", [creator, title, visibility, JSON.stringify(content(mode))])).rows[0].r;
}

async function setListed(as: string | null, shareId: string, listed: boolean) {
  await actAs(as);
  return (await db.query<{ r: { listed: boolean } }>("select public.set_custom_puzzle_community_listing($1,$2) as r", [shareId, listed])).rows[0].r;
}

async function feed(query: string | null = null, sort = "newest", limit = 24, offset = 0): Promise<Feed> {
  await actAs(null);
  return (await db.query<{ r: Feed }>("select public.list_community_puzzles($1,$2,$3,$4) as r", [query, sort, limit, offset])).rows[0].r;
}
const titles = async (...args: Parameters<typeof feed>) => (await feed(...args)).items.map((i) => i.title as string);

async function allSorts(query: string | null = null) {
  return [...(await titles(query, "newest", 48)), ...(await titles(query, "plays", 48))];
}

async function rejects(p: Promise<unknown>, pattern: RegExp) {
  await assert.rejects(p, (e: Error) => pattern.test(e.message));
}

async function ownerState(as: string | null, shareId: string) {
  await actAs(as);
  return (await db.query<{ r: Record<string, unknown> | null }>("select public.get_my_custom_puzzle_listing($1) as r", [shareId])).rows[0].r;
}

async function play(shareId: string, times: number) {
  for (let i = 0; i < times; i++) {
    const d = (await db.query<{ device_id: string; device_token: string }>("select * from public.create_device_identity()")).rows[0];
    await db.query("select public.submit_custom_puzzle_result($1,$2,$3,true,5::smallint,gen_random_uuid())", [shareId, d.device_id, d.device_token]);
  }
}

try {
  const plan = buildSchemaPlan({ includeSupabaseStubs: true, includeReset: false });
  // Everything before 0004, then 0004 and whatever follows it, in order.
  const at = plan.findIndex((x) => x.label.includes("0004_"));
  await applySchemaPlan(db, plan.slice(0, at));

  // Puzzles that exist BEFORE the migration: an account's public link and a
  // private link, and an anonymous public link.
  const ada = await account();
  const oldPublic = await create(ada, "Something In The Air", "public", "Ada Fictional");
  const oldPrivate = await create(ada, "Secret Fictional Private", "private", "Ada Fictional");
  const oldAnon = await create(null, "Anonymous Fictional Link", "public", "Guest Fictional");
  const snapshot = (await db.query("select id, share_id, short_code, visibility, content from public.custom_puzzles order by id")).rows;

  await applySchemaPlan(db, plan.slice(at));

  // 1. Additive: nothing changed, nothing is listed, on any sort or search.
  assert.deepEqual((await db.query("select id, share_id, short_code, visibility, content from public.custom_puzzles order by id")).rows, snapshot);
  assert.equal((await db.query<{ n: number }>("select count(*)::int n from public.custom_puzzles where community_listed")).rows[0].n, 0);
  await play(oldPublic.share_id, 3);
  assert.deepEqual(await allSorts(), []);
  assert.deepEqual(await allSorts("Air"), []);
  assert.deepEqual(await allSorts("Fictional"), []);

  // 2. Explicit opt-in by the signed-in creator lists it.
  const bo = await account();
  const offbeat = await create(bo, "A Little Offbeat", "public", "Bo Fictional", "rainbow");
  assert.deepEqual(await allSorts(), []); // created public, still not listed
  assert.deepEqual(await setListed(bo, offbeat.share_id, true), { listed: true });
  assert.deepEqual(await titles(), ["A Little Offbeat"]);

  // Payload: card fields only. No content words, ids, share id or owner.
  const item = (await feed()).items[0];
  assert.deepEqual(Object.keys(item).sort(), ALLOWED_KEYS);
  const raw = JSON.stringify(await feed());
  for (const secret of [offbeat.share_id, offbeat.puzzle_id, bo, ...WORDS.flat(), "Fictional Group", "Fictional Rainbow"]) {
    assert.ok(!raw.includes(secret), `feed leaked ${secret}`);
  }
  assert.equal(item.short_code, offbeat.short_code);
  assert.equal(item.mode, "rainbow");
  assert.match(String(item.creator_slug), /^bo-fictional-/);

  // 3. Private puzzles can never be listed, by their owner or anyone.
  await rejects(setListed(ada, oldPrivate.share_id, true), /private puzzles cannot be listed/);
  await rejects(db.query("update public.custom_puzzles set community_listed = true where id = $1", [oldPrivate.puzzle_id]), /custom_puzzles_community_requires_public/);

  // 4. An old public link appears only after its creator lists it.
  await setListed(ada, oldPublic.share_id, true);
  assert.deepEqual((await titles()).sort(), ["A Little Offbeat", "Something In The Air"]);

  // 5. Anonymous puzzles have no owner: nobody can list them.
  await rejects(setListed(null, oldAnon.share_id, true), /sign in/);
  await rejects(setListed(bo, oldAnon.share_id, true), /only the puzzle's creator/);
  assert.ok(!(await allSorts("Anonymous")).length);

  // 6. Another account cannot list or unlist someone else's puzzle.
  await rejects(setListed(bo, oldPublic.share_id, false), /only the puzzle's creator/);
  await rejects(setListed(ada, offbeat.share_id, false), /only the puzzle's creator/);
  assert.deepEqual((await titles()).sort(), ["A Little Offbeat", "Something In The Air"]);
  assert.deepEqual(await ownerState(bo, oldPublic.share_id), { owned: false });
  assert.deepEqual(await ownerState(null, oldPublic.share_id), { owned: false });
  assert.deepEqual(await ownerState(ada, oldPublic.share_id), { owned: true, listed: true, can_list: true, visibility: "public" });
  assert.deepEqual(await ownerState(ada, oldPrivate.share_id), { owned: true, listed: false, can_list: false, visibility: "private" });
  await rejects(setListed(ada, "no-such-share-id", true), /puzzle not found/);

  // Search: title, typed designer name, profile display name; literal only.
  const usual = await create(ada, "The Usual Suspects", "public", "Ada Fictional");
  await setListed(ada, usual.share_id, true);
  assert.deepEqual(await titles("usual"), ["The Usual Suspects"]);
  assert.deepEqual((await titles("ADA fict")).sort(), ["Something In The Air", "The Usual Suspects"]);
  assert.deepEqual(await titles("Bo Fictional"), ["A Little Offbeat"]);
  assert.deepEqual(await titles("%"), []);
  assert.deepEqual(await titles("_"), []);
  assert.deepEqual(await titles("   "), (await titles()));
  assert.deepEqual(await titles("x".repeat(500)), []); // long query is truncated, not an error
  assert.deepEqual(await titles("Secret"), []); // private never matches

  // Most Played: real finished-play counts, ties by newest listing.
  await play(usual.share_id, 5);
  await play(offbeat.share_id, 1);
  assert.deepEqual(await titles(null, "plays"), ["The Usual Suspects", "Something In The Air", "A Little Offbeat"]);
  assert.deepEqual((await feed(null, "plays")).items.map((i) => i.finished_plays), [5, 3, 1]);
  assert.deepEqual(await titles(null, "newest"), ["The Usual Suspects", "Something In The Air", "A Little Offbeat"]); // by listing time, not creation time
  assert.deepEqual(await titles(null, "anything-else"), await titles(null, "newest"));

  // 7. Unlisting removes it from every sort and search; its links still play.
  await setListed(ada, usual.share_id, false);
  assert.ok(!(await allSorts()).includes("The Usual Suspects"));
  assert.ok(!(await allSorts("Usual")).includes("The Usual Suspects"));
  await actAs(null);
  const viaShort = (await db.query<{ r: { title: string } | null }>("select public.get_custom_puzzle_by_short_code($1) as r", [usual.short_code])).rows[0].r;
  const viaLong = (await db.query<{ r: { title: string } | null }>("select public.get_custom_puzzle($1) as r", [usual.share_id])).rows[0].r;
  assert.equal(viaShort?.title, "The Usual Suspects");
  assert.equal(viaLong?.title, "The Usual Suspects");
  // Re-listing keeps its first listing time: no bumping to the top of Newest.
  const firstAt = (await db.query<{ t: string }>("select community_listed_at::text t from public.custom_puzzles where id=$1", [usual.puzzle_id])).rows[0].t;
  await setListed(ada, usual.share_id, true);
  await setListed(ada, usual.share_id, true); // idempotent set
  assert.equal((await db.query<{ t: string }>("select community_listed_at::text t from public.custom_puzzles where id=$1", [usual.puzzle_id])).rows[0].t, firstAt);

  // 8. Moderation: an admin-hidden puzzle drops out even with its flag set.
  await db.query("update public.custom_puzzles set moderation_status='hidden' where id=$1", [offbeat.puzzle_id]);
  assert.ok(!(await allSorts()).includes("A Little Offbeat"));
  assert.ok(!(await allSorts("Offbeat")).length);
  await rejects(setListed(bo, offbeat.share_id, true), /cannot be listed/);
  assert.deepEqual(await setListed(bo, offbeat.share_id, false), { listed: false }); // owner may still unlist
  await db.query("update public.custom_puzzles set moderation_status='active' where id=$1", [offbeat.puzzle_id]);
  assert.ok(!(await allSorts()).includes("A Little Offbeat"));

  // 9. Account deletion: rows lose their owner and leave the feed; no error.
  const cy = await account();
  const cyPuzzle = await create(cy, "Fictional Departing Puzzle", "public", "Cy Fictional");
  await setListed(cy, cyPuzzle.share_id, true);
  assert.ok((await titles()).includes("Fictional Departing Puzzle"));
  await actAs(cy);
  await db.query("select public.delete_my_account()");
  assert.ok(!(await allSorts()).includes("Fictional Departing Puzzle"));

  // Pagination: bounded page size and offset, has_more, deterministic order.
  const dee = await account();
  for (let i = 0; i < 60; i++) {
    const p = await create(dee, `Fictional Bulk ${String(i).padStart(2, "0")}`, "public", "Dee Fictional");
    await setListed(dee, p.share_id, true);
  }
  const big = await feed("Bulk", "newest", 1000, 0);
  assert.equal(big.limit, 48);
  assert.equal(big.items.length, 48);
  assert.equal(big.has_more, true);
  const rest = await feed("Bulk", "newest", 48, 48);
  assert.equal(rest.items.length, 12);
  assert.equal(rest.has_more, false);
  assert.equal(new Set([...big.items, ...rest.items].map((i) => i.short_code)).size, 60);
  assert.equal((await feed(null, "newest", -5, -5)).limit, 1);
  assert.equal((await feed(null, "newest", 24, 10 ** 9)).offset, 2000);

  // Grants: guests may browse; only signed-in accounts may change listings.
  await actAs(null);
  await db.exec("SET ROLE anon");
  assert.ok(((await db.query<{ r: Feed }>("select public.list_community_puzzles() as r")).rows[0].r.items.length) > 0);
  await rejects(db.query("select public.set_custom_puzzle_community_listing($1,false)", [oldPublic.share_id]), /permission denied/);
  await rejects(db.query("select public.get_my_custom_puzzle_listing($1)", [oldPublic.share_id]), /permission denied/);
  await rejects(db.query("select community_listed from public.custom_puzzles"), /permission denied/);
  await db.exec("RESET ROLE");
  await db.exec("SET ROLE authenticated");
  await actAs(bo);
  await rejects(db.query("update public.custom_puzzles set community_listed=false"), /permission denied/);
  await db.exec("RESET ROLE");

  console.log(
    "PASS: additive default (old public/private/anon links unlisted), explicit opt-in, card-only payload, private/anon/hidden/deleted excluded on every sort and search, " +
      "owner-only list/unlist, links survive unlisting, no re-list bump, literal bounded search, Most Played counts, bounded pagination, grants."
  );
} finally {
  await db.close();
}
