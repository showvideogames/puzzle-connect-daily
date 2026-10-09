import { describe, expect, it, vi } from "vitest";
import {
  handleFeedback,
  readApiKeys,
  serverSecretKey,
  type FeedbackDeps,
  type FeedbackRow,
} from "../../supabase/functions/submit-feedback/core";

// Made-up keys in the new formats. Nothing here is a real credential.
const PUBLISHABLE = "sb_publishable_TEST_publishable_key_0001";
const SECRET = "sb_secret_TEST_secret_key_0001";
const USER_TOKEN = "user-session-token-accepted-by-auth";
const USER_ID = "7f1c6a52-0000-4000-8000-000000000001";

/** A JWT-shaped legacy key (role anon), built at runtime so no key-like literal sits in the repo. */
const b64 = (value: object) => btoa(JSON.stringify(value)).replace(/=+$/, "");
const LEGACY_ANON_JWT = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ role: "anon", iss: "supabase" })}.signature`;

function setup(overrides: Partial<FeedbackDeps> = {}) {
  const inserted: FeedbackRow[] = [];
  const turnstileCalls: FormData[] = [];
  const deps: FeedbackDeps = {
    keys: { publishable: [PUBLISHABLE], secret: [SECRET] },
    turnstileSecret: "turnstile-test-secret",
    verifyUserToken: vi.fn(async (token: string) => (token === USER_TOKEN ? { id: USER_ID } : null)),
    insertFeedback: vi.fn(async (row: FeedbackRow) => {
      inserted.push(row);
      return { error: null };
    }),
    fetch: vi.fn(async (_url: unknown, init?: RequestInit) => {
      turnstileCalls.push(init?.body as FormData);
      return new Response(JSON.stringify({ success: true }));
    }) as unknown as typeof fetch,
    ...overrides,
  };
  return { deps, inserted, turnstileCalls };
}

const VALID_BODY = { type: "bug", message: "  The tiles overlap  ", email: " a@example.com ", turnstileToken: "captcha-ok" };

function request(headers: Record<string, string>, body: unknown = VALID_BODY, method = "POST") {
  return new Request("http://localhost/functions/v1/submit-feedback", {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}

/** What supabase-js sends: signed out, the publishable key in both headers. */
const signedOut = { apikey: PUBLISHABLE, authorization: `Bearer ${PUBLISHABLE}` };
/** Signed in: the publishable key plus the user's session token. */
const signedIn = { apikey: PUBLISHABLE, authorization: `Bearer ${USER_TOKEN}` };

async function call(req: Request, deps: FeedbackDeps) {
  const res = await handleFeedback(req, deps);
  return { status: res.status, body: res.status === 200 || res.headers.get("content-type") ? await res.json().catch(() => null) : null };
}

describe("submit-feedback: who may call", () => {
  it("signed out: saves the feedback with no user id, without asking Auth about a user", async () => {
    const { deps, inserted } = setup();
    expect(await call(request(signedOut), deps)).toEqual({ status: 200, body: { ok: true } });
    expect(inserted).toEqual([{ type: "bug", message: "The tiles overlap", email: "a@example.com", user_id: null }]);
    expect(deps.verifyUserToken).not.toHaveBeenCalled();
  });

  it("signed in: saves the feedback with the user id that Supabase Auth vouched for", async () => {
    const { deps, inserted } = setup();
    expect((await call(request(signedIn), deps)).status).toBe(200);
    expect(deps.verifyUserToken).toHaveBeenCalledWith(USER_TOKEN);
    expect(inserted[0].user_id).toBe(USER_ID);
  });

  it("a session Auth rejects (forged, expired, signed by a revoked key) is refused, not downgraded to anonymous", async () => {
    const { deps, inserted } = setup();
    const res = await call(request({ apikey: PUBLISHABLE, authorization: "Bearer not-a-valid-session" }), deps);
    expect(res).toEqual({ status: 401, body: { error: "Invalid or expired session" } });
    expect(inserted).toEqual([]);
  });

  it("the legacy anon key is refused as the API key, even while the platform still accepts it", async () => {
    const { deps, inserted } = setup();
    for (const headers of [
      { apikey: LEGACY_ANON_JWT, authorization: `Bearer ${LEGACY_ANON_JWT}` },
      { apikey: LEGACY_ANON_JWT, authorization: `Bearer ${USER_TOKEN}` },
    ]) {
      expect(await call(request(headers), deps)).toEqual({ status: 401, body: { error: "Invalid API key" } });
    }
    expect(inserted).toEqual([]);
    expect(deps.verifyUserToken).not.toHaveBeenCalled();
  });

  it("the legacy anon key as the bearer token is not a session: Auth decides, and its 'no' is a 401", async () => {
    const { deps, inserted } = setup();
    const res = await call(request({ apikey: PUBLISHABLE, authorization: `Bearer ${LEGACY_ANON_JWT}` }), deps);
    expect(res.status).toBe(401);
    expect(deps.verifyUserToken).toHaveBeenCalledWith(LEGACY_ANON_JWT);
    expect(inserted).toEqual([]);
  });

  it("a missing or unknown API key is refused", async () => {
    const { deps } = setup();
    expect((await call(request({ authorization: `Bearer ${PUBLISHABLE}` }), deps)).status).toBe(401);
    expect((await call(request({ apikey: "sb_publishable_someone_elses", authorization: "Bearer x" }), deps)).status).toBe(401);
    expect((await call(request({ apikey: `${PUBLISHABLE}x`, authorization: `Bearer ${PUBLISHABLE}` }), deps)).status).toBe(401);
  });

  it("a missing or malformed Authorization header is refused (the gateway required one too)", async () => {
    const { deps } = setup();
    expect(await call(request({ apikey: PUBLISHABLE }), deps)).toEqual({ status: 401, body: { error: "Missing authorization" } });
    expect((await call(request({ apikey: PUBLISHABLE, authorization: PUBLISHABLE }), deps)).status).toBe(401);
  });

  it("the server's own secret key is accepted, as a signed-out caller", async () => {
    const { deps, inserted } = setup();
    expect((await call(request({ apikey: SECRET, authorization: `Bearer ${SECRET}` }), deps)).status).toBe(200);
    expect(inserted[0].user_id).toBeNull();
  });

  it("checks the caller before reading the body, validating input or calling Turnstile", async () => {
    const { deps, turnstileCalls } = setup();
    expect((await call(request({}, { nonsense: true }), deps)).status).toBe(401);
    expect(turnstileCalls).toEqual([]);
  });

  it("fails closed with no current keys available", async () => {
    const { deps, inserted } = setup({ keys: { publishable: [], secret: [] } });
    expect(await call(request(signedOut), deps)).toEqual({ status: 500, body: { error: "Server misconfiguration" } });
    expect(inserted).toEqual([]);
  });

  it("answers CORS preflight without credentials", async () => {
    const { deps } = setup();
    const res = await handleFeedback(new Request("http://localhost/x", { method: "OPTIONS" }), deps);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-headers")).toContain("apikey");
  });
});

describe("submit-feedback: unchanged behaviour after the caller check", () => {
  it("validates input exactly as before", async () => {
    const { deps, inserted } = setup();
    const cases: [unknown, string][] = [
      [{ ...VALID_BODY, type: "spam" }, "Invalid feedback type"],
      [{ ...VALID_BODY, message: "   " }, "Message is required"],
      [{ ...VALID_BODY, message: "x".repeat(4001) }, "Message too long"],
      [{ ...VALID_BODY, turnstileToken: undefined }, "Captcha token required"],
    ];
    for (const [body, error] of cases) {
      expect(await call(request(signedOut, body), deps)).toEqual({ status: 400, body: { error } });
    }
    expect(inserted).toEqual([]);
  });

  it("refuses non-POST methods from an authorised caller", async () => {
    const { deps } = setup();
    expect((await call(request(signedOut, undefined, "GET"), deps)).status).toBe(405);
  });

  it("refuses when Turnstile says no, and saves nothing", async () => {
    const { deps, inserted } = setup({
      fetch: (async () => new Response(JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }))) as unknown as typeof fetch,
    });
    expect(await call(request(signedOut), deps)).toEqual({
      status: 400,
      body: { error: "Captcha verification failed", details: ["invalid-input-response"] },
    });
    expect(inserted).toEqual([]);
  });

  it("sends Cloudflare the secret, the token and the visitor's IP", async () => {
    const { deps, turnstileCalls } = setup();
    await call(request({ ...signedOut, "cf-connecting-ip": "203.0.113.9" }), deps);
    expect(turnstileCalls[0].get("secret")).toBe("turnstile-test-secret");
    expect(turnstileCalls[0].get("response")).toBe("captcha-ok");
    expect(turnstileCalls[0].get("remoteip")).toBe("203.0.113.9");
  });

  it("reports a failed insert as 500", async () => {
    const { deps } = setup({ insertFeedback: async () => ({ error: { message: "boom" } }) });
    expect(await call(request(signedOut), deps)).toEqual({ status: 500, body: { error: "Could not save feedback" } });
  });
});

describe("submit-feedback: reading the project's keys", () => {
  const env = (vars: Record<string, string>) => (name: string) => vars[name];

  it("reads the platform's JSON key maps and keeps only new-format keys", () => {
    const keys = readApiKeys(
      env({
        SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: PUBLISHABLE, legacy: LEGACY_ANON_JWT }),
        SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRET, other: "sb_secret_TEST_other" }),
        SUPABASE_ANON_KEY: LEGACY_ANON_JWT,
      }),
    );
    expect(keys).toEqual({ publishable: [PUBLISHABLE], secret: [SECRET, "sb_secret_TEST_other"] });
  });

  it("reads the local CLI's single-key form", () => {
    expect(readApiKeys(env({ SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE, SUPABASE_SECRET_KEY: SECRET }))).toEqual({
      publishable: [PUBLISHABLE],
      secret: [SECRET],
    });
  });

  it("never falls back to the legacy keys", () => {
    expect(readApiKeys(env({ SUPABASE_ANON_KEY: LEGACY_ANON_JWT, SUPABASE_SERVICE_ROLE_KEY: LEGACY_ANON_JWT }))).toEqual({
      publishable: [],
      secret: [],
    });
    expect(serverSecretKey(env({ SUPABASE_SERVICE_ROLE_KEY: LEGACY_ANON_JWT }))).toBeNull();
  });

  it("uses the secret key named `default` for its own calls", () => {
    expect(serverSecretKey(env({ SUPABASE_SECRET_KEYS: JSON.stringify({ other: "sb_secret_TEST_other", default: SECRET }) }))).toBe(SECRET);
    expect(serverSecretKey(env({ SUPABASE_SECRET_KEY: SECRET }))).toBe(SECRET);
    expect(serverSecretKey(env({ SUPABASE_SECRET_KEYS: "not json" }))).toBeNull();
  });
});
