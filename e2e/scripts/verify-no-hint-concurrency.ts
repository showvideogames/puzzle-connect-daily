/** Acceptance test for the guarded disposable Supabase stack, never production.
 * Requires e2e:up + e2e:reset. Does not reset schemas or apply migrations.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { loadE2eConfig, guardContext, assertIsE2eStack } from '../env.ts';
import { assertDisposableTarget } from '../safety.ts';
import { readStackStatus } from './lib/stack.ts';
import { attachPlatformIdentity } from './lib/seed-supabase.ts';

const config = loadE2eConfig();
assertDisposableTarget('no-hint concurrency acceptance', config, guardContext());
assertIsE2eStack(config.apiUrl, config.dbUrl);
const status = readStackStatus();
assert.ok(status.ok, 'Disposable Supabase stack must be running');
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const guest = createClient(config.apiUrl, config.anonKey, options);
const account = createClient(config.apiUrl, config.anonKey, options);
const admin = createClient(config.apiUrl, config.serviceRoleKey, options);
const observer = new pg.Client({ connectionString: config.dbUrl });
const a = new pg.Client({ connectionString: config.dbUrl });
const b = new pg.Client({ connectionString: config.dbUrl });
const query = `select public.finalize_game_session($1,$2,$3,true,0,10,false,null,'[]'::jsonb,false,'',true,'2000-01-01') as result`;
let uid: string | undefined;
try {
  await Promise.all([observer.connect(), a.connect(), b.connect()]);
  await a.query("set statement_timeout='5s'");
  await b.query("set statement_timeout='5s'");
  const pidA = (await a.query('select pg_backend_pid() as pid')).rows[0].pid;
  const pidB = (await b.query('select pg_backend_pid() as pid')).rows[0].pid;
  const email = `streak-${randomUUID()}@example.test`, password = randomUUID();
  const user = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ifError(user.error); uid = user.data.user!.id;
  await attachPlatformIdentity(config.dbUrl, uid, email, 'user_' + uid.replaceAll('-', ''));
  assert.ifError((await account.auth.signInWithPassword({ email, password })).error);
  assert.ifError((await account.rpc('ensure_account')).error);
  for (const signedIn of [false, true]) for (const format of ['full', 'mini']) {
    const http = signedIn ? account : guest;
    const identity = await http.rpc('create_device_identity'); assert.ifError(identity.error);
    const d = identity.data[0];
    const puzzle = (await observer.query(`insert into public.puzzles(date,format,is_published)
      select coalesce(max(date),'3000-01-01'::date)+1,$1,true from public.puzzles returning id`, [format])).rows[0].id;
    const params = { _puzzle_id: puzzle, _device_id: d.device_id, _device_token: d.device_token, _entry_context: 'archive_calendar' };
    const one = await http.rpc('create_game_session', params), two = await http.rpc('create_game_session', params);
    assert.ifError(one.error); assert.ifError(two.error); assert.ok(one.data); assert.ok(two.data);
    const before = await http.rpc('get_own_no_hint_streak', { _device_id: d.device_id, _device_token: d.device_token, _format: format });
    assert.ifError(before.error);
    await a.query('begin'); await b.query('begin');
    for (const connection of [a, b]) {
      await connection.query(`set local role ${signedIn ? 'authenticated' : 'anon'}`);
      await connection.query("select set_config('request.jwt.claims',$1,true)", [signedIn ? JSON.stringify({ sub: uid, role: 'authenticated' }) : '{}']);
    }
    assert.equal((await a.query(query, [one.data, d.device_id, d.device_token])).rows[0].result, true);
    // Keep A uncommitted. B must wait, then reclassify as a replay, not fail
    // the unique official-result constraint or double-count either aggregate.
    const pending = b.query(query, [two.data, d.device_id, d.device_token]);
    void pending.catch(() => {}); // assertion/cleanup below still observes rejection
    let blocked = false;
    for (let n = 0; n < 100; n++) {
      blocked = (await observer.query('select $1 = any(pg_blocking_pids($2)) as blocked', [pidA, pidB])).rows[0].blocked;
      if (blocked) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.ok(blocked, 'B must demonstrably overlap A, not run sequentially');
    await a.query('commit');
    assert.equal((await pending).rows[0].result, false);
    await b.query('commit');
    const rows = (await observer.query('select is_official,no_hint_completion_order from public.game_sessions where id=any($1::uuid[]) order by no_hint_completion_order', [[one.data,two.data]])).rows;
    assert.deepEqual(rows.map(r => r.is_official), [true,false]);
    assert.ok(BigInt(rows[0].no_hint_completion_order) < BigInt(rows[1].no_hint_completion_order));
    assert.equal((await observer.query('select total_plays from public.puzzle_aggregates where puzzle_id=$1', [puzzle])).rows[0].total_plays, 1);
    const after = await http.rpc('get_own_no_hint_streak', { _device_id: d.device_id, _device_token: d.device_token, _format: format });
    assert.ifError(after.error); assert.equal(after.data[0].tracked, before.data[0].tracked + 1);
    const retry = await http.rpc('finalize_game_session', { _session_id: one.data, _device_id: d.device_id, _device_token: d.device_token, _won:true, _mistakes:0, _active_time_seconds:10, _found_rainbow:false, _rainbow_solve_index:null, _solve_order:[], _hints_used:false, _share_grid:'', _skip_streak:true });
    assert.ifError(retry.error); assert.equal(retry.data,null);
    const again = await http.rpc('get_own_no_hint_streak', { _device_id: d.device_id, _device_token: d.device_token, _format: format });
    assert.ifError(again.error); assert.deepEqual(again.data, after.data);
    console.log(`PASS concurrent ${signedIn ? 'account' : 'guest'} ${format}: one official, replay saved, HTTP summary/retry stable`);
  }
} finally {
  await Promise.allSettled([a.query('rollback'),b.query('rollback')]);
  await Promise.allSettled([a.end(),b.end(),observer.end()]);
  if (uid) await admin.auth.admin.deleteUser(uid);
}
