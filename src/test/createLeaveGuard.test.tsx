/**
 * /create now has the site header, whose links lead away from a puzzle that
 * isn't saved anywhere. With nothing entered they go straight there; with
 * anything entered they ask first, Keep editing keeps every field, and
 * Discard and leave goes. While the puzzle is being created they hold on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({}),
    rpc: async () => ({ data: null, error: null }),
    auth: {
      getUser: async () => ({ data: { user: null } }),
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: () => {} }));
// The header's Stats dialog reads the database; here only that it opens without leaving.
vi.mock("@/components/StatsModal", () => ({
  StatsModal: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="Stats" /> : null),
}));
const created = vi.hoisted(() => ({ answer: null as null | ((value: unknown) => void), fail: null as null | ((error: Error) => void) }));
vi.mock("@/lib/customPuzzles", async (original) => ({
  ...(await original<typeof import("@/lib/customPuzzles")>()),
  createCustomPuzzle: () => new Promise((resolve, reject) => { created.answer = resolve; created.fail = reject; }),
}));

import CreatePuzzle from "@/pages/CreatePuzzle";

const WORDS = [
  ["Blue", "Green", "Red", "Yellow"],
  ["Battery", "Hood", "Tire", "Trunk"],
  ["Houston", "Mars", "Mercury", "Swift"],
  ["Bird", "Dog", "Tree", "White"],
];

function Where() {
  const { pathname } = useLocation();
  return <p data-testid="where">{pathname}</p>;
}
function renderCreate() {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={["/create"]}>
        <Routes>
          <Route path="/create" element={<><CreatePuzzle /><Where /></>} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </HelmetProvider>
  );
}

const header = () => screen.getByTestId("app-header");
const where = () => screen.getByTestId("where").textContent;
const asking = () => screen.queryByRole("alertdialog", { name: "Leave without creating your puzzle?" });
const cards = () => screen.getAllByTestId(/^category-card-/);
const title = () => screen.getByLabelText("Puzzle Title") as HTMLInputElement;
const designer = () => screen.getByLabelText("Your Name (Designer)") as HTMLInputElement;
// Focus first, as a real click or Enter does, so focus can be checked after the question.
const press = (el: HTMLElement) => act(async () => { el.focus(); fireEvent.click(el); });

/** Every kind of field: title, designer, visibility, style, and each category's name, answers and hint. */
function fillEverything() {
  fireEvent.change(title(), { target: { value: "Weekend Mix" } });
  fireEvent.change(designer(), { target: { value: "Robin" } });
  fireEvent.click(screen.getByRole("button", { name: "private" }));
  fireEvent.click(within(screen.getByRole("group", { name: "Puzzle style" })).getByRole("button", { name: "Classic" }));
  cards().forEach((card, i) => {
    const [name, , answers, hint] = within(card).getAllByRole("textbox") as HTMLInputElement[];
    fireEvent.change(name, { target: { value: `Cat ${i}` } });
    fireEvent.change(answers, { target: { value: WORDS[i].join(", ") } });
    fireEvent.change(hint, { target: { value: `hint${i}` } });
  });
}
function expectEverythingKept() {
  expect(title().value).toBe("Weekend Mix");
  expect(designer().value).toBe("Robin");
  expect(screen.getByText("Private puzzles can only be played by people with the link.")).toBeInTheDocument();
  expect(within(screen.getByRole("group", { name: "Puzzle style" })).getByRole("button", { name: "Classic" })).toHaveAttribute("aria-pressed", "true");
  cards().forEach((card, i) => {
    const [name, , answers, hint] = within(card).getAllByRole("textbox") as HTMLInputElement[];
    expect(name.value).toBe(`Cat ${i}`);
    expect(answers.value).toBe(WORDS[i].join(", "));
    expect(hint.value).toBe(`hint${i}`);
  });
}

beforeEach(() => { created.answer = null; created.fail = null; });
afterEach(() => vi.restoreAllMocks());

