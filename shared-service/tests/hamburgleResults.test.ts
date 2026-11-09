import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {it,expect} from 'vitest';
import {handleSocialGateway,type GatewayDb,type Queries} from '../../supabase/functions/social-gateway/core';

/**
 * The proposed, unnumbered Hamburgle patch on the released hub plus every
 * released patch through Mini (0011), and the gateway's real SQL for Hamburgle
 * callers, all on a throwaway PGlite. Nothing hosted.
 */
type HubReply<T = any> = {ok: boolean; outcome?: string; data: T};

const PATCH = readFileSync('shared-service/patches/0013_hamburgle_results.sql','utf8');
const ROLLBACK = readFileSync('shared-service/rollback/0013_hamburgle_results.sql','utf8');
const MINI = readFileSync('shared-service/patches/0011_rainbow_mini_seconds.sql','utf8');

// The two tables the gateway reads, copied from Hamburgle db/progress.sql at
// 0d42546, plus minimal stand-ins for auth.identities and the two columns of
// Rainbow's public.accounts that ACCOUNT_SQL reads.
const GAME_TABLES = `
create table auth.identities (user_id uuid not null, provider text not null, provider_id text not null, created_at timestamptz not null default now());
create table public.accounts (user_id uuid primary key, global_user_id text not null unique);
create schema hamburgle;
create table hamburgle.progress_accounts (
  id             uuid primary key default gen_random_uuid(),
  global_user_id text not null unique,
  created_at     timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  constraint progress_accounts_global_user_id_format check (global_user_id ~ '^user_[0-9A-Za-z]{10,64}$')
);
create table hamburgle.progress_daily (
  account_id   uuid not null references hamburgle.progress_accounts (id),
  daily_number integer not null check (daily_number between 1 and 100000),
  entry        jsonb not null check (jsonb_typeof(entry) = 'object'),
  receipts     jsonb not null default '{}'::jsonb check (jsonb_typeof(receipts) = 'object'),
  updated_at   timestamptz not null default now(),
  primary key (account_id, daily_number)
);`;

/**
 * The hub exactly as production will have it before this patch: the released
 * 0002-0011 chain, WITHOUT 0012 (recent completions is deferred and is not part
 * of the Hamburgle release), or only the patches before `upTo`.
 */
async function hub(upTo = '0013'): Promise<PGlite> {
 const db=new PGlite();
 await db.exec('create role anon nologin;create role authenticated nologin;create role service_role nologin;');
 await db.exec(readFileSync('shared-service/fixtures/hub-eb238dd.sql','utf8'));
 await db.exec('create schema auth;create table auth.users(id uuid primary key);');
 await db.exec(readFileSync('shared-service/fixtures/crosspuns-eb238dd.sql','utf8'));
 for(const file of readdirSync('shared-service/patches').filter(f=>f.endsWith('.sql')&&f<upTo&&!f.startsWith('0012_')).sort())await db.exec(readFileSync(`shared-service/patches/${file}`,'utf8'));
 expect((await db.query("select to_regprocedure('social.recent_completions(text,text,text,text)') f")).rows[0]).toEqual({f:null});
 return db;
}

async function as<T = HubReply>(db: PGlite, role: string, sql: string, params: unknown[]): Promise<T> {
 await db.exec(`set role ${role}`);
 try{return (await db.query<{r:T}>(sql,params)).rows[0].r;}finally{await db.exec('reset role');}
}
const call=(db:PGlite,fn:string,args:unknown[])=>as(db,'social_gateway',`select social.${fn}(${args.map((_,i)=>`$${i+1}`).join(',')}) r`,args);
const record=(db:PGlite,who:string,game:string,puzzle:string,at:string,summary:unknown,detail:unknown=null)=>
 as(db,'social_game_server','select social.record_completion($1,$2,$3,$4,$5::text::jsonb,$6::text::jsonb) r',[who,game,puzzle,at,JSON.stringify(summary),detail===null?null:JSON.stringify(detail)]);
