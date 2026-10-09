/**
 * submit-feedback, without the platform wiring (index.ts supplies that), so
 * every rule below runs under the unit tests.
 *
 * WHO MAY CALL. The platform's JWT check stays on in front of this function
 * (verify_jwt = true in supabase/config.toml), but the function does not
 * depend on what that check lets through. It applies its own rules, in
 * order:
 *
 *   1. `apikey` must be one of the project's CURRENT publishable or secret
 *      keys (the `sb_publishable_…` / `sb_secret_…` keys). Legacy JWT keys
 *      (`anon`, `service_role`) are never accepted, whether or not the
 *      platform still has them enabled.
 *   2. `Authorization: Bearer …` is required, as the gateway required it.
 *      - The same current API key there means a signed-out caller.
 *      - Anything else must be a user session that Supabase Auth accepts
 *        right now (signature, expiry, revocation). It is never trusted on
 *        its own claims. A token Auth rejects is a 401, not a silent
 *        downgrade to anonymous.
 *
 * WHAT IT DOES. Unchanged: validate, verify the Turnstile captcha, insert
 * one feedback row with the server key, with the caller's user id when
 * signed in and null when not.
 */

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_TYPES = new Set(["bug", "suggestion", "puzzle_idea", "business"]);
const MAX_MESSAGE_LENGTH = 4000;
export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface FeedbackRow {
  type: string;
  message: string;
  email: string | null;
  user_id: string | null;
}

export interface FeedbackDeps {
  /** The project's current API keys (see readApiKeys). */
  keys: ApiKeys;
  turnstileSecret: string | undefined;
  /** Asks Supabase Auth whether this access token is a valid session now. */
  verifyUserToken: (token: string) => Promise<{ id: string } | null>;
  insertFeedback: (row: FeedbackRow) => Promise<{ error: unknown }>;
  fetch: typeof fetch;
}

export interface ApiKeys {
  publishable: string[];
  secret: string[];
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * The platform injects the keys as JSON objects of name -> key
 * (SUPABASE_PUBLISHABLE_KEYS, SUPABASE_SECRET_KEYS). The local CLI stack
 * has a single key of each kind instead (SUPABASE_PUBLISHABLE_KEY,
 * SUPABASE_SECRET_KEY). Only values with the new key prefixes are kept, so
 * a legacy JWT can never end up on the accepted list.
 */
export function readApiKeys(env: (name: string) => string | undefined): ApiKeys {
  const collect = (mapName: string, singleName: string, prefix: string) => {
    const values: string[] = [];
    const raw = env(mapName);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          for (const value of Object.values(parsed)) if (typeof value === "string") values.push(value);
        }
      } catch {
        // unparseable: treated as no keys, which fails closed below
      }
    }
    const single = env(singleName);
    if (single) values.push(single);
    return [...new Set(values.filter((value) => value.startsWith(prefix)))];
  };
  return {
    publishable: collect("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_PUBLISHABLE_KEY", "sb_publishable_"),
    secret: collect("SUPABASE_SECRET_KEYS", "SUPABASE_SECRET_KEY", "sb_secret_"),
  };
}

/** The secret key the function itself uses: the one named `default`. */
export function serverSecretKey(env: (name: string) => string | undefined): string | null {
  try {
    const parsed = JSON.parse(env("SUPABASE_SECRET_KEYS") ?? "null");
    if (typeof parsed?.default === "string" && parsed.default.startsWith("sb_secret_")) return parsed.default;
  } catch {
    // fall through to the local single-key form
  }
  const single = env("SUPABASE_SECRET_KEY");
  return single?.startsWith("sb_secret_") ? single : null;
}

/** Constant-time for equal lengths; key lengths are not secret. */
function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function isCurrentApiKey(value: string, keys: ApiKeys): boolean {
  let match = false;
  for (const key of [...keys.publishable, ...keys.secret]) if (sameString(value, key)) match = true;
  return match;
}

/** `refused` is set when the caller may not proceed. */
export type Caller = { userId: string | null; refused?: { status: number; error: string } };

export async function authorizeCaller(req: Request, deps: Pick<FeedbackDeps, "keys" | "verifyUserToken">): Promise<Caller> {
  const apikey = req.headers.get("apikey") ?? "";
  if (!apikey || !isCurrentApiKey(apikey, deps.keys)) {
    return { userId: null, refused: { status: 401, error: "Invalid API key" } };
  }
  const match = (req.headers.get("authorization") ?? "").match(/^Bearer\s+(\S+)$/i);
  if (!match) {
    return { userId: null, refused: { status: 401, error: "Missing authorization" } };
  }
  const token = match[1];
  if (isCurrentApiKey(token, deps.keys)) {
    return { userId: null };
  }
  const user = await deps.verifyUserToken(token);
  if (!user) {
    return { userId: null, refused: { status: 401, error: "Invalid or expired session" } };
  }
  return { userId: user.id };
}

export async function handleFeedback(req: Request, deps: FeedbackDeps): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (deps.keys.publishable.length === 0 || deps.keys.secret.length === 0) {
      console.error("submit-feedback: the project's publishable/secret API keys are not available");
      return json(500, { error: "Server misconfiguration" });
    }
    const caller = await authorizeCaller(req, deps);
    if (caller.refused) return json(caller.refused.status, { error: caller.refused.error });

    if (req.method !== "POST") {
      return json(405, { error: "Method not allowed" });
    }

    const body = await req.json().catch(() => null);
    if (!body) return json(400, { error: "Invalid JSON body" });

    const { type, message, email, turnstileToken } = body as {
      type?: string;
      message?: string;
      email?: string | null;
      turnstileToken?: string;
    };

    // Basic input validation
    if (!type || !ALLOWED_TYPES.has(type)) {
      return json(400, { error: "Invalid feedback type" });
    }
    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return json(400, { error: "Message is required" });
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      return json(400, { error: "Message too long" });
    }
    if (!turnstileToken || typeof turnstileToken !== "string") {
      return json(400, { error: "Captcha token required" });
    }

    // Verify Turnstile token with Cloudflare
    if (!deps.turnstileSecret) {
      console.error("TURNSTILE_SECRET_KEY env var is not set");
      return json(500, { error: "Server misconfiguration" });
    }

    const form = new FormData();
    form.append("secret", deps.turnstileSecret);
    form.append("response", turnstileToken);
    const remoteIp =
      req.headers.get("cf-connecting-ip") ||
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "";
    if (remoteIp) form.append("remoteip", remoteIp);

    const verifyRes = await deps.fetch(TURNSTILE_VERIFY_URL, { method: "POST", body: form });
    const verifyBody = await verifyRes.json().catch(() => null);
    if (!verifyBody || verifyBody.success !== true) {
      return json(400, {
        error: "Captcha verification failed",
        details: verifyBody?.["error-codes"] ?? null,
      });
    }

    // Inserted with the server key, so this stays the only path even with
    // direct inserts revoked at the RLS level.
    const { error: insertError } = await deps.insertFeedback({
      type,
      message: message.trim(),
      email: typeof email === "string" && email.trim() ? email.trim() : null,
      user_id: caller.userId,
    });
    if (insertError) {
      console.error("feedback insert failed:", insertError);
      return json(500, { error: "Could not save feedback" });
    }

    return json(200, { ok: true });
  } catch (err) {
    console.error("submit-feedback error:", err);
    return json(500, { error: (err as Error).message || "Unknown error" });
  }
}
