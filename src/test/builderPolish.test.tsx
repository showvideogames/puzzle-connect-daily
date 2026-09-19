/**
 * Builder polish shared by Admin and /create: category drag-reorder, Rainbow
 * default, Start Over, live preview header and full-colour category cards.
 */
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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

import { useBuilderForm } from "@/hooks/useBuilderForm";
import CreatePuzzle from "@/pages/CreatePuzzle";
import { STYLE_OPTIONS } from "@/components/builder/styleOptions";

const WORDS = [
  ["Blue", "Green", "Red", "Yellow"],
  ["Battery", "Hood", "Tire", "Trunk"],
  ["Houston", "Mars", "Mercury", "Swift"],
  ["Bird", "Dog", "Tree", "White"],
];

function filled() {
  const view = renderHook(() => useBuilderForm());
  act(() => {
    WORDS.forEach((w, i) => {
      view.result.current.updateCategoryName(i, `Cat ${i}`);
      view.result.current.updateAnswersRaw(i, w.join(", "));
      view.result.current.updateHintWord(i, `hint${i}`);
    });
  });
  return view;
}

describe("category drag-and-drop ordering (moveGroup)", () => {
  it("moves content, reassigns difficulty by slot, and keeps answer identity", () => {
    const { result } = filled();
    const idsBefore = result.current.groups.map((g) => g.answers.map((a) => a.id));
    const poolBefore = result.current.groups.map((g) => g.poolIds);
    const boardBefore = [...result.current.wordOrderIds];

    act(() => result.current.moveGroup(0, 2)); // Cat 0 (was yellow) -> third slot (blue)

    expect(result.current.groups.map((g) => g.category)).toEqual(["Cat 1", "Cat 2", "Cat 0", "Cat 3"]);
    // Position defines difficulty/colour: content adopts the destination's.
    expect(result.current.groups.map((g) => g.difficulty)).toEqual([1, 2, 3, 4]);
    expect(result.current.groups[2].answersRaw).toBe("Blue, Green, Red, Yellow");
    // Answer identities travel with their category, untouched.
    expect(result.current.groups[2].answers.map((a) => a.id)).toEqual(idsBefore[0]);
    expect(result.current.groups[2].poolIds).toEqual(poolBefore[0]);
    expect(result.current.groups[0].answers.map((a) => a.id)).toEqual(idsBefore[1]);
    expect(result.current.groups[2].hintWord).toBe("hint0");
    // Board placement is keyed by answer id: not disturbed at all.
    expect(result.current.wordOrderIds).toEqual(boardBefore);
    // ...and the tile text at each board position is unchanged.
    expect(result.current.textsFor(result.current.wordOrderIds)).toEqual(
      boardBefore.map((id) => result.current.slotById.get(id)!.text)
    );
  });

  it("a Rainbow selection follows its category, and the Rainbow display order is untouched", () => {
    const { result } = filled();
    const pick = (g: number, i: number) => result.current.selectRainbowAnswer(g, result.current.groups[g].answers[i].id);
    act(() => {
      pick(0, 1); // Green
      pick(1, 2); // Tire
      pick(2, 0); // Houston
      pick(3, 3); // White
    });
    const selectedText = () =>
      result.current.rainbowHerringIds.map((id) => result.current.slotById.get(id!)?.text);
    expect(selectedText()).toEqual(["Green", "Tire", "Houston", "White"]);
    const displayBefore = [...result.current.rainbowWordOrderIds];

    act(() => result.current.moveGroup(3, 0)); // White's category to the top

    expect(result.current.groups.map((g) => g.category)).toEqual(["Cat 3", "Cat 0", "Cat 1", "Cat 2"]);
    expect(selectedText()).toEqual(["White", "Green", "Tire", "Houston"]);
    expect(result.current.rainbowWordOrderIds).toEqual(displayBefore);
  });

  it("tombstones and later edits still inherit ids correctly after a move", () => {
    const { result } = filled();
    act(() => result.current.updateAnswersRaw(1, "Battery, Hood, Tire")); // drop Trunk -> tombstone
    const tomb = result.current.groups[1].tombstones.map((t) => t.id);
    expect(tomb).toHaveLength(1);

    act(() => result.current.moveGroup(1, 3));
    expect(result.current.groups[3].tombstones.map((t) => t.id)).toEqual(tomb);

    act(() => result.current.updateAnswersRaw(3, "Battery, Hood, Tire, Boot"));
    // The new answer inherits the vacated id (and so its board position).
    expect(result.current.groups[3].answers[3].id).toBe(tomb[0]);
    expect(result.current.slotById.get(tomb[0])!.text).toBe("Boot");
  });

  it("ignores no-op and out-of-range moves", () => {
    const { result } = filled();
    const before = result.current.groups.map((g) => g.category);
    act(() => {
      result.current.moveGroup(2, 2);
      result.current.moveGroup(-1, 2);
      result.current.moveGroup(0, 9);
    });
    expect(result.current.groups.map((g) => g.category)).toEqual(before);
  });
});

