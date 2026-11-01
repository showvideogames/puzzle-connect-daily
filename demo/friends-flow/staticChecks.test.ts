/**
 * What the Friends and Groups preview can't do, read from its files and config.
 * Nothing of the page runs here: friendsFlow.test.tsx covers the flows.
 *   npx vitest run --config demo/friends-flow/vite.config.ts
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { describe, expect, it, vi } from "vitest";
import flowConfig from "./vite.config";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAINBOW = path.resolve(HERE, "../..");

const read = (name: string) => readFileSync(path.join(HERE, name), "utf8");

const PAGE_FILES = ["AddFriendFlow.tsx", "FriendsFlow.tsx", "LinkCards.tsx", "MyGroups.tsx", "Session.tsx", "WaitingRequests.tsx", "flowData.ts", "flowPanels.tsx", "useLive.ts", "main.tsx"];
const FAKE_FILES = ["fakeBackend.ts", "fakeSupabase.ts", "fakeSupabaseJs.ts"];

const page = read("index.html");
const main = read("main.tsx");
const glue = read("preview.ts");
const pageTexts = PAGE_FILES.map(read);
const fakeTexts = FAKE_FILES.map(read);

/** The network and every storage but the one each file is allowed. */
const NETWORK = [/\bfetch\b/, /XMLHttpRequest/, /WebSocket/, /EventSource/, /sendBeacon/, /https?:\/\//];
const STORAGE = [/sessionStorage/, /indexedDB/, /document\.cookie/, /serviceWorker/, /\bcaches\b/];

const offenders = (text: string, patterns: RegExp[]) => patterns.filter((pattern) => pattern.test(text)).map(String);

function plugin(name: string): Plugin {
  const found = (flowConfig.plugins as Plugin[]).find((candidate) => candidate.name === name);
  if (!found) throw new Error(`No plugin named ${name}`);
  return found;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

describe("the label", () => {
  it("is in the page itself, permanently, and says this is a mock with no real accounts", () => {
    const start = page.indexOf('<header class="preview-bar" data-testid="banner">');
    expect(start).toBeGreaterThan(-1);
    const banner = page.slice(start, page.indexOf("</header>", start));
    expect(banner).toContain("<strong>Mock.</strong>");
    expect(banner).toContain("No real accounts.");
    expect(banner).toContain("Nothing is sent anywhere");
    expect(banner).not.toContain("hidden");
    expect(page).toContain("<title>Friends and Groups mock preview</title>");
  });

  it("reuses the onboarding preview's stylesheet", () => {
    expect(main).toContain('import "../onboarding/preview.css";');
    expect(page).toContain('class="preview-root"');
  });
});

describe("real code only", () => {
  it("uses the real factory in its default mode, and the real session and sign-in code", () => {
    expect(glue).toContain("createRainbowSocial({ transport: backend.transport, credentialFor })");
    expect(glue).toContain("rainbowSession(credentialFor)");
    expect(glue).toContain("await ensureAccount();");
    expect(glue).toContain("await signOutOfRainbow();");
  });

  it("never builds a client by hand and never sets account state", () => {
    for (const text of [...pageTexts, glue, ...fakeTexts]) {
      expect(text).not.toMatch(/createSocialClient/);
      expect(text).not.toMatch(/publishAccount|forgetAccountConfirmation/);
    }
  });

  it("calls the game-server route only from the fake backend", () => {
    for (const text of [...pageTexts, glue]) expect(text).not.toMatch(/serverFor|recordCompletion/);
    expect(read("fakeBackend.ts")).toContain("hub.serverFor(GAME).recordCompletion");
  });

  it("builds a link only from what createGroup or createFriendInvite answered", () => {
    expect(read("MyGroups.tsx")).toContain("const { groupId, inviteCode } = made.data;");
    // Read off a row it would be a code from a list, which the contract forbids.
    for (const text of pageTexts) expect(text).not.toMatch(/\.inviteCode\b/);
  });
});

describe("no way out", () => {
  it("uses no network or storage, except the one clear in preview.ts and the session in the fake backend", () => {
    for (const text of [...pageTexts, glue, ...fakeTexts]) expect(offenders(text, [...NETWORK, ...STORAGE])).toEqual([]);
    for (const text of [...pageTexts, ...fakeTexts.slice(1)]) expect(text).not.toMatch(/localStorage/);
    expect(glue.match(/localStorage/g)).toEqual(["localStorage"]);
    expect(glue).toContain("localStorage.clear()");
  });

  it("writes text as text, and adds nothing to window", () => {
    for (const text of pageTexts) expect(text).not.toMatch(/innerHTML|dangerouslySetInnerHTML|insertAdjacentHTML|document\.write/);
    for (const text of [...pageTexts, glue, ...fakeTexts]) expect(text).not.toMatch(/\bwindow\s*[.[]|globalThis/);
  });

  it("starts only on a local address", () => {
    expect(main).toContain('const LOCAL_HOSTS = ["127.0.0.1", "localhost"];');
    expect(main).toMatch(/if \(LOCAL_HOSTS\.includes\(location\.hostname\)\) \{\s*void start\(\);\s*\} else \{/);
    expect(page).toMatch(/data-testid="blocked" hidden/);
    // Only the guard's branch loads anything that reaches the fake backend.
    expect(main).not.toMatch(/^import .*(preview"|FriendsFlow"|fakeBackend)/m);
  });

  it("has only its own files, so an env file here fails", () => {
    expect(readdirSync(HERE).filter((name) => name !== ".DS_Store").sort()).toEqual(
      [
        ...PAGE_FILES,
        ...FAKE_FILES,
        "flow.css",
        "friendsFlow.test.tsx",
        "index.html",
        "preview.ts",
        "staticChecks.test.ts",
        "tsconfig.json",
        "vite.config.ts",
      ].sort(),
    );
  });

  it("nothing in the app or the root site files refers to the preview", () => {
    const files = [
      ...walk(path.join(RAINBOW, "src")),
      ...walk(path.join(RAINBOW, "demo", "onboarding")).filter((file) => /\.(ts|tsx|css|html)$/.test(file)),
      ...["index.html", "vite.config.ts", "package.json", "vercel.json"].map((name) => path.join(RAINBOW, name)).filter((file) => existsSync(file)),
    ];
    expect(files.length).toBeGreaterThan(4);
    expect(files.filter((file) => /friends-?flow/i.test(readFileSync(file, "utf8").replace("feat/friends-flow-local", "")))).toEqual([]);
  });
});

describe("the config", () => {
  it("really refuses a build and a served build, through a plugin that runs for every command", () => {
    const refuser = plugin("friends-flow-preview-refuse-build");
    expect(refuser.apply).toBeUndefined();

    const hook = refuser.config as unknown as (config: object, env: { command: string; isPreview?: boolean }) => unknown;
    expect(() => hook({}, { command: "build" })).toThrow(/no build/);
    expect(() => hook({}, { command: "serve", isPreview: true })).toThrow(/no build/);
    expect(() => hook({}, { command: "serve" })).not.toThrow();
  });

  it("refuses a real env file and the real client by relative path", () => {
    const hook = plugin("friends-flow-preview-refuse-real-settings").resolveId as unknown as (source: string, importer?: string) => unknown;

    expect(() => hook("./.env", path.join(HERE, "main.tsx"))).toThrow(/refuses/);
    expect(() => hook("../../.env.local", path.join(HERE, "main.tsx"))).toThrow(/refuses/);
    expect(() => hook("../integrations/supabase/client", path.join(RAINBOW, "src", "lib", "gameStats.ts"))).toThrow(/refuses/);
    expect(hook("./preview", path.join(HERE, "main.tsx"))).toBeNull();
    expect(hook("react", path.join(HERE, "main.tsx"))).toBeNull();
  });

  it("swaps the client and the library, for the server and the tests alike", () => {
    const aliases = flowConfig.resolve?.alias as unknown as { find: RegExp; replacement: string }[];
    const target = (source: string) => aliases.find(({ find }) => find.test(source))?.replacement;
    expect(target("@/integrations/supabase/client")).toBe(path.join(HERE, "fakeSupabase.ts"));
    expect(target("@supabase/supabase-js")).toBe(path.join(HERE, "fakeSupabaseJs.ts"));
    expect(aliases.findIndex(({ find }) => find.test("@/integrations/supabase/client"))).toBe(0);
  });

  it("binds locally, with no way round its limits, and lets no VITE_ value in", () => {
    const { server, envDir, envPrefix, publicDir } = flowConfig;
    expect(server).toMatchObject({ host: "127.0.0.1", port: 5202, strictPort: true });
    expect(envDir).toBe(HERE);
    expect(envPrefix).toBe("FRIENDS_FLOW_PREVIEW_");
    expect(String(envPrefix)).not.toMatch(/^VITE_/);
    expect(publicDir).toBe(false);
    expect(server?.fs?.allow?.map((dir) => path.relative(RAINBOW, dir)).sort()).toEqual([path.join("demo", "friends-flow"), path.join("demo", "onboarding"), "node_modules", "src"].sort());
    expect(server?.proxy).toBeUndefined();
    expect(flowConfig.preview).toBeUndefined();
    expect(read("vite.config.ts")).not.toMatch(/0\.0\.0\.0/);
    expect(Object.keys(flowConfig.define ?? {}).sort()).toEqual(["import.meta.env.VITE_PLATFORM_DISCOVERY_URL", "import.meta.env.VITE_SHARED_SOCIAL"]);
  });

  it("serves the shared pictures from the onboarding preview's folder, and nothing else that way", () => {
    let handler: (request: { url?: string }, response: unknown, next: () => void) => void = () => undefined;
    const hook = plugin("friends-flow-preview-shared-assets").configureServer as unknown as (server: object) => void;
    hook({ middlewares: { use: (given: typeof handler) => (handler = given) } });

    const next = vi.fn();
    const picture = { url: "/shared-assets/avatars/bear.webp" };
    handler(picture, null, next);
    expect(picture.url).toBe(`/@fs${path.join(RAINBOW, "demo", "onboarding", "shared-assets", "avatars", "bear.webp")}`);

    const other = { url: "/main.tsx" };
    handler(other, null, next);
    expect(other.url).toBe("/main.tsx");
    expect(next).toHaveBeenCalledTimes(2);
  });
});
