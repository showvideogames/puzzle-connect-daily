import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMockWorld } from '@/social/conformance';

const base = readFileSync(path.resolve('shared-service/fixtures/hub-eb238dd.sql'), 'utf8');
const patch = readFileSync(path.resolve('shared-service/patches/0002_png_group_photos.sql'), 'utf8');
const png = await sharp({ create: { width: 256, height: 256, channels: 4, background: { r: 220, g: 40, b: 60, alpha: 0.4 } } }).png().toBuffer();
const jpg = await sharp(png).flatten({ background: '#ffffff' }).jpeg().toBuffer();
const url = (bytes: Uint8Array, type = 'png') => `data:image/${type};base64,${Buffer.from(bytes).toString('base64')}`;
const db = new PGlite();
let groupId: string, inviteCode: string;
async function call<T = unknown>(fn: string, args: unknown[]) {
  const params = args.map((_, i) => `$${i+1}`).join(',');
  await db.exec('set role social_gateway');
  try { return (await db.query<{ answer: { ok: boolean; data: T; outcome?: string } }>(`select social.${fn}(${params}) as answer`, args)).rows[0].answer; }
  finally { await db.exec('reset role'); }
}
beforeAll(async () => {
  await db.exec('create role anon nologin; create role authenticated nologin; create role service_role nologin;');
  await db.exec(base);
  for (const who of ['user_owner000001', 'user_member00001']) {
    await call('ensure_person', [who, 'rainbow']);
    await call('set_profile', [who, who, 'fox', '#DED1F2']);
  }
  ({ groupId, inviteCode } = (await call<{ groupId: string; inviteCode: string }>('create_group', ['user_owner000001', 'Picture club', 'Owner', 1])).data);
  await call('join_group', ['user_member00001', inviteCode, 'Member', 1]);
  expect((await call('set_group_appearance', ['user_owner000001', groupId, 'campfire', url(jpg, 'jpeg'), '#DED1F2'])).ok).toBe(true);
  await db.exec(patch);
}, 20000);
afterAll(async () => { await db.close(); });

describe('backward-compatible group PNG service patch', () => {
  it('preserves existing JPEG bytes, version, owner and members during upgrade', async () => {
    const row = (await call<Record<string, unknown>[]>('list_my_groups', ['user_owner000001'])).data[0];
    expect(row).toMatchObject({ photo: url(jpg, 'jpeg'), photoVersion: 1, memberCount: 2, isOwner: true });
  });
  it('round trips transparent bytes through owner save, member read and guest preview', async () => {
    expect(await call('set_group_appearance', ['user_owner000001', groupId, 'campfire', url(png), '#DED1F2'])).toMatchObject({ ok: true, data: { photoVersion: 2 } });
    expect((await call<Record<string, unknown>[]>('list_my_groups', ['user_member00001'])).data[0]).toMatchObject({ photo: url(png), photoVersion: 2, memberCount: 2 });
    expect((await call<{ photo: string }>('preview_invite', [null, inviteCode])).data.photo).toBe(url(png));
    expect((await sharp(png).ensureAlpha().raw().toBuffer())[3]).toBe(102);
    expect(await call('set_group_appearance', ['user_owner000001', groupId, 'book', url(png), '#CCE6CA'])).toMatchObject({ ok: true, data: { photoVersion: 2 } });
  });
  it('still refuses a member edit and keeps the stored picture', async () => {
    expect(await call('set_group_appearance', ['user_member00001', groupId, 'book', null, '#CCE6CA'])).toMatchObject({ ok: false, outcome: 'not_the_creator' });
    expect((await call<Record<string, unknown>[]>('list_my_groups', ['user_owner000001'])).data[0].photo).toBe(url(png));
  });
  it('rejects malformed containers, MIME mismatches, dimensions and oversized data in SQL and the memory hub', async () => {
    const world = createMockWorld();
    const owner = world.signIn('rainbow', 'user_owner000001');
    const made = await owner.call('createGroup', { name: 'Picture club', myName: 'Owner', noticeVersion: 1 });
    if (!made.ok) throw new Error('fixture group failed');
    const appearance = { groupId: made.data.groupId, emblemId: 'campfire', accentColor: '#DED1F2' };
    expect(await owner.call('setGroupAppearance', { ...appearance, photo: url(png) })).toMatchObject({ ok: true });
    const wrongSize = await sharp(png).resize(128,128).png().toBuffer();
    const animated = Buffer.from(png); animated.write('acTL',33+4); // replaces the first post-IHDR chunk type
    for (const [photo, outcome] of [
      [url(png.subarray(0,33)), 'not_a_picture'], [url(png.subarray(0,-1)), 'not_a_picture'],
      [url(Buffer.concat([png, Buffer.from([0])])), 'not_a_picture'], [url(animated), 'not_a_picture'],
      [url(jpg), 'not_a_picture'], [url(png,'jpeg'), 'not_a_picture'], [url(wrongSize), 'wrong_size'],
      [`data:image/png;base64,${'A'.repeat(81924)}`, 'too_big'],
    ]) {
      const sql = (await db.query<{ refusal: string }>('select refusal from social.check_photo($1)', [photo])).rows[0];
      expect(sql.refusal).toBe(outcome);
      expect(await owner.call('setGroupAppearance', { ...appearance, photo })).toMatchObject({ ok: false, outcome });
    }
  });
  it('accepts the exact PNG produced by the browser crop check', async () => {
    const browserPng = readFileSync(path.resolve('evidence/browser-transparent-photo.png'));
    expect((await db.query<{ refusal: string | null }>('select refusal from social.check_photo($1)', [url(browserPng)])).rows[0].refusal).toBeNull();
    const { data, info } = await sharp(browserPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height, data[3]]).toEqual([256, 256, 0]);
    expect(data[(128 * 256 + 128) * 4 + 3]).toBeGreaterThanOrEqual(127);
    expect(data[(128 * 256 + 128) * 4 + 3]).toBeLessThanOrEqual(128);
  });
  it('keeps helper functions private and safely reapplies the patch without resetting bytes', async () => {
    await db.exec(patch);
    for (const role of ['anon','authenticated','service_role']) {
      expect((await db.query<{ allowed: boolean }>("select has_function_privilege($1,'social.png_size(bytea)','EXECUTE') as allowed", [role])).rows[0].allowed).toBe(false);
    }
    expect((await call<Record<string, unknown>[]>('list_my_groups', ['user_owner000001'])).data[0]).toMatchObject({ photo: url(png), photoVersion: 2 });
  });
});
