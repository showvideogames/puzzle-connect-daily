import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {it,expect} from 'vitest';
type HubReply<T> = {ok?: boolean; outcome?: string; data: T};
type ResultRow = {summary: unknown; detailLocked: boolean; isMe: boolean};

import {COMPLETIONS_SQL} from '../../supabase/functions/social-gateway/core';

it('rehearses optional Mini seconds over current shared patches, preserving records, permissions and puzzle isolation',async()=>{
 const db=new PGlite();
 try {
 await db.exec('create role anon nologin;create role authenticated nologin;create role service_role nologin;');
 await db.exec(readFileSync('shared-service/fixtures/hub-eb238dd.sql','utf8'));
 await db.exec('create schema auth;create table auth.users(id uuid primary key);');
 await db.exec(readFileSync('shared-service/fixtures/crosspuns-eb238dd.sql','utf8'));
 for(const f of readdirSync('shared-service/patches').sort().filter(f=>f<'0011'))await db.exec(readFileSync(`shared-service/patches/${f}`,'utf8'));
 const call=async<T = Record<string,string>>(fn:string,args:unknown[],role='social_gateway')=>{
  await db.exec(`set role ${role}`);try{return (await db.query<{r:HubReply<T>}>(`select social.${fn}(${args.map((_,i)=>`$${i+1}`).join(',')}) r`,args)).rows[0].r;}finally{await db.exec('reset role');}
 };
 const alice='user_mini00000001',bob='user_mini00000002';
 for(const u of [alice,bob]){await call('ensure_person',[u,'rainbow']);await call('set_profile',[u,u,'fox','#DED1F2']);}
 const invite=await call('create_friend_invite',[alice,1]);
 const friendship=await call('accept_friend_invite',[bob,invite.data.code,1]);
 await call('set_friend_preference',[bob,friendship.data.friendRef,true,'Private pal']);
 const g=await call('create_group',[alice,'Mini club','Alice',1]);await call('join_group',[bob,g.data.inviteCode,'Bob',1]);
 const at=(await db.query<{at:string}>("select social.iso(now()) at")).rows[0].at;
 const record=(u:string,p:string,s:unknown)=>call('record_completion',[u,'rainbow',p,at,JSON.stringify(s),JSON.stringify('YYYY')],'social_game_server');
 expect((await record(alice,'full-1',{solved:true,mistakes:2})).ok).toBe(true);
 const cards=()=>db.query('select * from social.result_cards order by game,puzzle_id,person_id');
 const snapshot=JSON.stringify((await cards()).rows);
 const acl=async()=>JSON.stringify((await db.query("select oid,proowner,proacl,prosecdef,proconfig from pg_proc where oid='social.result_fits(text,jsonb,jsonb)'::regprocedure")).rows);
 const definition=async()=>(await db.query<{d:string}>("select pg_get_functiondef('social.result_fits(text,jsonb,jsonb)'::regprocedure) d")).rows[0].d;
 const before=await definition(),permissions=await acl();
 const forward=readFileSync('shared-service/patches/0011_rainbow_mini_seconds.sql','utf8');
 // Execute the exact candidate function in a transaction; rehearsal leaves no change.
 await db.exec(forward.replace(/commit;\s*$/,'rollback;'));
 expect(await definition()).toBe(before);expect(JSON.stringify((await cards()).rows)).toBe(snapshot);
 await db.exec(forward);expect(await acl()).toBe(permissions);expect(JSON.stringify((await cards()).rows)).toBe(snapshot);
 for(const seconds of [0,-1,1.5,'42',null,true,{},[],Number.MAX_SAFE_INTEGER+1])expect((await record(alice,'bad',{solved:true,mistakes:1,seconds})).outcome).toBe('bad_result');
 expect((await record(alice,'mini-1',{solved:true,mistakes:1,seconds:42})).ok).toBe(true);
 expect((await record(bob,'full-1',{solved:true,mistakes:0})).ok).toBe(true);
 const locked=await call<ResultRow[]>('list_results',[bob,'rainbow','mini-1']);
 expect(locked.data[0].summary).toEqual({solved:true,mistakes:1,seconds:42});expect(locked.data[0].detailLocked).toBe(true);expect(locked.data[0]).not.toHaveProperty('detail');
 expect((await record(bob,'mini-1',{solved:false,mistakes:4})).ok).toBe(true);
 const unlocked=await call<ResultRow[]>('list_results',[bob,'rainbow','mini-1']);expect(unlocked.data.every(r=>r.detailLocked===false)).toBe(true);
 const recorded=JSON.stringify((await cards()).rows);
 await record(alice,'mini-1',{solved:true,mistakes:0,seconds:1});expect(JSON.stringify((await cards()).rows)).toBe(recorded);
 // Optional rollback preserves cards and all unrelated operation privileges.
 await db.exec(readFileSync('shared-service/rollback/0011_rainbow_mini_seconds.sql','utf8'));
 expect(await definition()).toBe(before);expect(await acl()).toBe(permissions);expect(JSON.stringify((await cards()).rows)).toBe(recorded);
 expect((await call<Record<string,unknown>[]>('list_friend_preferences',[bob])).data[0]).toMatchObject({favorite:true,nickname:'Private pal'});
 await db.exec(forward);
 await call('block',[bob,friendship.data.friendRef]);
 expect((await call<ResultRow[]>('list_results',[bob,'rainbow','mini-1'])).data.every(r=>r.isMe)).toBe(true);
 expect((await call<ResultRow[]>('list_results',[bob,'rainbow','mini-1',g.data.groupId])).data.every(r=>r.isMe)).toBe(true);
 }finally{await db.close();}
},30000);

