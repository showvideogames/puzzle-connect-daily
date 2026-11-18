/** Read only a request token's routing identity; the server still validates the JWT. */
function bearerSubject(headers: Headers): string | null {
  try {
    const token = headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
    const payload = token?.split('.')[1];
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json.sub === 'string' ? json.sub : null;
  } catch {
    return null;
  }
}

/**
 * A fetch for the signed-in client that never lets an expired sign-in pass
 * reach the player as an error.
 *
 * The library renews the pass on a timer driven by the device's clock. On a
 * device whose clock is wrong (an hour slow is enough), it believes the pass is
 * still fresh while the server says "JWT expired", and every request fails.
 * So: when a database or storage request comes back 401 with a JWT complaint,
 * renew the pass once (renewal does not depend on the clock) and retry with the
 * new one. If renewal is impossible, hand back the original answer; the library
 * has then dropped the dead session and the site shows "Sign in" again.
 *
 * Only /rest/ and /storage/ requests are retried: the sign-in endpoints
 * themselves pass straight through, so a renewal can never loop.
 */
export function renewingFetch(
  renew: () => Promise<string | null>,
  base: typeof fetch = (input, init) => fetch(input, init),
  identity: () => string | null = () => null,
  epoch: () => number = () => 0,
): typeof fetch {
  let pending: { epoch: number; identity: string | null; promise: Promise<string | null> } | null = null;
  // Only requests for the same sign-in may share a renewal.
  const renewOnce = (forIdentity: string | null) => {
    if (pending?.identity === forIdentity && pending.epoch === epoch()) return pending.promise;
    const entry = {
      epoch: epoch(),
      identity: forIdentity,
      promise: renew().finally(() => {
        if (pending === entry) pending = null;
      }),
    };
    pending = entry;
    return entry.promise;
  };

  return async (input, init) => {
    const forIdentity = identity();
    const started = epoch();
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const requestUid = bearerSubject(headers);
    const sameIdentity = () => epoch() === started && identity() === forIdentity && (requestUid === null || requestUid === forIdentity);
    // Fetch can consume a Request body; keep one replayable copy before sending.
    const replay = input instanceof Request ? input.clone() : input;
    const res = await base(input, init);
    if (res.status !== 401) return res;
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!/\/(rest|storage)\/v1\//.test(url)) return res;
    const body = await res.clone().text().catch(() => '');
    if (!/jwt/i.test(body)) return res;

    // Never replay an old account mutation with a different person's renewed token.
    if (!sameIdentity()) return res;
    const token = await renewOnce(forIdentity).catch(() => null);
    if (!token || !sameIdentity()) return res;
    headers.set('Authorization', `Bearer ${token}`);
    return base(replay, { ...init, headers });
  };
}
