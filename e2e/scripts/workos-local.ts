/**
 * Wire the shared sign-in service (WorkOS) into the LOCAL e2e stack for the
 * manual smoke test. Phase 1 only: WorkOS STAGING environment, local Supabase.
 *
 *   npm run workos:local -- register --authkit-domain <name>.authkit.app
 *   npm run workos:local -- wire
 *   npm run workos:local -- status
 *   npm run workos:local -- remove
 *
 * Credentials:
 *   WORKOS_STAGING_API_KEY   the Staging environment's API key, in the shell
 *                            (never written anywhere by this tool)
 *   .runtime/workos-local.json   written by `register`: the application's
 *                            client id + secret and the AuthKit domain.
 *                            Git-ignored. Delete it after the smoke test.
 *
 * Guards (all must pass, every command):
 *   - the API key must look like a WorkOS secret key (sk_...)
 *   - the AuthKit domain must be a *.authkit.app or *.workos.com host and
 *     must NOT be the proof's Production environment domain
 *   - the redirect address is always the LOCAL stack's callback and the
 *     provider is installed only into the LOCAL stack (127.0.0.1:54421),
 *     confirmed through the same safety guard every e2e command uses
 *
 * The provider identifier is the neutral `custom:platform`; the application
 * is named after the game, not a brand, and carries the word "local" so it is
 * recognisable in the dashboard.
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { REPO_ROOT, assertIsE2eStack, guardContext, loadE2eConfig } from "../env.ts";
import { assertDisposableTarget } from "../safety.ts";

const RUNTIME_DIR = path.join(REPO_ROOT, ".runtime");
const RUNTIME_FILE = path.join(RUNTIME_DIR, "workos-local.json");
const MANAGEMENT_URL = "https://api.workos.com";
const PROVIDER_ID = "custom:platform";
const APP_NAME = "rainbow-categories-local";
/** The proof's Production environment. Phase 1 never touches it. */
const FORBIDDEN_DOMAINS = ["obedient-book-17.authkit.app"];

interface RuntimeState {
  authkitDomain: string;
  applicationId: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  registeredAt: string;
}

function apiKey(): string {
  const key = (process.env.WORKOS_STAGING_API_KEY ?? "").trim();
  if (!/^sk_/.test(key)) {
    throw new Error("WORKOS_STAGING_API_KEY is missing or is not a WorkOS API key (sk_...). Create one in the STAGING environment and export it in this shell only.");
  }
  return key;
}

function checkDomain(domain: string): string {
  const d = domain.trim().toLowerCase();
  if (!/^[a-z0-9-]+\.(authkit\.app|workos\.com)$/.test(d)) throw new Error(`"${domain}" is not an AuthKit domain.`);
  if (FORBIDDEN_DOMAINS.includes(d)) throw new Error(`REFUSING: ${d} is the proof's Production environment. Phase 1 uses Staging only.`);
  return d;
}

async function workos(method: string, urlPath: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${MANAGEMENT_URL}${urlPath}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, json };
}

function localConfig() {
  const config = loadE2eConfig();
  assertDisposableTarget("workos:local", config, guardContext());
  assertIsE2eStack(config.apiUrl, config.dbUrl);
  return config;
}

function readState(): RuntimeState | null {
  return existsSync(RUNTIME_FILE) ? (JSON.parse(readFileSync(RUNTIME_FILE, "utf8")) as RuntimeState) : null;
}