describe("/create with the site header", () => {
  it("has the site header, and with nothing entered its links go straight there", async () => {
    renderCreate();
    expect(within(header()).getByRole("link", { name: "Home" })).toBeInTheDocument();
    expect(screen.getAllByRole("banner")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Create a Puzzle" })).toBeInTheDocument();
    await press(within(header()).getByRole("link", { name: "Puzzle archive" }));
    expect(where()).toBe("/archive");
    expect(asking()).toBeNull();
  });

  it("asks before leaving: Keep editing keeps every field and focus, Escape too, and asking again works", async () => {
    renderCreate();
    fillEverything();
    const home = within(header()).getByRole("link", { name: "Home" });
    await press(home);
    const question = await screen.findByRole("alertdialog", { name: "Leave without creating your puzzle?" });
    expect(question).toHaveTextContent("What you've entered isn't saved anywhere yet, so it will be lost.");
    await waitFor(() => expect(within(question).getByRole("button", { name: "Keep editing" })).toHaveFocus());
    fireEvent.click(within(question).getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(asking()).toBeNull());
    expect(where()).toBe("/create");
    expectEverythingKept();
    await waitFor(() => expect(home).toHaveFocus());

    await press(within(header()).getByRole("link", { name: "Puzzle archive" }));
    fireEvent.keyDown(await screen.findByRole("alertdialog"), { key: "Escape" });
    await waitFor(() => expect(asking()).toBeNull());
    expect(where()).toBe("/create");
    expectEverythingKept();
  });

  it("Discard and leave goes where the menu link pointed", async () => {
    renderCreate();
    fillEverything();
    const menu = within(header()).getByRole("button", { name: "Menu" });
    await press(menu);
    const drawer = await screen.findByRole("dialog", { name: "Menu" });
    await press(within(drawer).getByRole("link", { name: "Rainbow Mini" }));
    const question = await screen.findByRole("alertdialog", { name: "Leave without creating your puzzle?" });
    fireEvent.click(within(question).getByRole("button", { name: "Discard and leave" }));
    await waitFor(() => expect(where()).toBe("/mini"));
  });

  it("Keep editing after a menu link puts focus back on the menu button, and the drawer's Create a puzzle doesn't ask", async () => {
    renderCreate();
    fireEvent.change(title(), { target: { value: "Weekend Mix" } });
    const menu = within(header()).getByRole("button", { name: "Menu" });
    await press(menu);
    await press(within(await screen.findByRole("dialog", { name: "Menu" })).getByRole("link", { name: "Puzzle archive" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(asking()).toBeNull());
    await waitFor(() => expect(menu).toHaveFocus());
    expect(title().value).toBe("Weekend Mix");

    await press(menu);
    await press(within(await screen.findByRole("dialog", { name: "Menu" })).getByRole("link", { name: "Create a puzzle" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull());
    expect(asking()).toBeNull();
    expect(where()).toBe("/create");
    expect(title().value).toBe("Weekend Mix");
  });

  it("counts any one field as something to lose, and the header's dialogs open without asking", async () => {
    renderCreate();
    fireEvent.click(screen.getByRole("button", { name: "private" }));
    await press(within(header()).getByRole("button", { name: "My stats" }));
    expect(screen.getByRole("dialog", { name: "Stats" })).toBeInTheDocument();
    expect(asking()).toBeNull();
  });

  it("asks the browser before the tab leaves only while something is entered", () => {
    renderCreate();
    const leave = () => { const event = new Event("beforeunload", { cancelable: true }); dispatchEvent(event); return event.defaultPrevented; };
    expect(leave()).toBe(false);
    fireEvent.change(designer(), { target: { value: "Robin" } });
    expect(leave()).toBe(true);
  });

  it("holds on while the puzzle is being created, then the finished page leaves freely", async () => {
    renderCreate();
    fillEverything();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Create Game" })));
    expect(screen.getByRole("button", { name: "Creating…" })).toBeDisabled();
    await press(within(header()).getByRole("link", { name: "Home" }));
    const holding = await screen.findByRole("alertdialog", { name: "Still creating your puzzle" });
    expect(within(holding).queryByRole("button", { name: "Discard and leave" })).toBeNull();
    await act(async () => created.answer!({ shareId: "share-1", shortCode: "abc123" }));
    expect(await screen.findByRole("heading", { name: "Puzzle Created!" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(where()).toBe("/create");
    await press(within(header()).getByRole("link", { name: "Home" }));
    expect(where()).toBe("/");
  });

  it("if creating fails, the work stays and leaving asks the plain question", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderCreate();
    fillEverything();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Create Game" })));
    await press(within(header()).getByRole("link", { name: "Home" }));
    await screen.findByRole("alertdialog", { name: "Still creating your puzzle" });
    await act(async () => created.fail!(new Error("Network trouble.")));
    const question = await screen.findByRole("alertdialog", { name: "Leave without creating your puzzle?" });
    fireEvent.click(within(question).getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(asking()).toBeNull());
    expect(screen.getByRole("alert")).toHaveTextContent("Network trouble.");
    expectEverythingKept();
    expect(where()).toBe("/create");
  });
});
