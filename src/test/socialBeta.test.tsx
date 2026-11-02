/**
 * The Friends and Groups beta flag: off leaves the app exactly as it was, on adds
 * two lazy routes and one menu row, and none of it reaches the main chunk.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { Children, isValidElement, type ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsModal } from "@/components/SettingsModal";
import { socialBetaOn } from "@/components/social/socialFlag";
import { START, reconcileSession, sessionKey } from "@/components/social/useSocialSession";
import { AUTH_STORAGE_KEY } from "@/lib/platformSignIn";
import { loadSettings } from "@/lib/settings";

const { createGatewayTransport, getTodaysPuzzle, rpc } = vi.hoisted(() => ({
  createGatewayTransport: vi.fn(() => ({ call: vi.fn() })),
  getTodaysPuzzle: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(),
    rpc,
    auth: {
      getUser: vi.fn(),
      getSession: vi.fn(),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      signOut: vi.fn(),
    },
  },
}));

vi.mock("@/lib/socialTransport", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/socialTransport")>()),
  createGatewayTransport,
}));

vi.mock("@/lib/puzzles", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/puzzles")>()),
  getTodaysPuzzle,
}));

const ROOT = path.resolve(__dirname, "..", "..");

const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Every route in App, in order, without rendering it: App is one tree of elements. */
function routePaths(node: ReactNode): string[] {
  const paths: string[] = [];
  Children.forEach(node, (child) => {
    if (!isValidElement(child)) return;
    const { path: routePath, children } = child.props as { path?: unknown; children?: ReactNode };
    if (typeof routePath === "string") paths.push(routePath);
    paths.push(...routePaths(children));
  });
  return paths;
}

async function appRoutes(flag: string): Promise<string[]> {
  vi.resetModules();
  vi.stubEnv("VITE_SHARED_SOCIAL", flag);
  const { default: App } = await import("@/App");
  return routePaths((App as () => ReactNode)());
}

const ROUTES_TODAY = [
  "/",
  "/admin",
  "/archive",
  "/archive/:puzzleId",
  "/free/:puzzleId",
  "/mini",
  "/mini/archive",
  "/mini/archive/:puzzleId",
  "/beta",
  "/beta/:puzzleId",
  "/create",
  "/p/:shortCode",
  "/custom/:shareId",
  "/creator/:publicSlug",
  "/favorites",
  "/__fixtures/community",
  "/__fixtures/mini",
  "/__fixtures/lucky-bot",
  "/auth/callback",
  "/privacy",
  "/terms",
  "/how-to-play",
  "*",
];

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

const menu = (props = {}) => (
  <MemoryRouter>
    <SettingsModal open onClose={vi.fn()} settings={loadSettings()} onSettingsChange={vi.fn()} showMenuLinks {...props} />
    <Where />
  </MemoryRouter>
);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the flag", () => {
  it("says what socialMode says, for every value", async () => {
    const { socialMode } = await import("@/social/rainbowAdapter");
    for (const flag of ["beta", "mock", "off", "", "BETA", " beta", "true", undefined, null, 1]) {
      for (const PROD of [true, false]) {
        expect(socialBetaOn(flag)).toBe(socialMode({ VITE_SHARED_SOCIAL: flag, PROD }) === "beta");
      }
    }
  });

  it("reads the same value as the adapter by default", () => {
    vi.stubEnv("VITE_SHARED_SOCIAL", "beta");
    expect(socialBetaOn()).toBe(true);
    vi.stubEnv("VITE_SHARED_SOCIAL", "mock");
    expect(socialBetaOn()).toBe(false);
  });
});

describe("flag off", () => {
  it("leaves App's route list exactly as it was", async () => {
    expect(await appRoutes("")).toEqual(ROUTES_TODAY);
    expect(await appRoutes("mock")).toEqual(ROUTES_TODAY);
  }, 60000);

  it("leaves the Settings menu without Friends & Groups", () => {
    render(menu());
    expect(screen.queryByRole("button", { name: "Friends & Groups" })).toBeNull();
  });
});