const fits=async(db:PGlite,game:string,summary:unknown,detail:unknown=null)=>(await db.query<{f:boolean}>('select social.result_fits($1,$2::text::jsonb,$3::text::jsonb) f',[game,JSON.stringify(summary),detail===null?null:JSON.stringify(detail)])).rows[0].f;
const FUNCTIONS="'social.result_fits(text,jsonb,jsonb)'::regprocedure,'social.game_enabled(text)'::regprocedure,'social.list_results(text,text,text,text)'::regprocedure";
const definitions=async(db:PGlite)=>JSON.stringify((await db.query(`select p.oid,p.proowner,p.proacl,p.prosecdef,p.proconfig,pg_get_functiondef(p.oid) d from pg_proc p where p.oid in (${FUNCTIONS}) order by p.oid`)).rows);
const cards=async(db:PGlite)=>JSON.stringify((await db.query('select game,puzzle_id,person_id,completed_at,summary,detail from social.result_cards order by game,puzzle_id,person_id')).rows);
const nowIso=async(db:PGlite)=>(await db.query<{at:string}>('select social.iso(now()) at')).rows[0].at;
const enabled=async(db:PGlite,game:string)=>(await db.query<{e:boolean}>('select social.game_enabled($1) e',[game])).rows[0].e;
/** A refused patch or rollback must leave everything exactly as it was. */
async function refusesAndChangesNothing(db:PGlite,sql:string,message:RegExp){
 const before=await definitions(db);
 await expect(db.exec(sql)).rejects.toThrow(message);
 await db.exec('rollback'); // clears the aborted transaction the failed file left open
 expect(await definitions(db)).toBe(before);
}

it('records and lists Hamburgle results of exactly { guesses, solved }, refuses every other shape, and keeps Mini and the other games as released',async()=>{
 const db=await hub();
 try {
 const before=await definitions(db);
 await db.exec(PATCH);
 await db.exec(PATCH); // re-runnable, as the whole-chain reapplication test does
 const after=JSON.parse(await definitions(db)) as Record<string,unknown>[];
 const old=JSON.parse(before) as Record<string,unknown>[];
 expect(after).toHaveLength(3);
 for(let i=0;i<old.length;i++)for(const key of ['oid','proowner','proacl','prosecdef','proconfig'])expect(after[i][key]).toEqual(old[i][key]);

 const alice='user_hamburgle00001';
 await call(db,'ensure_person',[alice,'hamburgle']);
 const at=await nowIso(db);
 const stored=await cards(db);
 for(const [summary,detail] of [
  [{guesses:3},null],[{solved:true},null],[{guesses:0,solved:true},null],[{guesses:-1,solved:true},null],[{guesses:1.5,solved:true},null],
  [{guesses:'3',solved:true},null],[{guesses:3,solved:'true'},null],[{guesses:3,solved:1},null],[{guesses:3,solved:null},null],
  [{guesses:3,solved:true,seconds:40},null],[{guesses:3,solved:true,mistakes:0},null],[{guesses:3,solved:true},'GGGG'],[{guesses:3,solved:true},[true]],
 ] as [unknown,unknown][]){
  expect((await record(db,alice,'hamburgle','daily:12',at,summary,detail)).outcome,JSON.stringify([summary,detail])).toBe('bad_result');
 }
 expect(await cards(db)).toBe(stored);

 expect((await record(db,alice,'hamburgle','daily:12',at,{guesses:3,solved:true})).ok).toBe(true);
 expect((await record(db,alice,'hamburgle','daily:13',at,{guesses:6,solved:false})).ok).toBe(true);
 const mine=await call(db,'list_results',[alice,'hamburgle','daily:12']);
 expect(mine.ok).toBe(true);
 expect(mine.data).toHaveLength(1);
 expect(mine.data[0]).toMatchObject({isMe:true,summary:{guesses:3,solved:true},detail:null,detailLocked:false});
 // The first result stands.
 const recorded=await cards(db);
 expect((await record(db,alice,'hamburgle','daily:12',at,{guesses:1,solved:true})).ok).toBe(true);
 expect(await cards(db)).toBe(recorded);

 // Every other game's shape and switch is as released, Mini's optional seconds included.
 for(const [game,summary,detail,expected] of [
  ['rainbow',{solved:true,mistakes:1},'GGGG',true],['rainbow',{solved:true,mistakes:1,seconds:40},'GGGG',true],
  ['rainbow',{solved:true,mistakes:1,seconds:0},'GGGG',false],['rainbow',{solved:true,mistakes:1,seconds:1.5},'GGGG',false],
  ['rainbow',{solved:true,mistakes:1,seconds:'40'},'GGGG',false],['rainbow',{solved:true,mistakes:1},null,false],
  ['crosspuns',{seconds:95},null,true],['crosspuns',{seconds:95},'x',false],['wtf',{score:7},[true,false],true],
  ['yodel',{score:5},null,true],['priceiswhat',{score:80},null,true],['cluevoyance',{score:1},null,false],
 ] as [string,unknown,unknown,boolean][])expect(await fits(db,game,summary,detail),`${game} ${JSON.stringify(summary)}`).toBe(expected);
 for(const game of ['rainbow','crosspuns','cluevoyance','wtf','hamburgle'])expect(await enabled(db,game)).toBe(true);
 for(const game of ['yodel','priceiswhat','chess'])expect(await enabled(db,game)).toBe(false);
 for(const game of ['yodel','priceiswhat'])expect((await record(db,alice,game,'daily:12',at,{score:1})).outcome).toBe('game_disabled');
 }finally{await db.close();}
},30000);

