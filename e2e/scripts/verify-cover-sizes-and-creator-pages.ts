/**
 * 0014 (per-emoji cover sizes) and 0015 (a creator page for a listed puzzle's
 * owner who has none) on disposable in-process PostgreSQL. Fictional data only.
 *
 *   npm run e2e:db:sizes-creators
 */
import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildSchemaPlan, applySchemaPlan } from "./lib/schema.ts";

const RB14 = fs.readFileSync(new URL("../../supabase/ops/cover-sizes/rollback-0014.sql", import.meta.url), "utf8");
const RB15 = fs.readFileSync(new URL("../../supabase/ops/creator-profile/rollback-0015.sql", import.meta.url), "utf8");
type Created = { puzzle_id: string; share_id: string; short_code: string };
type Card = { title: string; short_code: string; creator_name: string; creator_slug: string | null; cover_sizes: number[] | null; cover_emoji: string | null };
const db = new PGlite();

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
async function create(as: string | null, title: string, designer = "Fictional Maker", visibility = "public") {
  n++;
  const words = Array.from({ length: 16 }, (_, i) => `S${n}Z${String.fromCharCode(65 + i)}`);
  const content = { mode: "classic", groups: [0, 1, 2, 3].map((g) => ({ category: `G${n}${g}`, words: words.slice(g * 4, g * 4 + 4) })), word_order: words, rainbow_herring: null };
  await actAs(as);
  return (await db.query<{ r: Created }>("select public.create_custom_puzzle($1,$2,$3,$4::jsonb) as r", [designer, title, visibility, JSON.stringify(content)])).rows[0].r;
}
async function call<T>(as: string | null, sql: string, args: unknown[] = []): Promise<T> {
  await actAs(as);
  return (await db.query<{ r: T }>(`select ${sql} as r`, args)).rows[0].r;
}
async function rejects(p: Promise<unknown>, pattern: RegExp) {
  await assert.rejects(p, (e: Error) => pattern.test(e.message));
}
async function schema() {
  const q = async (sql: string) => (await db.query<Record<string, string>>(sql)).rows.map((r) => Object.values(r).join(" | ")).sort();
  return {
    columns: await q("select table_name, column_name, data_type, is_nullable, coalesce(column_default,'') from information_schema.columns where table_schema='public'"),
    constraints: await q("select conrelid::regclass::text, conname, pg_get_constraintdef(oid) from pg_constraint where connamespace='public'::regnamespace"),
    functions: await q("select p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)) from pg_proc p where p.pronamespace='public'::regnamespace"),
  };
}
const list = async () => (await call<{ items: Card[] }>(null, "public.list_community_puzzles(null,'newest',48,0)")).items;
const cardOf = async (code: string) => (await list()).find((c) => c.short_code === code);
const PUZZLE_ROWS = "select id, share_id, short_code, title, creator_name, created_by, visibility, content, moderation_status, community_listed, cover_emoji, cover_emoji_2, cover_emoji_3, cover_background from public.custom_puzzles order by id";