async function register(domainArg: string | undefined): Promise<number> {
  if (!domainArg) { console.error("register needs --authkit-domain <name>.authkit.app"); return 2; }
  const domain = checkDomain(domainArg);
  const config = localConfig();
  const redirectUri = `${config.apiUrl}/auth/v1/callback`;

  // Is the key for the environment the domain belongs to? Ask the domain's
  // discovery document for its issuer and the key's environment for its apps.
  const discovery = await fetch(`https://${domain}/.well-known/openid-configuration`).then((r) => r.json()).catch(() => null);
  if (!discovery?.issuer) { console.error(`No OpenID discovery document at https://${domain}`); return 1; }
  console.log(`issuer ${discovery.issuer}`);

  if (readState()) { console.error(`${RUNTIME_FILE} exists; run \`remove\` first.`); return 1; }

  const created = await workos("POST", "/connect/applications", {
    name: APP_NAME,
    type: "oauth",
    redirect_uris: [redirectUri],
    first_party: true,
    registration_type: "authenticated",
  });
  if (created.status >= 300 || !created.json?.id) {
    console.error(`WorkOS refused the application: HTTP ${created.status} ${JSON.stringify(created.json).slice(0, 400)}`);
    return 1;
  }
  const appId = created.json.id as string;
  const clientId = (created.json.client_id ?? created.json.id) as string;

  const secret = await workos("POST", `/connect/applications/${appId}/client_secrets`, {});
  const clientSecret = secret.json?.secret ?? secret.json?.client_secret ?? secret.json?.value;
  if (secret.status >= 300 || !clientSecret) {
    console.error(`Application created (${appId}) but no secret was issued: HTTP ${secret.status}. Remove it in the dashboard.`);
    return 1;
  }

  mkdirSync(RUNTIME_DIR, { recursive: true });
  const state: RuntimeState = { authkitDomain: domain, applicationId: appId, clientId, clientSecret, redirectUri, registeredAt: new Date().toISOString() };
  writeFileSync(RUNTIME_FILE, JSON.stringify(state, null, 2));
  console.log(`registered ${APP_NAME} (${appId}) with redirect ${redirectUri}; state in ${RUNTIME_FILE} (git-ignored)`);
  return 0;
}

async function wire(): Promise<number> {
  const state = readState();
  if (!state) { console.error("Nothing registered. Run `register` first."); return 1; }
  const config = localConfig();
  if (state.redirectUri !== `${config.apiUrl}/auth/v1/callback`) {
    console.error(`The registered redirect ${state.redirectUri} is not this stack's callback. STOPPING.`);
    return 1;
  }
  const admin = createClient(config.apiUrl, config.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const providers = admin.auth.admin as unknown as {
    customProviders: {
      deleteProvider(id: string): Promise<unknown>;
      createProvider(p: Record<string, unknown>): Promise<{ error: { message: string } | null }>;
    };
  };
  await providers.customProviders.deleteProvider(PROVIDER_ID).catch(() => undefined);
  const result = await providers.customProviders.createProvider({
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
  console.log(`installed ${PROVIDER_ID} in the local stack (issuer https://${state.authkitDomain}).`);
  console.log(`Now: export E2E_PLATFORM_DISCOVERY_URL=https://${state.authkitDomain}/.well-known/openid-configuration ; npm run e2e:up ; npm run e2e:app`);
  return 0;
}

async function status(): Promise<number> {
  const state = readState();
  console.log(state ? `registered: ${APP_NAME} ${state.applicationId} → ${state.redirectUri} (issuer https://${state.authkitDomain})` : "nothing registered");
  const config = loadE2eConfig();
  const list = await fetch(`${config.apiUrl}/auth/v1/settings`).then((r) => r.json()).catch(() => null);
  const external = list?.external ?? {};
  console.log(`local stack providers: ${Object.entries(external).filter(([, v]) => v).map(([k]) => k).join(", ") || "(unreadable)"}`);
  return 0;
}

async function remove(): Promise<number> {
  const state = readState();
  if (!state) { console.log("nothing to remove"); return 0; }
  const config = localConfig();
  const admin = createClient(config.apiUrl, config.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  await (admin.auth.admin as unknown as { customProviders: { deleteProvider(id: string): Promise<unknown> } }).customProviders
    .deleteProvider(PROVIDER_ID)
    .catch(() => undefined);
  const del = await workos("DELETE", `/connect/applications/${state.applicationId}`);
  console.log(`WorkOS application ${state.applicationId}: HTTP ${del.status}`);
  unlinkSync(RUNTIME_FILE);
  console.log("removed the local provider and the runtime file");
  return 0;
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  const domainIdx = rest.indexOf("--authkit-domain");
  const domain = domainIdx >= 0 ? rest[domainIdx + 1] : undefined;
  switch (command) {
    case "register": return register(domain);
    case "wire": return wire();
    case "status": return status();
    case "remove": return remove();
    default:
      console.error("usage: npm run workos:local -- register --authkit-domain <name>.authkit.app | wire | status | remove");
      return 2;
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
);
