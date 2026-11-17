/**
 * A fetch that never lets an expired sign-in pass reach the player as an error.
 *
 * The library renews the pass on a timer driven by the device's clock. On a
 * device whose clock is wrong (an hour slow is enough) it believes the pass is
 * still fresh while the server answers "JWT expired", and every request of a
 * signed-in player fails, the puzzle included. So: when a database or storage
 * request is refused with a JWT complaint, renew the pass once (renewal does
 * not depend on the clock) and retry with the new one.
 *
 * Retried only when it is safe:
 *   - database (/rest/), storage (/storage/) and server-function (/functions/)
 *     requests; the sign-in endpoints pass straight through, so a renewal can
 *     never loop;
 *   - requests signed with a user's pass, never the publishable key;
 *   - when the renewed pass belongs to the SAME user as the refused one (never
 *     as someone else, e.g. after another tab switched who is signed in).
 * If renewal is impossible the original answer is returned unchanged.
 */

export interface Renewed {
  token: string;
  userId: string | null;
}

function subjectOf(authorization: string | null): string | null {
  const part = String(authorization ?? "").replace(/^Bearer\s+/i, "").split(".")[1];
  if (!part) return null;
  try {
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="));
    return (JSON.parse(json) as { sub?: string }).sub ?? null;
  } catch {
    return null;
  }
}

export function renewingFetch(renew: () => Promise<Renewed | null>, base: typeof fetch = (input, init) => fetch(input, init)): typeof fetch {
  let pending: Promise<Renewed | null> | null = null;
  // Several requests failing at once share one renewal.
  const renewOnce = () => {
    pending ??= Promise.resolve()
      .then(renew)
      .finally(() => {
        pending = null;
      });
    return pending;
  };

  return async (input, init) => {
    const res = await base(input, init);
    if (res.status !== 401 && res.status !== 400 && res.status !== 403) return res;
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!/\/(rest|storage|functions)\/v1\//.test(url)) return res;
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    const sub = subjectOf(headers.get("Authorization"));
    if (!sub) return res; // the publishable key, or no pass at all: nothing to renew
    // Storage often answers 400 with the real reason in the body, so the body decides.
    const body = await res.clone().text().catch(() => "");
    if (!/jwt|token (is )?expired|exp\W{0,3}claim|timestamp check failed/i.test(body)) return res;

    const renewed = await renewOnce().catch(() => null);
    if (!renewed?.token || renewed.userId !== sub) return res;
    headers.set("Authorization", `Bearer ${renewed.token}`);
    return base(input instanceof Request ? input.clone() : input, { ...init, headers });
  };
}
