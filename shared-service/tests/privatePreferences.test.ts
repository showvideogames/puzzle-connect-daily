import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, expect, it } from 'vitest';
const db = new PGlite();
const alice = 'user_alice0000001', bob = 'user_bob000000001', eve = 'user_eve000000001';
let friendRef: string;
async function call(fn: string, args: unknown[]) {
  await db.exec('set role social_gateway');
  try { return (await db.query<{ answer: {ok: boolean; data: Record<string, unknown> | unknown[]; outcome?: string} }>(`select social.${fn}(${args.map((_, i) => `$${i+1}`).join(',')}) as answer`, args)).rows[0].answer; }
  finally { await db.exec('reset role'); }
}
beforeAll(async () => {
  await db.exec('create role anon nologin; create role authenticated nologin; create role service_role nologin;');
  await db.exec(readFileSync('shared-service/fixtures/hub-eb238dd.sql','utf8'));
  await db.exec(readFileSync('shared-service/patches/0003_private_friend_preferences.sql','utf8'));
  for (const id of [alice,bob,eve]) { await call('ensure_person',[id,'rainbow']); await call('set_profile',[id,id,'fox','#DED1F2']); }
  const invite = await call('create_friend_invite',[alice,1]);
  const accepted = await call('accept_friend_invite',[bob,(invite.data as {code:string}).code,1]);
  friendRef = (accepted.data as {friendRef:string}).friendRef;
  expect(friendRef).toBeTruthy();
},20000);
afterAll(() => db.close());
it('saves only the caller’s preferences, trims nicknames and keeps public names unchanged', async () => {
  const args = [alice,friendRef,true,'  Best pal  '];
  for (let i=0;i<2;i++) expect(await call('set_friend_preference',args)).toMatchObject({ok:true,data:{friendRef,favorite:true,nickname:'Best pal'}});
  expect(await call('list_friend_preferences',[alice])).toMatchObject({ok:true,data:[{friendRef,favorite:true,nickname:'Best pal'}]});
  expect(await call('list_friend_preferences',[bob])).toMatchObject({ok:true,data:[]});
  expect(await call('list_friend_preferences',[eve])).toMatchObject({ok:true,data:[]});
  const friends = await call('list_friends',[alice]);
  expect(friends.data).toMatchObject([{name:bob}]);
  expect(JSON.stringify(friends.data)).not.toContain('Best pal');
});
it('rejects another user’s reference, self/unknown references and invalid input', async () => {
  for (const [who,ref] of [[eve,friendRef],[alice,'self'],['user_unknown0001',friendRef]]) {
    expect((await call('set_friend_preference',[who,ref,true,'Private'])).ok).toBe(false);
  }
  for (const name of ['', ' '.repeat(3),'x'.repeat(25)]) expect(await call('set_friend_preference',[alice,friendRef,true,name])).toMatchObject({ok:false,outcome:'bad_name'});
  expect(await call('set_friend_preference',[alice,friendRef,null,null])).toMatchObject({ok:false});
});
it('allows each side to edit independently, clear their nickname and unset favorite', async () => {
  expect((await call('set_friend_preference',[bob,friendRef,true,'My pal'])).ok).toBe(true);
  expect(await call('set_friend_preference',[alice,friendRef,false,null])).toMatchObject({ok:true,data:{favorite:false,nickname:null}});
  expect(await call('list_friend_preferences',[bob])).toMatchObject({data:[{nickname:'My pal',favorite:true}]});
});
it('grants no table access and only gateway execution', async () => {
  for (const role of ['anon','authenticated','service_role','social_gateway']) {
    expect((await db.query<{ok:boolean}>("select has_table_privilege($1,'social.friend_preferences','SELECT') as ok",[role])).rows[0].ok).toBe(false);
    expect((await db.query<{ok:boolean}>("select has_function_privilege($1,'social.set_friend_preference(text,text,boolean,text)','EXECUTE') as ok",[role])).rows[0].ok).toBe(role==='social_gateway');
  }
});
it('cascades both private rows on unfriend and refuses delayed writes', async () => {
  expect((await call('remove_friend',[alice,friendRef])).ok).toBe(true);
  expect(await call('list_friend_preferences',[alice])).toMatchObject({data:[]});
  expect(await call('list_friend_preferences',[bob])).toMatchObject({data:[]});
  expect((await db.query<{count:number}>('select count(*)::int as count from social.friend_preferences')).rows[0].count).toBe(0);
  expect(await call('set_friend_preference',[alice,friendRef,true,'Late'])).toMatchObject({ok:false,outcome:'not_found'});
  expect((await call('ensure_person',[bob,'rainbow'])).data).toMatchObject({displayName:bob});
});
