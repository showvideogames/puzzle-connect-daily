#!/usr/bin/env node
/**
 * End-to-end check of the submit-feedback Edge Function on a THROWAWAY local
 * Supabase stack, using the new API key system only.
 *
 *   node scripts/check-feedback-function.mjs
 *
 * What it does:
 *   - builds a temporary Supabase project (own ports 54630-54634, outside
 *     the dev and e2e ranges) with Rainbow's baseline schema, an ES256 user
 *     signing key, and this repo's function code;
 *   - calls the function the way the site does (supabase-js with the
 *     PUBLISHABLE key), signed out and signed in;
 *   - checks that every other caller is refused: no or unknown API key, the
 *     LEGACY anon/service_role keys, forged sessions, ended sessions;
 *   - reads back exactly which feedback rows were stored, with which user;
 *   - stops the stack and deletes its data.
 *
 * Needs Docker. Touches no hosted project. Prints no key or token values.
 * Turnstile runs for real against Cloudflare's published always-pass TEST
 * secret.
 */

import { spawn, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORTS = { shadow: 54630, api: 54631, db: 54632, studio: 54633, smtp: 54634 };
// Cloudflare's documented dummy keys: this secret accepts any token.
const TURNSTILE_TEST_SECRET = "1x0000000000000000000000000000000AA";
const TURNSTILE_TEST_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const RUN = randomUUID().slice(0, 8);

const work = mkdtempSync(path.join(tmpdir(), "rainbow-feedback-check-"));
const project = path.join(work, "supabase");
let serve = null;
const results = [];

function check(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  -- ${detail}` : ""}`);
}

function cli(args, opts = {}) {
  const r = spawnSync("npx", ["--yes", "supabase", ...args, "--workdir", work], {
    cwd: work,
    shell: process.platform === "win32",
    encoding: "utf8",
    ...opts,
  });
  if (r.status !== 0 && !opts.allowFail) {
    throw new Error(`supabase ${args[0]} failed:\n${(r.stderr || r.stdout || "").split("\n").slice(-15).join("\n")}`);
  }
  return r;
}

function config(verifyJwt) {
  return `project_id = "rainbow-feedback-check"
[api]
enabled = true
port = ${PORTS.api}
schemas = ["public", "graphql_public"]
extra_search_path = ["public", "extensions"]
[db]
port = ${PORTS.db}
shadow_port = ${PORTS.shadow}
major_version = 17
[db.pooler]
enabled = false
[studio]
enabled = false
port = ${PORTS.studio}
[local_smtp]
enabled = false
port = ${PORTS.smtp}
[storage]
enabled = false
[realtime]
enabled = false
[analytics]
enabled = false
[edge_runtime]
enabled = true
[auth]
enabled = true
site_url = "http://127.0.0.1:5199"
jwt_expiry = 3600
enable_signup = true
enable_anonymous_sign_ins = false
signing_keys_path = "./signing_keys.json"
[auth.email]
enable_signup = true
enable_confirmations = false
[functions.submit-feedback]
verify_jwt = ${verifyJwt}
`;
}

