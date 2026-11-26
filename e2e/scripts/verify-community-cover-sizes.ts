/** Cover sizes on disposable PostgreSQL only. No production configuration is read. */
import { PGlite } from "@electric-sql/pglite";
import assert from "node:assert/strict";
import { buildSchemaPlan, applySchemaPlan } from "./lib/schema.ts";

const db = new PGlite();
type Json = Record<string, any>;
const q = async (sql: string, values: unknown[] = []) => (await db.query<{ r: any }>(`select ${sql} as r`, values)).rows[0].r;
const claims = async (id: string | null, role = "authenticated") => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims',$1,false)", [id ? JSON.stringify({ sub: id, role }) : ""]);
  if (id || role === "anon") await db.exec("set role " + role);
};
const account = async (admin = false) => {
  await claims(null);
  const user = (await db.query<{ id: string }>("insert into auth.users default values returning id")).rows[0].id;
  const sub = "user_" + user.replaceAll("-", "");
  await db.query("insert into auth.identities(user_id,provider,provider_id,identity_data) values ($1,'custom:platform',$2,$3::jsonb)", [user,sub,JSON.stringify({ sub })]);
  await claims(user);
  await q("public.ensure_account()");
  await claims(null);
  if (admin) await db.query("insert into public.user_roles(user_id,role) values($1,'admin')", [user]);
  return user;
};
const key = ["1F438", "1F337", "1F989"];
const base = "lilac";
const alt = "ocean";
const marks = (x: Json) => [x.cover_emoji, x.cover_emoji_2, x.cover_emoji_3, x.cover_background, x.cover_sizes ?? null];
const emojis = Array.from({length:16},(_,i)=>"FIXTURE"+String.fromCharCode(65+i));
const content = JSON.stringify({mode:"classic",groups:[0,1,2,3].map(i=>({category:"FIXTURE"+i,words:emojis.slice(4*i,4*i+4)})),word_order:emojis});
const one = (p: Json,k: string|null,b: string|null) => q("public.set_custom_puzzle_cover($1,$2,$3)",[p.share_id,k,b]);
const many = (p: Json, k: string[] | null,b: string | null) => q("public.set_custom_puzzle_cover_emojis($1,$2,$3)",[p.share_id,k,b]);
const sized = (p: Json,k: string[] | null,b: string|null,s: unknown) => q("public.set_custom_puzzle_cover_sized($1,$2,$3,$4)",[p.share_id,k,b,s]);
const direct = (p: Json) => q("public.get_custom_puzzle_by_short_code($1)",[p.short_code]);
const privilege = (r: string) => q("has_function_privilege($1,'public.set_custom_puzzle_cover_sized(text,text[],text,integer[])','EXECUTE')",[r]);

try {
  const plan = buildSchemaPlan({includeSupabaseStubs:true,includeReset:false});
  const step = plan.findIndex(x=>x.label.includes("0014_cover_emoji_sizes"));
  assert.equal(step,14);
  await applySchemaPlan(db,plan.slice(0,step));
  const owner = await account(), other = await account(), admin = await account(true);
  await claims(owner);
  const p = await q("public.create_custom_puzzle('Fixture Maker','Sized Cover Fixture','public',$1::jsonb)",[content]);
  await q("public.set_custom_puzzle_community_listing($1,true)",[p.share_id]);
  assert.deepEqual(await one(p,key[0],base),{cover_emoji:key[0],cover_background:base});
  const prior = await direct(p);
  await claims(null);
  await db.exec(plan[step].sql);
  await applySchemaPlan(db,plan.slice(step+1));
  assert.equal(await privilege("anon"),false);
  assert.equal(await privilege("authenticated"),true);
  assert.equal(await privilege("service_role"),false);
  const after = await direct(p);
  assert.deepEqual(Object.fromEntries(Object.entries(after).filter(([k])=>k!=="cover_sizes")),prior);
  assert.equal(after.cover_sizes,null);
  assert.equal(await q("to_regprocedure('public.get_my_creator_name()') is null"),true);
  assert.equal(await q("to_regprocedure('public.admin_ensure_puzzle_creator_profile(text)') is null"),true);
  assert.match(await q("pg_get_functiondef('public.get_creator_profile(text,text)'::regprocedure)"), /not _community_only or public.custom_puzzle_in_community/);

  await claims(other);
  await assert.rejects(sized(p,key,base,[50,100,250]),/only the puzzle's creator/);
  await q("public.set_custom_puzzle_favorite($1,true)",[p.share_id]);
  await claims(null,"anon");
  await assert.rejects(sized(p,key,base,[50,100,250]),/permission denied/);
  await claims(admin);
  await q("public.admin_set_community_curation($1, ARRAY[]::text[])",[p.short_code]);
  await claims(owner);
  for (const sizes of [[49,100,250],[50,100,251],[50,100],[50,null,250],[[50,100,250]]]) {
    await assert.rejects(sized(p,key,base,sizes),/one size|50% to 250%/);
  }
  const wanted = [...key,base,[50,100,250]];
  assert.deepEqual(marks(await sized(p,key,base,[50,100,250])),wanted);
  assert.deepEqual(marks(await direct(p)),wanted);
  assert.deepEqual(marks((await q("public.list_my_custom_puzzles()")).items[0]),wanted);
  assert.deepEqual(marks((await q("public.list_community_puzzles()")).items[0]),wanted);
  assert.deepEqual(marks((await q("public.list_community_newest()")).items[0]),wanted);
  assert.deepEqual(marks((await q("public.get_community_explore()")).featured),wanted);
  const slug=(await q("public.list_community_puzzles()")).items[0].creator_slug;
  assert.deepEqual(marks((await q("public.get_creator_community($1)",[slug])).puzzles[0]),wanted);
  await claims(other);
  assert.deepEqual(marks((await q("public.get_my_favorites()"))[0]),wanted);

  await claims(owner);
  assert.deepEqual(await many(p,key,alt),{cover_emoji:key[0],cover_emoji_2:key[1],cover_emoji_3:key[2],cover_background:alt});
  assert.deepEqual(marks(await direct(p)),[...key,alt,[50,100,250]]);
  await many(p,[key[1],key[0],key[2]],base);
  assert.deepEqual(marks(await direct(p)),[key[1],key[0],key[2],base,null]);
  assert.deepEqual(marks(await sized(p,[key[2],key[0]],alt,[250,50])),[key[2],key[0],null,alt,[250,50]]);
  assert.deepEqual(marks(await sized(p,[key[0]],base,[50])),[key[0],null,null,base,[50]]);
  assert.deepEqual(await one(p,key[0],alt),{cover_emoji:key[0],cover_background:alt});
  assert.deepEqual(marks(await direct(p)),[key[0],null,null,alt,[50]]);
  await one(p,key[1],base);
  assert.deepEqual(marks(await direct(p)),[key[1],null,null,base,null]);
  assert.deepEqual(marks(await sized(p,key,base,[100,100,100])),[...key,base,null]);
  assert.deepEqual(marks(await sized(p,[],null,[])),[null,null,null,null,null]);
  assert.deepEqual(marks(await sized(p,null,null,null)),[null,null,null,null,null]);
  assert.deepEqual(marks(await direct(p)),[null,null,null,null,null]);
  console.log("PASS exact migration: fictional owner/other/anon grants; legacy APIs incl. preserve on background-only edits; sizing bounds and payloads; privacy and unchanged catalog");
} finally {
  await db.close();
}
