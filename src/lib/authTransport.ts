/** Preserve refresh credentials through transport failures, never through a real credential refusal. */
export function temporaryAuthRefusals(base: typeof fetch, timeoutMs = 10_000): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (!url.pathname.endsWith('/auth/v1/token') || url.searchParams.get('grant_type') !== 'refresh_token') return base(input, init);
    const controller = new AbortController();
    const parent = init?.signal ?? (input instanceof Request ? input.signal : null);
    const abort = () => controller.abort();
    if (parent?.aborted) abort();
    else parent?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);
    try {
      const response = await base(input, { ...init, signal: controller.signal });
      // Captive portals can return HTML with 200 or even a JSON content type.
      // Check the body without consuming the response the SDK will receive.
      let json = false;
      try { await response.clone().json(); json = true; } catch { /* untrusted transport response */ }
      const temporary = [408, 425, 429].includes(response.status) || response.status >= 500;
      if (!temporary && json) return response;
      // Real JSON credential refusals pass through unchanged; they still end the session.
      return new Response(JSON.stringify({ code: 'temporarily_unavailable', msg: 'Sign-in renewal temporarily unavailable' }), {
        status: 503, headers: { 'content-type': 'application/json' },
      });
    } finally {
      clearTimeout(timer);
      parent?.removeEventListener('abort', abort);
    }
  };
}
