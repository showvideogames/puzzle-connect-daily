import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {it,expect} from 'vitest';
it('resolves current names and private nicknames per viewer without rewriting snapshots or exposing blocked standings',async()=>{
 const db=new PGlite();
 try {
 await db.exec('create role anon nologin;create role authenticated nologin;create role service_role nologin;');
 await db.exec(readFileSync('shared-service/fixtures/hub-eb238dd.sql','utf8'));
 await db.exec('create schema auth;create table auth.users(id uuid primary key);');
 await db.exec(readFileSync('shared-service/fixtures/crosspuns-eb238dd.sql','utf8'));
 for(const file of readdirSync('shared-service/patches').sort())await db.exec(readFileSync(`shared-service/patches/${file}`,'utf8'));
 async function call(fn:string,args:unknown[]){await db.exec('set role social_gateway');try{return (await db.query<{r:any}>(`select social.${fn}(${args.map((_,i)=>`$${i+1}`).join(',')}) r`,args)).rows[0].r;}finally{await db.exec('reset role');}}
 const users=['user_names000001','user_names000002','user_names000003'];
 for(const [i,u] of users.entries()){await call('ensure_person',[u,'rainbow']);await call('set_profile',[u,`Current ${i}`,'fox','#DED1F2']);}
 const {groupId,inviteCode}=(await call('create_group',[users[0],'Names','Legacy 0',1])).data;
 for(let i=1;i<3;i++)await call('join_group',[users[i],inviteCode,`Legacy ${i}`,1]);
 const before=(await db.query('select * from social.memberships order by id')).rows;
 for(const viewer of [0,2]){
 const invitation=(await call('create_friend_invite',[users[1],1])).data;
 const friendship=(await call('accept_friend_invite',[users[viewer],invitation.code,1])).data;
 expect(friendship).toBeTruthy();
 expect((await call('set_friend_preference',[users[viewer],friendship.friendRef,false,`Private ${viewer}`])).ok).toBe(true);
 }
 const readers=[(u:string)=>call('list_members',[u,groupId]),(u:string)=>call('crosspuns_standings',[u,groupId,0]),(u:string)=>call('crosspuns_standings_period',[u,groupId,0,7,'2026-11-05'])];
 for(const read of readers){
 for(const viewer of [0,1,2]){
 const answer=await read(users[viewer]);expect(answer.ok).toBe(true);const rows=Array.isArray(answer.data)?answer.data:answer.data.rows;
 expect(rows.map((r:any)=>r.name).sort()).toEqual(['Current 0',viewer===1?'Current 1':`Private ${viewer}`,'Current 2'].sort());
 }
 }
 await call('set_profile',[users[0],'Renamed','fox','#DED1F2']);
 for(const read of readers){const a=await read(users[2]);expect(JSON.stringify(a)).toContain('Renamed');expect(JSON.stringify(a)).not.toContain('Current 0');}
 const members=(await call('list_members',[users[0],groupId])).data;
 const other=members.find((m:any)=>m.name==='Private 0');
 await call('block',[users[0],other.memberRef]);
 for(const viewer of [0,1])for(const read of readers.slice(1)){
 const a=await read(users[viewer]);expect(a.data.rows.filter((r:any)=>r.blocked)).toEqual([{blocked:true,rank:1,label:'This player is blocked'}]);
 }
 expect((await db.query('select * from social.memberships order by id')).rows).toEqual(before);
 expect((await db.query<{allowed:boolean}>("select has_function_privilege('social_gateway','social.group_member_name(uuid,uuid,text)','execute') allowed")).rows[0].allowed).toBe(false);
 await db.exec("update social.persons set display_name=null where global_user_id='user_names000003'");
 expect((await call('list_members',[users[1],groupId])).data.map((r:any)=>r.name)).toContain('Legacy 2');
 }finally{await db.close();}
},30000);