it('result_fits is exactly Mini 0011 apart from the hamburgle branch',async()=>{
 const db=await hub();
 try {
 const body=async()=>(await db.query<{s:string}>("select prosrc s from pg_proc where oid='social.result_fits(text,jsonb,jsonb)'::regprocedure")).rows[0].s;
 const mini=await body();
 await db.exec(PATCH);
 const ours=await body();
 const outside=(s:string)=>s.replace(/when 'hamburgle' then[\s\S]*?p_detail is null;/,'<hamburgle>');
 expect(outside(ours)).toBe(outside(mini));
 expect(ours).not.toBe(mini);
 }finally{await db.close();}
},30000);

it('refuses a hub without Mini 0011, and changes nothing',async()=>{
 const db=await hub('0011');
 try {
 await refusesAndChangesNothing(db,PATCH,/result_fits\(text,jsonb,jsonb\) is not the released body/);
 expect(await enabled(db,'hamburgle')).toBe(false);
 expect(await fits(db,'rainbow',{solved:true,mistakes:1,seconds:40},'GGGG')).toBe(false);
 }finally{await db.close();}
},30000);

it('refuses a hub where another patch already replaced list_results or game_enabled, and changes nothing',async()=>{
 for(const [other,fn] of [
  [`create or replace function social.game_enabled(p_game text) returns boolean language sql immutable set search_path = social, pg_temp as $$ select p_game = 'rainbow' $$;`,'game_enabled'],
  [readFileSync('shared-service/fixtures/hub-eb238dd.sql','utf8').split('\n').slice(2184,2259).join('\n').replace('create function','create or replace function').replace('return social.ok(v_rows);','return social.ok(coalesce(v_rows, \'[]\'::jsonb));'),'list_results'],
 ] as const){
  const db=await hub();
  try {
  await db.exec(other);
  await refusesAndChangesNothing(db,PATCH,new RegExp(`${fn}\\(.*\\) is not the released body`));
  }finally{await db.close();}
 }
},60000);

it('the rollback refuses anything but exactly the state the patch leaves, and changes nothing',async()=>{
 const db=await hub();
 try {
 await refusesAndChangesNothing(db,ROLLBACK,/is not the body patches\/0013_hamburgle_results.sql leaves/);
 await db.exec(PATCH);
 await db.exec(MINI); // someone re-ran 0011 over it: result_fits is no longer the patch's
 await refusesAndChangesNothing(db,ROLLBACK,/result_fits\(text,jsonb,jsonb\) is not the body/);
 expect(await enabled(db,'hamburgle')).toBe(true);
 }finally{await db.close();}
},30000);

it('rollback restores all three functions exactly as Mini left them and keeps the cards already recorded',async()=>{
 const db=await hub();
 try {
 const before=await definitions(db);
 await db.exec(PATCH);
 const alice='user_hamburgle00001';
 await call(db,'ensure_person',[alice,'hamburgle']);
 const at=await nowIso(db);
 expect((await record(db,alice,'hamburgle','daily:12',at,{guesses:2,solved:true})).ok).toBe(true);
 const recorded=await cards(db);
 await db.exec(ROLLBACK);
 expect(await definitions(db)).toBe(before);
 expect(await cards(db)).toBe(recorded);
 expect(await fits(db,'rainbow',{solved:true,mistakes:1,seconds:40},'GGGG')).toBe(true);
 expect((await record(db,alice,'hamburgle','daily:14',at,{guesses:2,solved:true})).outcome).toBe('game_disabled');
 expect((await call(db,'list_results',[alice,'hamburgle','daily:12'])).data[0]).toMatchObject({summary:{guesses:2,solved:true}});
 // And the patch can go on again afterwards.
 await db.exec(PATCH);
 expect(await enabled(db,'hamburgle')).toBe(true);
 }finally{await db.close();}
},30000);

