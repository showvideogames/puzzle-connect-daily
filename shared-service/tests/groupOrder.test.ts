import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,expect,it} from 'vitest';
const db=new PGlite();const alice='user_alice0000001',bob='user_bob000000001';
let ids:string[]=[];
async function call(fn:string,args:unknown[]) {
 await db.exec('set role social_gateway');
 try {return (await db.query<{answer:{ok:boolean;data:{groupId?:string;inviteCode?:string;groupIds?:string[]};outcome?:string}}>(`select social.${fn}(${args.map((_,i)=>`$${i+1}`).join(',')}) as answer`,args)).rows[0].answer;}
 finally {await db.exec('reset role');}
}
beforeAll(async()=>{
 await db.exec('create role anon nologin; create role authenticated nologin; create role service_role nologin;');
 await db.exec(readFileSync('shared-service/fixtures/hub-eb238dd.sql','utf8'));
 for(const patch of ['0003_private_friend_preferences.sql','0004_private_group_order.sql'])await db.exec(readFileSync(`shared-service/patches/${patch}`,'utf8'));
 for(const id of [alice,bob]){await call('ensure_person',[id,'rainbow']);await call('set_profile',[id,id,'fox','#DED1F2']);}
 for(const name of ['One','Two','Three']){const made=await call('create_group',[alice,name,'Alice',1]);ids.push(made.data.groupId!);await call('join_group',[bob,made.data.inviteCode,'Bob',1]);}
 ids=(await call('list_group_order',[alice])).data.groupIds!;
},20000);
afterAll(()=>db.close());
it('changes only the viewer’s navigation order, preserving existing group/membership responses',async()=>{
 const before=(await db.query('select social.list_my_groups($1) as groups',[alice])).rows;
 const bobBefore=await call('list_group_order',[bob]);
 const reversed=[...ids].reverse();
 for(let i=0;i<2;i++)expect(await call('set_group_order',[alice,reversed])).toMatchObject({ok:true});
 expect(await call('list_group_order',[alice])).toMatchObject({data:{groupIds:reversed}});
 expect(await call('list_group_order',[bob])).toEqual(bobBefore);
 expect((await db.query('select social.list_my_groups($1) as groups',[alice])).rows).toEqual(before);
});
it('rejects stale, duplicate, outsider and malformed lists without partial writes',async()=>{
 const before=await call('list_group_order',[alice]);
 for(const bad of [[ids[0]], [ids[0],ids[0],ids[2]],[ids[0],ids[1],'unknown'],[...ids,null],null])expect((await call('set_group_order',[alice,bad])).ok).toBe(false);
 expect(await call('list_group_order',[alice])).toEqual(before);
 expect((await call('set_group_order',['user_unknown0001',ids])).ok).toBe(false);
});
it('removes departed memberships from order and safely reapplies the patch',async()=>{
 expect((await call('leave_group',[bob,ids[0]])).ok).toBe(true);
 expect((await call('list_group_order',[bob])).data.groupIds).not.toContain(ids[0]);
 expect((await call('set_group_order',[bob,ids])).ok).toBe(false);
 const before=await call('list_group_order',[alice]);
 await db.exec(readFileSync('shared-service/patches/0004_private_group_order.sql','utf8'));
 expect(await call('list_group_order',[alice])).toEqual(before);
});
it('permits only the gateway to call the new operations',async()=>{
 for(const role of ['anon','authenticated','service_role','social_gateway'])expect((await db.query<{ok:boolean}>("select has_function_privilege($1,'social.set_group_order(text,text[])','EXECUTE') as ok",[role])).rows[0].ok).toBe(role==='social_gateway');
});
