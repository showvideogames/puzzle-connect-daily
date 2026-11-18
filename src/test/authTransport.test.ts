import { describe, expect, it, vi } from 'vitest';
import { temporaryAuthRefusals } from '../lib/authTransport';
const renewal = 'https://auth.example.test/auth/v1/token?grant_type=refresh_token';
describe('temporary renewal failures', () => {
  it.each([408, 425, 429, 500, 503])('preserves a temporary %s refusal as retryable', async status => {
    const base = vi.fn(async () => new Response('{"code":"temporarily_unavailable"}', { status, headers: { 'content-type': 'application/json' } }));
    expect((await temporaryAuthRefusals(base)(renewal)).status).toBe(503);
    expect(base).toHaveBeenCalledOnce();
  });
  it('treats a non-JSON proxy page as unavailable', async () => {
    expect((await temporaryAuthRefusals(async () => new Response('<html>proxy</html>', { status: 403 }))(renewal)).status).toBe(503);
  });
  it.each(['refresh_token_not_found', 'refresh_token_already_used', 'invalid_credentials'])('preserves real credential refusal %s', async code => {
    const response = new Response(JSON.stringify({ code }), { status: 400, headers: { 'content-type': 'application/json' } });
    expect(await temporaryAuthRefusals(async () => response)(renewal)).toBe(response);
  });
  it('does not alter password sign-in or ordinary API failures', async () => {
    const response = new Response('refused', { status: 401 });
    const f = temporaryAuthRefusals(async () => response);
    expect(await f('https://auth.example.test/auth/v1/token?grant_type=password')).toBe(response);
    expect(await f('https://auth.example.test/rest/v1/progress')).toBe(response);
  });
  it.each([new TypeError('offline'), new DOMException('timeout', 'AbortError')])('leaves transport exceptions for SDK retry handling', async error => {
    await expect(temporaryAuthRefusals(async () => { throw error; })(renewal)).rejects.toBe(error);
  });
});

it('aborts a stalled renewal, allowing the SDK to retry without discarding credentials', async () => {
  const base: typeof fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError')));
  });
  await expect(temporaryAuthRefusals(base, 5)(renewal)).rejects.toMatchObject({ name: 'AbortError' });
});

it.each([200, 400])('does not mistake a non-JSON body labelled JSON (%s) for a credential refusal', async status => {
  const f = temporaryAuthRefusals(async () => new Response('<html>portal</html>', { status, headers: { 'content-type': 'application/json' } }));
  expect((await f(renewal)).status).toBe(503);
});