function buildProject() {
  mkdirSync(path.join(project, "migrations"), { recursive: true });
  // Rainbow's real schema (the storage-bucket migration is not needed here).
  cpSync(path.join(REPO, "supabase/migrations/0001_rainbow_baseline.sql"), path.join(project, "migrations/0001_rainbow_baseline.sql"));
  cpSync(path.join(REPO, "supabase/functions/submit-feedback"), path.join(project, "functions/submit-feedback"), { recursive: true });
  // The repo's own setting for this function, so the check runs what ships.
  const shipped = /\[functions\.submit-feedback\][^[]*verify_jwt\s*=\s*(true|false)/.exec(readFileSync(path.join(REPO, "supabase/config.toml"), "utf8"));
  writeFileSync(path.join(project, "config.toml"), config(shipped ? shipped[1] : "true"));
  // A fresh ES256 user-session signing key, the algorithm hosted Rainbow uses now.
  // The CLI writes it into the configured file, which must exist first.
  const keysFile = path.join(project, "signing_keys.json");
  writeFileSync(keysFile, "[]");
  cli(["gen", "signing-key", "--algorithm", "ES256", "--yes"]);
  const written = JSON.parse(readFileSync(keysFile, "utf8"));
  if (!Array.isArray(written) || written.length !== 1 || written[0].alg !== "ES256") throw new Error("signing key was not written");
  writeFileSync(path.join(work, "functions.env"), `TURNSTILE_SECRET_KEY=${TURNSTILE_TEST_SECRET}\n`);
  return shipped ? shipped[1] : "true";
}

function stackKeys() {
  const out = cli(["status", "-o", "json"]).stdout;
  const status = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
  const keys = {
    apiUrl: status.API_URL,
    publishable: status.PUBLISHABLE_KEY,
    secret: status.SECRET_KEY,
    legacyAnon: status.ANON_KEY,
    legacyService: status.SERVICE_ROLE_KEY,
  };
  for (const [name, value] of Object.entries(keys)) if (!value) throw new Error(`supabase status did not report ${name}`);
  return keys;
}

async function startServe(keys, extra = []) {
  serve = spawn("npx", ["--yes", "supabase", "functions", "serve", "--workdir", work, "--env-file", path.join(work, "functions.env"), ...extra], {
    cwd: work,
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  serve.stdout.on("data", (d) => (log += d));
  serve.stderr.on("data", (d) => (log += d));
  const url = `${keys.apiUrl}/functions/v1/submit-feedback`;
  for (let i = 0; i < 90; i++) {
    const res = await fetch(url, { method: "OPTIONS" }).catch(() => null);
    if (res && res.status === 200 && /serving|Serving|Listening/.test(log)) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`functions serve did not come up:\n${log.split("\n").slice(-20).join("\n")}`);
}

function stopServe() {
  if (!serve) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(serve.pid), "/T", "/F"], { stdio: "ignore" });
  else serve.kill("SIGTERM");
  serve = null;
  // functions serve leaves its runtime container behind when killed
  spawnSync("docker", ["rm", "-f", "supabase_edge_runtime_rainbow-feedback-check"], { stdio: "ignore" });
}

const message = (label) => `check-${RUN} ${label}`;
const body = (label) => ({ type: "bug", message: message(label), email: null, turnstileToken: TURNSTILE_TEST_TOKEN });

async function raw(keys, headers, label) {
  const res = await fetch(`${keys.apiUrl}/functions/v1/submit-feedback`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body(label)),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, error: json.error ?? json.msg ?? json.message };
}

const algOf = (jwt) => JSON.parse(Buffer.from(jwt.split(".")[0], "base64url").toString()).alg;

/**
 * One full pass against the running function. `label` keeps each pass's
 * rows apart. With the gateway check on, some refusals come from the
 * gateway and some from the function; either way they must be 401 and
 * store nothing.
 */
