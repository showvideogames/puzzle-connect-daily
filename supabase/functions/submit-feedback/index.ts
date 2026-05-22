import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_TYPES = new Set(["bug", "suggestion", "puzzle_idea", "business"]);
const MAX_MESSAGE_LENGTH = 4000;
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  try {
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
    const turnstileSecret = Deno.env.get("TURNSTILE_SECRET_KEY");
    if (!turnstileSecret) {
      console.error("TURNSTILE_SECRET_KEY env var is not set");
      return json(500, { error: "Server misconfiguration" });
    }

    const form = new FormData();
    form.append("secret", turnstileSecret);
    form.append("response", turnstileToken);
    const remoteIp =
      req.headers.get("cf-connecting-ip") ||
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "";
    if (remoteIp) form.append("remoteip", remoteIp);

    const verifyRes = await fetch(TURNSTILE_VERIFY_URL, { method: "POST", body: form });
    const verifyBody = await verifyRes.json().catch(() => null);
    if (!verifyBody || verifyBody.success !== true) {
      return json(400, {
        error: "Captcha verification failed",
        details: verifyBody?.["error-codes"] ?? null,
      });
    }

    // Derive user_id from the JWT in the Authorization header, if present.
    // Anonymous submissions are allowed too — user_id will be null.
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    let userId: string | null = null;
    const authHeader = req.headers.get("authorization");
    if (authHeader) {
      const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await anonClient.auth.getUser();
      userId = user?.id ?? null;
    }

    // Insert with the service-role client so this remains the only path
    // even after direct anon inserts are revoked at the RLS level.
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    const { error: insertError } = await adminClient.from("feedback").insert({
      type,
      message: message.trim(),
      email: typeof email === "string" && email.trim() ? email.trim() : null,
      user_id: userId,
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
});
