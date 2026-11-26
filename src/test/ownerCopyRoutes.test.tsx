import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import CreatePuzzle from "@/pages/CreatePuzzle";
import MyPuzzles from "@/pages/MyPuzzles";
import { draftFromSource } from "@/lib/builder/copyDraft";
import { CREATOR_DRAFT_KEY, encodeDraft, saveNewCopyDraft } from "@/lib/builder/creatorDraft";

const auth = vi.hoisted(() => ({
  id: null as string | null,
  listeners: new Set<(event: string, session: unknown) => void>(),
  session() { return this.id ? { user: { id: this.id }, access_token: "fixture-only" } : null; },
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (listener: (event: string, session: unknown) => void) => {
        auth.listeners.add(listener);
        queueMicrotask(() => { if (auth.listeners.has(listener)) listener("INITIAL_SESSION", auth.session()); });
        return { data: { subscription: { unsubscribe: () => auth.listeners.delete(listener) } } };
      },
      getSession: async () => ({ data: { session: auth.session() } }),
    },
  },
}));
vi.mock("@/lib/customPuzzles", () => ({
  listMyPuzzles: async () => ({ items: [], total: 0, hasMore: false }),
  MAX_PUZZLE_TITLE: 100,
  createCustomPuzzle: vi.fn(), getMyPuzzleSource: vi.fn(), renameMyPuzzle: vi.fn(),
  setCommunityListing: vi.fn(), setCustomPuzzleCover: vi.fn(),
}));
vi.mock("@/components/MinimalHeader", () => ({ MinimalHeader: () => null }));
vi.mock("@/components/community/CommunityHeader", () => ({ CommunityHeader: () => null }));
vi.mock("@/components/SiteFooter", () => ({ SiteFooter: () => null }));

const one = "00000000-0000-4000-8000-000000000001";
const two = "00000000-0000-4000-8000-000000000002";
const changeAccount = (id: string | null) => {
  auth.id = id;
  act(() => { for (const listener of auth.listeners) listener(id ? "SIGNED_IN" : "SIGNED_OUT", auth.session()); });
};
function prepare() {
  localStorage.clear();
  auth.id = one;
  const groups = [["ALTO", "BASS", "SOPRANO", "TENOR"], ["BALLAD", "HYMN", "LULLABY", "SHANTY"], ["CASSETTE", "RECORD", "REEL", "VINYL"], ["ENCORE", "GIG", "SETLIST", "TOUR"]];
  const original = draftFromSource({ title: "Fictional Draft", creatorName: "Puzzle Tester", visibility: "private", content: {
    mode: "classic", groups: groups.map((words, i) => ({ category: `Group ${i+1}`, words })), word_order: groups.flat(),
  } });
  const slot = saveNewCopyDraft(localStorage, original, one);
  localStorage.setItem(CREATOR_DRAFT_KEY, encodeDraft({ ...original, title: "Separate draft" }));
  Object.defineProperty(navigator, "locks", { configurable: true, value: {
    request: async (_key: string, _options: object, callback: (lock: object) => unknown) => callback({}),
  } });
  return slot;
}
function renderAt(url: string) {
  const router = createMemoryRouter([{path:"/create", element: <CreatePuzzle />}, {path:"/my-puzzles", element: <MyPuzzles />}], {initialEntries:[url]});
  const view = render(<HelmetProvider><RouterProvider router={router} /></HelmetProvider>);
  return { router, ...view };
}
afterEach(() => { auth.id = null; localStorage.clear(); });

it("remounts the editor on an account change and keeps the separate draft", async () => {
  const slot = prepare();
  const { unmount } = renderAt(`/create?draft=${slot}`);
  await waitFor(() => expect(screen.getByLabelText("Puzzle Title")).toHaveValue("Copy of Fictional Draft"));
  changeAccount(two);
  expect(await screen.findByTestId("copy-missing")).toBeVisible();
  expect(screen.queryByLabelText("Puzzle Title")).not.toBeInTheDocument();
  changeAccount(one);
  await waitFor(() => expect(screen.getByLabelText("Puzzle Title")).toHaveValue("Copy of Fictional Draft"));
  changeAccount(null);
  expect(screen.getByTestId("copy-missing")).toBeVisible();
  unmount();
  renderAt("/create");
  await waitFor(() => expect(screen.getByLabelText("Puzzle Title")).toHaveValue("Separate draft"));
  expect(screen.queryByText("Copy of Fictional Draft")).not.toBeInTheDocument();
});

it("shows only the current account’s saved copies in My Puzzles", async () => {
  prepare();
  renderAt("/my-puzzles");
  expect(await screen.findByText("Copy of Fictional Draft")).toBeVisible();
  changeAccount(two);
  expect(screen.queryByText("Copy of Fictional Draft")).not.toBeInTheDocument();
  changeAccount(one);
  expect(await screen.findByText("Copy of Fictional Draft")).toBeVisible();
});
