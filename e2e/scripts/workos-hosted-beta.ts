/**
 * Wire the shared sign-in (WorkOS) into the HOSTED beta project, using the
 * WorkOS STAGING environment. Owner-approved 2026-10-04 for the beta only;
 * WorkOS Production is never touched by this script (its domain is refused).
 *
 *   npm run workos:hosted-beta -- register --authkit-domain <name>.authkit.app
 *   npm run workos:hosted-beta -- wire
 *   npm run workos:hosted-beta -- allow-callback --url https://rainbowcategories.com/auth/callback
 *   npm run workos:hosted-beta -- status
 *   npm run workos:hosted-beta -- remove
 *
 * Credentials, all from the shell, none written anywhere by this script:
 *   WORKOS_STAGING_API_KEY          the Staging environment's API key (register/remove)
 *   RAINBOW_HOSTED_SERVICE_ROLE_KEY the hosted project's service-role key (wire/status/remove)
 *   SUPABASE_ACCESS_TOKEN           the Supabase personal access token (allow-callback)
 *   PHASE2_HOSTED_WRITE=yes         required by every command that changes the hosted project
 * State: .runtime/workos-hosted-beta.json (git-ignored): the application id,
 * client id and client secret. Delete it after the provider is installed.
 *
 * Guards: the project ref is the one in supabase/config.toml and nothing
 * else; the redirect is exactly that project's GoTrue callback; the AuthKit
 * domain must be a *.authkit.app host and must not be the Production one.
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { REPO_ROOT } from "../env.ts";

const RUNTIME_FILE = path.join(REPO_ROOT, ".runtime", "workos-hosted-beta.json");
const MANAGEMENT_URL = "https://api.workos.com";
const SUPABASE_MANAGEMENT = "https://api.supabase.com";
const PROVIDER_ID = "custom:platform";
const APP_NAME = "rainbow-categories-beta";
const FORBIDDEN_DOMAINS = ["obedient-book-17.authkit.app"];

interface State { authkitDomain: string; applicationId: string; clientId: string; clientSecret: string; redirectUri: string; registeredAt: string }

function projectRef(): string {
  const m = readFileSync(path.join(REPO_ROOT, "supabase", "config.toml"), "utf8").match(/^project_id\s*=\s*"([a-z]+)"/m);
  if (!m) throw new Error("supabase/config.toml names no project_id");
  return m[1];
}
const hostedUrl = () => `https://${projectRef()}.supabase.co`;
const callbackUri = () => `${hostedUrl()}/auth/v1/callback`;

function env(name: string, pattern: RegExp, hint: string): string {
  const v = (process.env[name] ?? "").trim();
  if (!pattern.test(v)) throw new Error(`${name} is missing or malformed (${hint}). Export it in this shell only.`);
  return v;
}
function requireWriteIntent(): void {
  if (process.env.PHASE2_HOSTED_WRITE !== "yes") throw new Error("REFUSING: this changes the hosted project; set PHASE2_HOSTED_WRITE=yes.");
}
function checkDomain(domain: string): string {
  const d = domain.trim().toLowerCase();
  if (!/^[a-z0-9-]+\.authkit\.app$/.test(d)) throw new Error(`"${domain}" is not an AuthKit domain.`);
  if (FORBIDDEN_DOMAINS.includes(d)) throw new Error(`REFUSING: ${d} is WorkOS Production. Staging only.`);
  if (!/staging/.test(d)) throw new Error(`REFUSING: ${d} does not look like the Staging environment's domain.`);
  return d;
}
async function workos(method: string, urlPath: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const key = env("WORKOS_STAGING_API_KEY", /^sk_/, "sk_…");
  const res = await fetch(`${MANAGEMENT_URL}${urlPath}`, { method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, json };
}
const readState = (): State | null => (existsSync(RUNTIME_FILE) ? (JSON.parse(readFileSync(RUNTIME_FILE, "utf8")) as State) : null);

function hostedAdmin() {
  const key = env("RAINBOW_HOSTED_SERVICE_ROLE_KEY", /^(sb_secret_|eyJ)/, "the project's service-role key");
  const client = createClient(hostedUrl(), key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client.auth.admin as unknown as {
    customProviders: {
      listProviders(): Promise<{ data: { providers?: { identifier: string; issuer?: string }[] } | null; error: { message: string } | null }>;
      deleteProvider(id: string): Promise<unknown>;
      createProvider(p: Record<string, unknown>): Promise<{ error: { message: string } | null }>;
    };
  };
}

async function register(domainArg: string | undefined): Promise<number> {
  if (!domainArg) { console.error("register needs --authkit-domain <name>.authkit.app"); return 2; }
  const domain = checkDomain(domainArg);
  if (readState()) { console.error(`${RUNTIME_FILE} exists; run \`remove\` first.`); return 1; }
  const discovery = await fetch(`https://${domain}/.well-known/openid-configuration`).then((r) => r.json()).catch(() => null);
  if (!discovery?.issuer) { console.error(`No OpenID discovery document at https://${domain}`); return 1; }
  const redirectUri = callbackUri();
  const created = await workos("POST", "/connect/applications", {
    name: APP_NAME,
    application_type: "oauth",
    description: `Rainbow Categories hosted BETA (${projectRef()}), WorkOS Staging. Temporary; replaced by a Production application at launch.`,
    redirect_uris: [{ uri: redirectUri, default: true }],
    uses_pkce: false,
    is_first_party: true,
  });
  if (created.status >= 300 || !created.json?.id) { console.error(`WorkOS refused the application: HTTP ${created.status} ${JSON.stringify(created.json).slice(0, 400)}`); return 1; }
  const appId = created.json.id as string;
  const clientId = (created.json.client_id ?? created.json.id) as string;
  const secret = await workos("POST", `/connect/applications/${appId}/client_secrets`, {});
  const clientSecret = (secret.json?.secret ?? secret.json?.client_secret ?? secret.json?.value) as string | undefined;
  if (secret.status >= 300 || !clientSecret) { console.error(`Application created (${appId}) but no secret was issued: HTTP ${secret.status}. Remove it in the dashboard.`); return 1; }
  mkdirSync(path.dirname(RUNTIME_FILE), { recursive: true });
  writeFileSync(RUNTIME_FILE, JSON.stringify({ authkitDomain: domain, applicationId: appId, clientId, clientSecret, redirectUri, registeredAt: new Date().toISOString() } satisfies State, null, 2));
  console.log(`registered ${APP_NAME} (${appId}) in WorkOS Staging with redirect ${redirectUri}; state in ${path.relative(REPO_ROOT, RUNTIME_FILE)} (git-ignored)`);
  return 0;
}

async function wire(): Promise<number> {
  requireWriteIntent();
  const state = readState();
  if (!state) { console.error("Nothing registered. Run `register` first."); return 1; }
  if (state.redirectUri !== callbackUri()) { console.error(`The registered redirect ${state.redirectUri} is not this project's callback. STOPPING.`); return 1; }
  const providers = hostedAdmin().customProviders;
  await providers.deleteProvider(PROVIDER_ID).catch(() => undefined);
  const result = await providers.createProvider({
    provider_type: "oidc",
    identifier: PROVIDER_ID,
    name: "Shared account",
    client_id: state.clientId,
    client_secret: state.clientSecret,
    issuer: `https://${state.authkitDomain}`,
    scopes: ["openid", "email", "profile"],
    pkce_enabled: true,
  });
  if (result.error) { console.error(`provider NOT installed: ${result.error.message}`); return 1; }
  console.log(`installed ${PROVIDER_ID} in the hosted project ${projectRef()} (issuer https://${state.authkitDomain}).`);
  console.log(`Build-time value for the deploy: VITE_PLATFORM_DISCOVERY_URL=https://${state.authkitDomain}/.well-known/openid-configuration`);
  return 0;
}

async function allowCallback(url: string | undefined): Promise<number> {
  if (!url || !/^https:\/\/[a-z0-9.-]+\/auth\/callback$/.test(url)) { console.error("allow-callback needs --url https://<site>/auth/callback"); return 2; }
  requireWriteIntent();
  const token = env("SUPABASE_ACCESS_TOKEN", /^sbp_/, "sbp_…");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const current = await fetch(`${SUPABASE_MANAGEMENT}/v1/projects/${projectRef()}/config/auth`, { headers }).then((r) => r.json()) as { uri_allow_list?: string };
  const list = (current.uri_allow_list ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (list.includes(url)) { console.log(`already allowed: ${url} (list: ${list.join(", ")})`); return 0; }
  const next = [...list, url].join(",");
  const res = await fetch(`${SUPABASE_MANAGEMENT}/v1/projects/${projectRef()}/config/auth`, { method: "PATCH", headers, body: JSON.stringify({ uri_allow_list: next }) });
  if (res.status >= 300) { console.error(`PATCH refused: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`); return 1; }
  console.log(`redirect allow-list is now: ${next}`);
  return 0;
}

async function status(): Promise<number> {
  const state = readState();
  console.log(state ? `registered: ${APP_NAME} ${state.applicationId} → ${state.redirectUri} (issuer https://${state.authkitDomain})` : "nothing registered locally");
  const list = await hostedAdmin().customProviders.listProviders();
  console.log(`hosted custom providers: ${JSON.stringify(list.data?.providers?.map((p) => ({ identifier: p.identifier, issuer: p.issuer })) ?? list.error?.message)}`);
  return 0;
}

async function remove(): Promise<number> {
  requireWriteIntent();
  const state = readState();
  await hostedAdmin().customProviders.deleteProvider(PROVIDER_ID).catch(() => undefined);
  if (state) {
    const del = await workos("DELETE", `/connect/applications/${state.applicationId}`);
    console.log(`WorkOS application ${state.applicationId}: HTTP ${del.status}`);
    unlinkSync(RUNTIME_FILE);
  }
  console.log("removed the hosted provider and the runtime file");
  return 0;
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  const opt = (name: string) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
  switch (command) {
    case "register": return register(opt("--authkit-domain"));
    case "wire": return wire();
    case "allow-callback": return allowCallback(opt("--url"));
    case "status": return status();
    case "remove": return remove();
    default:
      console.error("usage: npm run workos:hosted-beta -- register --authkit-domain <name>.authkit.app | wire | allow-callback --url <https://site/auth/callback> | status | remove");
      return 2;
  }
}

main().then((code) => process.exit(code), (error) => { console.error(`\n${error instanceof Error ? error.message : String(error)}\n`); process.exit(1); });
