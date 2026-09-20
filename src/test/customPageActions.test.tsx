/**
 * Custom puzzle page: personal vs. puzzle stats, and the bottom CTA.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { FakeSupabase } from "./fakeSupabase";

vi.setConfig({ testTimeout: 30000 });

const db = new FakeSupabase();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => db.from(t),
    rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a),
    auth: {
      getUser: () => db.auth.getUser(),
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signOut: async () => {},
    },
  },
}));
vi.mock("canvas-confetti", () => ({ default: () => {} }));
vi.mock("@/lib/sounds", () => ({ playRainbowSound: () => {}, playGiftOpenSound: () => {} }));
vi.mock("@/lib/haptics", () => ({ vibrateSuccess: () => {}, vibrateError: () => {}, vibrateCelebration: () => {} }));
vi.mock("@/lib/analytics", () => ({ trackEvent: () => {} }));

import { createCustomPuzzle, type CreateCustomPuzzleInput } from "@/lib/customPuzzles";
import { loadProgress } from "@/lib/gameProgress";
import { CustomStatsModal } from "@/components/CustomStatsModal";
import CustomPuzzle from "@/pages/CustomPuzzle";

const GROUPS = [
  ["BLUE", "GREEN", "RED", "YELLOW"],
  ["BATTERY", "HOOD", "TIRE", "TRUNK"],
  ["HOUSTON", "MARS", "MERCURY", "SWIFT"],
  ["BIRD", "DOG", "TREE", "WHITE"],
];
const INPUT: CreateCustomPuzzleInput = {
  creatorName: "Sam West",
  title: "Golf Words",
  visibility: "public",
  content: {
    mode: "classic",
    groups: GROUPS.map((words, i) => ({ category: `Cat ${i}`, words, hintWord: null })),
    wordOrder: GROUPS.flat(),
    rainbowHerring: null,
    rainbowCategoryName: null,
    rainbowHintWord: null,
    alphabetizeCompleted: true,
  },
};

function reduceMotion() {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => {},
    }),
  });
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 25; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

async function mintIdentity() {
  const { data } = await db.rpc("create_device_identity");
  const id = (Array.isArray(data) ? data[0] : data) as { device_id: string; device_token: string };
  localStorage.setItem("rc-device-id", id.device_id);
  localStorage.setItem("rc-device-token", id.device_token);
}

beforeEach(async () => {
  reduceMotion();
  for (const t of ["custom_puzzles", "custom_puzzle_results", "custom_puzzle_stats", "device_identities"]) db.tables[t] = [];
  localStorage.clear();
  sessionStorage.clear();
  db.signIn(null);
  await mintIdentity();
  db.writeLog = [];
  window.scrollTo = () => {};
});

async function renderPage() {
  const { shareId } = await createCustomPuzzle(INPUT);
  const view = render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[`/custom/${shareId}`]}>
        <Routes>
          <Route path="/custom/:shareId" element={<CustomPuzzle />} />
          <Route path="/create" element={<div>CREATE PAGE</div>} />
        </Routes>
      </MemoryRouter>
    </HelmetProvider>
  );
  await screen.findByText("Select four words that share a connection!");
  return { shareId, view };
}

const tile = (word: string) => document.querySelector(`[data-word="${word}"] button`) as HTMLButtonElement;

async function playGroups(words: string[][]) {
  for (const g of words) {
    for (const w of g) await act(async () => { fireEvent.click(tile(w)); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^submit$/i })); });
    await settle();
  }
}

async function loseByGuessing() {
  const wrong = [
    [GROUPS[0][0], GROUPS[1][0], GROUPS[2][0], GROUPS[3][0]],
    [GROUPS[0][1], GROUPS[1][1], GROUPS[2][1], GROUPS[3][1]],
    [GROUPS[0][2], GROUPS[1][2], GROUPS[2][2], GROUPS[3][2]],
    [GROUPS[0][3], GROUPS[1][3], GROUPS[2][3], GROUPS[3][3]],
  ];
  for (const g of wrong) {
    for (const w of g) await act(async () => { fireEvent.click(tile(w)); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^submit$/i })); });
    await settle();
    // an incorrect guess leaves its tiles selected; clear before the next one
    const deselect = screen.queryByRole("button", { name: /deselect all/i });
    if (deselect) await act(async () => { fireEvent.click(deselect); });
  }
}

import { parseSupportUrl } from "@/lib/supportUrl";

describe("personal stats vs puzzle stats", () => {
  it("Puzzle Stats is on the page before play and opens the puzzle modal; it sits beside Favorite", async () => {
    await renderPage();
    const stats = screen.getByRole("button", { name: "Puzzle Stats" });
    const fav = screen.getByRole("button", { name: /^favorite/i });
    expect(stats.parentElement).toBe(screen.getByTestId("custom-action-row"));
    expect(fav.closest("[data-testid=custom-action-row]")).toBe(stats.parentElement);
    fireEvent.click(stats);
    expect(await screen.findByRole("dialog", { name: "Puzzle stats" })).toBeTruthy();
  });

  it("the global header stats button opens PERSONAL stats, never the puzzle's aggregate modal", async () => {
    await renderPage();
    fireEvent.click(screen.getByRole("button", { name: "My stats" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    expect(screen.queryByRole("dialog", { name: "Puzzle stats" })).toBeNull();
    expect(document.body.textContent).not.toContain("Completed Plays");
    expect(document.body.textContent).not.toContain("No completed plays yet");
  });

  it("post-game Results opens the same Puzzle stats modal, and Puzzle Stats stays on the page", async () => {
    await renderPage();
    await playGroups(GROUPS);
    expect(screen.getByRole("button", { name: "Puzzle Stats" })).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /^results$/i }));
    expect(await screen.findByRole("dialog", { name: "Puzzle stats" })).toBeTruthy();
  });
});

describe("bottom CTA", () => {
  it("Create Your Own routes internally to /create without a reload", async () => {
    await renderPage();
    const link = screen.getByRole("link", { name: "Create Your Own" });
    expect(link).toHaveAttribute("href", "/create");
    expect(link).not.toHaveAttribute("target");
    fireEvent.click(link);
    expect(await screen.findByText("CREATE PAGE")).toBeTruthy();
  });

  it("with no support URL there is no support action, dead link, or support sentence", async () => {
    vi.stubEnv("VITE_SUPPORT_URL", "");
    await renderPage();
    expect(screen.getByText("Enjoyed this puzzle?")).toBeTruthy();
    expect(screen.queryByText(/Keep the Puzzles Coming/)).toBeNull();
    expect(screen.queryByText(/Your support helps fund/)).toBeNull();
    expect(document.querySelector('a[href="#"]')).toBeNull();
    vi.unstubAllEnvs();
  });

  it("with a support URL it opens externally in a new tab with safe rel, and the copy has no coffee wording", async () => {
    vi.stubEnv("VITE_SUPPORT_URL", "https://example.com/support");
    await renderPage();
    const a = screen.getByRole("link", { name: /Keep the Puzzles Coming/ });
    expect(a).toHaveAttribute("href", "https://example.com/support");
    expect(a).toHaveAttribute("target", "_blank");
    expect(a.getAttribute("rel")).toContain("noopener");
    expect(a.getAttribute("rel")).toContain("noreferrer");
    expect(screen.getByText(/Your support helps fund new puzzles and future games/)).toBeTruthy();
    expect(screen.getByTestId("custom-cta").textContent?.toLowerCase()).not.toContain("coffee");
    vi.unstubAllEnvs();
  });

  it("the CTA sits below Results and Replay after completion", async () => {
    await renderPage();
    await playGroups(GROUPS);
    const replay = await screen.findByRole("button", { name: /^replay$/i });
    const cta = screen.getByTestId("custom-cta");
    expect(replay.compareDocumentPosition(cta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("only http(s) URLs are accepted as support URLs", () => {
    expect(parseSupportUrl(undefined)).toBeNull();
    expect(parseSupportUrl("  ")).toBeNull();
    expect(parseSupportUrl("#")).toBeNull();
    expect(parseSupportUrl("javascript:alert(1)")).toBeNull();
    expect(parseSupportUrl("not a url")).toBeNull();
    expect(parseSupportUrl("https://ko-fi.com/x")).toBe("https://ko-fi.com/x");
  });
});
