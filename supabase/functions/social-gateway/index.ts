import { createClient } from "https://esm.sh/@supabase/supabase-js@2.105.4";
import postgres from "npm:postgres@3.4.9";
import {
  TRANSACTION_LIMITS_SQL,
  authCouldNotAnswer,
  createPreviewThrottle,
  handleSocialGateway,
  readApiKeys,
  serverSecretKey,
  type GatewayDb,
} from "./core.ts";

// Platform wiring only; the rules live in core.ts (and its tests).
// Uses the project's new API keys exclusively: nothing here reads
// SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY, the legacy JWT keys.
const env = (name: string) => Deno.env.get(name);
const keys = readApiKeys(env);
const secretKey = serverSecretKey(env);
const dbUrl = env("SUPABASE_DB_URL");

const admin = secretKey
  ? createClient(env("SUPABASE_URL")!, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

// Prepared statements are off, because the connection can come through a
// transaction pooler. One connection per instance, because the live games share
// this database's connections. TLS on the hosted project; the local stack has
// none. Notices are dropped, so nothing the database says reaches a log by itself.
const sql = dbUrl
  ? postgres(dbUrl, {
      prepare: false,
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
      ssl: env("SUPABASE_URL")?.startsWith("https://") ? "require" : false,
      connection: { application_name: "social-gateway" },
      onnotice: () => {},
    })
  : null;

const db: GatewayDb = {
  transaction: <T>(work: Parameters<GatewayDb["transaction"]>[0]) =>
    sql!.begin(async (tx) => {
      await tx.unsafe(TRANSACTION_LIMITS_SQL);
      return work({ query: async (text, params) => [...(await tx.unsafe(text, params as never[]))] });
    }) as Promise<T>,
};

const allowPreview = createPreviewThrottle();

Deno.serve((req) =>
  handleSocialGateway(req, {
    // Without a usable server key and database there is nothing to accept: fail closed.
    keys: admin && sql ? keys : { publishable: [], secret: [] },
    verifyUserToken: async (token) => {
      const { data, error } = await admin!.auth.getUser(token);
      if (error && authCouldNotAnswer(error.status)) throw new Error("Auth could not answer.");
      return error || !data.user ? null : { id: data.user.id, isAnonymous: data.user.is_anonymous === true };
    },
    allowPreview,
    db,
  }),
);
