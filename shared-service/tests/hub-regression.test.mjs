// The hub SQL and its uninstall, on a throwaway Postgres: in memory, except for one
// test that restarts it from a temporary folder. Nothing here touches a real database or
// the project's dependencies: PGlite comes from wherever it is already
// installed, named by SOCIAL_PGLITE, for example
//   SOCIAL_PGLITE=/path/to/node_modules/@electric-sql/pglite/dist/index.js \
//     node --test tests/social/draft-hub.test.mjs
// Set SOCIAL_REQUIRE_PGLITE=1 to fail instead of skipping when it isn't there,
// so a check that must prove the SQL can't pass by proving nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DRAFT = readFileSync(new URL('../fixtures/hub-eb238dd.sql', import.meta.url), 'utf8');
const PATCH = readFileSync(new URL('../patches/0002_png_group_photos.sql', import.meta.url), 'utf8');
const UNINSTALL = readFileSync(new URL('../fixtures/uninstall.sql', import.meta.url), 'utf8');

// Read from the contract's own file, so the lists in the SQL can't drift from it.
const CONTRACT = readFileSync(new URL('../../src/social/contract.ts', import.meta.url), 'utf8');
const contractList = (name) => [...CONTRACT.match(new RegExp(`${name} = \\[([^\\]]+)\\]`))[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

const ENTRY_FUNCTIONS = [
  'accept_friend_invite',
  'accept_friend_request',
  'block',
  'cancel_friend_request',
  'create_friend_invite',
  'create_group',
  'decline_friend_request',
  'delete_person',
  'ensure_person',
  'find_friend_by_code',
  'is_beta_tester',
  'join_group',
  'leave_group',
  'let_back_in',
  'list_blocks',
  'list_friend_requests',
  'list_friends',
  'list_members',
  'list_my_groups',
  'list_removed',
  'list_results',
  'preview_invite',
  'remove_friend',
  'remove_member',
  'rename_group',
  'rename_me_in_group',
  'replace_invite',
  'send_friend_request',
  'set_display_name',
  'set_group_appearance',
  'set_profile',
  'unblock',
];

/** All social_game_server can run. audience_global_ids returns global ids, so it stays off the gateway's role. */
const SERVER_FUNCTIONS = ['audience_global_ids', 'record_completion'];

const FACE_KEYS = ['animalId', 'backgroundColor'];
const FRIEND_PREVIEW_KEYS = ['inviterName', ...FACE_KEYS];
const GROUP_PREVIEW_KEYS = ['name', 'emblemId', 'accentColor', 'photo', 'memberPreview', 'isMember', 'isRemoved'];
const REQUEST_ROW_KEYS = ['requestRef', 'name', ...FACE_KEYS, 'sentAt'];
const RESULT_ROW_KEYS = ['isMe', 'name', ...FACE_KEYS, 'summary', 'detailLocked'];

/** The exact keys of each function's data, or of each row of a list. */
const ALLOWED_KEYS = {
  accept_friend_invite: ['friendRef', 'name'],
  accept_friend_request: ['friendRef', 'name'],
  block: ['blockRef'],
  cancel_friend_request: [],
  create_friend_invite: ['code', 'expiresAt'],
  create_group: ['groupId', 'inviteCode'],
  decline_friend_request: [],
  delete_person: [],
  ensure_person: ['displayName', ...FACE_KEYS, 'friendCode', 'friendCount', 'groupCount'],
  find_friend_by_code: ['requestRef', 'name', ...FACE_KEYS],
  join_group: ['groupId'],
  leave_group: ['closed'],
  let_back_in: [],
  list_blocks: ['blockRef', 'name'],
  list_friend_requests: ['incoming', 'outgoing'],
  list_friends: ['friendRef', 'name', ...FACE_KEYS, 'since'],
  list_members: ['memberRef', 'name', ...FACE_KEYS, 'isOwner', 'isMe', 'joinedAt'],
  list_my_groups: ['groupId', 'name', 'emblemId', 'accentColor', 'photo', 'photoVersion', 'memberCount', 'isOwner', 'myName', 'inviteCode'],
  list_removed: ['removedRef', 'name'],
  record_completion: [],
  remove_friend: [],
  remove_member: [],
  rename_group: [],
  rename_me_in_group: [],
  replace_invite: ['inviteCode'],
  send_friend_request: [],
  set_display_name: ['displayName'],
  set_group_appearance: ['photoVersion'],
  set_profile: ['displayName', ...FACE_KEYS],
  unblock: [],
};

/** Functions with more than one honest shape. Each alternative is exact. */
const KEY_ALTERNATIVES = {
  preview_invite: [FRIEND_PREVIEW_KEYS, GROUP_PREVIEW_KEYS],
  list_results: ['friendRef', 'memberRef'].flatMap((ref) => [
    [ref, ...RESULT_ROW_KEYS],
    [ref, ...RESULT_ROW_KEYS, 'detail'],
  ]),
};

/** Every outcome the hub itself can give. The client-only ones can't come from here. */
const HUB_OUTCOMES = new Set([
  'already_friends',
  'bad_avatar',
  'bad_color',
  'bad_emblem',
  'bad_my_name',
  'bad_name',
  'bad_result',
  'cannot_remove_self',
  'game_disabled',
  'group_full',
  'invalid_code',
  'invite_expired',
  'invite_used',
  'needs_display_name',
  'not_a_member',
  'not_a_picture',
  'not_found',
  'not_linked',
  'not_the_creator',
  'notice_required',
  'own_code',
  'own_invite',
  'removed',
  'request_pending',
  'slow_down',
  'too_big',
  'too_many_created',
  'too_many_friends',
  'too_many_groups',
  'wrong_size',
]);

/** The sharing notice's version, and how many arguments each function that asks for it takes. */
const NOTICE = 1;
const TAKES_NOTICE = { accept_friend_invite: 3, accept_friend_request: 3, create_friend_invite: 2, create_group: 4, join_group: 4, send_friend_request: 3 };

/** What a new group looks like. */
const NEW_GROUP_LOOK = { emblemId: 'campfire', accentColor: '#DED1F2', photo: null, photoVersion: 0 };

const PUZZLE = 'daily:2026-10-31';
const OTHER_PUZZLE = 'daily:2026-10-30';
const SAMPLE_RESULTS = {
  rainbow: { summary: { solved: true, mistakes: 2 }, detail: 'GREEN-GRID-SECRET' },
  crosspuns: { summary: { seconds: 95 }, detail: null },
  wtf: { summary: { score: 7 }, detail: [true, false, true] },
};
const NOBODY_CODE = 'ZZZ-222';

/** The same small JPEG the conformance suite builds. */
function jpegBytes(width, height, padding = 0) {
  const length = padding + 2;
  const comment = padding > 0 ? [0xff, 0xfe, length >> 8, length & 255, ...new Array(padding).fill(0x41)] : [];
  return [0xff, 0xd8, ...comment, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9];
}

const PHOTO_PREFIX = 'data:image/jpeg;base64,';
const photoFrom = (bytes) => `${PHOTO_PREFIX}${Buffer.from(bytes).toString('base64')}`;

const iso = (ms) => new Date(ms).toISOString();
const justNow = () => iso(Date.now());
const ago = (seconds) => iso(Date.now() - seconds * 1000);

/** What JavaScript's trim removes. */
const TRIMMED = [
  '\u0009', '\u000a', '\u000b', '\u000c', '\u000d', ' ', ' ', ' ',
  ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ',
  ' ', ' ', ' ', ' ', '　', '﻿',
];

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CODE = /^[0-9a-z]{12}$/;
const FRIEND_CODE = /^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/;

const PGLITE = process.env.SOCIAL_PGLITE;
const REQUIRED = process.env.SOCIAL_REQUIRE_PGLITE === '1';
const skip = PGLITE || REQUIRED ? false : 'SOCIAL_PGLITE is not set. Point it at an installed PGlite entry file to run the draft hub tests.';

test('the draft names no outside object and stays out of the migrations', () => {
  assert.match(DRAFT, /^-- DRAFT\. NOT A MIGRATION\. NEVER APPLIED TO A HOSTED DATABASE\./);
  assert.match(DRAFT, /D1/);
  for (const banned of [/\bauth\./i, /\bxw_/i, /\bpublic\./i, /create\s+extension/i]) {
    assert.doesNotMatch(DRAFT, banned);
  }
  assert.throws(() => readFileSync(new URL('../../supabase/migrations/0001_social_hub.sql', import.meta.url)), /ENOENT/);
});

test('the draft says which operations it does not cover yet', () => {
  const notDrafted = DRAFT.slice(DRAFT.indexOf('NOT DRAFTED YET'), DRAFT.indexOf('create schema social'));
  assert.match(notDrafted, /unlinkGame/);
  for (const op of ['unblock', 'listBlocks', 'renameMeInGroup', 'listRemoved', 'previewInvite', 'setProfile', 'listResults', 'recordCompletion']) {
    assert.doesNotMatch(notDrafted, new RegExp(op));
  }
});

test('membership for postgres is guarded, and hub roles are made only if missing', () => {
  // Read from the text: a throwaway database always has a postgres role, so the guard's other branch can't run here.
  assert.match(DRAFT, /if exists \(select 1 from pg_roles r where r\.rolname = 'postgres'\) then\s+grant social_gateway, social_game_server to postgres;/);
  for (const role of ['social_gateway', 'social_game_server']) {
    assert.match(DRAFT, new RegExp(`if not exists \\(select 1 from pg_roles r where r\\.rolname = '${role}'\\) then\\s+create role ${role} nologin;`));
  }
  assert.equal(DRAFT.match(/create role /g).length, 2);
});

test('uninstall touches the hub and nothing else, and names no game object', () => {
  const statements = [...UNINSTALL.matchAll(/^\s*drop\s+(\w+)\s+if exists\s+(\w+)(\s+cascade)?;/gim)].map((m) => m[0].trim());
  assert.deepEqual(statements, ['drop schema if exists social cascade;', 'drop role if exists social_gateway;', 'drop role if exists social_game_server;']);
  assert.equal(UNINSTALL.match(/^\s*drop\s/gim).length, 3, 'there should be no other drop');
  const banned = [/\bauth\./i, /\bxw_/i, /\bpublic\./i, /\baccounts\b/i, /game_sessions/i, /rainbow|crosspuns|cluevoyance|hamburgle|yodel|priceiswhat/i, /drop\s+owned/i, /reassign/i, /truncate/i, /delete\s+from/i];
  for (const word of banned) assert.doesNotMatch(UNINSTALL, word);
});

test('the draft hub', { skip }, async (t) => {
  assert.ok(PGLITE, 'SOCIAL_REQUIRE_PGLITE=1 but SOCIAL_PGLITE is not set, so the draft hub was not tested.');
  const { PGlite } = await import(PGLITE);
  const db = new PGlite();
  await db.waitReady;
  await db.exec('create role anon nologin; create role authenticated nologin; create role service_role nologin;');
  await db.exec(DRAFT);
  await db.exec(PATCH);

  const answers = [];
  /** Filled as people are deleted, since the last test can no longer read their ids. */
  const deletedIds = new Set();

  async function asRole(role, work) {
    await db.exec(`set role ${role}`);
    try {
      return await work();
    } finally {
      await db.exec('reset role');
    }
  }

  const parsed = (value) => (typeof value === 'string' ? JSON.parse(value) : value);

  /**
   * One gateway call, as the gateway would make it. Someone from person() gets a
   * name first, because nearly every write now needs one. The current notice is
   * added to a call that leaves it out; a test of the notice passes one itself.
   */
  async function hub(fn, ...args) {
    if (unnamed.delete(args[0])) await hub('set_display_name', args[0], 'Someone');
    if (fn === 'delete_person') {
      const { rows } = await db.query(`select id::text as id from social.persons where global_user_id = $1`, [args[0]]);
      for (const { id } of rows) deletedIds.add(id);
    }
    const sent = args.length + 1 === TAKES_NOTICE[fn] ? [...args, NOTICE] : args;
    const marks = sent.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await asRole('social_gateway', () => db.query(`select social.${fn}(${marks}) as answer`, sent));
    const answer = parsed(rows[0].answer);
    answers.push({ fn, answer });
    return answer;
  }

  /** One game server call, on that server's own role. The casts keep JSON values exactly as written here. */
  async function recording({ who, game, puzzle = PUZZLE, at = justNow(), summary = SAMPLE_RESULTS[game]?.summary, detail = SAMPLE_RESULTS[game]?.detail ?? null }) {
    const json = (value) => (value === null || value === undefined ? null : JSON.stringify(value));
    const { rows } = await asRole('social_game_server', () =>
      db.query(`select social.record_completion($1, $2, $3, $4, $5::text::jsonb, $6::text::jsonb) as answer`, [who, game, puzzle, at, json(summary), json(detail)]),
    );
    const answer = parsed(rows[0].answer);
    answers.push({ fn: 'record_completion', answer });
    return answer;
  }

  async function finish(game, who, puzzle = PUZZLE, at = justNow()) {
    assert.deepEqual(await recording({ who, game, puzzle, at }), { ok: true, data: {} });
  }

  async function ok(fn, ...args) {
    const answer = await hub(fn, ...args);
    assert.equal(answer.ok, true, `${fn} should succeed, got ${JSON.stringify(answer)}`);
    return answer.data;
  }

  async function refused(outcome, fn, ...args) {
    assert.deepEqual(await hub(fn, ...args), { ok: false, outcome });
  }

  async function count(sql, ...params) {
    const { rows } = await db.query(`select count(*)::int as n ${sql}`, params);
    return rows[0].n;
  }

  const sourceOf = async (name) =>
    (await db.query(`select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'social' and p.proname = $1`, [name])).rows[0].prosrc;

  // Global ids in the shape the hub accepts. Each test uses its own people.
  let serial = 0;
  const nameless = () => `user_person${String((serial += 1)).padStart(6, '0')}`;
  const unnamed = new Set();
  const person = () => {
    const id = nameless();
    unnamed.add(id);
    return id;
  };
  /** Someone with a name and an account in these games, as far as the hub can tell. */
  const player = async (name, ...games) => {
    const id = nameless();
    await ok('set_display_name', id, name);
    for (const game of games) await ok('ensure_person', id, game);
    return id;
  };

  const otherMember = async (viewer, groupId) => (await ok('list_members', viewer, groupId)).find((m) => !m.isMe);
  const memberNamed = async (viewer, groupId, name) => (await ok('list_members', viewer, groupId)).find((m) => m.name === name);
  const removedRef = async (groupId) => (await db.query(`select id::text as id from social.removals where group_id = $1`, [groupId])).rows[0].id;
  const friendCodeOf = async (who) => (await ok('ensure_person', who, 'crosspuns')).friendCode;
  const befriend = async (a, b) => ok('accept_friend_invite', b, (await ok('create_friend_invite', a)).code);
  const lookUp = async (who, other) => ok('find_friend_by_code', who, await friendCodeOf(other));
  const sendRequest = async (from, to) => ok('send_friend_request', from, (await lookUp(from, to)).requestRef);
  const incoming = async (who) => (await ok('list_friend_requests', who)).incoming;
  const outgoing = async (who) => (await ok('list_friend_requests', who)).outgoing;
  const hasNoRequests = async (who) => assert.deepEqual(await ok('list_friend_requests', who), { incoming: [], outgoing: [] });
  const noFriends = async (...people) => {
    for (const who of people) assert.deepEqual(await ok('list_friends', who), []);
  };
  const results = async (viewer, game, puzzle = PUZZLE, groupId = null) => ok('list_results', viewer, game, puzzle, groupId);
  const hashOfRef = `encode(sha256(convert_to($1, 'UTF8')), 'hex')`;

  /** On the server's role. Never put in answers: this is the one function whose answer holds global ids. */
  async function audience(...args) {
    const marks = args.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await asRole('social_game_server', () => db.query(`select social.audience_global_ids(${marks}) as answer`, args));
    return parsed(rows[0].answer);
  }
  async function audienceHolds(args, people, label) {
    const answer = await audience(...args);
    assert.equal(answer.ok, true, `${label}: got ${JSON.stringify(answer)}`);
    assert.deepEqual([...answer.data].sort(), [...people].sort(), label);
  }

  /** A plain true or false, not a wire answer, so it isn't put in answers either. */
  const isBetaTester = async (id) => (await asRole('social_gateway', () => db.query(`select social.is_beta_tester($1) as answer`, [id]))).rows[0].answer;

  /** Every count a refused call could disturb. */
  const worldState = async () =>
    JSON.stringify(
      (
        await db.query(`select
          (select count(*) from social.memberships)::int as memberships,
          (select count(*) from social.friendships)::int as friendships,
          (select count(*) from social.friend_requests)::int as requests,
          (select count(*) from social.friend_lookups)::int as lookups,
          (select count(*) from social.invites)::int as invites,
          (select count(*) from social.invites where used_at is not null)::int as used_invites,
          (select count(*) from social.groups)::int as groups,
          (select count(*) from social.activity)::int as activity`)
      ).rows[0],
    );

  try {
    const tables = (await db.query(`select tablename from pg_tables where schemaname = 'social'`)).rows.map((r) => r.tablename);
    const functions = (
      await db.query(`select p.proname, p.pronargs from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'social'`)
    ).rows;
    assert.ok(tables.length >= 9, 'the schema should have its tables');
    assert.ok(functions.length > ENTRY_FUNCTIONS.length, 'the schema should have helpers too');

    await t.test('anon, authenticated and service_role are denied on every table and function', async () => {
      for (const role of ['anon', 'authenticated', 'service_role']) {
        for (const table of tables) {
          await assert.rejects(asRole(role, () => db.query(`select * from social.${table}`)), /permission denied/, `${role} reading ${table}`);
        }
        for (const { proname, pronargs } of functions) {
          const nulls = Array(pronargs).fill('null').join(', ');
          await assert.rejects(asRole(role, () => db.query(`select social.${proname}(${nulls})`)), /permission denied/, `${role} calling ${proname}`);
        }
        // The schema refusal above comes first, so check the rights underneath it too.
        assert.equal((await db.query(`select has_schema_privilege('${role}'::name, 'social', 'usage') as can`)).rows[0].can, false);
        assert.equal(await count(`from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'social' and has_function_privilege('${role}'::name, p.oid, 'execute')`), 0);
        assert.equal(await count(`from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'social' and c.relkind = 'r' and has_table_privilege('${role}'::name, c.oid, 'select, insert, update, delete')`), 0);
      }
    });

    await t.test('row-level security is on everywhere', async () => {
      assert.equal(await count(`from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'social' and c.relkind = 'r' and not c.relrowsecurity`), 0);
    });

    await t.test('social_gateway has no direct table access and only the entry functions', async () => {
      for (const table of tables) {
        await assert.rejects(asRole('social_gateway', () => db.query(`select * from social.${table}`)), /permission denied/, `reading ${table}`);
      }
      await assert.rejects(asRole('social_gateway', () => db.query(`insert into social.persons (global_user_id) values ('user_sneakysneaky')`)), /permission denied/);
      const { rows } = await db.query(
        `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'social' and has_function_privilege('social_gateway'::name, p.oid, 'execute') order by 1`,
      );
      assert.deepEqual(rows.map((r) => r.proname), ENTRY_FUNCTIONS);
    });

    await t.test('every function pins its search path', async () => {
      assert.equal(
        await count(`from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'social' and not exists (select 1 from unnest(p.proconfig) c where c = 'search_path=social, pg_temp')`),
        0,
      );
    });

    await t.test('anything that counts or connects people locks them first, and owner checks come after the group lock', async () => {
      const writers = [
        'accept_friend_invite',
        'accept_friend_request',
        'block',
        'cancel_friend_request',
        'create_friend_invite',
        'create_group',
        'decline_friend_request',
        'delete_person',
        'find_friend_by_code',
        'join_group',
        'record_completion',
        'send_friend_request',
        'set_profile',
        'unblock',
      ];
      for (const fn of writers) assert.match(await sourceOf(fn), /social\.lock_persons\(/, fn);
      // Two people go in one call. A second call could take them out of id order.
      for (const fn of ['accept_friend_request', 'cancel_friend_request', 'decline_friend_request', 'find_friend_by_code', 'send_friend_request', 'unblock']) {
        assert.equal((await sourceOf(fn)).match(/social\.lock_persons\(/g).length, 1, fn);
      }
      assert.match(await sourceOf('lock_persons'), /order by p\.id for no key update/);
      for (const fn of ['let_back_in', 'remove_member', 'rename_group', 'replace_invite', 'set_group_appearance']) {
        assert.match(await sourceOf(fn), /for update[\s\S]*owner_refusal/, fn);
      }
      assert.match(await sourceOf('list_removed'), /for share[\s\S]*owner_refusal/);
      assert.match(await sourceOf('rename_me_in_group'), /for update[\s\S]*not_a_member/);
    });

    await t.test('one global id is one person across games: a group made once is listed for that id', async () => {
      const alice = nameless();
      const first = await ok('ensure_person', alice, 'crosspuns');
      assert.match(first.friendCode, FRIEND_CODE);
      assert.deepEqual(first, { displayName: null, animalId: 'fox', backgroundColor: '#DED1F2', friendCode: first.friendCode, friendCount: 0, groupCount: 0 });
      await ok('ensure_person', alice, 'rainbow');
      assert.equal(await count(`from social.persons where global_user_id = $1`, alice), 1);
      assert.equal(await count(`from social.game_links l join social.persons p on p.id = l.person_id where p.global_user_id = $1`, alice), 2);

      assert.equal((await ok('set_display_name', alice, '  Alice  ')).displayName, 'Alice');
      const { groupId, inviteCode } = await ok('create_group', alice, 'Club', 'Al');
      const listed = await ok('list_my_groups', alice);
      assert.deepEqual(listed, [{ groupId, name: 'Club', ...NEW_GROUP_LOOK, memberCount: 1, isOwner: true, myName: 'Al', inviteCode }]);
      assert.deepEqual(await ok('ensure_person', alice, 'wtf'), { ...first, displayName: 'Alice', groupCount: 1 });
    });

    await t.test('whether a game is enabled is the gateway\'s check: the hub accepts every known game and only refuses an unknown one', async () => {
      const alice = person();
      for (const game of ['yodel', 'hamburgle', 'priceiswhat']) await ok('ensure_person', alice, game);
      assert.equal(await count(`from social.game_links l join social.persons p on p.id = l.person_id where p.global_user_id = $1`, alice), 3);
      await refused('game_disabled', 'ensure_person', alice, 'not-a-game');
      await refused('game_disabled', 'ensure_person', alice, null);
      assert.equal(await count(`from social.game_links l join social.persons p on p.id = l.person_id where p.global_user_id = $1`, alice), 3);
    });

    await t.test('names are checked and limits answer with an outcome', async () => {
      const alice = person();
      await refused('bad_name', 'create_group', alice, '   ', 'Al');
      await refused('bad_name', 'create_group', alice, 'x'.repeat(41), 'Al');
      await refused('bad_my_name', 'create_group', alice, 'Club', 'x'.repeat(25));
      await refused('bad_my_name', 'set_display_name', alice, '');
      for (let i = 0; i < 5; i++) await ok('create_group', alice, `Club ${i}`, 'Al');
      await refused('slow_down', 'create_group', alice, 'One too many', 'Al');
    });

    await t.test('names are trimmed of exactly what JavaScript trims', async () => {
      const alice = person();
      for (const c of TRIMMED) {
        assert.equal(`${c}Sam${c}`.trim(), 'Sam', 'the list should match JavaScript');
        assert.equal((await ok('set_display_name', alice, `${c}Sam${c}`)).displayName, 'Sam', `U+${c.codePointAt(0).toString(16)}`);
      }
      for (const c of ['​', '᠎']) {
        assert.equal(`${c}Sam`.trim(), `${c}Sam`, 'JavaScript leaves this one alone');
        assert.equal((await ok('set_display_name', alice, `${c}Sam`)).displayName, `${c}Sam`);
      }
      await refused('bad_my_name', 'set_display_name', alice, TRIMMED.join(''));
      assert.equal((await ok('set_display_name', alice, '\u{1F9E9}'.repeat(24))).displayName.length, 48, 'a four-byte character should count as one');
    });

    await t.test('timestamps and codes are in the wire format', async () => {
      const alice = person();
      const bob = person();
      const { code, expiresAt } = await ok('create_friend_invite', alice);
      assert.match(code, CODE);
      assert.match(expiresAt, TIMESTAMP);
      assert.ok(Date.parse(expiresAt) > Date.now());
      await ok('accept_friend_invite', bob, code);
      assert.match((await ok('list_friends', alice))[0].since, TIMESTAMP);
      const { groupId, inviteCode } = await ok('create_group', alice, 'Club', 'Al');
      assert.match(inviteCode, CODE);
      assert.match((await ok('list_members', alice, groupId))[0].joinedAt, TIMESTAMP);
    });

    await t.test('a member list comes in joining order, a page at a time', async () => {
      const alice = person();
      const { groupId, inviteCode } = await ok('create_group', alice, 'Club', 'Al');
      for (const name of ['First', 'Second', 'Third']) await ok('join_group', person(), inviteCode, name);

      // A forced clock, against the order the rows were written in.
      const times = { Al: '2026-01-01T00:00:00.000Z', Third: '2026-01-01T00:00:01.000Z', First: '2026-01-01T00:00:02.000Z', Second: '2026-01-01T00:00:03.000Z' };
      for (const [name, at] of Object.entries(times)) {
        await db.query(`update social.memberships set joined_at = $1 where group_id = $2 and name = $3`, [at, groupId, name]);
      }
      const expected = ['Al', 'Third', 'First', 'Second'];

      const whole = await ok('list_members', alice, groupId);
      assert.deepEqual(whole.map((m) => m.name), expected);
      assert.deepEqual(whole.map((m) => m.joinedAt), expected.map((name) => times[name]));

      const paged = [];
      let cursor = [null, null];
      for (let page = 0; page < 10; page++) {
        const rows = await ok('list_members', alice, groupId, cursor[0], cursor[1], 1);
        if (rows.length === 0) break;
        assert.equal(rows.length, 1);
        paged.push(rows[0].name);
        cursor = [rows[0].joinedAt, rows[0].memberRef];
      }
      assert.deepEqual(paged, expected);

      assert.equal((await ok('list_members', alice, groupId, null, null, 500)).length, 4);
    });

    await t.test('a removed member is refused, even with a replaced code, until let back in', async () => {
      const owner = person();
      const member = person();
      const { groupId, inviteCode } = await ok('create_group', owner, 'Club', 'Owner');
      await ok('join_group', member, inviteCode, 'Bee');
      await ok('remove_member', owner, groupId, (await otherMember(owner, groupId)).memberRef);

      await refused('removed', 'join_group', member, inviteCode, 'Bee');
      const fresh = (await ok('replace_invite', owner, groupId)).inviteCode;
      await refused('removed', 'join_group', member, fresh, 'Bee');
      await refused('not_a_member', 'list_members', member, groupId);

      assert.equal(await count(`from social.removals where group_id = $1 and name = 'Bee'`, groupId), 1);
      await refused('not_found', 'let_back_in', owner, groupId, randomUUID());
      await ok('let_back_in', owner, groupId, await removedRef(groupId));
      await ok('join_group', member, fresh, 'Bee');
      assert.equal((await ok('list_members', owner, groupId)).length, 2);
    });

    await t.test('every owner-only function refuses a member and changes nothing', async () => {
      const owner = person();
      const member = person();
      const { groupId, inviteCode } = await ok('create_group', owner, 'Club', 'Owner');
      await ok('join_group', member, inviteCode, 'Bee');
      const ownerRow = await otherMember(member, groupId);

      await refused('not_the_creator', 'remove_member', member, groupId, ownerRow.memberRef);
      await refused('not_the_creator', 'let_back_in', member, groupId, randomUUID());
      await refused('not_the_creator', 'replace_invite', member, groupId);
      await refused('not_the_creator', 'rename_group', member, groupId, 'Mine now');
      await refused('not_the_creator', 'list_removed', member, groupId);

      assert.equal((await ok('list_members', owner, groupId)).length, 2);
      assert.equal((await ok('list_my_groups', owner))[0].name, 'Club');
      await ok('join_group', person(), inviteCode, 'Later');
    });

    await t.test('the owner cannot remove themselves', async () => {
      const owner = person();
      const { groupId } = await ok('create_group', owner, 'Club', 'Owner');
      const [me] = await ok('list_members', owner, groupId);
      await refused('cannot_remove_self', 'remove_member', owner, groupId, me.memberRef);
      assert.equal((await ok('list_members', owner, groupId)).length, 1);
    });

    await t.test('a ref from one group fails in another, whichever group it comes from', async () => {
      const owner = person();
      const member = person();
      const first = await ok('create_group', owner, 'One', 'Owner');
      const second = await ok('create_group', owner, 'Two', 'Owner');
      await ok('join_group', member, first.inviteCode, 'Bee');
      await ok('join_group', member, second.inviteCode, 'Bee');

      const inFirst = await otherMember(owner, first.groupId);
      const inSecond = await otherMember(owner, second.groupId);
      assert.notEqual(inFirst.memberRef, inSecond.memberRef, 'one person should have unrelated refs');
      await refused('not_found', 'remove_member', owner, second.groupId, inFirst.memberRef);
      assert.equal((await ok('list_members', owner, second.groupId)).length, 2);

      await ok('remove_member', owner, first.groupId, inFirst.memberRef);
      await refused('not_found', 'let_back_in', owner, second.groupId, await removedRef(first.groupId));
      await refused('removed', 'join_group', member, first.inviteCode, 'Bee');
    });

    await t.test('a replaced code stops working at once', async () => {
      const owner = person();
      const { groupId, inviteCode } = await ok('create_group', owner, 'Club', 'Owner');
      const fresh = (await ok('replace_invite', owner, groupId)).inviteCode;
      assert.notEqual(fresh, inviteCode);
      await refused('invalid_code', 'join_group', person(), inviteCode, 'Bee');
      await ok('join_group', person(), fresh, 'Bee');
    });

    await t.test('a code of the wrong kind does nothing', async () => {
      const alice = person();
      const bob = person();
      const { inviteCode } = await ok('create_group', alice, 'Club', 'Al');
      const { code } = await ok('create_friend_invite', alice);
      await refused('invalid_code', 'accept_friend_invite', bob, inviteCode);
      await refused('invalid_code', 'join_group', bob, code, 'Bee');
      await ok('accept_friend_invite', bob, code);
    });

    await t.test('every invite is found by its hash, a friend code is never stored readable, and the constraint enforces it', async () => {
      const alice = person();
      const { groupId, inviteCode } = await ok('create_group', alice, 'Club', 'Al');
      const friend = (await ok('create_friend_invite', alice)).code;
      const byHash = `i.code_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`;
      const rowFor = async (code) => {
        const { rows } = await db.query(`select to_jsonb(i)::text as whole, i.code from social.invites i where ${byHash}`, [code]);
        assert.equal(rows.length, 1, 'the row should be findable by hash');
        return rows[0];
      };

      const friendRow = await rowFor(friend);
      assert.equal(friendRow.code, null);
      assert.ok(!friendRow.whole.includes(friend), 'the code itself should be nowhere in the row');
      assert.equal((await rowFor(inviteCode)).code, inviteCode);

      await assert.rejects(db.query(`update social.invites i set code = $1 where ${byHash}`, [friend]), /invites_readable_code/);
      await assert.rejects(db.query(`update social.invites set code = null where group_id = $1`, [groupId]), /invites_readable_code/);
      await assert.rejects(db.query(`update social.invites set code = 'NOT A CODE' where group_id = $1`, [groupId]), /invites_code_format/);
    });

    await t.test('an owner reads the group code back, a member gets null, and the code follows replacement and ownership', async () => {
      const owner = person();
      const member = person();
      const { groupId, inviteCode } = await ok('create_group', owner, 'Club', 'Owner');
      await ok('join_group', member, inviteCode, 'Bee');
      const shownTo = async (who) => (await ok('list_my_groups', who))[0];

      assert.deepEqual([(await shownTo(owner)).isOwner, (await shownTo(owner)).inviteCode], [true, inviteCode]);
      assert.deepEqual([(await shownTo(member)).isOwner, (await shownTo(member)).inviteCode], [false, null]);

      const fresh = (await ok('replace_invite', owner, groupId)).inviteCode;
      assert.equal((await shownTo(owner)).inviteCode, fresh, 'the readable copy should move with the hash');
      assert.equal((await shownTo(member)).inviteCode, null);
      await refused('invalid_code', 'join_group', person(), inviteCode, 'Late');

      // The new owner gets the code. The old one, back as a member, doesn't.
      await ok('leave_group', owner, groupId);
      assert.deepEqual([(await shownTo(member)).isOwner, (await shownTo(member)).inviteCode], [true, fresh]);
      await ok('join_group', owner, ` ${fresh.toUpperCase()} `, 'Back');
      assert.deepEqual([(await shownTo(owner)).isOwner, (await shownTo(owner)).inviteCode], [false, null]);
    });

    await t.test('a friend invite works once, and only for someone else', async () => {
      const alice = person();
      const bob = person();
      const { code } = await ok('create_friend_invite', alice);
      await refused('own_invite', 'accept_friend_invite', alice, code);
      await refused('invalid_code', 'accept_friend_invite', bob, 'nosuchcode00');
      const { friendRef } = await ok('accept_friend_invite', bob, code);
      await refused('invite_used', 'accept_friend_invite', person(), code);

      assert.deepEqual((await ok('list_friends', alice)).map((f) => f.friendRef), [friendRef]);
      assert.deepEqual((await ok('list_friends', bob)).map((f) => f.friendRef), [friendRef]);
      await refused('not_found', 'remove_friend', person(), friendRef);
      await ok('remove_friend', bob, friendRef);
      assert.deepEqual(await ok('list_friends', alice), []);
      await refused('not_found', 'remove_friend', alice, friendRef);
    });

    await t.test('an expired friend invite is refused', async () => {
      const alice = person();
      const { code } = await ok('create_friend_invite', alice);
      await db.query(`update social.invites set expires_at = now() - interval '1 second' where code_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`, [code]);
      await refused('invite_expired', 'accept_friend_invite', person(), code);
    });

    await t.test('a friendship is one row per pair, whichever way round it was made', async () => {
      const alice = person();
      const bob = person();
      const first = await ok('accept_friend_invite', bob, (await ok('create_friend_invite', alice)).code);
      const invite = (await ok('create_friend_invite', bob)).code;
      const again = await ok('accept_friend_invite', alice, invite);
      assert.equal(again.friendRef, first.friendRef);
      await ok('accept_friend_invite', person(), invite);
      await assert.rejects(
        db.query(
          `insert into social.friendships (person_a, person_b, notice_a, notice_b)
           select greatest(a.id, b.id), least(a.id, b.id), 1, 1 from social.persons a, social.persons b
            where a.global_user_id = $1 and b.global_user_id = $2`,
          [alice, bob],
        ),
        /friendships_unordered_pair/,
      );
    });

    await t.test('a block ends the friendship, a blocked accept looks used and is used, and groups are left alone', async () => {
      const alice = person();
      const bob = person();
      const { friendRef } = await ok('accept_friend_invite', bob, (await ok('create_friend_invite', alice)).code);
      const hers = (await ok('create_friend_invite', alice)).code;
      const { groupId, inviteCode } = await ok('create_group', alice, 'Club', 'Al');
      await ok('join_group', bob, inviteCode, 'Bee');

      await refused('not_found', 'block', person(), friendRef);
      const blocked = await ok('block', alice, friendRef);
      assert.ok(blocked.blockRef);
      assert.deepEqual(await ok('list_friends', alice), []);
      assert.deepEqual(await ok('list_friends', bob), []);

      await refused('invite_used', 'accept_friend_invite', bob, hers);
      await refused('invite_used', 'accept_friend_invite', person(), hers);
      const his = (await ok('create_friend_invite', bob)).code;
      await refused('invite_used', 'accept_friend_invite', alice, his);
      assert.deepEqual(await ok('list_friends', bob), []);
      assert.equal((await ok('list_members', bob, groupId)).length, 2);

      const row = await otherMember(alice, groupId);
      assert.equal((await ok('block', alice, row.memberRef)).blockRef, blocked.blockRef, 'blocking again should give the same blockRef');
      await refused('not_found', 'block', alice, (await ok('list_members', alice, groupId)).find((m) => m.isMe).memberRef);
    });

    await t.test('a block through a memberRef ends a friendship, and only a member can make one', async () => {
      const alice = person();
      const bob = person();
      const outsider = person();
      await ok('accept_friend_invite', bob, (await ok('create_friend_invite', alice)).code);
      const { groupId, inviteCode } = await ok('create_group', alice, 'Club', 'Al');
      await ok('join_group', bob, inviteCode, 'Bee');
      const row = await otherMember(alice, groupId);

      await refused('not_found', 'block', outsider, row.memberRef);
      assert.equal((await ok('list_friends', alice)).length, 1);

      await ok('block', alice, row.memberRef);
      assert.deepEqual(await ok('list_friends', alice), []);
      assert.equal(await count(`from social.blocks b join social.persons p on p.id = b.blocker where p.global_user_id = $1 and b.name = 'Bee'`, alice), 1);
    });

    await t.test('a non-member and an unknown group get the same answer', async () => {
      const owner = person();
      const stranger = person();
      const { groupId, inviteCode } = await ok('create_group', owner, 'Club', 'Owner');
      const calls = [
        ['list_members'],
        ['leave_group'],
        ['rename_group', 'Mine now'],
        ['rename_me_in_group', 'Sneaky'],
        ['remove_member', randomUUID()],
        ['list_removed'],
        ['let_back_in', randomUUID()],
        ['replace_invite'],
        ['set_group_appearance', 'moon', null, '#CCE6CA'],
      ];
      for (const [fn, ...rest] of calls) {
        await refused('not_a_member', fn, stranger, groupId, ...rest);
        await refused('not_a_member', fn, stranger, randomUUID(), ...rest);
        await refused('not_a_member', fn, stranger, 'not-even-a-uuid', ...rest);
      }
      assert.deepEqual(await ok('list_my_groups', owner), [{ groupId, name: 'Club', ...NEW_GROUP_LOOK, memberCount: 1, isOwner: true, myName: 'Owner', inviteCode }]);
    });

    await t.test('leaving hands over to the longest-standing member, and the last one out closes the group', async () => {
      const owner = person();
      const first = person();
      const second = person();
      const { groupId, inviteCode } = await ok('create_group', owner, 'Club', 'Owner');
      await ok('join_group', first, inviteCode, 'First');
      await ok('join_group', second, inviteCode, 'Second');
      await db.query(`update social.memberships set joined_at = joined_at + interval '1 second' where group_id = $1 and name = 'Second'`, [groupId]);

      assert.deepEqual(await ok('leave_group', owner, groupId), { closed: false });
      assert.equal((await ok('list_my_groups', first))[0].isOwner, true);
      assert.equal((await ok('list_my_groups', second))[0].isOwner, false);
      await ok('leave_group', second, groupId);
      assert.deepEqual(await ok('leave_group', first, groupId), { closed: true });
      assert.equal(await count(`from social.groups where id = $1`, groupId), 0);
      await refused('invalid_code', 'join_group', person(), inviteCode, 'Bee');
    });

    await t.test('someone who owned a group and came back has no owner powers', async () => {
      const owner = person();
      const next = person();
      const { groupId, inviteCode } = await ok('create_group', owner, 'Club', 'Owner');
      await ok('join_group', next, inviteCode, 'Next');
      await ok('leave_group', owner, groupId);
      await ok('join_group', owner, inviteCode, 'Back');
      await refused('not_the_creator', 'rename_group', owner, groupId, 'Mine again');
      await refused('not_the_creator', 'replace_invite', owner, groupId);
    });

    await t.test('delete_person erases the person and hands over or closes their groups', async () => {
      const alice = person();
      const bob = person();
      const carol = person();
      const dave = person();
      const erin = person();
      await ok('set_display_name', alice, 'Alice');
      await ok('ensure_person', alice, 'crosspuns');

      const shared = await ok('create_group', alice, 'Shared', 'Al');
      await ok('join_group', bob, shared.inviteCode, 'Bee');
      const alone = await ok('create_group', alice, 'Alone', 'Al');
      const theirs = await ok('create_group', carol, 'Theirs', 'Cee');
      await ok('join_group', alice, theirs.inviteCode, 'Al');
      await ok('remove_member', carol, theirs.groupId, (await otherMember(carol, theirs.groupId)).memberRef);
      await ok('accept_friend_invite', carol, (await ok('create_friend_invite', alice)).code);
      const { friendRef } = await ok('accept_friend_invite', dave, (await ok('create_friend_invite', alice)).code);
      await ok('block', alice, friendRef);
      const againstThem = await ok('accept_friend_invite', alice, (await ok('create_friend_invite', erin)).code);
      await ok('block', erin, againstThem.friendRef);
      const open = (await ok('create_friend_invite', alice)).code;

      assert.deepEqual(await ok('delete_person', alice), {});

      assert.equal(await count(`from social.persons where global_user_id = $1`, alice), 0);
      assert.deepEqual(await ok('list_friends', carol), []);
      const [handedOver] = await ok('list_my_groups', bob);
      assert.equal(handedOver.groupId, shared.groupId);
      assert.equal(handedOver.isOwner, true);
      assert.equal(handedOver.inviteCode, shared.inviteCode, 'the new owner can share the same link');
      assert.equal(await count(`from social.groups where id = $1`, alone.groupId), 0);
      await refused('invalid_code', 'accept_friend_invite', bob, open);

      // Provisional, D13: what other people held against them goes too.
      assert.equal(await count(`from social.blocks b join social.persons p on p.id = b.blocker where p.global_user_id = $1`, erin), 0);
      assert.equal(await count(`from social.removals where group_id = $1`, theirs.groupId), 0);

      // The group's own code lives on for its new owner, with nobody's name on it.
      await ok('join_group', person(), shared.inviteCode, 'Later');
      assert.equal(await count(`from social.invites i join social.groups g on g.id = i.group_id where g.id = $1 and i.creator_id is null`, shared.groupId), 1);

      // Coming back is coming back as nobody: the removal and the block are gone too.
      const back = await ok('ensure_person', alice, 'rainbow');
      assert.deepEqual(back, { displayName: null, animalId: 'fox', backgroundColor: '#DED1F2', friendCode: back.friendCode, friendCount: 0, groupCount: 0 });
      await ok('set_display_name', alice, 'Alice again');
      await ok('accept_friend_invite', dave, (await ok('create_friend_invite', alice)).code);
      await ok('join_group', alice, theirs.inviteCode, 'Al');

      const never = 'user_nevercame0000';
      assert.deepEqual(await ok('delete_person', never), {});
    });

    await t.test('a profile takes only the contract\'s avatars and colors, all or nothing, and follows the person', async () => {
      const alice = nameless();
      for (const bad of ['dragon', 'Fox', '', null]) await refused('bad_avatar', 'set_profile', alice, 'Alice', bad, '#CCE1F1');
      for (const bad of ['#ded1f2', '#000000', '', null]) await refused('bad_color', 'set_profile', alice, 'Alice', 'otter', bad);
      await refused('bad_my_name', 'set_profile', alice, '   ', 'otter', '#CCE1F1');
      const untouched = await ok('ensure_person', alice, 'crosspuns');
      assert.deepEqual([untouched.displayName, untouched.animalId, untouched.backgroundColor], [null, 'fox', '#DED1F2']);

      for (const animalId of contractList('AVATAR_IDS')) await ok('set_profile', alice, 'Alice', animalId, '#CCE1F1');
      for (const color of contractList('PROFILE_COLORS')) await ok('set_profile', alice, 'Alice', 'otter', color);
      assert.deepEqual(await ok('set_profile', alice, '  Alice  ', 'otter', '#CCE1F1'), { displayName: 'Alice', animalId: 'otter', backgroundColor: '#CCE1F1' });

      const bob = person();
      await befriend(alice, bob);
      const { groupId, inviteCode } = await ok('create_group', alice, 'Club', 'Al');
      await ok('join_group', bob, inviteCode, 'Bee');
      const [friend] = await ok('list_friends', bob);
      const owner = await otherMember(bob, groupId);
      for (const row of [friend, owner]) assert.deepEqual([row.animalId, row.backgroundColor], ['otter', '#CCE1F1']);
    });

    await t.test('a friend code is shown with its dash, stored clean, unique, and reads the same however it is typed', async () => {
      const alice = person();
      const bob = person();
      const code = await friendCodeOf(bob);
      assert.match(code, FRIEND_CODE);
      assert.equal((await ok('ensure_person', bob, 'wtf')).friendCode, code, 'one person should have one code in every game');

      const { rows } = await db.query(`select friend_code from social.persons`);
      for (const { friend_code } of rows) assert.match(friend_code, /^[A-HJ-NP-Z2-9]{6}$/);
      assert.equal(new Set(rows.map((r) => r.friend_code)).size, rows.length);

      const clean = code.replace('-', '');
      for (const typed of [code, clean, code.toLowerCase(), clean.toLowerCase(), `  ${code.slice(0, 3)} ${code.slice(4)}  `]) {
        assert.equal((await ok('find_friend_by_code', alice, typed)).name, 'Someone', typed);
      }
      for (const typed of [NOBODY_CODE, '', 'ABC', `${clean}X`, null]) await refused('not_found', 'find_friend_by_code', alice, typed);
    });

    await t.test('requests: nobody is a friend until the person asked accepts', async () => {
      const alice = person();
      const bob = person();
      await ok('set_display_name', alice, 'Alice');
      await ok('set_display_name', bob, 'Bob');

      const found = await lookUp(alice, bob);
      assert.equal(found.name, 'Bob');
      await noFriends(alice, bob);
      await hasNoRequests(bob);

      await ok('send_friend_request', alice, found.requestRef);
      await noFriends(alice, bob);
      const [asked] = await incoming(bob);
      const [sent] = await outgoing(alice);
      assert.equal(asked.name, 'Alice');
      assert.equal(sent.name, 'Bob');
      assert.match(asked.sentAt, TIMESTAMP);
      await noFriends(alice, bob);

      const accepted = await ok('accept_friend_request', bob, asked.requestRef);
      assert.equal(accepted.name, 'Alice');
      assert.deepEqual((await ok('list_friends', alice)).map((f) => f.friendRef), [accepted.friendRef]);
      assert.deepEqual((await ok('list_friends', bob)).map((f) => f.friendRef), [accepted.friendRef]);
      await hasNoRequests(alice);
      await hasNoRequests(bob);

      const { rows } = await db.query(`select notice_a, notice_b from social.friendships where id = $1`, [accepted.friendRef]);
      assert.deepEqual(rows, [{ notice_a: NOTICE, notice_b: NOTICE }], 'both people saw the notice');
    });

    await t.test('requests: only the person asked can accept or decline, and only the sender can cancel', async () => {
      const alice = person();
      const bob = person();
      const carol = person();
      await sendRequest(alice, bob);
      const [{ requestRef }] = await incoming(bob);
      const before = await worldState();

      await refused('not_found', 'accept_friend_request', carol, requestRef);
      await refused('not_found', 'decline_friend_request', carol, requestRef);
      await refused('not_found', 'cancel_friend_request', carol, requestRef);
      await refused('not_found', 'accept_friend_request', alice, requestRef);
      await refused('not_found', 'decline_friend_request', alice, requestRef);
      await refused('not_found', 'cancel_friend_request', bob, requestRef);
      await refused('not_found', 'accept_friend_request', bob, 'not-even-a-uuid');
      assert.equal(await worldState(), before);
      await noFriends(alice, bob, carol);

      await ok('cancel_friend_request', alice, requestRef);
      await hasNoRequests(alice);
      await hasNoRequests(bob);
      await refused('not_found', 'accept_friend_request', bob, requestRef);
      await refused('not_found', 'cancel_friend_request', alice, requestRef);
    });

    await t.test('requests: a decline is silent to the sender, and finding them again says request_pending', async () => {
      const alice = person();
      const bob = person();
      const { requestRef: looked } = await lookUp(alice, bob);
      await ok('send_friend_request', alice, looked);
      const before = await outgoing(alice);
      const [asked] = await incoming(bob);

      await ok('decline_friend_request', bob, asked.requestRef);

      assert.deepEqual(await incoming(bob), []);
      assert.deepEqual(await outgoing(alice), before, "the sender's row should stay exactly as it was");
      await refused('request_pending', 'find_friend_by_code', alice, await friendCodeOf(bob));
      await refused('request_pending', 'send_friend_request', alice, looked);
      await refused('not_found', 'accept_friend_request', bob, asked.requestRef);
      await refused('not_found', 'decline_friend_request', bob, asked.requestRef);
      await noFriends(alice, bob);

      await ok('cancel_friend_request', alice, before[0].requestRef);
      await sendRequest(bob, alice);
    });

    await t.test('requests: own_code, already_friends and request_pending, in both directions', async () => {
      const alice = person();
      const bob = person();
      const carol = person();
      const hers = await friendCodeOf(alice);
      const his = await friendCodeOf(bob);
      await refused('own_code', 'find_friend_by_code', alice, hers.toLowerCase());

      const crossing = await lookUp(bob, alice);
      await sendRequest(alice, bob);
      await refused('request_pending', 'find_friend_by_code', alice, his);
      await refused('request_pending', 'find_friend_by_code', bob, hers);
      await refused('request_pending', 'send_friend_request', bob, crossing.requestRef);

      await ok('accept_friend_request', bob, (await incoming(bob))[0].requestRef);
      await refused('already_friends', 'find_friend_by_code', alice, his);
      await refused('already_friends', 'send_friend_request', bob, crossing.requestRef);

      // A friendship made through a link clears any request between them.
      await sendRequest(carol, alice);
      await befriend(alice, carol);
      await hasNoRequests(carol);
      await refused('already_friends', 'find_friend_by_code', carol, hers);
    });

    await t.test('requests: a blocked pair gets not_found both ways, like a code nobody holds, and a block clears requests', async () => {
      const alice = person();
      const bob = person();
      const hers = await friendCodeOf(alice);
      const his = await friendCodeOf(bob);
      const { groupId, inviteCode } = await ok('create_group', alice, 'Club', 'Al');
      await ok('join_group', bob, inviteCode, 'Bee');
      const herLookup = await lookUp(alice, bob);
      const hisLookup = await lookUp(bob, alice);
      await ok('send_friend_request', bob, hisLookup.requestRef);

      await ok('block', alice, (await otherMember(alice, groupId)).memberRef);

      await hasNoRequests(alice);
      await hasNoRequests(bob);
      const nobody = await hub('find_friend_by_code', bob, NOBODY_CODE);
      assert.deepEqual(nobody, { ok: false, outcome: 'not_found' });
      for (const [caller, code, requestRef] of [
        [alice, his, herLookup.requestRef],
        [bob, hers, hisLookup.requestRef],
      ]) {
        assert.deepEqual(await hub('find_friend_by_code', caller, code), nobody);
        await refused('not_found', 'send_friend_request', caller, requestRef);
      }
      await hasNoRequests(alice);
      await hasNoRequests(bob);
      await noFriends(alice, bob);

      // The blocker's own request goes too, even one that was declined.
      const carol = person();
      const dave = person();
      const club = await ok('create_group', carol, 'Other', 'Cee');
      await ok('join_group', dave, club.inviteCode, 'Dee');
      await sendRequest(carol, dave);
      await ok('decline_friend_request', dave, (await incoming(dave))[0].requestRef);
      assert.equal((await outgoing(carol)).length, 1);
      await ok('block', carol, (await otherMember(carol, club.groupId)).memberRef);
      await hasNoRequests(carol);
      await hasNoRequests(dave);
    });

    await t.test('requests: lookups and sends share 30 a day, and a code nobody holds counts too', async () => {
      const alice = person();
      const bob = person();
      const code = await friendCodeOf(bob);
      const { requestRef } = await ok('find_friend_by_code', alice, code);
      for (let i = 1; i < 30; i++) {
        const answer = await hub('find_friend_by_code', alice, i % 2 === 0 ? code : NOBODY_CODE);
        assert.ok(answer.ok || answer.outcome === 'not_found', `attempt ${i} should still be allowed`);
      }
      await refused('slow_down', 'find_friend_by_code', alice, code);
      await refused('slow_down', 'send_friend_request', alice, requestRef);
      await hasNoRequests(bob);

      const ageActivity = `update social.activity a set at = now() - interval '25 hours' from social.persons p where p.id = a.person_id and p.global_user_id = $1`;
      await db.query(ageActivity, [alice]);
      await ok('send_friend_request', alice, requestRef);
      assert.equal((await incoming(bob)).length, 1);

      // A send spends the same allowance.
      const carol = person();
      const dave = person();
      await sendRequest(carol, dave);
      assert.equal(await count(`from social.activity a join social.persons p on p.id = a.person_id where p.global_user_id = $1 and a.kind = 'friend_lookup'`, carol), 2);
    });

    await t.test('requests: a lookup ref works only for its caller and its hour, and only a hash of it is stored', async () => {
      const alice = person();
      const bob = person();
      const carol = person();
      const dave = person();
      const toBob = await lookUp(alice, bob);
      const toDave = await lookUp(alice, dave);

      const { rows } = await db.query(
        `select to_jsonb(l)::text as whole, extract(epoch from l.expires_at - now()) as seconds from social.friend_lookups l where l.ref_hash = ${hashOfRef}`,
        [toBob.requestRef],
      );
      assert.equal(rows.length, 1, 'the row should be findable by hash');
      assert.ok(!rows[0].whole.includes(toBob.requestRef), 'the ref itself should be nowhere in the row');
      assert.ok(Number(rows[0].seconds) > 3500 && Number(rows[0].seconds) <= 3600, 'a ref should last an hour');

      const before = await worldState();
      await refused('not_found', 'send_friend_request', carol, toBob.requestRef);
      await refused('not_found', 'send_friend_request', bob, toBob.requestRef);
      await refused('not_found', 'accept_friend_request', bob, toBob.requestRef);
      await refused('not_found', 'send_friend_request', alice, 'no-such-ref');
      await hasNoRequests(alice);
      await hasNoRequests(bob);
      assert.equal(JSON.parse(await worldState()).requests, JSON.parse(before).requests);

      await db.query(`update social.friend_lookups set expires_at = now() - interval '1 millisecond' where ref_hash = ${hashOfRef}`, [toDave.requestRef]);
      await refused('not_found', 'send_friend_request', alice, toDave.requestRef);
      await hasNoRequests(dave);

      await ok('send_friend_request', alice, toBob.requestRef);
      assert.equal((await incoming(bob)).length, 1, 'a ref still in its hour should work');
    });

    await t.test('notice_required leaves nothing behind, for any version but the current one', async () => {
      const owner = person();
      const joiner = person();
      const third = person();
      const { groupId, inviteCode } = await ok('create_group', owner, 'Club', 'Owner');
      const { code } = await ok('create_friend_invite', owner);
      await sendRequest(owner, joiner);
      const [asked] = await incoming(joiner);
      const { requestRef } = await lookUp(joiner, third);
      const before = await worldState();

      for (const version of [null, NOTICE - 1, NOTICE + 1]) {
        await refused('notice_required', 'join_group', joiner, inviteCode, 'Jo', version);
        await refused('notice_required', 'accept_friend_invite', joiner, code, version);
        await refused('notice_required', 'send_friend_request', joiner, requestRef, version);
        await refused('notice_required', 'accept_friend_request', joiner, asked.requestRef, version);
        await refused('notice_required', 'create_friend_invite', joiner, version);
        await refused('notice_required', 'create_group', joiner, 'Mine', 'Jo', version);
        await refused('notice_required', 'create_group', joiner, '   ', 'Jo', version);
      }
      assert.equal(await worldState(), before);

      await ok('join_group', joiner, inviteCode, 'Jo');
      await refused('notice_required', 'join_group', joiner, inviteCode, 'Jo', NOTICE + 1);
      const { rows: seen } = await db.query(`select name, notice_version from social.memberships where group_id = $1 order by name`, [groupId]);
      assert.deepEqual(seen, [
        { name: 'Jo', notice_version: NOTICE },
        { name: 'Owner', notice_version: NOTICE },
      ]);
    });

    await t.test('a friendship keeps the version each side saw, the inviter\'s from the invite', async () => {
      const inviter = person();
      const accepter = person();
      const { code } = await ok('create_friend_invite', inviter);
      const hash = `encode(sha256(convert_to($1, 'UTF8')), 'hex')`;
      assert.deepEqual((await db.query(`select notice_version from social.invites where code_hash = ${hash}`, [code])).rows, [{ notice_version: NOTICE }]);

      // A version no call can send, so it can only have come from the invite.
      const earlier = NOTICE + 40;
      await db.query(`update social.invites set notice_version = ${earlier} where code_hash = ${hash}`, [code]);
      const { friendRef } = await ok('accept_friend_invite', accepter, code);

      const { rows } = await db.query(
        `select p.global_user_id as who, case when f.person_a = p.id then f.notice_a else f.notice_b end as notice
           from social.friendships f join social.persons p on p.id in (f.person_a, f.person_b)
          where f.id = $1`,
        [friendRef],
      );
      assert.deepEqual(Object.fromEntries(rows.map((row) => [row.who, row.notice])), { [inviter]: earlier, [accepter]: NOTICE });
    });

    await t.test('needs_display_name leaves nothing behind, and reading, declining and deleting need no name', async () => {
      const owner = person();
      const nora = nameless();
      const { inviteCode } = await ok('create_group', owner, 'Club', 'Owner');
      const { code } = await ok('create_friend_invite', owner);
      const friendCode = await friendCodeOf(owner);
      const before = await worldState();

      await refused('needs_display_name', 'create_friend_invite', nora);
      await refused('needs_display_name', 'accept_friend_invite', nora, code);
      await refused('needs_display_name', 'find_friend_by_code', nora, friendCode);
      await refused('needs_display_name', 'send_friend_request', nora, randomUUID());
      await refused('needs_display_name', 'accept_friend_request', nora, randomUUID());
      await refused('needs_display_name', 'create_group', nora, 'Club', 'Nora');
      await refused('needs_display_name', 'join_group', nora, inviteCode, 'Nora');
      // The name comes first, whatever the notice says.
      await refused('needs_display_name', 'create_friend_invite', nora, NOTICE + 1);
      await refused('needs_display_name', 'create_group', nora, 'Club', 'Nora', NOTICE + 1);
      assert.equal(await worldState(), before);

      assert.equal((await lookUp(owner, nora)).name, null, 'someone with no name shows as null');
      await sendRequest(owner, nora);
      const [asked] = await incoming(nora);
      await refused('needs_display_name', 'accept_friend_request', nora, asked.requestRef);
      await ok('decline_friend_request', nora, asked.requestRef);
      assert.equal((await ok('preview_invite', nora, inviteCode)).isMember, false);
      await ok('delete_person', nora);
    });

    await t.test('a group invitation shows an anonymous caller exactly the allowed fields, the owner first, and creates nobody', async () => {
      const owner = await player('Alice Private', 'rainbow');
      await ok('set_profile', owner, 'Alice Private', 'bear', '#F1CDDA');
      const { groupId, inviteCode } = await ok('create_group', owner, 'Club', 'Al');
      const joiners = [
        ['Bee', 'owl', '#CCE6CA'],
        ['Cee', 'otter', '#F8E4A0'],
        ['Dee', 'panda', '#CCE1F1'],
        ['Eve', 'lion', '#F8D0BD'],
      ];
      for (const [index, [name, animalId, color]] of joiners.entries()) {
        const id = person();
        await ok('set_profile', id, `${name} Private`, animalId, color);
        await ok('join_group', id, inviteCode, name);
        await db.query(`update social.memberships set joined_at = $1 where group_id = $2 and name = $3`, [iso(Date.UTC(2026, 0, 1, 0, 0, index)), groupId, name]);
      }
      // The owner joined last on paper, and still comes first.
      await db.query(`update social.memberships set joined_at = $1 where group_id = $2 and name = 'Al'`, [iso(Date.UTC(2026, 0, 2)), groupId]);
      await finish('rainbow', owner);

      const expected = {
        name: 'Club',
        emblemId: 'campfire',
        accentColor: '#DED1F2',
        photo: null,
        memberPreview: {
          faces: [
            { animalId: 'bear', backgroundColor: '#F1CDDA' },
            { animalId: 'owl', backgroundColor: '#CCE6CA' },
            { animalId: 'otter', backgroundColor: '#F8E4A0' },
          ],
          leadName: 'Al',
          memberCount: 5,
        },
        isMember: false,
        isRemoved: false,
      };
      const people = await count(`from social.persons`);
      assert.deepEqual(await ok('preview_invite', null, inviteCode), expected);
      for (const id of ['not-an-id', '', 'user_nevercame1111']) assert.deepEqual(await ok('preview_invite', id, inviteCode), expected, `the id ${id}`);
      assert.equal(await count(`from social.persons`), people, 'a preview should create nobody');

      assert.deepEqual(await ok('preview_invite', person(), inviteCode), expected, 'a signed-in stranger sees what a guest sees');

      await ok('leave_group', owner, groupId);
      const after = (await ok('preview_invite', null, inviteCode)).memberPreview;
      assert.equal(after.leadName, 'Bee');
      assert.equal(after.faces[0].animalId, 'owl');
      assert.equal(after.memberCount, 4);
    });

    await t.test('a member and a removed person get no memberPreview, and a guest still does', async () => {
      const owner = person();
      const member = person();
      const gone = person();
      const { groupId, inviteCode } = await ok('create_group', owner, 'Club', 'Owner');
      await ok('join_group', member, inviteCode, 'Bee');
      await ok('join_group', gone, inviteCode, 'Cee');
      await ok('remove_member', owner, groupId, (await memberNamed(owner, groupId, 'Cee')).memberRef);

      for (const who of [owner, member]) {
        const seen = await ok('preview_invite', who, inviteCode);
        assert.deepEqual([seen.isMember, seen.isRemoved, seen.memberPreview], [true, false, null]);
      }
      const theirs = await ok('preview_invite', gone, inviteCode);
      assert.deepEqual([theirs.isMember, theirs.isRemoved, theirs.memberPreview], [false, true, null]);
      assert.equal((await ok('preview_invite', null, inviteCode)).memberPreview.memberCount, 2);
    });

    await t.test('an unknown or replaced code shows no one', async () => {
      const owner = person();
      const { groupId, inviteCode } = await ok('create_group', owner, 'Club', 'Owner');
      const fresh = (await ok('replace_invite', owner, groupId)).inviteCode;
      for (const viewer of [null, person()]) {
        await refused('invalid_code', 'preview_invite', viewer, inviteCode);
        await refused('invalid_code', 'preview_invite', viewer, 'nosuchcode00');
        await refused('invalid_code', 'preview_invite', viewer, null);
        assert.equal((await ok('preview_invite', viewer, ` ${fresh.toUpperCase()} `)).memberPreview.memberCount, 1);
      }
    });

    await t.test('a friend invitation shows the inviter and their face alone, until it is used or expires', async () => {
      const alice = person();
      await ok('set_profile', alice, 'Alice', 'owl', '#F8E4A0');
      const { code } = await ok('create_friend_invite', alice);
      assert.deepEqual(await ok('preview_invite', null, code), { inviterName: 'Alice', animalId: 'owl', backgroundColor: '#F8E4A0' });

      const stale = (await ok('create_friend_invite', alice)).code;
      await db.query(`update social.invites set expires_at = now() - interval '1 second' where code_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`, [stale]);
      await refused('invite_expired', 'preview_invite', null, stale);

      await ok('accept_friend_invite', person(), code);
      await refused('invite_used', 'preview_invite', null, code);
    });

    await t.test('a group look comes from the approved lists and its picture is checked from its own bytes', async () => {
      const owner = person();
      const member = person();
      const { groupId, inviteCode } = await ok('create_group', owner, 'Club', 'Owner');
      await ok('join_group', member, inviteCode, 'Bee');
      const set = async (emblem, photo, color) => (await ok('set_group_appearance', owner, groupId, emblem, photo, color)).photoVersion;
      const look = ['moon', null, '#CCE6CA'];

      await refused('not_the_creator', 'set_group_appearance', member, groupId, ...look);
      for (const bad of ['dragon', 'Moon', '', null]) await refused('bad_emblem', 'set_group_appearance', owner, groupId, bad, null, '#CCE6CA');
      for (const bad of ['#cce6ca', 'red', '', null]) await refused('bad_color', 'set_group_appearance', owner, groupId, 'moon', null, bad);
      for (const emblem of contractList('GROUP_EMBLEM_IDS')) assert.equal(await set(emblem, null, '#CCE6CA'), 0);

      const edge = 256;
      const small = photoFrom(jpegBytes(edge, edge, 1000));
      const encoded = Buffer.from(jpegBytes(edge, edge)).toString('base64');
      const notPictures = [
        '',
        'a picture',
        encoded,
        `data:image/png;base64,${encoded}`,
        PHOTO_PREFIX,
        `${PHOTO_PREFIX}@@@not base64@@@`,
        `${PHOTO_PREFIX}${encoded.slice(0, -1)}`,
        // Stray bits after the last byte: decode() lets these through, and the mock doesn't.
        `${PHOTO_PREFIX}${encoded.slice(0, -2)}l=`,
        photoFrom([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        photoFrom([...Buffer.from('<svg onload=alert(1)>')]),
        photoFrom([0xff, 0xd8, 0xff, 0xd9]),
      ];
      for (const photo of notPictures) await refused('not_a_picture', 'set_group_appearance', owner, groupId, 'moon', photo, '#CCE6CA');
      for (const [width, height] of [[edge - 1, edge], [edge, edge - 1], [4000, 4000]]) {
        await refused('wrong_size', 'set_group_appearance', owner, groupId, 'moon', photoFrom(jpegBytes(width, height)), '#CCE6CA');
      }
      const padding = 61440 - (jpegBytes(edge, edge, 1).length - 1);
      const largest = photoFrom(jpegBytes(edge, edge, padding));
      await refused('too_big', 'set_group_appearance', owner, groupId, 'moon', photoFrom(jpegBytes(edge, edge, padding + 1)), '#CCE6CA');
      await refused('too_big', 'set_group_appearance', owner, groupId, 'moon', `${PHOTO_PREFIX}${'A'.repeat(90000)}`, '#CCE6CA');

      assert.equal(await set('moon', largest, '#CCE6CA'), 1, 'the largest allowed picture should save');
      assert.equal(await set('moon', largest, '#CCE6CA'), 1, 'the same picture again is no change');
      assert.equal(await set('cabin', largest, '#F8E4A0'), 1, 'a new emblem and color are no change to the picture');
      assert.equal(await set('cabin', small, '#F8E4A0'), 2);
      assert.equal(await set('cabin', null, '#F8E4A0'), 3, 'clearing the picture should move the version');
      assert.equal(await set('cabin', null, '#F8E4A0'), 3);
      assert.equal(await set('book', small, '#F8D0BD'), 4);

      for (const who of [owner, member]) {
        const [row] = await ok('list_my_groups', who);
        assert.deepEqual([row.emblemId, row.accentColor, row.photo, row.photoVersion], ['book', '#F8D0BD', small, 4]);
      }
      const guest = await ok('preview_invite', null, inviteCode);
      assert.deepEqual([guest.emblemId, guest.accentColor, guest.photo], ['book', '#F8D0BD', small]);
    });

    await t.test('the gateway cannot run the server functions, and the game server can run those and nothing else', async () => {
      await assert.rejects(asRole('social_gateway', () => db.query(`select social.record_completion(null, null, null, null, null, null)`)), /permission denied/);
      await assert.rejects(asRole('social_gateway', () => db.query(`select social.audience_global_ids(null, null)`)), /permission denied/);
      await assert.rejects(asRole('social_gateway', () => db.query(`select social.audience_global_ids(null)`)), /permission denied/);
      for (const signature of ['social.record_completion(text, text, text, text, jsonb, jsonb)', 'social.audience_global_ids(text, text)']) {
        assert.equal((await db.query(`select has_function_privilege('social_gateway'::name, '${signature}', 'execute') as can`)).rows[0].can, false, signature);
      }

      const { rows } = await db.query(
        `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'social' and has_function_privilege('social_game_server'::name, p.oid, 'execute')`,
      );
      assert.deepEqual(rows.map((r) => r.proname).sort(), SERVER_FUNCTIONS);
      for (const { proname, pronargs } of functions) {
        if (SERVER_FUNCTIONS.includes(proname)) continue;
        const nulls = Array(pronargs).fill('null').join(', ');
        await assert.rejects(asRole('social_game_server', () => db.query(`select social.${proname}(${nulls})`)), /permission denied/, proname);
      }
      for (const table of tables) {
        await assert.rejects(asRole('social_game_server', () => db.query(`select * from social.${table}`)), /permission denied/, `reading ${table}`);
      }
      await assert.rejects(
        asRole('social_game_server', () => db.query(`insert into social.result_cards (game, puzzle_id, person_id, completed_at, summary) values ('rainbow', 'x', gen_random_uuid(), now(), '{}')`)),
        /permission denied/,
      );
      for (const role of ['social_gateway', 'social_game_server']) {
        assert.equal(await count(`from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'social' and c.relkind = 'r' and has_table_privilege('${role}'::name, c.oid, 'select, insert, update, delete')`), 0);
      }
    });

    await t.test('a result that does not fit its game is refused and stores nothing', async () => {
      const alice = await player('Alice', 'rainbow', 'crosspuns', 'wtf', 'cluevoyance');
      const at = justNow();
      const rainbow = { who: alice, game: 'rainbow', at };
      const crosspuns = { who: alice, game: 'crosspuns', at };
      const wtf = { who: alice, game: 'wtf', at };
      const spoiled = [
        { ...rainbow, who: null },
        { ...rainbow, puzzle: null },
        { ...rainbow, puzzle: '' },
        { ...rainbow, puzzle: 'x'.repeat(65) },
        { ...rainbow, puzzle: 'has a space' },
        { ...rainbow, at: null },
        { ...rainbow, at: 'today' },
        { ...rainbow, at: '2025-01-01T00:00:00Z' },
        { ...rainbow, at: '2025-02-31T00:00:00.000Z' },
        { ...rainbow, at: '2025-01-01T24:00:00.000Z' },
        { ...rainbow, at: iso(Date.now() + 60000) },
        { ...rainbow, summary: null },
        { ...rainbow, summary: 'a result' },
        { ...rainbow, summary: { solved: true } },
        { ...rainbow, summary: { solved: true, mistakes: 1, note: 'free text' } },
        { ...rainbow, summary: { solved: 'yes', mistakes: 1 } },
        { ...rainbow, summary: { solved: true, mistakes: -1 } },
        { ...rainbow, summary: { solved: true, mistakes: 1.5 } },
        { ...rainbow, summary: { solved: true, mistakes: '1' } },
        { ...rainbow, detail: null },
        { ...rainbow, detail: '' },
        { ...rainbow, detail: '   ' },
        { ...rainbow, detail: [true] },
        { ...rainbow, detail: 'x'.repeat(501) },
        { ...crosspuns, summary: { seconds: 'fast' } },
        { ...crosspuns, summary: { score: 7 } },
        { ...crosspuns, detail: 'a grid' },
        { ...wtf, detail: null },
        { ...wtf, detail: [] },
        { ...wtf, detail: ['yes'] },
        { ...wtf, detail: 'a grid' },
        { ...wtf, detail: Array(501).fill(true) },
        { ...rainbow, game: 'cluevoyance', summary: SAMPLE_RESULTS.rainbow.summary, detail: SAMPLE_RESULTS.rainbow.detail },
        { ...wtf, game: 'cluevoyance', summary: SAMPLE_RESULTS.wtf.summary, detail: SAMPLE_RESULTS.wtf.detail },
      ];
      const cards = await count(`from social.result_cards`);
      for (const input of spoiled) assert.deepEqual(await recording(input), { ok: false, outcome: 'bad_result' }, JSON.stringify(input).slice(0, 120));
      assert.equal(await count(`from social.result_cards`), cards, 'nothing should have been stored');

      for (const puzzle of ['x', 'Daily:a_b-9', 'x'.repeat(64)]) await finish('rainbow', alice, puzzle);
      assert.deepEqual(await recording({ ...rainbow, puzzle: 'longest', detail: 'x'.repeat(500) }), { ok: true, data: {} });
      assert.deepEqual(await recording({ ...wtf, puzzle: 'longest', detail: Array(500).fill(false) }), { ok: true, data: {} });

      // A JSON null is no detail too, as a game server's body would send it.
      const { rows } = await asRole('social_game_server', () =>
        db.query(`select social.record_completion($1, 'crosspuns', 'json-null', $2, '{"seconds":1}'::jsonb, 'null'::jsonb) as answer`, [alice, justNow()]),
      );
      assert.deepEqual(parsed(rows[0].answer), { ok: true, data: {} });
      assert.equal((await results(alice, 'crosspuns', 'json-null'))[0].detail, null);
    });

    await t.test('the hub itself refuses a disabled or unknown game, whatever the result looks like, and every shape is ready', async () => {
      const alice = await player('Alice', 'yodel', 'hamburgle', 'priceiswhat');
      const refusal = { ok: false, outcome: 'game_disabled' };
      const cards = await count(`from social.result_cards`);
      const shapes = [
        ['yodel', { score: 5 }],
        ['hamburgle', { guesses: 3 }],
        ['priceiswhat', { score: 80 }],
      ];
      for (const [game, summary] of shapes) {
        assert.deepEqual(await recording({ who: alice, game, summary, detail: null }), refusal, game);
        assert.deepEqual(await recording({ who: alice, game, summary: null, at: 'today', detail: null }), refusal, `${game}, malformed`);
        const { rows } = await db.query(`select social.result_fits($1, $2::text::jsonb, null) as fits`, [game, JSON.stringify(summary)]);
        assert.equal(rows[0].fits, true, `${game}: its shape should be waiting for it`);
      }
      assert.deepEqual(await recording({ who: alice, game: 'not-a-game', summary: { score: 1 }, detail: null }), refusal);
      assert.deepEqual(await recording({ who: alice, game: null, summary: { score: 1 }, detail: null }), refusal);
      assert.equal(await count(`from social.result_cards`), cards);
    });

    await t.test('a known person gets the game link and the result, and an unknown person stays not_found and is never created', async () => {
      const alice = await player('Alice', 'rainbow');
      const links = `from social.game_links l join social.persons p on p.id = l.person_id where p.global_user_id = $1 and l.game = 'crosspuns'`;
      assert.equal(await count(links, alice), 0);

      assert.deepEqual(await recording({ who: alice, game: 'crosspuns', summary: { seconds: 'fast' } }), { ok: false, outcome: 'bad_result' });
      assert.equal(await count(links, alice), 0, 'a refused result should make no link');

      await finish('crosspuns', alice);
      assert.equal(await count(links, alice), 1, 'the game server vouches for its own account');
      assert.deepEqual((await results(alice, 'crosspuns')).map((row) => row.isMe), [true], 'the result should not vanish');
      await finish('crosspuns', alice);
      assert.equal(await count(links, alice), 1, 'a replay should make no second link');

      const refusal = { ok: false, outcome: 'not_found' };
      const people = await count(`from social.persons`);
      const allLinks = await count(`from social.game_links`);
      const cards = await count(`from social.result_cards`);
      assert.deepEqual(await recording({ who: 'user_nobody000000', game: 'rainbow' }), refusal);
      assert.deepEqual(await recording({ who: 'not-an-id', game: 'rainbow' }), refusal);
      assert.equal(await count(`from social.persons`), people, 'a result should never create a person');
      assert.equal(await count(`from social.game_links`), allLinks);
      assert.equal(await count(`from social.result_cards`), cards);
    });

    await t.test('detail is left out of the JSON until the viewer finishes the same game and puzzle', async () => {
      for (const [game, other] of [
        ['rainbow', 'wtf'],
        ['wtf', 'rainbow'],
      ]) {
        const first = await player('First', game);
        const viewer = await player('Viewer', game, other);
        await befriend(first, viewer);
        const { groupId, inviteCode } = await ok('create_group', first, 'Club', 'First');
        await ok('join_group', viewer, inviteCode, 'Viewer');
        await finish(game, first);

        const { summary, detail } = SAMPLE_RESULTS[game];
        const bothAudiences = async () => [await results(viewer, game), await results(viewer, game, PUZZLE, groupId)];
        const stillLocked = async (label) => {
          for (const rows of await bothAudiences()) {
            assert.equal(rows.length, 1, label);
            assert.ok(!('detail' in rows[0]), `${label}: the key should be absent`);
            assert.equal(rows[0].detailLocked, true, label);
            assert.deepEqual(rows[0].summary, summary, label);
            assert.ok(!JSON.stringify(rows).includes(JSON.stringify(detail)), `${label}: the detail should be nowhere in the answer`);
          }
        };

        await stillLocked('nothing finished');
        await finish(game, viewer, OTHER_PUZZLE);
        await stillLocked('a different puzzle finished');
        await finish(other, viewer);
        await stillLocked('the same puzzle id finished in another game');

        await finish(game, viewer);
        for (const rows of await bothAudiences()) {
          assert.equal(rows.length, 2);
          for (const row of rows) {
            assert.deepEqual(row.detail, detail);
            assert.equal(row.detailLocked, false);
          }
        }
      }
    });

    await t.test('a result with no detail says so to everyone, and each row carries the ref to join on', async () => {
      const alice = await player('Alice', 'crosspuns');
      const bob = await player('Bob', 'rainbow');
      const { friendRef } = await befriend(alice, bob);
      const { groupId, inviteCode } = await ok('create_group', alice, 'Club', 'Al');
      await ok('join_group', bob, inviteCode, 'Bee');
      assert.deepEqual(await results(alice, 'crosspuns'), [], 'nobody has played yet');
      await finish('crosspuns', alice);

      for (const viewer of [alice, bob]) {
        const [row] = await results(viewer, 'crosspuns');
        assert.ok('detail' in row);
        assert.deepEqual([row.detail, row.detailLocked], [null, false]);
      }
      const [mine] = await results(alice, 'crosspuns');
      assert.ok('friendRef' in mine);
      assert.deepEqual([mine.isMe, mine.friendRef, mine.name], [true, null, 'Alice']);
      const [seen] = await results(bob, 'crosspuns');
      assert.deepEqual([seen.isMe, seen.friendRef, seen.name], [false, friendRef, 'Alice']);
      const [inGroup] = await results(alice, 'crosspuns', PUZZLE, groupId);
      const me = (await ok('list_members', alice, groupId)).find((m) => m.isMe);
      assert.deepEqual([inGroup.isMe, inGroup.memberRef, inGroup.name], [true, me.memberRef, 'Al']);
    });

    await t.test('a stranger gets nothing, and a group they are not in looks like no group at all', async () => {
      const alice = await player('Alice', 'rainbow');
      const stranger = person();
      const { groupId } = await ok('create_group', alice, 'Club', 'Al');
      await finish('rainbow', alice);
      assert.deepEqual(await results(stranger, 'rainbow'), []);
      for (const id of [groupId, randomUUID(), 'no-such-group', '']) await refused('not_a_member', 'list_results', stranger, 'rainbow', PUZZLE, id);
    });

    await t.test('forward-only: a friend sees only what was completed at or after the friendship began', async () => {
      const alice = await player('Alice', 'rainbow');
      const bob = await player('Bob', 'crosspuns');
      await finish('rainbow', alice, 'before', ago(60));
      const { friendRef } = await befriend(alice, bob);
      const since = ago(30);
      await db.query(`update social.friendships set since = $1 where id = $2`, [since, friendRef]);
      await finish('rainbow', alice, 'just-before', iso(Date.parse(since) - 1));
      await finish('rainbow', alice, 'same-moment', since);
      await finish('rainbow', alice, 'after', ago(10));

      assert.deepEqual(await results(bob, 'rainbow', 'before'), []);
      assert.deepEqual(await results(bob, 'rainbow', 'just-before'), []);
      assert.equal((await results(bob, 'rainbow', 'same-moment')).length, 1);
      assert.equal((await results(bob, 'rainbow', 'after')).length, 1);
      assert.equal((await results(alice, 'rainbow', 'before'))[0].isMe, true, 'my own result is mine whatever its date');

      await ok('remove_friend', bob, friendRef);
      await befriend(bob, alice);
      assert.deepEqual(await results(bob, 'rainbow', 'after'), [], 'a new friendship should start from its own moment');
    });

    await t.test('forward-only: in a group, from the later of the two people joining', async () => {
      const alice = await player('Alice', 'rainbow');
      const bob = await player('Bob', 'rainbow');
      const carol = await player('Carol', 'crosspuns');
      const { groupId, inviteCode } = await ok('create_group', alice, 'Club', 'Al');
      await ok('join_group', bob, inviteCode, 'Bee');
      await ok('join_group', carol, inviteCode, 'Cee');
      for (const [name, seconds] of [['Al', 100], ['Bee', 50], ['Cee', 10]]) {
        await db.query(`update social.memberships set joined_at = $1 where group_id = $2 and name = $3`, [ago(seconds), groupId, name]);
      }
      await finish('rainbow', alice, 'before-bob', ago(60));
      await finish('rainbow', alice, 'between', ago(30));
      await finish('rainbow', bob, 'between', ago(30));
      await finish('rainbow', alice, 'after', ago(5));
      await finish('rainbow', bob, 'after', ago(5));

      assert.deepEqual(await results(bob, 'rainbow', 'before-bob', groupId), []);
      assert.equal((await results(bob, 'rainbow', 'between', groupId)).length, 2);
      assert.equal((await results(alice, 'rainbow', 'between', groupId)).length, 2);
      assert.deepEqual(await results(carol, 'rainbow', 'between', groupId), [], 'someone who joined later should not see the past');
      assert.equal((await results(carol, 'rainbow', 'after', groupId)).length, 2);
      assert.equal((await results(alice, 'rainbow', 'before-bob', groupId))[0].isMe, true);
    });

    await t.test('unfriending, leaving and removal hide rows at once, each from its own audience', async () => {
      const onlyMine = (rows, label) => assert.deepEqual(rows.map((row) => row.isMe), [true], label);
      const alice = await player('Alice', 'rainbow');
      const bob = await player('Bob', 'rainbow');
      const carol = await player('Carol', 'crosspuns');
      const { friendRef } = await befriend(alice, bob);
      const { groupId, inviteCode } = await ok('create_group', alice, 'Club', 'Al');
      await ok('join_group', bob, inviteCode, 'Bee');
      await ok('join_group', carol, inviteCode, 'Cee');
      const carolRow = await memberNamed(alice, groupId, 'Cee');
      await finish('rainbow', alice);
      await finish('rainbow', bob);
      assert.equal((await results(alice, 'rainbow')).length, 2);
      assert.equal((await results(alice, 'rainbow', PUZZLE, groupId)).length, 2);

      await ok('remove_friend', bob, friendRef);
      onlyMine(await results(alice, 'rainbow'), 'unfriending hides her from him');
      onlyMine(await results(bob, 'rainbow'), 'and him from her');
      assert.equal((await results(bob, 'rainbow', PUZZLE, groupId)).length, 2, 'the shared group is its own audience');

      await ok('leave_group', bob, groupId);
      onlyMine(await results(alice, 'rainbow', PUZZLE, groupId), 'leaving hides the row from the group');
      await refused('not_a_member', 'list_results', bob, 'rainbow', PUZZLE, groupId);

      assert.equal((await results(carol, 'rainbow', PUZZLE, groupId)).length, 1);
      await ok('remove_member', alice, groupId, carolRow.memberRef);
      await refused('not_a_member', 'list_results', carol, 'rainbow', PUZZLE, groupId);
      assert.deepEqual(await results(carol, 'rainbow'), []);
    });

    await t.test('a block hides rows both ways in every audience, though both stay members', async () => {
      const onlyMine = (rows) => assert.deepEqual(rows.map((row) => row.isMe), [true]);
      const alice = await player('Alice', 'rainbow');
      const bob = await player('Bob', 'rainbow');
      const carol = await player('Carol', 'crosspuns');
      await befriend(alice, bob);
      const { groupId, inviteCode } = await ok('create_group', alice, 'Club', 'Al');
      await ok('join_group', bob, inviteCode, 'Bee');
      await ok('join_group', carol, inviteCode, 'Cee');
      const row = await memberNamed(alice, groupId, 'Bee');
      await finish('rainbow', alice);
      await finish('rainbow', bob);

      await ok('block', alice, row.memberRef);

      for (const who of [alice, bob]) {
        onlyMine(await results(who, 'rainbow'));
        onlyMine(await results(who, 'rainbow', PUZZLE, groupId));
      }
      assert.equal((await ok('list_members', alice, groupId)).length, 3, 'a block has no effect on membership');
      assert.equal((await results(carol, 'rainbow', PUZZLE, groupId)).length, 2, 'everyone else should see both');
    });

    await t.test('the first result for a game, puzzle and person wins, and a replay changes nothing', async () => {
      const alice = await player('Alice', 'rainbow');
      const bob = await player('Bob', 'rainbow');
      await befriend(alice, bob);
      await finish('rainbow', alice);
      await finish('rainbow', bob);
      const before = await results(bob, 'rainbow');
      const stored = `from social.result_cards c join social.persons p on p.id = c.person_id where p.global_user_id = $1`;
      const firstTime = (await db.query(`select c.completed_at::text as at ${stored}`, [alice])).rows[0].at;

      const replay = { who: alice, game: 'rainbow', summary: { solved: false, mistakes: 4 }, detail: 'RRRR' };
      assert.deepEqual(await recording(replay), { ok: true, data: {} });
      assert.deepEqual(await results(bob, 'rainbow'), before);
      assert.equal(await count(stored, alice), 1);
      assert.equal((await db.query(`select c.completed_at::text as at ${stored}`, [alice])).rows[0].at, firstTime);

      assert.deepEqual(await recording({ ...replay, puzzle: OTHER_PUZZLE }), { ok: true, data: {} });
      assert.deepEqual((await results(alice, 'rainbow', OTHER_PUZZLE))[0].summary, replay.summary, 'another puzzle is another result');
    });

    await t.test('deletion leaves no card, request, lookup or friend code behind', async () => {
      const alice = await player('Alice', 'rainbow', 'wtf');
      const bob = await player('Bob', 'rainbow');
      const carol = person();
      const dave = person();
      const erin = person();
      await finish('rainbow', alice);
      await finish('wtf', alice);
      await finish('rainbow', bob);
      await sendRequest(alice, carol);
      await sendRequest(dave, alice);
      const held = await lookUp(erin, alice);
      const code = await friendCodeOf(alice);
      const { rows } = await db.query(`select id::text as id from social.persons where global_user_id = $1`, [alice]);
      const { id } = rows[0];
      const cards = await count(`from social.result_cards`);

      await ok('delete_person', alice);

      // No operation reaches a deleted person's cards, so the tables are the only proof.
      assert.equal(cards - (await count(`from social.result_cards`)), 2, 'her two cards should go and nobody else\'s');
      assert.equal(await count(`from social.result_cards where person_id = $1`, id), 0);
      assert.equal(await count(`from social.friend_requests where from_person = $1 or to_person = $1`, id), 0);
      assert.equal(await count(`from social.friend_lookups where caller = $1 or target = $1`, id), 0);
      assert.equal(await count(`from social.persons where friend_code = $1`, code.replace('-', '')), 0);

      await hasNoRequests(carol);
      await hasNoRequests(dave);
      await refused('not_found', 'find_friend_by_code', bob, code);
      await refused('not_found', 'send_friend_request', erin, held.requestRef);
      assert.deepEqual(await recording({ who: alice, game: 'rainbow' }), { ok: false, outcome: 'not_found' });
      assert.deepEqual((await results(bob, 'rainbow')).map((row) => row.isMe), [true]);
    });

    await t.test('postgres can take both hub roles, and no client role can', async () => {
      const { rows } = await db.query(
        `select r.rolname as role, u.rolname as member
           from pg_auth_members m
           join pg_roles r on r.oid = m.roleid
           join pg_roles u on u.oid = m.member
          where r.rolname in ('social_gateway', 'social_game_server')
          order by 1, 2`,
      );
      assert.deepEqual(rows, [
        { role: 'social_game_server', member: 'postgres' },
        { role: 'social_gateway', member: 'postgres' },
      ]);
    });

    await t.test('the beta list: a non-tester gets false, the gateway can only ask, and asking creates nobody', async () => {
      const tester = await player('Tess', 'rainbow');
      const other = await player('Otto', 'rainbow');
      await db.query(`insert into social.beta_testers (global_user_id) values ($1)`, [tester]);

      assert.equal(await isBetaTester(tester), true);
      assert.equal(await isBetaTester(other), false);
      const people = await count(`from social.persons`);
      for (const id of ['user_nevercame2222', 'not-an-id', '', null]) assert.equal(await isBetaTester(id), false, `the id ${id}`);
      assert.equal(await count(`from social.persons`), people, 'asking should create nobody');

      await assert.rejects(asRole('social_gateway', () => db.query(`insert into social.beta_testers (global_user_id) values ($1)`, [other])), /permission denied/);
      await assert.rejects(asRole('social_gateway', () => db.query(`delete from social.beta_testers`)), /permission denied/);
      await assert.rejects(db.query(`insert into social.beta_testers (global_user_id) values ('not-a-global-id')`), /beta_testers_global_id_format/);
      assert.equal(await isBetaTester(other), false);
      assert.equal(await count(`from social.beta_testers where added_at is not null`), 1);
    });

    await t.test('unblock: the blocker alone, and friending works again while nothing else comes back', async () => {
      const alice = await player('Alice');
      const bob = await player('Bob');
      const { groupId, inviteCode } = await ok('create_group', alice, 'Club', 'Al');
      await ok('join_group', bob, inviteCode, 'Bee');
      const blockHim = async () => ok('block', alice, (await otherMember(alice, groupId)).memberRef);
      const his = await friendCodeOf(bob);
      const { blockRef } = await blockHim();

      await refused('not_found', 'find_friend_by_code', alice, his);
      await refused('not_found', 'unblock', bob, blockRef);
      await refused('not_found', 'unblock', person(), blockRef);
      await refused('not_found', 'unblock', alice, randomUUID());
      await refused('not_found', 'unblock', alice, 'not-even-a-uuid');
      await refused('not_found', 'find_friend_by_code', alice, his);

      await ok('unblock', alice, blockRef);
      await refused('not_found', 'unblock', alice, blockRef);
      await noFriends(alice, bob);

      await sendRequest(alice, bob);
      await ok('accept_friend_request', bob, (await incoming(bob))[0].requestRef);
      assert.deepEqual((await ok('list_friends', alice)).map((f) => f.name), ['Bob']);

      // Each side's block is its own: lifting mine leaves theirs standing.
      await ok('block', bob, (await ok('list_friends', bob))[0].friendRef);
      const mine = await blockHim();
      await ok('unblock', alice, mine.blockRef);
      await refused('not_found', 'find_friend_by_code', alice, his);
    });

    await t.test('list_blocks: the name as the blocker saw it, for the blocker alone', async () => {
      const alice = await player('Alice');
      const bob = await player('Bob');
      const carol = await player('Carol');
      const { groupId, inviteCode } = await ok('create_group', alice, 'Club', 'Al');
      await ok('join_group', bob, inviteCode, 'Bee');
      const { friendRef } = await befriend(alice, carol);
      assert.deepEqual(await ok('list_blocks', alice), []);

      const throughGroup = await ok('block', alice, (await otherMember(alice, groupId)).memberRef);
      const throughFriend = await ok('block', alice, friendRef);

      // Neither a later name nor a later block changes what was saved.
      await ok('set_display_name', bob, 'Robert');
      await ok('rename_me_in_group', bob, groupId, 'Rob');
      await ok('set_display_name', carol, 'Caroline');
      await ok('block', alice, (await otherMember(alice, groupId)).memberRef);

      const listed = (await ok('list_blocks', alice)).sort((x, y) => x.name.localeCompare(y.name));
      assert.deepEqual(listed, [
        { blockRef: throughGroup.blockRef, name: 'Bee' },
        { blockRef: throughFriend.blockRef, name: 'Carol' },
      ]);
      assert.deepEqual(await ok('list_blocks', bob), [], 'a block never shows to the person blocked');
    });

    await t.test('rename_me_in_group: members only, this group only, and the usual name rules', async () => {
      const owner = person();
      const member = person();
      const outsider = person();
      const first = await ok('create_group', owner, 'One', 'Owner');
      const second = await ok('create_group', owner, 'Two', 'Owner');
      await ok('join_group', member, first.inviteCode, 'Bee');
      await ok('join_group', member, second.inviteCode, 'Bee');
      const names = async (groupId) => (await ok('list_members', owner, groupId)).map((m) => m.name).sort();

      await ok('rename_me_in_group', member, first.groupId, '  Bumble  ');
      assert.deepEqual(await names(first.groupId), ['Bumble', 'Owner']);
      assert.deepEqual(await names(second.groupId), ['Bee', 'Owner'], 'another group keeps its name');
      assert.equal((await ok('ensure_person', member, 'rainbow')).displayName, 'Someone', 'the display name stays');

      for (const bad of ['', '   ', 'x'.repeat(25), null]) await refused('bad_my_name', 'rename_me_in_group', member, first.groupId, bad);
      await refused('not_a_member', 'rename_me_in_group', outsider, first.groupId, 'Sneaky');
      await refused('not_a_member', 'rename_me_in_group', outsider, first.groupId, '   ');
      assert.deepEqual(await names(first.groupId), ['Bumble', 'Owner']);

      await ok('remove_member', owner, first.groupId, (await memberNamed(owner, first.groupId, 'Bumble')).memberRef);
      await refused('not_a_member', 'rename_me_in_group', member, first.groupId, 'Back');
      assert.deepEqual((await ok('list_removed', owner, first.groupId)).map((r) => r.name), ['Bumble']);
    });

    await t.test('list_removed: the owner alone, with the name at removal and a ref that lets them back', async () => {
      const owner = person();
      const member = person();
      const gone = person();
      const { groupId, inviteCode } = await ok('create_group', owner, 'Club', 'Owner');
      await ok('join_group', member, inviteCode, 'Bee');
      await ok('join_group', gone, inviteCode, 'Cee');
      assert.deepEqual(await ok('list_removed', owner, groupId), []);

      await ok('remove_member', owner, groupId, (await memberNamed(owner, groupId, 'Cee')).memberRef);
      await ok('set_display_name', gone, 'Someone new');
      const ref = await removedRef(groupId);
      assert.deepEqual(await ok('list_removed', owner, groupId), [{ removedRef: ref, name: 'Cee' }]);

      await refused('not_the_creator', 'list_removed', member, groupId);
      await refused('not_a_member', 'list_removed', gone, groupId);
      await refused('not_a_member', 'list_removed', person(), groupId);

      await ok('let_back_in', owner, groupId, ref);
      assert.deepEqual(await ok('list_removed', owner, groupId), []);
    });

    await t.test('audience_global_ids: the caller and friends, or the group, never a non-member, and never across a block', async () => {
      const alice = await player('Alice', 'rainbow');
      const bob = await player('Bob', 'rainbow');
      const carol = await player('Carol', 'rainbow');
      const dave = await player('Dave', 'rainbow');
      const stranger = await player('Stranger', 'rainbow');
      await befriend(alice, bob);
      const { groupId, inviteCode } = await ok('create_group', alice, 'Club', 'Al');
      await ok('join_group', carol, inviteCode, 'Cee');
      await ok('join_group', dave, inviteCode, 'Dee');

      await audienceHolds([alice, null], [alice, bob], 'the caller and their friends');
      await audienceHolds([alice], [alice, bob], 'the group is optional');
      await audienceHolds([bob, null], [alice, bob], 'from the other side too');
      await audienceHolds([stranger, null], [stranger], 'no connections');
      await audienceHolds([alice, groupId], [alice, carol, dave], 'the group, and no friend outside it');
      await audienceHolds([carol, groupId], [alice, carol, dave], 'any member');

      const notMember = { ok: false, outcome: 'not_a_member' };
      for (const id of [groupId, randomUUID(), 'no-such-group', '']) assert.deepEqual(await audience(bob, id), notMember, `the group ${id}`);

      const people = await count(`from social.persons`);
      assert.deepEqual(await audience('user_nevercame3333', null), { ok: false, outcome: 'not_found' });
      assert.deepEqual(await audience('user_nevercame3333', groupId), notMember);
      assert.equal(await count(`from social.persons`), people, 'a read should create nobody');

      await ok('block', alice, (await memberNamed(alice, groupId, 'Dee')).memberRef);
      await audienceHolds([alice, groupId], [alice, carol], 'the blocker');
      await audienceHolds([dave, groupId], [carol, dave], 'the person blocked');
      await audienceHolds([carol, groupId], [alice, carol, dave], 'everyone else');

      await ok('remove_member', alice, groupId, (await memberNamed(alice, groupId, 'Cee')).memberRef);
      assert.deepEqual(await audience(carol, groupId), notMember, 'removal ends it at once');
      await ok('remove_friend', bob, (await ok('list_friends', bob))[0].friendRef);
      await audienceHolds([alice, null], [alice], 'unfriending ends it at once');
    });

    await t.test('a malformed global id is refused and creates nothing', async () => {
      const before = await count(`from social.persons`);
      for (const bad of ['bob', 'user_short', 'USER_aaaaaaaaaaaa', "user_aaaaaaaaaa'--", `user_${'a'.repeat(65)}`, '', null]) {
        await refused('not_linked', 'ensure_person', bad, 'crosspuns');
        await refused('not_linked', 'set_display_name', bad, 'Sam');
        await refused('not_linked', 'create_friend_invite', bad);
        await refused('not_linked', 'accept_friend_invite', bad, 'nosuchcode00');
        await refused('not_linked', 'list_friends', bad);
        await refused('not_linked', 'remove_friend', bad, randomUUID());
        await refused('not_linked', 'block', bad, randomUUID());
        await refused('not_linked', 'create_group', bad, 'Club', 'Sam');
        await refused('not_linked', 'join_group', bad, 'nosuchcode00', 'Sam');
        await refused('not_linked', 'list_my_groups', bad);
        await refused('not_linked', 'list_members', bad, randomUUID());
        await refused('not_linked', 'leave_group', bad, randomUUID());
        await refused('not_linked', 'remove_member', bad, randomUUID(), randomUUID());
        await refused('not_linked', 'let_back_in', bad, randomUUID(), randomUUID());
        await refused('not_linked', 'replace_invite', bad, randomUUID());
        await refused('not_linked', 'rename_group', bad, randomUUID(), 'Club');
        await refused('not_linked', 'delete_person', bad);
        await refused('not_linked', 'set_profile', bad, 'Sam', 'fox', '#DED1F2');
        await refused('not_linked', 'find_friend_by_code', bad, NOBODY_CODE);
        await refused('not_linked', 'send_friend_request', bad, randomUUID());
        await refused('not_linked', 'list_friend_requests', bad);
        await refused('not_linked', 'accept_friend_request', bad, randomUUID());
        await refused('not_linked', 'decline_friend_request', bad, randomUUID());
        await refused('not_linked', 'cancel_friend_request', bad, randomUUID());
        await refused('not_linked', 'set_group_appearance', bad, randomUUID(), 'moon', null, '#CCE6CA');
        await refused('not_linked', 'list_results', bad, 'rainbow', PUZZLE, null);
        await refused('not_linked', 'unblock', bad, randomUUID());
        await refused('not_linked', 'list_blocks', bad);
        await refused('not_linked', 'rename_me_in_group', bad, randomUUID(), 'Sam');
        await refused('not_linked', 'list_removed', bad, randomUUID());
        assert.deepEqual(await audience(bad, null), { ok: false, outcome: 'not_linked' });
        assert.equal(await isBetaTester(bad), false);
      }
      assert.equal(await count(`from social.persons`), before);
    });

    await t.test('every answer in this whole run holds exactly its declared keys, and every function was heard from', async () => {
      const sameKeys = (row, keys) => JSON.stringify(Object.keys(row).sort()) === JSON.stringify([...keys].sort());
      const seen = new Set();
      for (const { fn, answer } of answers) {
        seen.add(fn);
        if (answer.ok) {
          assert.deepEqual(Object.keys(answer).sort(), ['data', 'ok'], fn);
          const rows = Array.isArray(answer.data) ? answer.data : [answer.data];
          const allowed = KEY_ALTERNATIVES[fn] ?? [ALLOWED_KEYS[fn]];
          for (const row of rows) assert.ok(allowed.some((keys) => sameKeys(row, keys)), `${fn} answered the keys ${Object.keys(row)}`);
          if (fn === 'list_friend_requests') {
            for (const row of [...answer.data.incoming, ...answer.data.outgoing]) assert.ok(sameKeys(row, REQUEST_ROW_KEYS), `a request row held ${Object.keys(row)}`);
          }
        } else {
          assert.deepEqual(Object.keys(answer).sort(), ['ok', 'outcome'], fn);
          assert.ok(HUB_OUTCOMES.has(answer.outcome), `${fn} gave the unknown outcome ${answer.outcome}`);
        }
      }
      // is_beta_tester answers a plain true or false, so its own test covers it.
      const wireFunctions = ENTRY_FUNCTIONS.filter((fn) => fn !== 'is_beta_tester');
      assert.deepEqual([...seen].sort(), [...wireFunctions, 'record_completion'].sort());
    });

    await t.test('no answer in this whole run contained a global id or an internal person id', async () => {
      assert.ok(answers.length > 100, 'the run should have produced plenty of answers');
      const { rows } = await db.query(`select id::text as id from social.persons`);
      const internal = new Set([...rows.map((r) => r.id), ...deletedIds]);
      assert.ok(deletedIds.size > 0, 'someone should have been deleted along the way');
      for (const { answer } of answers) {
        const text = JSON.stringify(answer);
        assert.doesNotMatch(text, /user_[0-9A-Za-z]{10}/);
        assert.doesNotMatch(text, /global|person_|personId|email/i);
        for (const value of text.match(/[0-9a-f]{8}-[0-9a-f-]{27}/g) ?? []) assert.ok(!internal.has(value), 'a person id reached a response');
      }
    });
  } finally {
    await db.close();
  }
});

test('what the hub saved is still there, and still guarded, after the database closes and opens again', { skip }, async () => {
  assert.ok(PGLITE, 'SOCIAL_REQUIRE_PGLITE=1 but SOCIAL_PGLITE is not set, so saving across a restart was not tested.');
  const { PGlite } = await import(PGLITE);
  const dataDir = mkdtempSync(join(tmpdir(), 'social-hub-restart-'));
  const open = async () => {
    const opened = new PGlite(dataDir);
    await opened.waitReady;
    return opened;
  };
  let db = null;

  async function answerAs(role, sql, params) {
    await db.exec(`set role ${role}`);
    try {
      const { answer } = (await db.query(sql, params)).rows[0];
      return typeof answer === 'string' ? JSON.parse(answer) : answer;
    } finally {
      await db.exec('reset role');
    }
  }
  const call = (fn, ...args) => answerAs('social_gateway', `select social.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')}) as answer`, args);
  async function ok(fn, ...args) {
    const answer = await call(fn, ...args);
    assert.equal(answer.ok, true, `${fn} should succeed, got ${JSON.stringify(answer)}`);
    return answer.data;
  }
  const refused = async (outcome, fn, ...args) => assert.deepEqual(await call(fn, ...args), { ok: false, outcome });
  const finish = async (who) => {
    const { summary, detail } = SAMPLE_RESULTS.rainbow;
    const answer = await answerAs(
      'social_game_server',
      `select social.record_completion($1, 'rainbow', $2, $3, $4::text::jsonb, $5::text::jsonb) as answer`,
      [who, PUZZLE, justNow(), JSON.stringify(summary), JSON.stringify(detail)],
    );
    assert.deepEqual(answer, { ok: true, data: {} });
  };

  const ada = 'user_restartada0000';
  const ben = 'user_restartben0000';
  const dee = 'user_restartdee0000';
  const cleo = 'user_restartcleo000';
  const stranger = 'user_restartnobody0';

  try {
    db = await open();
    await db.exec('create role anon nologin; create role authenticated nologin; create role service_role nologin;');
    await db.exec(DRAFT);
  await db.exec(PATCH);

    await ok('set_profile', ada, 'Ada', 'owl', '#CCE1F1');
    await ok('set_profile', ben, 'Ben', 'otter', '#F8E4A0');
    for (const [who, name] of [[dee, 'Dee'], [cleo, 'Cleo'], [stranger, 'Stranger']]) await ok('set_display_name', who, name);

    const bensCode = (await ok('ensure_person', ben, 'rainbow')).friendCode;
    const { requestRef } = await ok('find_friend_by_code', ada, bensCode);
    await ok('send_friend_request', ada, requestRef, NOTICE);
    const [asked] = (await ok('list_friend_requests', ben)).incoming;
    const { friendRef } = await ok('accept_friend_request', ben, asked.requestRef, NOTICE);

    const usedInvite = (await ok('create_friend_invite', ada, NOTICE)).code;
    await ok('accept_friend_invite', dee, usedInvite, NOTICE);

    const { groupId, inviteCode } = await ok('create_group', ada, 'Club', 'Al', NOTICE);
    await ok('join_group', ben, inviteCode, 'Bee', NOTICE);
    await ok('join_group', dee, inviteCode, 'Dee', NOTICE);
    const removed = (await ok('list_members', ada, groupId)).find((m) => m.name === 'Dee');
    await ok('remove_member', ada, groupId, removed.memberRef);

    await finish(ada);

    /** Everything that must come back the same. No function shows a notice version, so those are read from the tables. */
    const saved = async () => ({
      ada: await ok('ensure_person', ada, 'rainbow'),
      ben: await ok('ensure_person', ben, 'rainbow'),
      adasFriends: await ok('list_friends', ada),
      bensFriends: await ok('list_friends', ben),
      adasGroups: await ok('list_my_groups', ada),
      bensGroups: await ok('list_my_groups', ben),
      members: await ok('list_members', ada, groupId),
      friendNotices: (await db.query(`select notice_a, notice_b from social.friendships where id = $1`, [friendRef])).rows,
      memberNotices: (await db.query(`select name, notice_version from social.memberships where group_id = $1 order by name`, [groupId])).rows,
    });
    const before = await saved();

    await db.close();
    db = null;
    db = await open();

    const after = await saved();
    assert.deepEqual(after, before);

    // The same answers would prove nothing if they were empty, so here is what they hold.
    assert.deepEqual(after.ada, { displayName: 'Ada', animalId: 'owl', backgroundColor: '#CCE1F1', friendCode: after.ada.friendCode, friendCount: 2, groupCount: 1 });
    assert.match(after.ada.friendCode, FRIEND_CODE);
    assert.deepEqual([after.ben.displayName, after.ben.animalId, after.ben.backgroundColor, after.ben.friendCode], ['Ben', 'otter', '#F8E4A0', bensCode]);
    assert.ok(after.adasFriends.some((f) => f.friendRef === friendRef && f.name === 'Ben'));
    assert.deepEqual(after.bensFriends.map((f) => [f.friendRef, f.name]), [[friendRef, 'Ada']]);
    // By name: two people joining in the same millisecond would swap places.
    assert.deepEqual(after.members.map((m) => [m.name, m.isOwner]).sort(), [['Al', true], ['Bee', false]]);
    assert.deepEqual(after.adasGroups.map((g) => [g.groupId, g.isOwner, g.inviteCode]), [[groupId, true, inviteCode]]);
    assert.deepEqual(after.bensGroups.map((g) => [g.groupId, g.isOwner, g.inviteCode]), [[groupId, false, null]]);
    assert.deepEqual(after.friendNotices, [{ notice_a: NOTICE, notice_b: NOTICE }]);
    assert.deepEqual(after.memberNotices, [
      { name: 'Al', notice_version: NOTICE },
      { name: 'Bee', notice_version: NOTICE },
    ]);

    // A stranger still sees nothing.
    assert.deepEqual(await ok('list_friends', stranger), []);
    assert.deepEqual(await ok('list_my_groups', stranger), []);
    assert.deepEqual(await ok('list_results', stranger, 'rainbow', PUZZLE, null), []);
    await refused('not_a_member', 'list_members', stranger, groupId);
    await refused('not_a_member', 'list_results', stranger, 'rainbow', PUZZLE, groupId);

    await refused('invite_used', 'accept_friend_invite', stranger, usedInvite, NOTICE);
    await refused('removed', 'join_group', dee, inviteCode, 'Dee', NOTICE);

    // Detail is left out, in both audiences, until the viewer finishes too.
    const adasRow = async (audience) => (await ok('list_results', ben, 'rainbow', PUZZLE, audience)).find((row) => !row.isMe);
    for (const audience of [null, groupId]) {
      const locked = await adasRow(audience);
      assert.ok(!('detail' in locked), 'the key should be absent');
      assert.equal(locked.detailLocked, true);
      assert.deepEqual(locked.summary, SAMPLE_RESULTS.rainbow.summary);
    }
    await finish(ben);
    for (const audience of [null, groupId]) {
      const shown = await adasRow(audience);
      assert.equal(shown.detail, SAMPLE_RESULTS.rainbow.detail);
      assert.equal(shown.detailLocked, false);
    }

    await ok('join_group', cleo, inviteCode, 'Cee', NOTICE);
    assert.deepEqual((await ok('list_members', ada, groupId)).map((m) => m.name).sort(), ['Al', 'Bee', 'Cee']);
  } finally {
    await db?.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('uninstall leaves nothing named social and everything else as it was, refuses to take anything built on the hub, and a second install works', { skip }, async () => {
  assert.ok(PGLITE, 'SOCIAL_REQUIRE_PGLITE=1 but SOCIAL_PGLITE is not set, so uninstall was not tested.');
  const { PGlite } = await import(PGLITE);
  const db = new PGlite();
  await db.waitReady;

  const count = async (sql) => (await db.query(`select count(*)::int as n ${sql}`)).rows[0].n;
  const namedSocial = async () => {
    let total = 0;
    for (const place of ['pg_namespace where nspname', 'pg_roles where rolname', 'pg_class where relname', 'pg_proc where proname', 'pg_type where typname']) {
      total += await count(`from ${place} like '%social%'`);
    }
    return total;
  };
  const hubIsInstalled = async () => {
    assert.equal(await count(`from pg_namespace where nspname = 'social'`), 1);
    assert.equal(await count(`from pg_roles where rolname in ('social_gateway', 'social_game_server')`), 2);
    assert.equal(await count(`from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'social' and c.relname = 'persons'`), 1);
  };
  const everythingElseSurvived = async () => {
    assert.equal(await count(`from game_fixture.scores`), 1);
    assert.equal(await count(`from pg_roles where rolname in ('anon', 'authenticated', 'service_role', 'game_fixture_role', 'postgres')`), 5);
  };
  /** One call on each role, so a reinstall that only looks right can't pass. */
  async function hubAnswers() {
    const who = 'user_secondinstall0';
    const asRole = async (role, sql) => {
      await db.exec(`set role ${role}`);
      try {
        const { answer } = (await db.query(sql)).rows[0];
        return typeof answer === 'string' ? JSON.parse(answer) : answer;
      } finally {
        await db.exec('reset role');
      }
    };
    assert.equal((await asRole('social_gateway', `select social.set_display_name('${who}', 'Sam') as answer`)).ok, true);
    assert.deepEqual(await asRole('social_game_server', `select social.audience_global_ids('${who}') as answer`), { ok: true, data: [who] });
  }

  try {
    await db.exec('create role anon nologin; create role authenticated nologin; create role service_role nologin;');
    await db.exec('create role game_fixture_role nologin; create schema game_fixture; create table game_fixture.scores (id int primary key); insert into game_fixture.scores values (1);');
    const memberships = await count(`from pg_auth_members`);
    assert.equal(await namedSocial(), 0);

    await db.exec(DRAFT);
  await db.exec(PATCH);
    await hubIsInstalled();

    // Cascade would take this view with it, so the whole uninstall has to stop instead.
    await db.exec('create view game_fixture.peek as select global_user_id from social.persons');
    await assert.rejects(db.exec(UNINSTALL), /social hub not removed[\s\S]*peek/);
    await hubIsInstalled();
    assert.equal(await count(`from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'game_fixture' and c.relname = 'peek'`), 1);
    await db.exec('drop view game_fixture.peek');

    await db.exec(UNINSTALL);
    assert.equal(await namedSocial(), 0, 'nothing named social should remain');
    assert.equal(await count(`from pg_auth_members`), memberships, 'the hub roles should take their memberships with them');
    await everythingElseSurvived();

    await db.exec(UNINSTALL);
    assert.equal(await namedSocial(), 0, 'a second run should change nothing');
    await everythingElseSurvived();

    await db.exec(DRAFT);
  await db.exec(PATCH);
    await hubIsInstalled();
    await hubAnswers();

    // The beta plan's quick rollback drops only the schema, so the roles are still there.
    await db.exec('drop schema social cascade');
    await db.exec(DRAFT);
  await db.exec(PATCH);
    await hubIsInstalled();
    await hubAnswers();

    await db.exec(UNINSTALL);
    assert.equal(await namedSocial(), 0);
    await everythingElseSurvived();
  } finally {
    await db.close();
  }
});