it('executes the actual gateway completion SQL with Full/Mini format matching and historical eligibility',async()=>{
 const db=new PGlite();
 try {
 const baseline=readFileSync('supabase/migrations/0001_rainbow_baseline.sql','utf8');
 // Verbatim source table definitions (foreign keys/indexes/auth policies outside these definitions are not installed).
 for(const table of ['accounts','puzzles','game_sessions']){
  const start=baseline.indexOf(`CREATE TABLE public.${table} (`);const end=baseline.indexOf('\n);',start)+3;
  await db.exec(baseline.slice(start,end));
 }
 const uid='11111111-1111-4111-8111-111111111111',full='22222222-2222-4222-8222-222222222222',mini='33333333-3333-4333-8333-333333333333',user='user_mini00000001';
 await db.query('insert into public.accounts(user_id,global_user_id)values($1,$2)',[uid,user]);
 for(const [p,f] of [[full,'full'],[mini,'mini']])await db.query("insert into public.puzzles(id,date,is_published,is_beta,format)values($1,'2026-01-01',true,false,$2)",[p,f]);
 const add=async(p:string,f:string,context:string,time:string)=>db.query("insert into public.game_sessions(puzzle_id,user_id,won,mistakes,active_time_seconds,share_grid,status,is_official,entry_context,completed_at,format)values($1,$2,true,1,42,'YYYY','won',true,$3,$4,$5)",[p,uid,context,time,f]);
 await add(mini,'mini','daily_home','2026-01-01T12:00:00Z');await add(mini,'full','daily_home','2026-01-01T12:00:00Z');await add(mini,'mini','archive','2026-01-01T12:00:00Z');
 await add(full,'full','daily_home','2026-01-01T12:00:00Z');
 const rows=async(p:string)=>(await db.query(COMPLETIONS_SQL,[JSON.stringify([user]),p])).rows;
 expect(await rows(mini)).toMatchObject([{format:'mini',active_time_seconds:42}]);expect(await rows(mini)).toHaveLength(1);
 expect(await rows(full)).toMatchObject([{format:'full'}]);expect(await rows(full)).toHaveLength(1);
 // No new daily: late home play remains valid only for that format.
 await add(mini,'mini','daily_home','2026-01-10T12:00:00Z');expect(await rows(mini)).toHaveLength(2);
 await db.exec("insert into public.puzzles(date,is_published,is_beta,format)values('2026-01-02',true,false,'mini')");
 expect(await rows(mini)).toHaveLength(1);
 }finally{await db.close();}
},30000);