it('runs after every released patch, twice over, as the whole-chain reapplication does',async()=>{
 const db=await hub();
 try {
 await db.exec(PATCH);
 const once=await definitions(db);
 for(const file of readdirSync('shared-service/patches').filter(f=>f.endsWith('.sql')&&f<'0011').sort())await db.exec(readFileSync(`shared-service/patches/${file}`,'utf8'));
 await db.exec(PATCH);
 expect(await definitions(db)).toBe(once);
 }finally{await db.close();}
},30000);

// ── History on join (provisional scope: Hamburgle groups only) ──

it('in a Hamburgle group, current members see each other\'s earlier results; leaving, removal and blocks still hide them; friends and other games stay forward-only',async()=>{
 const db=await hub();
 try {
 await db.exec(PATCH);
 const [ana,ben,cleo,dev,eve]=['user_history00001','user_history00002','user_history00003','user_history00004','user_history00005'];
 for(const who of [ana,ben,cleo,dev,eve]){
  await call(db,'ensure_person',[who,'hamburgle']);
  expect((await call(db,'set_profile',[who,who.slice(-5),'fox','#DED1F2'])).ok).toBe(true);
 }
 const tick=async()=>{await sleep(20);const at=await nowIso(db);await sleep(20);return at;};
 const list=async(who:string,puzzle:string,group?:string,game='hamburgle')=>{
  const answer=await call(db,'list_results',group?[who,game,puzzle,group]:[who,game,puzzle]);
  expect(answer.ok,JSON.stringify(answer)).toBe(true);
  return answer.data as {isMe:boolean;name:string;summary:{guesses:number;solved:boolean};detail?:unknown;detailLocked:boolean;memberRef?:string}[];
 };
 const others=async(who:string,puzzle:string,group?:string,game='hamburgle')=>(await list(who,puzzle,group,game)).filter(r=>!r.isMe).map(r=>r.name).sort();

 // Before any connection: Ana and Ben finish Daily #30, and Ana a Rainbow puzzle.
 await record(db,ana,'hamburgle','daily:30',await tick(),{guesses:2,solved:true});
 await record(db,ben,'hamburgle','daily:30',await tick(),{guesses:6,solved:false});
 await record(db,ana,'rainbow','rb-1',await tick(),{solved:true,mistakes:0},'GGGG');
 await record(db,dev,'hamburgle','daily:30',await tick(),{guesses:4,solved:true});
 await record(db,eve,'hamburgle','daily:30',await tick(),{guesses:3,solved:true});

 const club=await call(db,'create_group',[cleo,'Burger club','Cleo',1]);
 const group=club.data.groupId as string;
 await tick();
 for(const [who,name] of [[ana,'Ana'],[ben,'Ben'],[dev,'Dev'],[eve,'Eve']])expect((await call(db,'join_group',[who,club.data.inviteCode,name,1])).ok).toBe(true);

 // Both directions: the new members bring their earlier results, and see the others'.
 expect(await others(ben,'daily:30',group)).toEqual(['Ana','Dev','Eve']);
 expect(await others(ana,'daily:30',group)).toEqual(['Ben','Dev','Eve']);
 expect(await others(cleo,'daily:30',group)).toEqual(['Ana','Ben','Dev','Eve']);
 const row=(await list(cleo,'daily:30',group)).find(r=>r.name==='Ana');
 expect(row).toMatchObject({summary:{guesses:2,solved:true},detail:null,detailLocked:false});
 // Own row as ever, and a puzzle nobody finished lists nobody.
 expect((await list(cleo,'daily:31',group))).toEqual([]);

 // A non-member gets the same refusal as before.
 const outsider='user_history00009';
 await call(db,'ensure_person',[outsider,'hamburgle']);
 expect(await call(db,'list_results',[outsider,'hamburgle','daily:30',group])).toEqual({ok:false,outcome:'not_a_member'});

 // Friends stay forward-only: becoming friends now shows Ana nothing of Ben's earlier Daily.
 const invite=await call(db,'create_friend_invite',[ana,1]);
 expect((await call(db,'accept_friend_invite',[ben,invite.data.code,1])).ok).toBe(true);
 expect(await others(ana,'daily:30')).toEqual([]);
 // Other games' groups stay forward-only too (provisional scope), with Rainbow's detail lock as before.
 expect(await others(ben,'rb-1',group,'rainbow')).toEqual([]);
 await record(db,ana,'rainbow','rb-2',await tick(),{solved:true,mistakes:1},'GGGG');
 expect((await list(ben,'rb-2',group,'rainbow'))[0]).toMatchObject({name:'Ana',detailLocked:true});
 expect((await list(ben,'rb-2',group,'rainbow'))[0]).not.toHaveProperty('detail');

 // A block hides rows both ways, though both stay members.
 const eveRef=(await list(cleo,'daily:30',group)).find(r=>r.name==='Eve')!.memberRef!;
 expect((await call(db,'block',[cleo,eveRef])).ok).toBe(true);
 expect(await others(cleo,'daily:30',group)).toEqual(['Ana','Ben','Dev']);
 expect((await call(db,'list_results',[eve,'hamburgle','daily:30',group])).data.map((r:{name:string})=>r.name).sort()).toEqual(['Ana','Ben','Dev','Eve']);

 // Leaving or being removed: no row, either way.
 const devRef=(await list(cleo,'daily:30',group)).find(r=>r.name==='Dev')!.memberRef!;
 expect((await call(db,'remove_member',[cleo,group,devRef])).ok).toBe(true);
 expect((await call(db,'leave_group',[ben,group])).ok).toBe(true);
 expect(await others(ana,'daily:30',group)).toEqual(['Eve']);
 expect(await call(db,'list_results',[ben,'hamburgle','daily:30',group])).toEqual({ok:false,outcome:'not_a_member'});
 expect(await call(db,'list_results',[dev,'hamburgle','daily:30',group])).toEqual({ok:false,outcome:'not_a_member'});
 // Coming back makes them a current member again, history and all.
 expect((await call(db,'join_group',[ben,club.data.inviteCode,'Ben',1])).ok).toBe(true);
 expect(await others(ana,'daily:30',group)).toEqual(['Ben','Eve']);

 // Rolled back: Hamburgle groups are forward-only again, and nothing recorded is lost.
 const kept=await cards(db);
 await db.exec(ROLLBACK);
 expect(await others(ana,'daily:30',group)).toEqual([]);
 expect(await cards(db)).toBe(kept);
 }finally{await db.close();}
},60000);