async function suite(label, keys, admin, users, password) {
  const fn = "submit-feedback";
  const tag = (name) => `${label} ${name}`;
  const P = keys.publishable;

  // 1. The site, signed out: supabase-js with the publishable key, no session.
  const visitor = createClient(keys.apiUrl, P, { auth: { persistSession: false, autoRefreshToken: false } });
  const out = await visitor.functions.invoke(fn, { body: body(tag("signed-out")) });
  check(`[${label}] signed out (site client, publishable key): accepted`, !out.error && out.data?.ok === true, out.error ? String(out.error.message) : "");

  // 2. The site, signed in.
  const alice = createClient(keys.apiUrl, P, { auth: { persistSession: false, autoRefreshToken: false } });
  const signIn = await alice.auth.signInWithPassword({ email: `alice-${RUN}@feedback-check.test`, password });
  if (signIn.error) throw new Error(`signIn: ${signIn.error.message}`);
  check(`[${label}] user sessions are signed with the new asymmetric key`, algOf(signIn.data.session.access_token) === "ES256", `alg=${algOf(signIn.data.session.access_token)}`);
  const inn = await alice.functions.invoke(fn, { body: body(tag("signed-in")) });
  check(`[${label}] signed in (site client, publishable key + session): accepted`, !inn.error && inn.data?.ok === true, inn.error ? String(inn.error.message) : "");

  // 3. Everything else is refused.
  const [h, p] = signIn.data.session.access_token.split(".");
  const refusals = [
    ["no API key", { authorization: `Bearer ${P}` }],
    ["an unknown sb_publishable_ key", { apikey: "sb_publishable_not_this_project", authorization: `Bearer ${P}` }],
    ["LEGACY anon key as the API key", { apikey: keys.legacyAnon, authorization: `Bearer ${keys.legacyAnon}` }],
    ["LEGACY service_role key as the API key", { apikey: keys.legacyService, authorization: `Bearer ${keys.legacyService}` }],
    ["LEGACY anon key presented as a session", { apikey: P, authorization: `Bearer ${keys.legacyAnon}` }],
    ["LEGACY service_role key presented as a session", { apikey: P, authorization: `Bearer ${keys.legacyService}` }],
    ["no Authorization header", { apikey: P }],
    ["a forged session (Alice's claims, wrong signature)", { apikey: P, authorization: `Bearer ${h}.${p}.${randomBytes(64).toString("base64url")}` }],
  ];
  for (const [name, headers] of refusals) {
    const r = await raw(keys, headers, tag(`refused ${name}`));
    check(`[${label}] refused: ${name}`, r.status === 401, `${r.status} ${r.error ?? r.message ?? ""}`);
  }

  // 4. A session that has ended (signed out everywhere) no longer counts,
  // even though its signature is still valid: Auth is asked every time.
  const bob = createClient(keys.apiUrl, P, { auth: { persistSession: false, autoRefreshToken: false } });
  const bobToken = (await bob.auth.signInWithPassword({ email: `bob-${RUN}@feedback-check.test`, password })).data.session.access_token;
  const before = await raw(keys, { apikey: P, authorization: `Bearer ${bobToken}` }, tag("bob before sign-out"));
  await admin.auth.admin.signOut(bobToken, "global");
  const after = await raw(keys, { apikey: P, authorization: `Bearer ${bobToken}` }, tag("bob after sign-out"));
  check(`[${label}] an ended session is refused`, before.status === 200 && after.status === 401, `before=${before.status} after=${after.status} ${after.error ?? ""}`);

  // 5. Exactly the accepted calls were stored, each with the right user.
  const { data: rows, error } = await admin.from("feedback").select("message, user_id").like("message", `check-${RUN} ${label} %`).order("created_at");
  if (error) throw new Error(`reading feedback: ${error.message}`);
  const stored = Object.fromEntries(rows.map((r) => [r.message.replace(`check-${RUN} ${label} `, ""), r.user_id]));
  check(
    `[${label}] stored: signed-out -> no user, signed-in -> Alice, Bob (before sign-out) -> Bob, nothing else`,
    rows.length === 3 && stored["signed-out"] === null && stored["signed-in"] === users.alice && stored["bob before sign-out"] === users.bob,
    `${rows.length} rows`,
  );
}

async function main() {
  const shipped = buildProject();
  console.log(`Temporary project: ${work}`);
  console.log("Starting a throwaway local Supabase stack (first run pulls images)...");
  cli(["start", "-x", "realtime,storage-api,imgproxy,studio,postgres-meta,logflare,vector,supavisor,mailpit,edge-runtime"], { stdio: ["ignore", "ignore", "pipe"] });
  const keys = stackKeys();
  check("stack issues new-format keys", keys.publishable.startsWith("sb_publishable_") && keys.secret.startsWith("sb_secret_"));

  const admin = createClient(keys.apiUrl, keys.secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const password = randomBytes(18).toString("base64url");
  const users = {};
  for (const who of ["alice", "bob"]) {
    const { data, error } = await admin.auth.admin.createUser({ email: `${who}-${RUN}@feedback-check.test`, password, email_confirm: true });
    if (error) throw new Error(`createUser: ${error.message}`);
    users[who] = data.user.id;
  }

  // As shipped (supabase/config.toml), then with the gateway check off, to
  // show the function's own checks hold without it.
  for (const verifyJwt of [shipped === "true", shipped !== "true"]) {
    writeFileSync(path.join(project, "config.toml"), config(verifyJwt));
    await startServe(keys);
    await suite(`gateway ${verifyJwt ? "on" : "off"}${String(verifyJwt) === shipped ? " (as shipped)" : ""}`, keys, admin, users, password);
    stopServe();
  }
}

try {
  await main();
} catch (err) {
  check("check ran to completion", false, err instanceof Error ? err.message : String(err));
} finally {
  stopServe();
  cli(["stop", "--no-backup"], { allowFail: true, stdio: "ignore" });
  rmSync(work, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