describe("style default and loading", () => {
  const loadInput = (over = {}) => ({
    groups: WORDS.map((w, i) => ({ category: `C${i}`, words: w, difficulty: (i + 1) as 1 | 2 | 3 | 4, hintWord: null })),
    wordOrder: null,
    rainbowHerring: null,
    rainbowCategoryName: "",
    rainbowHintWord: "",
    theme: "",
    alphabetizeCompleted: true,
    ...over,
  });

  it("a brand-new puzzle defaults to Rainbow", () => {
    const { result } = renderHook(() => useBuilderForm());
    expect(result.current.style).toBe("rainbow");
  });

  it("loading an existing puzzle keeps the stored style, and never falls back to the default", () => {
    const { result } = renderHook(() => useBuilderForm());
    act(() => result.current.load(loadInput({ style: "classic" })));
    expect(result.current.style).toBe("classic");
    // A saved draft with no stored style leaves the current style alone.
    act(() => result.current.load(loadInput()));
    expect(result.current.style).toBe("classic");
    act(() => result.current.setStyle("rainbow"));
    act(() => result.current.load(loadInput({ style: "classic" })));
    expect(result.current.style).toBe("classic");
  });

  it("style options list Rainbow first, then Classic, with the agreed descriptions", () => {
    expect(STYLE_OPTIONS.map((o) => o.label)).toEqual(["Rainbow", "Classic"]);
    expect(STYLE_OPTIONS[0].description).toBe(
      "Four categories plus a fifth Rainbow category made from one answer in each category."
    );
    expect(STYLE_OPTIONS[1].description).toBe("Four standard categories with no Rainbow category.");
  });
});

describe("builder reset (Start Over) restores every new-puzzle default", () => {
  it("clears names, answers, hints, Rainbow, order and re-randomizes the board", () => {
    const { result } = filled();
    act(() => {
      result.current.setStyle("classic");
      result.current.setAlphabetizeCompleted(false);
      result.current.setRainbowCategoryName("Mixed");
      result.current.setRainbowHintWord("rh");
      result.current.setTheme("flag");
      result.current.selectRainbowAnswer(0, result.current.groups[0].answers[0].id);
    });
    const oldIds = new Set(result.current.allSlots.map((s) => s.id));

    act(() => result.current.reset());

    expect(result.current.groups.every((g) => g.category === "" && g.answersRaw === "" && g.hintWord === "")).toBe(true);
    expect(result.current.nonBlankSlots).toHaveLength(0);
    expect(result.current.groups.map((g) => g.difficulty)).toEqual([1, 2, 3, 4]);
    expect(result.current.groups.every((g) => g.tombstones.length === 0)).toBe(true);
    expect(result.current.rainbowHerringIds).toEqual([null, null, null, null]);
    expect(result.current.rainbowWordOrderIds).toEqual([]);
    expect(result.current.rainbowCategoryName).toBe("");
    expect(result.current.rainbowHintWord).toBe("");
    expect(result.current.theme).toBe("");
    expect(result.current.style).toBe("rainbow");
    expect(result.current.alphabetizeCompleted).toBe(true);
    // A fresh 16-position board with brand-new ids (nothing carried over).
    expect(result.current.wordOrderIds).toHaveLength(16);
    expect(new Set(result.current.wordOrderIds).size).toBe(16);
    expect(result.current.wordOrderIds.some((id) => oldIds.has(id))).toBe(false);
  });

  it("gives a different random opening arrangement each time", () => {
    const { result } = renderHook(() => useBuilderForm());
    const layouts = new Set<string>();
    for (let i = 0; i < 4; i++) {
      act(() => result.current.reset());
      // Compare by group membership per position (ids are new every reset).
      layouts.add(
        result.current.wordOrderIds
          .map((id) => result.current.groups.findIndex((g) => g.poolIds.includes(id)))
          .join("")
      );
    }
    expect(layouts.size).toBeGreaterThan(1);
  });
});

