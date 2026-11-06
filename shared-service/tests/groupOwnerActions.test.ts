import {readFileSync} from 'node:fs';import {PGlite} from '@electric-sql/pglite';import {afterAll,beforeAll,expect,it} from 'vitest';
const db=new PGlite();const a='user_alice0000001',b='user_bob000000001',c='user_carol000001';let groupId:string,inviteCode:string,target:string;
async function call(fn:string,args:unknown[],role='social_gateway'){
 await db.exec(`set role ${role}`);try{return (await db.query<{answer:{ok:boolean;data:unknown;outcome?:string}}>(`select social.${fn}(${args.map((_,i)=>`$${i+1}`).join(',')}) as answer`,args)).rows[0].answer;}finally{await db.exec('reset role');}
}
beforeAll(async()=>{
 await db.exec('create role anon nologin;create role authenticated nologin;create role service_role nologin;');await db.exec(readFileSync('shared-service/fixtures/hub-eb238dd.sql','utf8'));await db.exec(readFileSync('shared-service/patches/0006_group_owner_actions.sql','utf8'));
 for(const who of [a,b,c]){await call('ensure_person',[who,'rainbow']);await call('set_profile',[who,who,'fox','#DED1F2']);}
 ({groupId,inviteCode}=(await call('create_group',[a,'Club','Alice',1])).data as {groupId:string;inviteCode:string});await call('join_group',[b,inviteCode,'Bob',1]);
 target=((await call('list_members',[a,groupId])).data as {memberRef:string;isMe:boolean}[]).find(m=>!m.isMe)!.memberRef;
 for(const who of [a,b])expect((await call('record_completion',[who,'rainbow','puzzle-1',new Date().toISOString(),JSON.stringify({solved:true,mistakes:0}),JSON.stringify('GRID')],'social_game_server')).ok).toBe(true);
},20000);afterAll(()=>db.close());
it('rejects nonowners and unrelated target references without changing membership',async()=>{
 expect(await call('transfer_group_ownership',[b,groupId,target])).toMatchObject({ok:false,outcome:'not_the_creator'});
 expect(await call('transfer_group_ownership',[c,groupId,target])).toMatchObject({ok:false,outcome:'not_a_member'});
 expect(await call('transfer_group_ownership',[a,groupId,'not-a-member'])).toMatchObject({ok:false,outcome:'not_found'});
 expect(await call('delete_group',[b,groupId])).toMatchObject({ok:false,outcome:'not_the_creator'});
});
it('transfers to an existing member, preserving both members and existing invitation bytes',async()=>{
 expect((await call('transfer_group_ownership',[a,groupId,target])).ok).toBe(true);
 expect((await call('list_my_groups',[a])).data).toMatchObject([{isOwner:false,memberCount:2,inviteCode:null}]);
 expect((await call('list_my_groups',[b])).data).toMatchObject([{isOwner:true,memberCount:2,inviteCode}]);
 expect(await call('delete_group',[a,groupId])).toMatchObject({ok:false,outcome:'not_the_creator'});
});
it('deletes only the group and its access, retaining personal result cards and profiles',async()=>{
 expect((await call('delete_group',[b,groupId])).ok).toBe(true);
 expect((await call('list_my_groups',[a])).data).toEqual([]);expect((await call('list_my_groups',[b])).data).toEqual([]);
 expect((await call('preview_invite',[null,inviteCode])).ok).toBe(false);
 expect((await call('list_results',[a,'rainbow','puzzle-1',groupId])).ok).toBe(false);
 expect((await call('list_results',[a,'rainbow','puzzle-1',null])).data).toMatchObject([{isMe:true}]);
 expect((await db.query<{n:number}>('select count(*)::int as n from social.result_cards')).rows[0].n).toBe(2);
 expect((await call('ensure_person',[a,'rainbow'])).data).toMatchObject({displayName:a});
 expect((await call('delete_group',[b,groupId])).ok).toBe(false);
});
