/** Disposable in-process PostgreSQL only. Never connects to a hosted database. */
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { buildSchemaPlan, applySchemaPlan } from './lib/schema.ts';
import { bestNoHintStreak } from '../../src/lib/noHintStreak.ts';
const db = new PGlite();
type Device = {device_id:string;device_token:string};
type History = {completion_order:string;qualified:boolean|null};
async function device():Promise<Device> { return (await db.query<Device>('select * from public.create_device_identity()')).rows[0]; }
let puzzleNumber=0;
async function puzzle(format='full') { return (await db.query<{id:string}>("insert into public.puzzles(date,format,is_published) values ('2000-01-01'::date + $1::int,$2,true) returning id",[++puzzleNumber,format])).rows[0].id; }
async function start(d:Device,p= '', format='full') {
 const pid=p||await puzzle(format);
 const id=(await db.query<{id:string}>("select public.create_game_session($1,$2,$3,'archive_calendar') as id",[pid,d.device_id,d.device_token])).rows[0].id;
 assert.ok(id);return {id,pid};
}
async function finish(d:Device,id:string,won=true,hints:boolean|null=false) {
 return (await db.query<{result:boolean|null}>("select public.finalize_game_session($1,$2,$3,$4,0,10,false,null,'[]'::jsonb,$5,'',true,'2000-01-01') as result",[id,d.device_id,d.device_token,won,hints])).rows[0].result;
}
async function summary(d:Device,format='full') { return (await db.query<{best:number;tracked:number;unknown:number}>('select * from public.get_own_no_hint_streak($1,$2,$3)',[d.device_id,d.device_token,format])).rows[0]; }
async function history(d:Device,format='full') { const rows=(await db.query<History>('select * from public.no_hint_history_for_owner($1,$2,$3)',[d.device_id,d.device_token,format])).rows;assert.deepEqual(await summary(d,format),bestNoHintStreak(rows));return rows; }
async function actAs(id:string|null) { await db.query("select set_config('request.jwt.claims',$1,false)",[id?JSON.stringify({sub:id,role:'authenticated'}):'']); }
async function account() {
 const id=(await db.query<{id:string}>('insert into auth.users default values returning id')).rows[0].id;
 const sub='user_'+id.replaceAll('-','');
 await db.query("insert into auth.identities(user_id,provider,provider_id,identity_data) values ($1,'custom:platform',$2,$3::jsonb)",[id,sub,JSON.stringify({sub})]);
 await actAs(id);await db.query('select * from public.ensure_account()');return id;
}
try {
 const plan=buildSchemaPlan({includeSupabaseStubs:true,includeReset:false});
 await applySchemaPlan(db,plan.filter(x=>!x.label.includes('0003_')));
 const d=await device();const legacy=await start(d);
 await finish(d,legacy.id);
 const before=(await db.query('select id,won,hints_used,completed_at from public.game_sessions')).rows;
 await applySchemaPlan(db,plan.filter(x=>x.label.includes('0003_')));
 assert.deepEqual((await db.query('select id,won,hints_used,completed_at from public.game_sessions')).rows,before);
 assert.deepEqual(await history(d),[]); // no reset/backfill
 const a=await start(d);assert.equal(await finish(d,a.id),true);
 const first=await history(d);assert.equal(first[0].qualified,true);
 assert.equal(await finish(d,a.id),null);assert.deepEqual(await history(d),first);
 const replay=await start(d,a.pid);assert.equal(await finish(d,replay.id,false),false);
 assert.deepEqual(await history(d),first); // non-official loss cannot break streak
 const b=await start(d);await finish(d,b.id);
 await db.query("update public.game_sessions set completed_at='1990-01-01' where id=$1",[b.id]);
 assert.equal(bestNoHintStreak(await history(d)).best,2); // ordering independent of calendar/time
 const loss=await start(d);await finish(d,loss.id,false);
 const hinted=await start(d);await finish(d,hinted.id,true,true);
 const unknown=await start(d);await finish(d,unknown.id,true,null);
 const c=await start(d);await finish(d,c.id);
 assert.deepEqual(bestNoHintStreak(await history(d)),{best:2,tracked:6,unknown:1});
 const mini=await start(d,'','mini');await finish(d,mini.id);
 assert.equal(bestNoHintStreak(await history(d,'mini')).best,1);
 assert.equal((await history(d)).length,6);
 // A hint persisted after completion is still disqualifying, even if the
 // completion payload incorrectly said false. RPC retries remain harmless.
 await db.query("select public.record_hint_event($1,$2,$3,'small',now(),1,0::smallint,0::smallint,0::smallint,false)",[c.id,d.device_id,d.device_token]);
 assert.equal((await history(d)).at(-1)?.qualified,false);
 const rollback=await start(d);await db.exec('BEGIN');await finish(d,rollback.id);await db.exec('ROLLBACK');
 assert.equal((await history(d)).length,6);await finish(d,rollback.id);
 assert.equal((await history(d)).length,7);
 const directPid=await puzzle();await db.query("insert into public.game_sessions(puzzle_id,device_id,won,mistakes,hints_used) values ($1,$2,true,0,false)",[directPid,d.device_id]);
 assert.equal((await history(d)).at(-1)?.qualified,null); // legacy direct completion is unknown
 const stranger=await device();assert.deepEqual(await history(stranger),[]);
 assert.deepEqual(await history({...d,device_token:'invalid'}),[]);
 await db.exec('SET ROLE anon');assert.equal((await summary(d)).tracked,8);await db.exec('RESET ROLE');
 // Authenticated history and guest import preserve orders; overlapping
 // official results are demoted by the existing import function.
 const guestBefore=await history(d);
 const uid=await account();const fresh=await device();
 const own=await start(fresh,a.pid);await finish(fresh,own.id);
 const ownBefore=await history(fresh);assert.equal(ownBefore.length,1);
 await db.query('select * from public.import_guest_history($1,$2)',[d.device_id,d.device_token]);
 const imported=await history(fresh);
 assert.equal(imported.length,ownBefore.length+guestBefore.length-1);
 assert.ok(imported.some(r=>r.completion_order===guestBefore[1].completion_order));
 const count=imported.length;await db.query('select * from public.import_guest_history($1,$2)',[d.device_id,d.device_token]);
 assert.equal((await history(fresh)).length,count);
 await db.exec('SET ROLE authenticated');assert.equal((await summary(fresh)).tracked,count);await db.exec('RESET ROLE');
 await actAs(null);assert.deepEqual(await history(fresh),[]); // account-owned data not exposed as guest
 await actAs(uid);
 // Every persisted completion order is unique, even with replay/rollback gaps.
 const unique=(await db.query<{n:number;u:number}>('select count(no_hint_completion_order)::int n,count(distinct no_hint_completion_order)::int u from public.game_sessions')).rows[0];
 assert.equal(unique.n,unique.u);
 // Server summary stays one row even beyond common API row limits.
 await actAs(null);const many=await device();
 await db.query("with p as (insert into public.puzzles(date,format,is_published) select '3000-01-01'::date + n,'full',true from generate_series(1,1101) n returning id) insert into public.game_sessions(puzzle_id,device_id,mistakes) select id::text,$1,0 from p",[many.device_id]);
 await db.query("update public.game_sessions set status='won',won=true,is_official=true,completed_at=now(),no_hint_qualified=true where device_id=$1",[many.device_id]);
 assert.deepEqual(await summary(many),{best:1101,tracked:1101,unknown:0});
 console.log('PASS: forward baseline, guest/account RPCs, retry, replay, loss/hints/unknown, late hint, rollback/retry, Full/Mini, archive/calendar gaps, import/deduplication, ownership and grants.');
} finally { await db.close(); }
