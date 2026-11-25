/**
 * Community part 3 (admin curation and keyset Newest) against the real SQL in
 * a disposable in-process PostgreSQL (PGlite). Never connects to a hosted
 * database. Fictional data only.
 *
 * `npm run e2e:db:curation`
 */
import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import { buildSchemaPlan, applySchemaPlan } from "./lib/schema.ts";

const db = new PGlite();
type Created = { puzzle_id: string; share_id: string; short_code: string };
type Card = { title: string; short_code: string; listed_at: string };
type Explore = { featured: Card | null; picks: Card[] };
type Newest = { items: Card[]; has_more: boolean; limit: number };

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
  const words = Array.from({ length: 16 }, (_, i) => `C${n}Y${String.fromCharCode(65 + i)}`);
  const content = {
    mode: "classic",
    groups: [0, 1, 2, 3].map((g) => ({ category: `Hidden Group ${n}-${g}`, words: words.slice(g * 4, g * 4 + 4), hint_word: null, category_emoji: null })),
    word_order: words, rainbow_herring: null, rainbow_category_name: null, rainbow_hint_word: null, rainbow_category_emoji: null, alphabetize_completed: true,
  };
  await actAs(as);
  return (await db.query<{ r: Created }>("select public.create_custom_puzzle($1,$2,$3,$4::jsonb) as r", ["Fictional Maker", title, visibility, JSON.stringify(content)])).rows[0].r;
}
async function list(as: string, p: Created, on = true) {
  await actAs(as);
  await db.query("select public.set_custom_puzzle_community_listing($1,$2)", [p.share_id, on]);
}
async function call<T>(as: string | null, sql: string, args: unknown[] = []): Promise<T> {
  await actAs(as);
  return (await db.query<{ r: T }>(`select ${sql} as r`, args)).rows[0].r;
}
const explore = () => call<Explore>(null, "public.get_community_explore()");
const curate = (as: string | null, featured: Created | null, picks: Created[]) =>
  call<unknown>(as, "public.admin_set_community_curation($1,$2)", [featured?.short_code ?? null, picks.map((p) => p.short_code)]);
const newest = (limit = 24, cursor?: Card) =>
  call<Newest>(null, "public.list_community_newest($1,$2,$3)", [limit, cursor?.listed_at ?? null, cursor?.short_code ?? null]);
const titles = (cards: Card[]) => cards.map((c) => c.title);
async function rejects(p: Promise<unknown>, pattern: RegExp) {
  await assert.rejects(p, (e: Error) => pattern.test(e.message));
}
async function allNewest(pageSize: number) {
  const out: Card[] = [];
  let cursor: Card | undefined;
  for (;;) {
    const page = await newest(pageSize, cursor);
    out.push(...page.items);
    if (!page.has_more) return out;
    cursor = page.items[page.items.length - 1];
  }
}

