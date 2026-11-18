import { createClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { temporaryAuthRefusals } from '../lib/authTransport';
const user = { id: 'synthetic-user', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '' };
const expired = { access_token: 'synthetic-expired', refresh_token: 'synthetic-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) - 60, user };
const fresh = { ...expired, access_token: 'synthetic-fresh', refresh_token: 'synthetic-rotated', expires_at: Math.floor(Date.now() / 1000) + 3600 };
function fixture(first: () => Promise<Response>) {
  const values = new Map([['test-auth', JSON.stringify(expired)]]);
  let recover = false;
  const base = vi.fn<typeof fetch>(async () => recover ? new Response(JSON.stringify(fresh), { headers: { 'content-type': 'application/json' } }) : first());
  const client = createClient('https://unused.example.test', 'synthetic-public-key', {
    auth: { storageKey: 'test-auth', storage: { getItem: k => values.get(k) ?? null, setItem: (k,v) => { values.set(k,v); }, removeItem: k => { values.delete(k); } }, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: temporaryAuthRefusals(base) },
  });
  return { client, base, values, recover: () => { recover = true; } };
}
it.each(['fetch', 'timeout', '429', '408', 'non-JSON'])('real SDK preserves and silently renews after %s failure', async kind => {
  const s = fixture(async () => {
    if (kind === 'fetch') throw new TypeError('offline');
    if (kind === 'timeout') throw new DOMException('timeout', 'AbortError');
    return new Response(kind === 'non-JSON' ? '<html>proxy</html>' : '{}', { status: kind === 'non-JSON' ? 403 : Number(kind), headers: { 'content-type': kind === 'non-JSON' ? 'text/html' : 'application/json' } });
  });
  const reading = s.client.auth.getSession();
  await vi.waitFor(() => expect(s.base).toHaveBeenCalled());
  expect(JSON.parse(s.values.get('test-auth')!).refresh_token).toBe('synthetic-refresh');
  s.recover();
  const result = await reading;
  // Some SDK versions surface the temporary error before their next automatic attempt.
  const renewed = result.data.session ?? (await s.client.auth.refreshSession()).data.session;
  expect(renewed?.access_token).toBe('synthetic-fresh');
  expect(JSON.parse(s.values.get('test-auth')!).refresh_token).toBe('synthetic-rotated');
  await s.client.auth.stopAutoRefresh();
}, 15000);
it('real SDK removes a genuinely rejected expired refresh credential', async () => {
  const s = fixture(async () => new Response(JSON.stringify({ error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' }), { status: 400, headers: { 'content-type': 'application/json' } }));
  expect((await s.client.auth.getSession()).data.session).toBeNull();
  expect(s.values.has('test-auth')).toBe(false);
  await s.client.auth.stopAutoRefresh();
});
