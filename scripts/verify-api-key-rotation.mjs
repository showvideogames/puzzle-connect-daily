#!/usr/bin/env node
/**
 * READ-ONLY probes of the hosted project's API keys, run before and after
 * each step of retiring the legacy JWT secret. They show that the new paths
 * work and that the old credentials are refused.
 *
 *   SUPABASE_ACCESS_TOKEN=… node scripts/verify-api-key-rotation.mjs [--expect=<stage>]
 *
 *   stages: baseline | function-deployed | site-switched | legacy-disabled | revoked
 *
 * Uses only PUBLIC keys: the publishable key and the legacy `anon` key.
 * The legacy service_role key and every secret key are never fetched.
 * Nothing is written: the reads are a public table and Auth's settings, and
 * the one function call stops at "captcha required", before any insert.
 * Prints no key values.
 */

const REF = process.env.SUPABASE_PROJECT_REF ?? "zmauemcjcrdrgfjzkvgd";
const SITE = process.env.RAINBOW_SITE_URL ?? "https://www.rainbowcategories.com";
const API = `https://${REF}.supabase.co`;
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error("Set SUPABASE_ACCESS_TOKEN (the CLI's access token; read-only use).");
  process.exit(2);
}
const stage = (process.argv.find((a) => a.startsWith("--expect=")) ?? "").slice("--expect=".length) || null;

async function management(path) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Management API ${path}: ${res.status}`);
  return res.json();
}

// Only the two public keys are taken from the listing.
const listing = await management("/api-keys");
const publishable = listing.find((k) => k.type === "publishable" && k.name === "default")?.api_key;
const legacyAnon = listing.find((k) => k.type === "legacy" && k.name === "anon")?.api_key;
if (!publishable?.startsWith("sb_publishable_")) throw new Error("no default publishable key found");

const status = async (url, init) => (await fetch(url, init).catch(() => ({ status: 0 }))).status;
const accepted = (code) => code >= 200 && code < 300;

const probes = [];
const probe = (id, what, observed, expect) => probes.push({ id, what, observed, expect });

// P1/P2: the new key, on Auth and on a public table.
probe("P1", "publishable key accepted by Auth", await status(`${API}/auth/v1/settings`, { headers: { apikey: publishable } }), { all: "ok" });
probe("P2", "publishable key reads a public table", await status(`${API}/rest/v1/puzzle_aggregates?select=puzzle_id&limit=1`, { headers: { apikey: publishable } }), { all: "ok" });

// P3: the legacy anon key used AS AN API KEY (what disabling legacy keys turns off).
const p3 = legacyAnon ? await status(`${API}/auth/v1/settings`, { headers: { apikey: legacyAnon } }) : "absent";
probe("P3", "legacy anon key accepted as an API key", p3, { baseline: "ok", "function-deployed": "ok", "site-switched": "ok", "legacy-disabled": "refused", revoked: "refused" });

// P4: a token signed by the legacy secret, presented as a session with the
// new key (what revoking the secret turns off). The legacy anon key is such a token.
const p4 = legacyAnon
  ? await status(`${API}/rest/v1/puzzle_aggregates?select=puzzle_id&limit=1`, { headers: { apikey: publishable, authorization: `Bearer ${legacyAnon}` } })
  : "absent";
probe("P4", "token signed by the legacy secret accepted", p4, { baseline: "ok", "function-deployed": "ok", "site-switched": "ok", "legacy-disabled": "record", revoked: "refused" });

// P5/P6: the feedback function. A body with no captcha token is refused with
// 400 "Captcha token required" after the caller check and before any insert.
async function fn(headers) {
  const res = await fetch(`${API}/functions/v1/submit-feedback`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ type: "bug", message: "key-rotation probe (never stored: no captcha)" }),
  }).catch(() => null);
  if (!res) return 0;
  const body = await res.json().catch(() => ({}));
  return res.status === 400 && body.error === "Captcha token required" ? "reached-function" : res.status;
}
probe("P5", "feedback function reachable the way the site calls it (publishable key, signed out)", await fn({ apikey: publishable, authorization: `Bearer ${publishable}` }), { all: "reached-function" });
probe("P6", "feedback function with the legacy anon key", legacyAnon ? await fn({ apikey: legacyAnon, authorization: `Bearer ${legacyAnon}` }) : "absent", { baseline: "reached-function", "function-deployed": "refused", "site-switched": "refused", "legacy-disabled": "refused", revoked: "refused" });

// P7: which key the live site ships.
let shipped = "unknown";
try {
  const html = await (await fetch(SITE)).text();
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((m) => new URL(m[1], SITE).href);
  const code = (await Promise.all(scripts.map(async (s) => (await fetch(s)).text()))).join("\n");
  const hasLegacy = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/.test(code);
  const hasNew = code.includes(publishable);
  shipped = hasLegacy ? (hasNew ? "both" : "legacy") : hasNew ? "publishable" : "none";
} catch {
  // stays unknown
}
probe("P7", "key in the live site's code", shipped, { baseline: "legacy", "function-deployed": "legacy", "site-switched": "publishable", "legacy-disabled": "publishable", revoked: "publishable" });

// P8: the legacy secret's state.
const keys = await management("/config/auth/signing-keys");
const legacy = (keys.keys ?? keys).find((k) => k.algorithm === "HS256");
probe("P8", "legacy HS256 signing secret", legacy?.status ?? "absent", { baseline: "previously_used", "function-deployed": "previously_used", "site-switched": "previously_used", "legacy-disabled": "previously_used", revoked: "revoked" });

// Normalise HTTP codes to ok / refused for comparison.
const norm = (v) => (typeof v === "number" ? (accepted(v) ? "ok" : v === 401 || v === 403 ? "refused" : `http-${v}`) : v);
let failed = 0;
console.log(`Stage: ${stage ?? "(observe only)"}   project ${REF}   ${new Date().toISOString()}`);
for (const p of probes) {
  const want = p.expect.all ?? (stage ? p.expect[stage] : undefined);
  const got = norm(p.observed);
  const verdict = !want || want === "record" ? "    " : got === want ? "PASS" : "FAIL";
  if (verdict === "FAIL") failed++;
  console.log(`${verdict}  ${p.id}  ${p.what}: ${got}${want && want !== "record" ? `  (expected ${want})` : ""}`);
}
if (stage) console.log(failed ? `\n${failed} probe(s) not as expected for stage "${stage}". Stop and investigate.` : `\nAll probes as expected for stage "${stage}".`);
process.exit(failed ? 1 : 0);