// ── The gateway's real statements, with Hamburgle accounts ──

const PUBLISHABLE='sb_publishable_TEST_publishable_key_0001';
const SECRET='sb_secret_TEST_secret_key_0001';

const gatewayDb=(db:PGlite):GatewayDb=>({
 transaction:<T,>(work:(tx:Queries)=>Promise<T>)=>db.transaction(async tx=>work({query:async(text,params)=>(await tx.query<Record<string,unknown>>(text,params)).rows})),
});

/** The token stands for the auth user id Auth would return for it. */
async function gateway(db:PGlite,hamburgle:boolean,authUser:string,op:string,args:unknown):Promise<HubReply>{
 const request=new Request('http://localhost/functions/v1/social-gateway',{method:'POST',headers:{'content-type':'application/json',apikey:PUBLISHABLE,authorization:`Bearer ${authUser}`},body:JSON.stringify({op,args})});
 const response=await handleSocialGateway(request,{keys:{publishable:[PUBLISHABLE],secret:[SECRET]},verifyUserToken:async token=>({id:token,isAnonymous:false}),allowPreview:()=>true,access:'everyone',hamburgle,db:gatewayDb(db)});
 return response.json();
}

const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

it('a Hamburgle-only account uses the hub through the gateway, shares only finished counted Dailies, and stays one person when it later gets a Rainbow account',async()=>{
 const db=await hub();
 try {
 await db.exec(PATCH);
 await db.exec(GAME_TABLES);
 const people={alice:{uid:'11111111-1111-4111-8111-111111111111',gid:'user_hamburgle00001'},bob:{uid:'22222222-2222-4222-8222-222222222222',gid:'user_hamburgle00002'}};
 const account:Record<string,string>={};
 for(const [name,{uid,gid}] of Object.entries(people)){
  await db.query("insert into auth.identities(user_id,provider,provider_id) values ($1,'custom:platform',$2)",[uid,gid]);
  account[name]=(await db.query<{id:string}>('insert into hamburgle.progress_accounts(global_user_id) values ($1) returning id',[gid])).rows[0].id;
 }
 const {alice,bob}=people;
 expect((await db.query("select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='hamburgle'")).rows).toHaveLength(0);

 // Only the custom:platform identity counts: another provider naming Alice's id is no one.
 const stray='33333333-3333-4333-8333-333333333333';
 await db.query("insert into auth.identities(user_id,provider,provider_id) values ($1,'email',$2)",[stray,alice.gid]);
 expect(await gateway(db,true,stray,'getMe',{})).toEqual({ok:false,outcome:'not_linked'});

 // Off: exactly today's behaviour, and nobody is created.
 expect(await gateway(db,false,alice.uid,'getMe',{})).toEqual({ok:false,outcome:'not_linked'});
 expect((await db.query('select 1 from social.persons')).rows).toHaveLength(0);

 // On: in, linked to Hamburgle only.
 const me=await gateway(db,true,alice.uid,'getMe',{});
 expect(me.ok).toBe(true);
 // Without 0012 the gateway's recentCompletions operation (Rainbow's, no client calls it) fails closed, and the hub carries on.
 expect(await gateway(db,true,alice.uid,'recentCompletions',{from:'2026-11-01T00:00:00.000Z',until:'2026-11-06T00:00:00.000Z'})).toEqual({ok:false,outcome:'unavailable'});
 expect((await gateway(db,true,alice.uid,'getMe',{})).ok).toBe(true);
 expect((await db.query<{game:string}>('select l.game from social.game_links l join social.persons p on p.id=l.person_id where p.global_user_id=$1',[alice.gid])).rows.map(r=>r.game)).toEqual(['hamburgle']);
 for(const [who,name] of [[alice,'Alice'],[bob,'Bob']] as const)expect((await gateway(db,true,who.uid,'setProfile',{displayName:name,animalId:'fox',backgroundColor:'#DED1F2'})).ok).toBe(true);
 const invite=await gateway(db,true,alice.uid,'createFriendInvite',{noticeVersion:1});
 expect((await gateway(db,true,bob.uid,'acceptFriendInvite',{code:invite.data.code,noticeVersion:1})).ok).toBe(true);

 await sleep(20);
 const at=new Date().toISOString();
 await sleep(20);
 // As src/dated-store.ts keeps it: the counted round says its mode and Daily number.
 const entry=(counted:Record<string,unknown>,extras:unknown[]=[])=>(n:number)=>JSON.stringify({counted:{mode:'daily',dated:{number:n,date:'2026-11-05'},...counted},extras});
 const daily=(who:string,n:number,value:(n:number)=>string)=>db.query('insert into hamburgle.progress_daily(account_id,daily_number,entry) values ($1,$2,$3::jsonb)',[account[who],n,value(n)]);
 await daily('alice',12,entry({status:'won',guesses:['PLANT','MELON','BOMBER'],completedAt:at}));
 await daily('bob',12,entry({status:'in_progress',guesses:['PLANT'],completedAt:null},[{status:'won',guesses:['BOMBER'],completedAt:at}]));
 await daily('bob',11,entry({status:'lost',guesses:['A','B','C','D','E','F'],completedAt:at}));
 await daily('alice',13,entry({status:'won',guesses:'not a list',completedAt:at}));
 await daily('alice',14,entry({status:'won',guesses:[],completedAt:at}));
 const progress=async()=>JSON.stringify((await db.query('select * from hamburgle.progress_accounts a full join hamburgle.progress_daily d on d.account_id=a.id order by a.global_user_id,d.daily_number')).rows);
 const untouched=await progress();

 const seen=await gateway(db,true,bob.uid,'listResults',{gameId:'hamburgle',puzzleId:'daily:12'});
 expect(seen.ok).toBe(true);
 expect(seen.data).toHaveLength(1);
 expect(seen.data[0]).toMatchObject({isMe:false,summary:{guesses:3,solved:true},detail:null,detailLocked:false});
 expect((await gateway(db,true,bob.uid,'listResults',{gameId:'hamburgle',puzzleId:'daily:11'})).data).toMatchObject([{isMe:true,summary:{guesses:6,solved:false}}]);
 for(const puzzleId of ['daily:13','daily:14','archive:12','12']){
  const answer=await gateway(db,true,alice.uid,'listResults',{gameId:'hamburgle',puzzleId});
  expect(answer,puzzleId).toEqual({ok:true,data:[]});
 }
 const shared=(await db.query<{puzzle_id:string;summary:unknown;completed_at:string}>("select c.puzzle_id,c.summary,social.iso(c.completed_at) completed_at from social.result_cards c where c.game='hamburgle' order by c.puzzle_id")).rows;
 expect(shared).toEqual([{puzzle_id:'daily:11',summary:{guesses:6,solved:false},completed_at:at},{puzzle_id:'daily:12',summary:{guesses:3,solved:true},completed_at:at}]);
 expect(await progress()).toBe(untouched);
 expect((await db.query('select 1 from public.accounts')).rows).toHaveLength(0);

 // A later Rainbow account with the same global id is the same person: same code, no duplicate.
 await db.query('insert into public.accounts(user_id,global_user_id) values ($1,$2)',[alice.uid,alice.gid]);
 for(const hamburgle of [true,false]){
  const again=await gateway(db,hamburgle,alice.uid,'getMe',{});
  expect(again.data.friendCode).toBe(me.data.friendCode);
  expect(again.data.friendCount).toBe(1);
 }
 expect((await db.query('select 1 from social.persons where global_user_id=$1',[alice.gid])).rows).toHaveLength(1);
 expect((await db.query<{game:string}>('select l.game from social.game_links l join social.persons p on p.id=l.person_id where p.global_user_id=$1 order by l.game',[alice.gid])).rows.map(r=>r.game)).toEqual(['hamburgle','rainbow']);
 }finally{await db.close();}
},30000);

