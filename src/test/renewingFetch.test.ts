import { describe, expect, it, vi } from 'vitest';
import { renewingFetch } from '../lib/renewingFetch';

const REST = 'https://project.supabase.co/rest/v1/rpc/xw_my_account';
// What the database answers for a pass whose time is up (PostgREST, 401).
const expired = () => new Response(JSON.stringify({ code: 'PGRST303', message: 'JWT expired' }), { status: 401 });
const ok = (body = '[]') => new Response(body, { status: 200 });
const authOf = (init?: RequestInit) => new Headers(init?.headers).get('Authorization');

describe('renewingFetch', () => {
  it('passes a normal answer straight through, without renewing', async () => {
    const base = vi.fn(async () => ok());
    const renew = vi.fn(async () => 'new');
    const res = await renewingFetch(renew, base)(REST, { headers: { Authorization: 'Bearer old' } });
    expect(res.status).toBe(200);
    expect(renew).not.toHaveBeenCalled();
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('renews an expired pass and retries once with the new one', async () => {
    const base = vi.fn<typeof fetch>().mockResolvedValueOnce(expired()).mockResolvedValueOnce(ok('[{"id":1}]'));
    const renew = vi.fn(async () => 'fresh-token');
    const res = await renewingFetch(renew, base)(REST, { method: 'POST', body: '{}', headers: { Authorization: 'Bearer stale', apikey: 'k' } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('[{"id":1}]');
    expect(renew).toHaveBeenCalledTimes(1);
    expect(base).toHaveBeenCalledTimes(2);
    const retry = base.mock.calls[1][1];
    expect(authOf(retry)).toBe('Bearer fresh-token');
    expect(new Headers(retry?.headers).get('apikey')).toBe('k');
    expect(retry?.body).toBe('{}');
  });

  it('hands back the original answer when renewal is impossible (the dead session is dropped by the library)', async () => {
    const base = vi.fn<typeof fetch>().mockResolvedValueOnce(expired());
    const res = await renewingFetch(async () => null, base)(REST, {});
    expect(res.status).toBe(401);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('treats a renewal that throws like one that is impossible', async () => {
    const base = vi.fn<typeof fetch>().mockResolvedValueOnce(expired());
    const res = await renewingFetch(async () => {
      throw new Error('offline');
    }, base)(REST, {});
    expect(res.status).toBe(401);
  });

  it('never retries the sign-in endpoints themselves, so renewal cannot loop', async () => {
    const base = vi.fn(async () => expired());
    const renew = vi.fn(async () => 'new');
    await renewingFetch(renew, base)('https://project.supabase.co/auth/v1/token?grant_type=refresh_token', {});
    expect(renew).not.toHaveBeenCalled();
  });

  it('leaves a 401 that is not about the pass alone (a refused permission stays refused)', async () => {
    const base = vi.fn(async () => new Response('{"code":"42501","message":"permission denied for table xw_times"}', { status: 401 }));
    const renew = vi.fn(async () => 'new');
    const res = await renewingFetch(renew, base)(REST, {});
    expect(res.status).toBe(401);
    expect(renew).not.toHaveBeenCalled();
  });

  it('shares one renewal between requests that fail at the same time', async () => {
    const base = vi.fn<typeof fetch>(async (_i, init) => (authOf(init) === 'Bearer fresh' ? ok() : expired()));
    let release!: (t: string) => void;
    const renew = vi.fn(() => new Promise<string>((r) => (release = r)));
    const f = renewingFetch(renew, base);
    const both = Promise.all([f(REST, { headers: { Authorization: 'Bearer stale' } }), f(REST, { headers: { Authorization: 'Bearer stale' } })]);
    await vi.waitFor(() => expect(renew).toHaveBeenCalled());
    release('fresh');
    const [a, b] = await both;
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(renew).toHaveBeenCalledTimes(1);
  });
});

describe('renewal across account switches', () => {
  it('does not renew an old request after the signed-in identity changes', async () => {
    let identity = 'alice';
    let release!: (response: Response) => void;
    const base = vi.fn<typeof fetch>().mockImplementationOnce(() => new Promise<Response>(r => { release = r; })).mockResolvedValue(ok());
    const renew = vi.fn(async () => 'bob-token');
    const pending = renewingFetch(renew, base, () => identity)(REST, { method: 'POST', body: '{"p_seconds":20}' });
    identity = 'bob';
    release(expired());
    expect((await pending).status).toBe(401);
    expect(renew).not.toHaveBeenCalled();
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('does not retry an account mutation if identity changes during renewal', async () => {
    let identity = 'alice';
    let release!: (token: string) => void;
    const base = vi.fn<typeof fetch>().mockResolvedValueOnce(expired()).mockResolvedValue(ok());
    const renew = vi.fn(() => new Promise<string>(r => { release = r; }));
    const pending = renewingFetch(renew, base, () => identity)(REST, { method: 'POST', body: '{"p_seconds":20}' });
    await vi.waitFor(() => expect(renew).toHaveBeenCalled());
    identity = 'bob';
    release('bob-token');
    expect((await pending).status).toBe(401);
    expect(base).toHaveBeenCalledTimes(1);
  });
});

it('does not share an in-flight renewal with a different sign-in', async () => {
  let identity = 'alice';
  const releases: ((token: string) => void)[] = [];
  const renew = vi.fn(() => new Promise<string>(r => { releases.push(r); }));
  const base = vi.fn<typeof fetch>(async (_input, init) => authOf(init)?.includes('fresh') ? ok() : expired());
  const request = renewingFetch(renew, base, () => identity);
  const alice = request(REST, { headers: { Authorization: 'Bearer alice-old' } });
  await vi.waitFor(() => expect(renew).toHaveBeenCalledTimes(1));
  identity = 'bob';
  const bob = request(REST, { headers: { Authorization: 'Bearer bob-old' } });
  await vi.waitFor(() => expect(renew).toHaveBeenCalledTimes(2));
  releases[0]('alice-fresh');
  expect((await alice).status).toBe(401);
  releases[1]('bob-fresh');
  expect((await bob).status).toBe(200);
  expect(base.mock.calls.map(([, init]) => authOf(init))).toEqual(['Bearer alice-old', 'Bearer bob-old', 'Bearer bob-fresh']);
});

it('does not renew an import pinned to A when storage already belongs to B before fetch begins', async () => {
  const tokenA = `e30.${btoa(JSON.stringify({ sub: 'uid-a' }))}.signature`;
  const base = vi.fn<typeof fetch>().mockResolvedValue(expired());
  const renew = vi.fn(async () => 'token-b');
  const res = await renewingFetch(renew, base, () => 'uid-b')(REST, { headers: { Authorization: `Bearer ${tokenA}` } });
  expect(res.status).toBe(401);
  expect(renew).not.toHaveBeenCalled();
  expect(base).toHaveBeenCalledTimes(1);
});

it('still renews a pinned import when its token and stored session identify the same account', async () => {
  const tokenA = `e30.${btoa(JSON.stringify({ sub: 'uid-a' }))}.signature`;
  const base = vi.fn<typeof fetch>().mockResolvedValueOnce(expired()).mockResolvedValue(ok());
  const renew = vi.fn(async () => 'fresh-a');
  const res = await renewingFetch(renew, base, () => 'uid-a')(REST, { headers: { Authorization: `Bearer ${tokenA}` } });
  expect(res.status).toBe(200);
  expect(renew).toHaveBeenCalledTimes(1);
  expect(authOf(base.mock.calls[1][1])).toBe('Bearer fresh-a');
});

it('does not replay across sign-out and sign-in as the same person', async () => {
  let epoch = 0;
  const base = vi.fn<typeof fetch>().mockResolvedValue(expired());
  const renew = vi.fn(async () => { epoch++; return 'fresh'; });
  const response = await renewingFetch(renew, base, () => 'alice', () => epoch)(REST);
  expect(response.status).toBe(401);
  expect(base).toHaveBeenCalledOnce();
});

it('preserves a consumed Request body for the one retry', async () => {
  const bodies: string[] = [];
  const base: typeof fetch = async input => {
    bodies.push(await (input as Request).text());
    return bodies.length === 1 ? expired() : ok();
  };
  const request = new Request(REST, { method: 'POST', body: '{"value":42}' });
  expect((await renewingFetch(async () => 'fresh', base)(request)).status).toBe(200);
  expect(bodies).toEqual(['{"value":42}', '{"value":42}']);
});
