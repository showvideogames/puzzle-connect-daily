import {readFileSync} from 'node:fs';import {PGlite} from '@electric-sql/pglite';import {afterAll,beforeAll,expect,it} from 'vitest';
const db=new PGlite();const owner='user_owner000001',member='user_member00001',other='user_other000001';let id:string,code:string,ref:string;
async function call(fn:string,args:unknown[]){await db.exec('set role social_gateway');try{return (await db.query<{answer:{ok:boolean;data:unknown;outcome?:string}}>(`select social.${fn}(${args.map((_,i)=>`$${i+1}`).join(',')}) as answer`,args)).rows[0].answer;}finally{await db.exec('reset role');}}
beforeAll(async()=>{
 await db.exec('create role anon nologin;create role authenticated nologin;create role service_role nologin;');await db.exec(readFileSync('shared-service/fixtures/hub-eb238dd.sql','utf8'));await db.exec(readFileSync('shared-service/patches/0007_group_invite_permissions.sql','utf8'));
 for(const who of [owner,member,other]){await call('ensure_person',[who,'rainbow']);await call('set_profile',[who,who,'fox','#DED1F2']);}
 const made=(await call('create_group',[owner,'Club','Owner',1])).data as {groupId:string;inviteCode:string};id=made.groupId;code=made.inviteCode;await call('join_group',[member,code,'Member',1]);
 ref=((await call('list_members',[owner,id])).data as {memberRef:string;isMe:boolean}[]).find(m=>!m.isMe)!.memberRef;
},20000);afterAll(()=>db.close());
it('defaults to owner-only code access and denies self-grants and outsiders',async()=>{
 expect(await call('get_group_invitation',[owner,id])).toMatchObject({data:{canInvite:true,inviteCode:code,grantedMemberRefs:[]}});
 expect(await call('get_group_invitation',[member,id])).toMatchObject({data:{canInvite:false,inviteCode:null,grantedMemberRefs:[]}});
 expect((await call('get_group_invitation',[other,id])).ok).toBe(false);
 expect(await call('set_member_invite_permission',[member,id,ref,true])).toMatchObject({ok:false,outcome:'not_the_creator'});
 expect((await call('set_member_invite_permission',[owner,id,'foreign',true])).ok).toBe(false);
});
it('lets the owner delegate and revoke without rotating existing links or exposing permission lists to members',async()=>{
 for(let i=0;i<2;i++)expect((await call('set_member_invite_permission',[owner,id,ref,true])).ok).toBe(true);
 expect(await call('get_group_invitation',[member,id])).toMatchObject({data:{canInvite:true,inviteCode:code,grantedMemberRefs:[]}});
 expect(await call('get_group_invitation',[owner,id])).toMatchObject({data:{grantedMemberRefs:[ref]}});
 expect((await call('list_my_groups',[member])).data).toMatchObject([{inviteCode:null}]);
 expect((await call('set_member_invite_permission',[owner,id,ref,false])).ok).toBe(true);
 expect(await call('get_group_invitation',[member,id])).toMatchObject({data:{canInvite:false,inviteCode:null}});
 expect((await call('preview_invite',[null,code])).ok).toBe(true);
});
it('ends permission with membership; rejoining starts without a grant',async()=>{
 await call('set_member_invite_permission',[owner,id,ref,true]);await call('leave_group',[member,id]);
 expect((await call('get_group_invitation',[member,id])).ok).toBe(false);
 await call('join_group',[member,code,'Member',1]);expect(await call('get_group_invitation',[member,id])).toMatchObject({data:{canInvite:false,inviteCode:null}});
});