try {
  const plan = buildSchemaPlan({ includeSupabaseStubs: true, includeReset: false });
  const at = plan.findIndex((x) => x.label.includes("0006_"));
  await applySchemaPlan(db, plan.slice(0, at));
  const wren = await account();
  const pantry = await create(wren, "Pantry Raid");
  await list(wren, pantry);
  const before = (await db.query("select id, community_listed, community_listed_at from public.custom_puzzles order by id")).rows;
  await applySchemaPlan(db, plan.slice(at));
  assert.deepEqual((await db.query("select id, community_listed, community_listed_at from public.custom_puzzles order by id")).rows, before);

  // No selections: no shells, just nothing.
  assert.deepEqual(await explore(), { featured: null, picks: [] });

  const admin = await account(true);
  const odie = await account();
  const tides = await create(odie, "Turn Of The Tides");
  const air = await create(wren, "Something In The Air");
  const offbeat = await create(wren, "A Little Offbeat");
  const usual = await create(odie, "The Usual Suspects");
  const linkOnly = await create(wren, "Link Only Lighthouse"); // public, never listed
  const secret = await create(wren, "Private Parlour", "private");
  for (const p of [tides, air, offbeat, usual]) await list(p === tides || p === usual ? odie : wren, p);

  // Admin only.
  await rejects(curate(null, pantry, []), /admin role required/);
  await rejects(curate(wren, pantry, []), /admin role required/);
  await rejects(call(wren, "public.admin_get_community_curation()"), /admin role required/);

  // Validation: only puzzles in Community now; no duplicates; featured not a pick; at most six.
  await rejects(curate(admin, linkOnly, []), /only puzzles listed in Community/);
  await rejects(curate(admin, null, [secret]), /only puzzles listed in Community/);
  await rejects(curate(admin, pantry, [pantry]), /can't also be an Editor's Pick/);
  await rejects(curate(admin, null, [air, air]), /picked once/);
  await rejects(curate(admin, null, Array(7).fill(air)), /at most six/);

  await curate(admin, pantry, [tides, air, offbeat, usual]);
  let ex = await explore();
  assert.equal(ex.featured?.title, "Pantry Raid");
  assert.deepEqual(titles(ex.picks), ["Turn Of The Tides", "Something In The Air", "A Little Offbeat", "The Usual Suspects"]);
  assert.ok(!titles(ex.picks).includes("Pantry Raid"));
  assert.deepEqual(Object.keys(ex.featured!).sort(), ["creator_name", "creator_slug", "favorite_count", "finished_plays", "listed_at", "mode", "short_code", "title"]);
  const raw = JSON.stringify(ex);
  for (const s of [pantry.share_id, pantry.puzzle_id, wren, admin, "Hidden Group"]) assert.ok(!raw.includes(s), `explore leaked ${s}`);

  // Re-checked on read: unlist and moderation remove entries; the row stays for the admin.
  await list(wren, pantry, false);
  await list(odie, tides, false);
  ex = await explore();
  assert.equal(ex.featured, null); // no empty Featured shell
  assert.deepEqual(titles(ex.picks), ["Something In The Air", "A Little Offbeat", "The Usual Suspects"]);
  const adminView = await call<{ title: string; shown: boolean; hidden_reason: string | null }[]>(admin, "public.admin_get_community_curation()");
  assert.deepEqual(adminView.filter((r) => !r.shown).map((r) => [r.title, r.hidden_reason]), [["Pantry Raid", "unlisted by its creator"], ["Turn Of The Tides", "unlisted by its creator"]]);
  await db.query("update public.custom_puzzles set moderation_status='hidden' where id=$1", [air.puzzle_id]);
  assert.deepEqual(titles((await explore()).picks), ["A Little Offbeat", "The Usual Suspects"]);
  await db.query("update public.custom_puzzles set moderation_status='active' where id=$1", [air.puzzle_id]);
  // The links still resolve.
  assert.equal((await call<{ title: string }>(null, "public.get_custom_puzzle_by_short_code($1)", [pantry.short_code])).title, "Pantry Raid");
  // Re-listing brings it back where the admin put it.
  await list(wren, pantry);
  assert.equal((await explore()).featured?.title, "Pantry Raid");
  // Unlisted curated rows can't be re-saved as is; the admin replaces or removes them.
  await rejects(curate(admin, pantry, [tides]), /only puzzles listed in Community/);
  await curate(admin, air, [offbeat]); // replace
  ex = await explore();
  assert.equal(ex.featured?.title, "Something In The Air");
  assert.deepEqual(titles(ex.picks), ["A Little Offbeat"]);
  await curate(admin, null, []); // remove all
  assert.deepEqual(await explore(), { featured: null, picks: [] });
  await curate(admin, offbeat, []);
  await list(odie, tides);

  // Newest: first listing time, newest first; independent of curation and plays.
  const order = titles((await newest()).items);
  assert.deepEqual(order, ["The Usual Suspects", "A Little Offbeat", "Something In The Air", "Turn Of The Tides", "Pantry Raid"].filter((t) => order.includes(t)));
  assert.equal(order.length, 5);
  assert.ok(!order.includes("Link Only Lighthouse") && !order.includes("Private Parlour"));
  // Featured can also be in Newest; a newly listed, never-curated puzzle comes first.
  const fresh = await create(odie, "Fictional Fresh Arrival");
  assert.ok(!titles((await newest()).items).includes("Fictional Fresh Arrival")); // not listed yet
  await list(odie, fresh);
  assert.equal((await newest()).items[0].title, "Fictional Fresh Arrival");
  assert.equal((await explore()).featured?.title, "A Little Offbeat");
  assert.ok(titles((await newest()).items).includes("A Little Offbeat"));
  // Re-listing never moves an older puzzle back to the top.
  const posBefore = titles((await newest()).items).indexOf("Pantry Raid");
  await list(wren, pantry, false);
  await list(wren, pantry);
  assert.equal(titles((await newest()).items).indexOf("Pantry Raid"), posBefore);

  // Keyset paging: same order as one big page, at any page size.
  const one = titles((await newest(48)).items);
  for (const size of [1, 2, 4]) assert.deepEqual(titles(await allNewest(size)), one);
  // Stable across changes between pages: a new listing never repeats or skips older ones.
  const p1 = await newest(2);
  const extra = await create(wren, "Fictional Between Pages");
  await list(wren, extra);
  const rest: Card[] = [];
  let cursor = p1.items[p1.items.length - 1];
  for (;;) {
    const page = await newest(2, cursor);
    rest.push(...page.items);
    if (!page.has_more) break;
    cursor = page.items[page.items.length - 1];
  }
  assert.deepEqual([...titles(p1.items), ...titles(rest)], one);
  // An unlisting between pages doesn't skip anyone else.
  const q1 = await newest(2);
  await list(wren, offbeat, false);
  const afterUnlist = [...titles(q1.items)];
  cursor = q1.items[1];
  for (;;) {
    const page = await newest(2, cursor);
    afterUnlist.push(...titles(page.items));
    if (!page.has_more) break;
    cursor = page.items[page.items.length - 1];
  }
  const expected = ["Fictional Between Pages", ...one].filter((t) => t !== "A Little Offbeat" || titles(q1.items).includes(t));
  assert.deepEqual(afterUnlist, expected);
  assert.equal((await newest(1000)).limit, 48);

  // Ties on listing time are ordered by short code, deterministically.
  await db.query("update public.custom_puzzles set community_listed_at = '2026-01-01T00:00:00Z' where community_listed");
  const tie = await allNewest(1);
  assert.deepEqual(tie.map((c) => c.short_code), [...tie.map((c) => c.short_code)].sort());

  // Grants: guests read Explore and Newest; never the curation table or admin calls.
  await actAs(null);
  await db.exec("SET ROLE anon");
  assert.ok((await db.query("select public.get_community_explore()")).rows.length === 1);
  assert.ok((await db.query("select public.list_community_newest()")).rows.length === 1);
  await rejects(db.query("select * from public.community_curation"), /permission denied/);
  await rejects(db.query("select public.admin_get_community_curation()"), /permission denied/);
  await rejects(db.query("select public.admin_set_community_curation(null, '{}')"), /permission denied/);
  await db.exec("RESET ROLE");
  await db.exec("SET ROLE authenticated");
  await actAs(wren);
  await rejects(db.query("select * from public.community_curation"), /permission denied/);
  await db.exec("RESET ROLE");

  console.log(
    "PASS: additive, admin-only curation (one Featured, ≤6 ordered Picks, no duplicate, only puzzles in Community), re-checked on read (unlist/hide vanish, no empty shell), " +
      "replace/remove, Newest by first listing time independent of curation, new listings first, no re-list bump, keyset paging stable across inserts/unlists, grants."
  );
} finally {
  await db.close();
}
