import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleFeedback, readApiKeys, serverSecretKey } from "./core.ts";

// Platform wiring only; the rules live in core.ts (and its tests).
// Uses the project's new API keys exclusively: nothing here reads
// SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY, the legacy JWT keys.
const env = (name: string) => Deno.env.get(name);
const keys = readApiKeys(env);
const secretKey = serverSecretKey(env);
const admin = secretKey
  ? createClient(env("SUPABASE_URL")!, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

Deno.serve((req) =>
  handleFeedback(req, {
    // Without a usable server key there is nothing to accept: fail closed.
    keys: admin ? keys : { publishable: [], secret: [] },
    turnstileSecret: env("TURNSTILE_SECRET_KEY"),
    verifyUserToken: async (token) => {
      const { data, error } = await admin!.auth.getUser(token);
      return error || !data.user ? null : { id: data.user.id };
    },
    insertFeedback: async (row) => {
      const { error } = await admin!.from("feedback").insert(row);
      return { error };
    },
    fetch,
  }),
);