describe("beta", () => {
  it("adds /friends and /join/:code, and nothing else", async () => {
    const routes = await appRoutes("beta");
    expect(routes.filter((route) => !ROUTES_TODAY.includes(route))).toEqual(["/friends", "/join/:code"]);
    expect(routes.filter((route) => ROUTES_TODAY.includes(route))).toEqual(ROUTES_TODAY);
  }, 60000);

  it("offers Friends & Groups in the Settings menu, which opens /friends", () => {
    vi.stubEnv("VITE_SHARED_SOCIAL", "beta");
    const onClose = vi.fn();
    render(menu({ onClose }));
    fireEvent.click(screen.getByRole("button", { name: "Friends & Groups" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("where")).toHaveTextContent("/friends");
  });

  it("offers Edit profile to someone signed in, which opens the editor on /friends", () => {
    vi.stubEnv("VITE_SHARED_SOCIAL", "beta");
    render(menu({ user: { id: "u1", email: null } }));
    fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/friends");
  });

  it("offers no Edit profile to a guest, or with the flag off", () => {
    vi.stubEnv("VITE_SHARED_SOCIAL", "beta");
    const { unmount } = render(menu());
    expect(screen.queryByRole("button", { name: "Edit profile" })).toBeNull();
    unmount();
    vi.stubEnv("VITE_SHARED_SOCIAL", "");
    render(menu({ user: { id: "u1", email: null } }));
    expect(screen.queryByRole("button", { name: "Edit profile" })).toBeNull();
  });

  it("still lets a page choose where the row goes", () => {
    vi.stubEnv("VITE_SHARED_SOCIAL", "beta");
    const onOpenSocial = vi.fn();
    render(menu({ onOpenSocial }));
    fireEvent.click(screen.getByRole("button", { name: "Friends & Groups" }));
    expect(onOpenSocial).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("where")).toHaveTextContent("/");
  });
});

describe("the main chunk", () => {
  it("App and the Settings menu statically import the flag and nothing else that is social", () => {
    for (const file of ["src/App.tsx", "src/components/SettingsModal.tsx"]) {
      const imports = read(file).match(/^import .*$/gm) ?? [];
      expect(imports.filter((line) => /social|account\//i.test(line))).toEqual(['import { socialBetaOn } from "@/components/social/socialFlag";']);
    }
  });

  it("the flag imports nothing, so it brings nothing with it", () => {
    expect(read("src/components/social/socialFlag.ts")).not.toMatch(/^import /m);
  });

  it("the two pages are loaded lazily", () => {
    const app = read("src/App.tsx");
    expect(app).toContain('lazy(() => import("./pages/Friends.tsx"))');
    expect(app).toContain('lazy(() => import("./pages/Join.tsx"))');
  });
});

describe("the app's own code", () => {
  it("never imports the demos", () => {
    const sources = walk(path.join(ROOT, "src")).filter((file) => /\.tsx?$/.test(file));
    expect(sources.length).toBeGreaterThan(10);
    expect(sources.filter((file) => /(from\s+|import\()["'][^"']*demo\//.test(readFileSync(file, "utf8")))).toEqual([]);
  });
});

describe("the real client", () => {
  async function fresh() {
    vi.resetModules();
    createGatewayTransport.mockClear();
    getTodaysPuzzle.mockReset();
    vi.stubEnv("VITE_SHARED_SOCIAL", "beta");
    vi.stubEnv("VITE_SUPABASE_URL", "http://supabase.test");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "publishable");
    vi.stubEnv("VITE_PLATFORM_DISCOVERY_URL", "http://discovery.test");
    return (await import("@/components/social/appSocial")).appSocial;
  }

  it("is built once, from the same two values as the Supabase client", async () => {
    const appSocial = await fresh();
    const first = appSocial();
    expect(appSocial()).toBe(first);
    expect(createGatewayTransport).toHaveBeenCalledTimes(1);
    expect(createGatewayTransport).toHaveBeenCalledWith({ baseUrl: "http://supabase.test", publishableKey: "publishable" });
  }, 30000);

  it("links an invitation to /join, with the real code", async () => {
    const appSocial = await fresh();
    expect(appSocial().api.linkUrl("abc123abc123")).toBe(`${location.origin}/join/abc123abc123`);
  }, 30000);

  it("asks for today's full daily once, and asks again after a lookup that found none", async () => {
    const appSocial = await fresh();
    const { api } = appSocial();
    getTodaysPuzzle.mockResolvedValueOnce(null);
    expect(await api.puzzleId()).toBeNull();
    await Promise.resolve();
    getTodaysPuzzle.mockResolvedValueOnce({ id: "puzzle-1" });
    expect(await api.puzzleId()).toBe("puzzle-1");
    expect(await api.puzzleId()).toBe("puzzle-1");
    expect(getTodaysPuzzle).toHaveBeenCalledTimes(2);
    expect(getTodaysPuzzle).toHaveBeenCalledWith("full");
  }, 30000);

  it("treats a lookup that fails as no puzzle", async () => {
    const appSocial = await fresh();
    getTodaysPuzzle.mockRejectedValueOnce(new Error("down"));
    expect(await appSocial().api.puzzleId()).toBeNull();
  }, 30000);

  it("holds through a real re-check, and lets go as soon as it fails at ensure_account", async () => {
    const appSocial = await fresh();
    const { source } = appSocial();
    const { ensureAccount } = await import("@/lib/platformSignIn");
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ access_token: "token", user: { id: "u1" } }));
    rpc.mockReset();

    rpc.mockResolvedValueOnce({ data: [{ outcome: "ok", user_id: "u1", global_user_id: "user_1", email: null, created_at: "2026-01-01T00:00:00.000Z" }], error: null });
    await ensureAccount();
    const signedIn = reconcileSession(START, source.read());
    expect(signedIn.view.kind).toBe("signed-in");

    let finish: (answer: unknown) => void = () => undefined;
    rpc.mockReturnValueOnce(new Promise((resolve) => {
      finish = resolve;
    }));
    const recheck = ensureAccount();
    expect(source.read()).toMatchObject({ state: "checking", checkRunning: true });
    const held = reconcileSession(signedIn, source.read());
    expect(sessionKey(held.view)).toBe(sessionKey(signedIn.view));

    finish({ data: null, error: { message: "down" } });
    await recheck;
    expect(source.read()).toMatchObject({ state: "checking", checkRunning: false, accountId: "u1" });
    expect(sessionKey(reconcileSession(held, source.read()).view)).toBe("checking");

    localStorage.removeItem(AUTH_STORAGE_KEY);
  }, 30000);
});