// ── the /create page (shared components) ───────────────────────────────────
function renderCreate() {
  return render(
    <HelmetProvider>
      <MemoryRouter>
        <CreatePuzzle />
      </MemoryRouter>
    </HelmetProvider>
  );
}

const cardOrder = () =>
  screen.getAllByTestId(/^category-card-/).map((c) => (within(c).getAllByRole("textbox")[0] as HTMLInputElement).value);

function fillPage() {
  const cards = screen.getAllByTestId(/^category-card-/);
  cards.forEach((card, i) => {
    const [name, , answers, hint] = within(card).getAllByRole("textbox") as HTMLInputElement[];
    fireEvent.change(name, { target: { value: `Cat ${i}` } });
    fireEvent.change(answers, { target: { value: WORDS[i].join(", ") } });
    fireEvent.change(hint, { target: { value: `hint${i}` } });
  });
}

describe("/create builder page", () => {
  it("starts on Rainbow, listed first", () => {
    renderCreate();
    const styleGroup = screen.getByRole("group", { name: "Puzzle style" });
    const buttons = within(styleGroup).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Rainbow", "Classic"]);
    expect(buttons[0].getAttribute("aria-pressed")).toBe("true");
    expect(buttons[1].getAttribute("aria-pressed")).toBe("false");
  });

  it("shows the style description on hover and focus, and as visible helper text for touch", () => {
    renderCreate();
    const styleGroup = screen.getByRole("group", { name: "Puzzle style" });
    const [rainbow, classic] = within(styleGroup).getAllByRole("button");
    const helper = () => document.getElementById("style-description")!.textContent;
    // Nothing hovered: the selected option is described (visible without hover).
    expect(helper()).toBe(STYLE_OPTIONS[0].description);
    fireEvent.mouseEnter(classic);
    expect(helper()).toBe(STYLE_OPTIONS[1].description);
    fireEvent.mouseLeave(classic);
    fireEvent.focus(classic);
    expect(helper()).toBe(STYLE_OPTIONS[1].description);
    fireEvent.blur(classic);
    expect(helper()).toBe(STYLE_OPTIONS[0].description);
    expect(rainbow.getAttribute("title")).toBe(STYLE_OPTIONS[0].description);
    expect(classic.getAttribute("title")).toBe(STYLE_OPTIONS[1].description);
  });

  it("the preview header shows the defaults, then updates live with title, designer and style", () => {
    renderCreate();
    expect(screen.getByTestId("preview-title").textContent).toBe("My Custom Puzzle");
    expect(screen.getByTestId("preview-byline").textContent).toBe("Created by you");
    const header = screen.getByTestId("preview-header");
    expect(within(header).getByRole("button", { name: /rainbow puzzle mode/i })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Puzzle Title"), { target: { value: "Golf Words" } });
    fireEvent.change(screen.getByLabelText(/Your Name/), { target: { value: "Sam West" } });
    expect(screen.getByTestId("preview-title").textContent).toBe("Golf Words");
    expect(screen.getByTestId("preview-byline").textContent).toBe("Created by Sam West");

    fireEvent.click(within(screen.getByRole("group", { name: "Puzzle style" })).getByRole("button", { name: "Classic" }));
    expect(within(header).getByRole("button", { name: /4 groups puzzle mode/i })).toBeTruthy();

    // Blank again -> back to the defaults.
    fireEvent.change(screen.getByLabelText("Puzzle Title"), { target: { value: "   " } });
    fireEvent.change(screen.getByLabelText(/Your Name/), { target: { value: "" } });
    expect(screen.getByTestId("preview-title").textContent).toBe("My Custom Puzzle");
    expect(screen.getByTestId("preview-byline").textContent).toBe("Created by you");
  });

  it("each category card is filled with its category colour, with solid Ink text and light inputs", () => {
    renderCreate();
    [1, 2, 3, 4].forEach((n) => {
      const card = screen.getByTestId(`category-card-${n}`);
      expect(card.className).toContain(`bg-group-${n}`);
      expect(card.className).toContain("text-[#292825]");
      expect(card.className).not.toMatch(/(^|\s)border(\s|$)/);
      expect(card.className).not.toMatch(/opacity/);
      within(card).getAllByRole("textbox").forEach((input) => {
        expect(input.className).toContain("bg-[#FFFDF8]");
      });
    });
  });

  it("only the six-dot handle is draggable, never the card or its inputs", () => {
    renderCreate();
    const card = screen.getByTestId("category-card-1");
    expect(card.getAttribute("draggable")).toBeNull();
    expect(card.parentElement!.getAttribute("draggable")).toBeNull();
    within(card).getAllByRole("textbox").forEach((i) => expect(i.getAttribute("draggable")).toBeNull());
    const handles = screen.getAllByRole("button", { name: /Reorder .* category/ });
    expect(handles).toHaveLength(4);
    handles.forEach((h) => expect(h.getAttribute("draggable")).toBe("true"));
  });

  it("reorders by keyboard (arrow keys on the handle) and content adopts the destination colour", () => {
    renderCreate();
    fillPage();
    expect(cardOrder()).toEqual(["Cat 0", "Cat 1", "Cat 2", "Cat 3"]);
    const handle = () => screen.getByRole("button", { name: /Reorder Yellow category/ });
    fireEvent.keyDown(handle(), { key: "ArrowDown" });
    expect(cardOrder()).toEqual(["Cat 1", "Cat 0", "Cat 2", "Cat 3"]);
    // Cards keep their slot colours; the moved content is now in the Green slot.
    const green = screen.getByTestId("category-card-2");
    expect((within(green).getAllByRole("textbox")[0] as HTMLInputElement).value).toBe("Cat 0");
    expect(within(green).getByText(/Green · Easy/)).toBeTruthy();
    // Edge: moving the top card up does nothing.
    fireEvent.keyDown(screen.getByRole("button", { name: /Reorder Yellow category/ }), { key: "ArrowUp" });
    expect(cardOrder()).toEqual(["Cat 1", "Cat 0", "Cat 2", "Cat 3"]);
  });

  it("reorders by mouse drag on the handle", () => {
    renderCreate();
    fillPage();
    const handle = screen.getByRole("button", { name: /Reorder Yellow category/ });
    const target = screen.getByTestId("category-card-3").parentElement!;
    fireEvent.dragStart(handle, { dataTransfer: { setData: () => {}, setDragImage: () => {}, effectAllowed: "" } });
    fireEvent.dragOver(target, { dataTransfer: {} });
    fireEvent.drop(target, { dataTransfer: {} });
    expect(cardOrder()).toEqual(["Cat 1", "Cat 2", "Cat 0", "Cat 3"]);
  });

  it("Start Over asks first, then clears everything but the designer name", async () => {
    renderCreate();
    fillPage();
    fireEvent.change(screen.getByLabelText("Puzzle Title"), { target: { value: "Golf Words" } });
    fireEvent.change(screen.getByLabelText(/Your Name/), { target: { value: "Sam West" } });
    fireEvent.click(within(screen.getByRole("group", { name: "Puzzle style" })).getByRole("button", { name: "Classic" }));
    fireEvent.click(screen.getByLabelText(/Alphabetize answers/));

    fireEvent.click(screen.getByRole("button", { name: "Start Over" }));
    // Confirmation shown; nothing cleared yet.
    expect(await screen.findByText("Start over?")).toBeTruthy();
    expect((screen.getByLabelText("Puzzle Title") as HTMLInputElement).value).toBe("Golf Words");
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect((screen.getByLabelText("Puzzle Title") as HTMLInputElement).value).toBe("Golf Words");
    expect(cardOrder()).toEqual(["Cat 0", "Cat 1", "Cat 2", "Cat 3"]);

    fireEvent.click(screen.getByRole("button", { name: "Start Over" }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes, start over" }));

    expect((screen.getByLabelText("Puzzle Title") as HTMLInputElement).value).toBe("");
    // Designer name preserved.
    expect((screen.getByLabelText(/Your Name/) as HTMLInputElement).value).toBe("Sam West");
    expect(screen.getByTestId("preview-byline").textContent).toBe("Created by Sam West");
    expect(screen.getByTestId("preview-title").textContent).toBe("My Custom Puzzle");
    for (const card of screen.getAllByTestId(/^category-card-/)) {
      (within(card).getAllByRole("textbox") as HTMLInputElement[]).forEach((i) => expect(i.value).toBe(""));
    }
    // Defaults restored: Rainbow, alphabetize on, 16 blank starting positions.
    expect(
      within(screen.getByRole("group", { name: "Puzzle style" })).getByRole("button", { name: "Rainbow" }).getAttribute("aria-pressed")
    ).toBe("true");
    expect((screen.getByLabelText(/Alphabetize answers/) as HTMLInputElement).checked).toBe(true);
  });
});