it('shares only within the audience (friends from the connection on, a Hamburgle group with each current member’s history), keeps the first result, picks up a later finish, and covers a Rainbow-first account',async()=>{
 const db=await hub();
 try {
 await db.exec(PATCH);
 await db.exec(GAME_TABLES);
 let made=0;
 type Who={uid:string;gid:string;account:string|null};
 const person=async(gid:string,{rainbow=false}={}):Promise<Who>=>{
  const uid=`00000000-0000-4000-8000-${String(++made).padStart(12,'0')}`;
  await db.query("insert into auth.identities(user_id,provider,provider_id) values ($1,'custom:platform',$2)",[uid,gid]);
  const account=(await db.query<{id:string}>('insert into hamburgle.progress_accounts(global_user_id) values ($1) returning id',[gid])).rows[0].id;
  if(rainbow)await db.query('insert into public.accounts(user_id,global_user_id) values ($1,$2)',[uid,gid]);
  return {uid,gid,account};
 };
 const g=(who:Who,op:string,args:unknown)=>gateway(db,true,who.uid,op,args);
 const alice=await person('user_isolation0001'),bob=await person('user_isolation0002'),carol=await person('user_isolation0003');
 const dave=await person('user_isolation0004',{rainbow:true}),erin=await person('user_isolation0005');
 for(const [who,name] of [[alice,'Alice'],[bob,'Bob'],[carol,'Carol'],[dave,'Dave'],[erin,'Erin']] as const){
  expect((await g(who,'setProfile',{displayName:name,animalId:'fox',backgroundColor:'#DED1F2'})).ok,name).toBe(true);
 }
 const linksOf=async(who:Who)=>(await db.query<{game:string}>('select l.game from social.game_links l join social.persons p on p.id=l.person_id where p.global_user_id=$1 order by l.game',[who.gid])).rows.map(r=>r.game);
 expect(await linksOf(dave)).toEqual(['rainbow']);
 expect(await linksOf(alice)).toEqual(['hamburgle']);

 const put=(who:Who,n:number,counted:Record<string,unknown>)=>db.query(
  'insert into hamburgle.progress_daily(account_id,daily_number,entry) values ($1,$2,$3::jsonb) on conflict (account_id,daily_number) do update set entry=excluded.entry',
  [who.account,n,JSON.stringify({counted:{mode:'daily',dated:{number:n,date:'2026-11-05'},...counted},extras:[]})]);
 const won=(guesses:number,at:string)=>({status:'won',guesses:Array(guesses).fill('BURGER'),completedAt:at});
 const tick=async()=>{await sleep(20);const at=new Date().toISOString();await sleep(20);return at;};
 const cardsFor=async(puzzle:string)=>(await db.query<{n:number}>("select count(*)::int n from social.result_cards where game='hamburgle' and puzzle_id=$1",[puzzle])).rows[0].n;
 const others=(answer:HubReply)=>(answer.data as {isMe:boolean;summary:{guesses:number;solved:boolean}}[]).filter(r=>!r.isMe).map(r=>r.summary).sort((a,b)=>a.guesses-b.guesses);

 // Finished before Alice and Bob were connected: recorded, but never shown to Bob as a friend.
 await put(alice,20,won(2,await tick()));
 const befriend=async(a:Who,b:Who)=>{const invite=await g(a,'createFriendInvite',{noticeVersion:1});expect((await g(b,'acceptFriendInvite',{code:invite.data.code,noticeVersion:1})).ok).toBe(true);};
 await befriend(alice,bob);
 await befriend(dave,bob);
 const club=await g(erin,'createGroup',{name:'Burger club',myName:'Erin',noticeVersion:1});
 expect((await g(bob,'joinGroup',{code:club.data.inviteCode,myName:'Bob',noticeVersion:1})).ok).toBe(true);
 expect((await g(bob,'listResults',{gameId:'hamburgle',puzzleId:'daily:20'})).data).toEqual([]);
 expect(await cardsFor('daily:20')).toBe(1);

 const at=await tick();
 await put(alice,12,won(3,at));
 await put(carol,12,won(1,at));
 await put(dave,12,{status:'lost',guesses:Array(6).fill('BURGER'),completedAt:at});
 await put(erin,12,won(4,at));
 await put(bob,12,{status:'in_progress',guesses:['BURGER','BUNNED'],completedAt:null});
 await put(alice,15,{...won(2,at),mode:'archive'});
 await put(alice,16,{...won(2,at),dated:{number:99,date:'2026-11-05'}});

 // Friends: Alice and the Rainbow-first Dave, never Carol (not connected) or Erin (group only).
 const friends=await g(bob,'listResults',{gameId:'hamburgle',puzzleId:'daily:12'});
 expect(others(friends)).toEqual([{guesses:3,solved:true},{guesses:6,solved:false}]);
 expect(friends.data.some((r:{isMe:boolean})=>r.isMe)).toBe(false);
 expect(await linksOf(dave)).toEqual(['hamburgle','rainbow']);
 // The group: its members only.
 expect(others(await g(bob,'listResults',{gameId:'hamburgle',puzzleId:'daily:12',groupId:club.data.groupId}))).toEqual([{guesses:4,solved:true}]);
 expect((await db.query("select 1 from social.result_cards c join social.persons p on p.id=c.person_id where p.global_user_id=$1",[carol.gid])).rows).toHaveLength(0);

 // Listing again changes nothing, and a later change to a shared attempt doesn't replace it.
 const count=await cardsFor('daily:12');
 await g(bob,'listResults',{gameId:'hamburgle',puzzleId:'daily:12'});
 expect(await cardsFor('daily:12')).toBe(count);
 await put(alice,12,won(1,at));
 expect(others(await g(bob,'listResults',{gameId:'hamburgle',puzzleId:'daily:12'}))).toEqual([{guesses:3,solved:true},{guesses:6,solved:false}]);

 // Bob's attempt in progress shows once he finishes it.
 await put(bob,12,won(2,await tick()));
 const mine=(await g(bob,'listResults',{gameId:'hamburgle',puzzleId:'daily:12'})).data.filter((r:{isMe:boolean})=>r.isMe);
 expect(mine).toMatchObject([{summary:{guesses:2,solved:true}}]);

 // A counted round that says it is an archive play, or another Daily, is never shared.
 for(const puzzleId of ['daily:15','daily:16']){
  expect((await g(alice,'listResults',{gameId:'hamburgle',puzzleId})).data,puzzleId).toEqual([]);
  expect(await cardsFor(puzzleId)).toBe(0);
 }

 // History on join, through the gateway: once Alice joins the club, her Daily #20
 // from before any connection shows in the group, and still not among friends.
 expect((await g(alice,'joinGroup',{code:club.data.inviteCode,myName:'Alice',noticeVersion:1})).ok).toBe(true);
 expect(others(await g(bob,'listResults',{gameId:'hamburgle',puzzleId:'daily:20',groupId:club.data.groupId}))).toEqual([{guesses:2,solved:true}]);
 expect(others(await g(erin,'listResults',{gameId:'hamburgle',puzzleId:'daily:20',groupId:club.data.groupId}))).toEqual([{guesses:2,solved:true}]);
 expect((await g(bob,'listResults',{gameId:'hamburgle',puzzleId:'daily:20'})).data).toEqual([]);
 }finally{await db.close();}
},30000);