try {
  const plan = buildSchemaPlan({ includeSupabaseStubs: true, includeReset: false });
  const at14 = plan.findIndex((x) => x.label.includes("0014_"));
  const at15 = plan.findIndex((x) => x.label.includes("0015_"));
  assert.ok(at14 > 0 && at15 === at14 + 1, "0014 then 0015 are in the plan");
  await applySchemaPlan(db, plan.slice(0, at14));

  // ── Fixtures before 0014: an older two-emoji listed cover ─────────────────
  const wren = await account();
  const odie = await account();
  const old = await create(wren, "Garden Party", "Wren Halloway");
  await call(wren, "public.set_custom_puzzle_community_listing($1,true)", [old.share_id]);
  await call(wren, "public.set_custom_puzzle_cover_emojis($1,$2,$3)", [old.share_id, ["1F438", "1F337"], "lime-checks"]);
  await call(odie, "public.set_custom_puzzle_favorite($1,true)", [old.share_id]);
  const before14 = await schema();
  const rows = (await db.query(PUZZLE_ROWS)).rows;
  await applySchemaPlan(db, plan.slice(at14, at14 + 1));
  assert.deepEqual((await db.query(PUZZLE_ROWS)).rows, rows, "0014 changes no existing cover");

  // ── 0014: older covers read as standard sizes everywhere ──────────────────
  const payloads = async () => [
    (await cardOf(old.short_code))!.cover_sizes,
    (await call<{ cover_sizes: unknown }>(null, "public.get_custom_puzzle_by_short_code($1)", [old.short_code])).cover_sizes,
    (await call<{ cover_sizes: unknown }>(null, "public.get_custom_puzzle($1)", [old.share_id])).cover_sizes,
    (await call<{ cover_sizes: unknown }[]>(null, "public.get_custom_puzzle_cards($1)", [[old.share_id]]))[0].cover_sizes,
    (await call<{ cover_sizes: unknown }[]>(odie, "public.get_my_favorites()"))[0].cover_sizes,
    (await call<{ items: { cover_sizes: unknown }[] }>(wren, "public.list_my_custom_puzzles()")).items[0].cover_sizes,
    (await call<{ puzzles: { cover_sizes: unknown }[] }>(null, "public.get_creator_community($1)", [(await db.query<{ s: string }>("select public_slug s from public.creator_profiles where user_id=$1", [wren])).rows[0].s])).puzzles[0].cover_sizes,
  ];
  assert.deepEqual(await payloads(), Array(7).fill(null));

  // Independent sizes per slot, in order, the same on every payload.
  const sized = (as: string | null, emojis: unknown, bg: unknown, sizes: unknown) => call<Record<string, unknown>>(as, "public.set_custom_puzzle_cover_sized($1,$2,$3,$4)", [old.share_id, emojis, bg, sizes]);
  const r = await sized(wren, ["1F438", "1F337"], "lime-checks", [50, 250]);
  assert.deepEqual([r.cover_emoji, r.cover_emoji_2, r.cover_background, r.cover_sizes], ["1F438", "1F337", "lime-checks", [50, 250]]);
  assert.deepEqual(await payloads(), Array(7).fill([50, 250]));
  await sized(wren, ["1FA90", "1F680", "2B50-FE0F"], "lilac-dots", [100, 175, 60]);
  assert.deepEqual(await payloads(), Array(7).fill([100, 175, 60]));
  // All standard is stored as none (exactly like an older cover).
  await sized(wren, ["1FA90", "1F680", "2B50-FE0F"], "lilac-dots", [100, 100, 100]);
  assert.equal((await db.query<{ s: unknown }>("select cover_emoji_sizes s from public.custom_puzzles where id=$1", [old.puzzle_id])).rows[0].s, null);
  await sized(wren, ["1F438"], "lime-checks", null);
  assert.deepEqual(await payloads(), Array(7).fill(null));
  // Bounds, shape and owner.
  for (const [emojis, sizes, why] of [
    [["1F438"], [49], /50% to 250%/], [["1F438"], [251], /50% to 250%/], [["1F438", "1F337"], [100], /one size/],
    [["1F438"], [100, 100], /one size/], [["1F438", "1F337"], [100, null], /one size/], [["1F438"], [[100]], /one size|malformed|dimension/],
  ] as [string[], unknown, RegExp][]) {
    await rejects(sized(wren, emojis, "lime-checks", sizes), why);
  }
  await rejects(sized(odie, ["1F438"], "lime-checks", [150]), /only the puzzle's creator/);
  await rejects(sized(null, ["1F438"], "lime-checks", [150]), /sign in/);
  await rejects(sized(wren, ["<b>"], "lime-checks", [150]), /not available/);
  // A rejected size never leaves a half-written cover.
  assert.deepEqual((await cardOf(old.short_code))!.cover_emoji, "1F438");
  // The older setters still work and reset sizes to standard.
  await sized(wren, ["1F438", "1F337"], "lime-checks", [70, 200]);
  await call(wren, "public.set_custom_puzzle_cover_emojis($1,$2,$3)", [old.share_id, ["1F438", "1F337"], "lime-checks"]);
  assert.equal((await cardOf(old.short_code))!.cover_sizes, null);
  await sized(wren, ["1F438"], "lime-checks", [220]);
  await call(wren, "public.set_custom_puzzle_cover($1,$2,$3)", [old.share_id, "1F37F", "apricot-stripes"]);
  assert.equal((await cardOf(old.short_code))!.cover_sizes, null);
  // The table itself refuses out-of-bounds or mismatched sizes.
  await rejects(db.query("update public.custom_puzzles set cover_emoji_sizes = '{300}' where id = $1", [old.puzzle_id]), /cover_emoji_sizes/);
  await rejects(db.query("update public.custom_puzzles set cover_emoji_sizes = '{100,100}' where id = $1", [old.puzzle_id]), /cover_emoji_sizes/);
  // Grants.
  await actAs(null);
  await db.exec("SET ROLE anon");
  await rejects(db.query("select public.set_custom_puzzle_cover_sized($1,'{1F438}','lime-checks','{100}')", [old.share_id]), /permission denied/);
  await db.exec("RESET ROLE");
  // Rollback restores the exact schema.
  await db.exec(RB14);
  assert.deepEqual(await schema(), before14, "rollback-0014 restores the schema exactly");
  await applySchemaPlan(db, plan.slice(at14, at14 + 1));

  // ── 0015: a listed legacy puzzle reassigned to an owner without a page ────
  const admin = await account(true);
  const quinn = await account(); // never created a puzzle: no creator profile
  const pip = await account();
  const rex = await account();
  // Legacy puzzles made as a guest, later assigned to accounts by hand (no app
  // path does this) and listed under an earlier owner.
  const harbor = await create(null, "Harbor Lights", "Harbor Hal");
  const quietDraft = await create(null, "Quiet Unlisted", "Harbor Hal");
  const secret = await create(null, "Secret Private", "Harbor Hal", "private");
  const mill = await create(null, "Old Mill", "Miller Pip");
  const pond = await create(null, "Pond Life", "Rex R");
  const guestMade = await create(null, "Anonymous Airship", "Guest Puzzler");
  await db.query("update public.custom_puzzles set created_by = $1 where id = any($2)", [quinn, [harbor.puzzle_id, quietDraft.puzzle_id, secret.puzzle_id]]);
  await db.query("update public.custom_puzzles set created_by = $1 where id = $2", [pip, mill.puzzle_id]);
  await db.query("update public.custom_puzzles set created_by = $1 where id = $2", [rex, pond.puzzle_id]);
  await db.query("update public.custom_puzzles set community_listed = true, community_listed_at = now() where id = any($1)", [[harbor.puzzle_id, mill.puzzle_id]]);
  assert.equal((await cardOf(harbor.short_code))!.creator_slug, null, "the reported symptom: a listed puzzle with no owner page renders a plain byline");
  const profilesBefore = (await db.query("select * from public.creator_profiles order by user_id")).rows;
  const before15 = await schema();
  const puzzles15 = (await db.query(PUZZLE_ROWS)).rows;
  await applySchemaPlan(db, plan.slice(at15, at15 + 1));
  assert.deepEqual((await db.query("select * from public.creator_profiles order by user_id")).rows, profilesBefore, "0015 itself rewrites nobody");
  assert.deepEqual((await db.query(PUZZLE_ROWS)).rows, puzzles15);

  // The owner opens My Puzzles: their page appears, with a stable slug.
  const mine = await call<{ public_slug: string }>(quinn, "public.ensure_my_creator_profile()");
  assert.match(mine.public_slug, /^harbor-hal-[a-z0-9]{4}$/);
  assert.deepEqual(await call(quinn, "public.ensure_my_creator_profile()"), mine, "stable on every call");
  const card = (await cardOf(harbor.short_code))!;
  assert.equal(card.creator_slug, mine.public_slug, "the card now links to the actual owner");
  assert.equal(card.creator_name, "Harbor Hal", "the original byline is kept as saved");
  const shelf = await call<{ display_name: string; puzzles: { title: string }[] }>(null, "public.get_creator_community($1)", [mine.public_slug]);
  assert.equal(shelf.display_name, "Harbor Hal");
  assert.deepEqual(shelf.puzzles.map((p) => p.title), ["Harbor Lights"], "only listed puzzles: never unlisted or private ones");
  // Nothing listed: no page.
  assert.deepEqual(await call(odie, "public.ensure_my_creator_profile()"), { public_slug: (await db.query<{ s: string }>("select public_slug s from public.creator_profiles where user_id=$1", [odie])).rows[0]?.s ?? null });
  const nobody = await account();
  assert.deepEqual(await call(nobody, "public.ensure_my_creator_profile()"), { public_slug: null });
  assert.equal((await db.query("select 1 from public.creator_profiles where user_id=$1", [nobody])).rows.length, 0);
  await rejects(call(null, "public.ensure_my_creator_profile()"), /sign in/);

  // Admin, one reported puzzle.
  await rejects(call(odie, "public.admin_ensure_puzzle_creator_profile($1)", [mill.short_code]), /admins only/);
  await rejects(call(null, "public.admin_ensure_puzzle_creator_profile($1)", [mill.short_code]), /admins only/);
  const fixed = await call<{ public_slug: string }>(admin, "public.admin_ensure_puzzle_creator_profile($1)", [mill.short_code]);
  assert.match(fixed.public_slug, /^miller-pip-[a-z0-9]{4}$/);
  assert.equal((await cardOf(mill.short_code))!.creator_slug, fixed.public_slug);
  assert.deepEqual(await call(admin, "public.admin_ensure_puzzle_creator_profile($1)", [guestMade.short_code]), { public_slug: null, reason: "no_owner" });
  assert.deepEqual(await call(admin, "public.admin_ensure_puzzle_creator_profile($1)", [pond.short_code]), { public_slug: null, reason: "not_in_community" });
  assert.equal((await db.query("select 1 from public.creator_profiles where user_id=$1", [rex])).rows.length, 0);

  // Listing it is enough, too; and a chosen public name wins over the byline.
  await call(rex, "public.set_my_creator_name($1)", ["Rex Rivers"]);
  assert.equal((await db.query("select 1 from public.creator_profiles where user_id=$1", [rex])).rows.length, 0, "a name alone makes no page");
  await call(rex, "public.set_custom_puzzle_community_listing($1,true)", [pond.share_id]);
  const rexSlug = (await cardOf(pond.short_code))!.creator_slug!;
  assert.match(rexSlug, /^rex-rivers-[a-z0-9]{4}$/);
  // Existing pages are never renamed or re-slugged; puzzles never touched.
  const wrenProfile = profilesBefore.find((p) => (p as { user_id: string }).user_id === wren);
  assert.deepEqual((await db.query("select * from public.creator_profiles where user_id=$1", [wren])).rows[0], wrenProfile);
  const after = (await db.query(PUZZLE_ROWS)).rows as Record<string, unknown>[];
  assert.deepEqual(after.map(({ community_listed, ...rest }) => rest), (puzzles15 as Record<string, unknown>[]).map(({ community_listed, ...rest }) => rest));
  // Grants.
  await actAs(null);
  await db.exec("SET ROLE anon");
  await rejects(db.query("select public.ensure_my_creator_profile()"), /permission denied/);
  await rejects(db.query("select public.custom_ensure_listed_owner_profile($1, 'x')", [quinn]), /permission denied/);
  await db.exec("RESET ROLE");
  await db.exec("SET ROLE authenticated");
  await rejects(db.query("select public.custom_ensure_listed_owner_profile($1, 'x')", [quinn]), /permission denied/);
  await db.exec("RESET ROLE");
  await db.exec(RB15);
  assert.deepEqual(await schema(), before15, "rollback-0015 restores the schema exactly");

  console.log("PASS: 0014 additive, older covers read as standard everywhere, 1-3 independent sizes (50-250) in order on all seven cover payloads, all-standard stored as none, bounds/shape/owner/guest refused with no half-write, older setters reset sizes, table check, exact rollback; 0015 rewrites nobody, gives a listed reassigned puzzle's actual owner a stable page (owner, listing, public name or admin one-puzzle paths; chosen name over byline), shelf shows only listed puzzles, no page without a listing or for guest puzzles, existing pages and all puzzles untouched, exact rollback.");
} finally {
  await db.close();
}
