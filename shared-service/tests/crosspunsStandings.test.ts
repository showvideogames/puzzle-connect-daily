import {readFileSync} from 'node:fs';import {PGlite} from '@electric-sql/pglite';import {beforeAll,afterAll,it,expect} from 'vitest';
const db=new PGlite();const users=['user_alice0000001','user_bob000000001','user_carol000001','user_dave0000001'];let group:string,code:string;let refs:string[]=[];
async function call(fn:string,args:unknown[]){await db.exec('set role social_gateway');try{return (await db.query<{r:{ok:boolean;outcome?:string;data:any}}>(`select social.${fn}(${args.map((_,i)=>`$${i+1}`).join(',')}) r`,args)).rows[0].r;}finally{await db.exec('reset role');}}
beforeAll(async()=>{
 await db.exec('create role anon nologin;create role authenticated nologin;create role service_role nologin;');
 await db.exec(readFileSync('shared-service/fixtures/hub-eb238dd.sql','utf8'));
 // Minimal exact source columns/uniqueness from CrossPuns migrations 0002/0007.
 await db.exec(`create table public.xw_accounts(id uuid primary key default gen_random_uuid(),global_user_id text unique,player_key uuid unique default gen_random_uuid());
 create table public.xw_puzzles(id uuid primary key default gen_random_uuid(),publish_date date);
 create table public.xw_times(id uuid primary key default gen_random_uuid(),puzzle_id uuid,player_key uuid,seconds int,created_at timestamptz default now(),unique(puzzle_id,player_key));
 create table public.xw_solves(account_id uuid,puzzle_id uuid,seconds int,used_help boolean,solved_at timestamptz,primary key(account_id,puzzle_id));
 create function public.xw_today_local() returns date language sql as $$select (now() at time zone 'Pacific/Kiritimati')::date$$;`);
 await db.exec(readFileSync('shared-service/patches/0008_crosspuns_standings.sql','utf8'));
 await db.exec(readFileSync('shared-service/patches/0009_crosspuns_rolling.sql','utf8'));
 for(const who of users){await call('ensure_person',[who,'rainbow']);await call('set_profile',[who,who,'fox','#DED1F2']);await db.query('insert into public.xw_accounts(global_user_id) values($1)',[who]);}
 ({groupId:group,inviteCode:code}=(await call('create_group',[users[0],'Club','Alice',1])).data);
 for(let i=1;i<4;i++)await call('join_group',[users[i],code,['Alice','Bob','Carol','Dave'][i],1]);
 const members=(await call('list_members',[users[0],group])).data;refs=['Alice','Bob','Carol','Dave'].map(name=>members.find((m:any)=>m.name===name).memberRef);
 const puzzle=(await db.query<{id:string}>("insert into public.xw_puzzles(publish_date) values('2020-01-01') returning id")).rows[0].id;
 for(let i=0;i<4;i++)await db.query("insert into public.xw_solves select id,$2,$3,false,'2020-01-01' from public.xw_accounts where global_user_id=$1",[users[i],puzzle,[99,10,30,40][i]]);
 // Posted time wins over the stored solve (legacy/import precedence), never twice.
 await db.query('insert into public.xw_times(puzzle_id,player_key,seconds) select $2,player_key,10 from public.xw_accounts where global_user_id=$1',[users[0],puzzle]);
 const hidden=(await db.query<{id:string}>("insert into public.xw_puzzles(publish_date) values(current_date+100) returning id")).rows[0].id;
 await db.query("insert into public.xw_solves select id,$2,1,false,now() from public.xw_accounts where global_user_id=$1",[users[3],hidden]);
},20000);afterAll(()=>db.close());
it('ranks current members using all prior history, competition ties and no duplicate sources',async()=>{
 const answer=await call('crosspuns_standings',[users[0],group,0]);expect(answer.ok).toBe(true);
 expect(answer.data.total).toBe(4);expect(answer.data.rows.map((r:any)=>[r.rank,r.points])).toEqual([[1,3],[1,3],[3,1],[4,0]]);
 expect((await call('crosspuns_standings',[users[0],group,50])).data.rows).toEqual([]);
});
it.each([[7,'2024-02-24'],[30,'2024-02-01'],[365,'2023-03-03']])('filters %i days by publication, inclusive boundaries, regardless of solve date',async(days,start)=>{
 await db.exec('begin');
 try {
  for(const date of [start,'2024-03-01']){
   const puzzle=(await db.query<{id:string}>('insert into public.xw_puzzles(publish_date) values($1) returning id',[date])).rows[0].id;
   // A late solve is attributed to the puzzle's date, not today's timestamp.
   await db.query("insert into public.xw_solves select id,$2,20,false,now() from public.xw_accounts where global_user_id=$1",[users[0],puzzle]);
  }
  for(const expression of ["$1::date-1","'2024-03-02'::date"]){
   const puzzle=(await db.query<{id:string}>(`insert into public.xw_puzzles(publish_date) values(${expression}) returning id`,expression.includes('$1')?[start]:[])).rows[0].id;
   await db.query("insert into public.xw_solves select id,$2,1,false,'2024-03-01' from public.xw_accounts where global_user_id=$1",[users[1],puzzle]);
  }
  const answer=await call('crosspuns_standings_period',[users[0],group,0,days,'2024-03-01']);
  expect(answer.ok).toBe(true);expect(answer.data.rows.find((r:any)=>r.name==='Alice').points).toBe(6);
  expect(answer.data.rows.find((r:any)=>r.name==='Bob').points).toBe(0);
 } finally {await db.exec('rollback');}
});
it('keeps old all-time requests compatible and rejects malformed/incomplete periods',async()=>{
 expect(await call('crosspuns_standings_period',[users[0],group,0,null,null])).toEqual(await call('crosspuns_standings',[users[0],group,0]));
 for(const args of [[7,null],[null,'2024-03-01'],[8,'2024-03-01'],[7,'2024-02-30'],[7,'bad'],[7,'2024-3-1']])expect((await call('crosspuns_standings_period',[users[0],group,0,...args])).ok).toBe(false);
});
it('masks either direction without changing ranks or ordinary block result behavior',async()=>{
 expect((await call('block',[users[0],refs[1]])).ok).toBe(true);
 for(const [viewer,hidden] of [[users[0],refs[1]],[users[1],refs[0]]]){
  const rows=(await call('crosspuns_standings',[viewer,group,0])).data.rows;
  expect(rows.filter((r:any)=>r.blocked)).toEqual([{blocked:true,rank:1,label:'This player is blocked'}]);
  expect(JSON.stringify(rows)).not.toContain(hidden);
  expect(rows.map((r:any)=>r.rank)).toEqual([1,1,3,4]);
 }
 expect((await call('crosspuns_standings',[users[2],group,0])).data.rows.every((r:any)=>!r.blocked)).toBe(true);
 const periodRows=(await call('crosspuns_standings_period',[users[0],group,0,7,'2020-01-01'])).data.rows;
 expect(periodRows.filter((r:any)=>r.blocked)).toEqual([{blocked:true,rank:1,label:'This player is blocked'}]);
 const audience=(await db.query<{r:any}>('select social.audience_global_ids($1,$2) r',[users[0],group])).rows[0].r;
 expect(audience.data).not.toContain(users[1]);
});
it('removes departed contributions, retains personal source history, and restores history on rejoin',async()=>{
 const before=(await db.query('select * from public.xw_solves order by account_id,puzzle_id')).rows;
 await call('leave_group',[users[1],group]);
 expect((await call('crosspuns_standings',[users[0],group,0])).data.rows.map((r:any)=>[r.rank,r.points])).toEqual([[1,3],[2,2],[3,1]]);
 expect(await call('crosspuns_standings',[users[1],group,0])).toMatchObject({ok:false,outcome:'not_a_member'});
 await call('join_group',[users[1],code,'Bob',1]);
 expect((await call('crosspuns_standings',[users[0],group,0])).data.rows.map((r:any)=>r.rank)).toEqual([1,1,3,4]);
 expect((await db.query('select * from public.xw_solves order by account_id,puzzle_id')).rows).toEqual(before);
});
it('refuses unknown/nonmember reads and invalid paging; grants no direct client execution',async()=>{
 expect((await call('crosspuns_standings',['user_unknown0001',group,0])).ok).toBe(false);
 expect((await call('crosspuns_standings',[users[0],'invalid',0])).ok).toBe(false);
 for(const offset of [-1,10001,null])expect((await call('crosspuns_standings',[users[0],group,offset])).ok).toBe(false);
 for(const role of ['anon','authenticated','service_role','social_gateway'])expect((await db.query<{ok:boolean}>("select has_function_privilege($1,'social.crosspuns_standings(text,text,int)','execute') ok",[role])).rows[0].ok).toBe(role==='social_gateway');
});
it('excludes Reveal-only solves and paginates a large group without leaking private ids',async()=>{
 const puzzle=(await db.query<{id:string}>("insert into public.xw_puzzles(publish_date) values('2020-01-02') returning id")).rows[0].id;
 await db.query("insert into public.xw_solves select id,$2,1,true,'2020-01-02' from public.xw_accounts where global_user_id=$1",[users[3],puzzle]);
 expect((await call('crosspuns_standings',[users[3],group,0])).data.rows.find((r:any)=>r.name==='Dave').points).toBe(0);
 await call('ensure_person',['user_outsider0001','rainbow']);
 expect(await call('crosspuns_standings',['user_outsider0001',group,0])).toMatchObject({ok:false,outcome:'not_a_member'});
 // Disposable fixture population avoids daily join limits; no production data.
 for(let i=0;i<51;i++){
  const who=`user_extra${String(i).padStart(10,'0')}`;await call('ensure_person',[who,'rainbow']);
  await db.query("insert into social.memberships(group_id,person_id,name,notice_version) select $1,id,$2,1 from social.persons where global_user_id=$3",[group,`Member ${i}`,who]);
 }
 const first=(await call('crosspuns_standings',[users[3],group,0])).data;
 const last=(await call('crosspuns_standings',[users[3],group,50])).data;
 expect(first.total).toBe(55);expect(first.rows).toHaveLength(50);expect(last.rows).toHaveLength(5);
 expect(new Set([...first.rows,...last.rows].map((r:any)=>r.memberRef)).size).toBe(55);
 expect(JSON.stringify(first)).not.toContain('user_');
});
it('returns unavailable rather than an empty ranking when the source is missing',async()=>{
 await db.exec('alter table public.xw_times rename to xw_times_unavailable');
 expect(await call('crosspuns_standings',[users[0],group,0])).toMatchObject({ok:false,outcome:'unavailable'});
 await db.exec('alter table public.xw_times_unavailable rename to xw_times');
});
