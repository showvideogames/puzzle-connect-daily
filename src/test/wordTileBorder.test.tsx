// Pointer focus remains separate from submission selection and color annotations.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { WordTile } from "@/components/WordTile";
import { rainbowBarReserve } from "@/lib/rainbowWordFit";

function getButton(container: HTMLElement) {
  const btn = container.querySelector("button");
  if (!btn) throw new Error("tile button not found");
  return btn;
}

describe("WordTile pointer-click focus", () => {
  it("prevents the default mousedown focus so a click can't leave the tile focused", () => {
    const { container } = render(<WordTile word="PIE" isSelected={false} onClick={() => {}} />);
    const btn = getButton(container);
    const notCanceled = fireEvent.mouseDown(btn);
    // fireEvent returns false when a handler called preventDefault.
    expect(notCanceled).toBe(false);
  });

  it("still fires the click/selection handler after that mousedown", () => {
    const onClick = vi.fn();
    const { container } = render(<WordTile word="PIE" isSelected={false} onClick={onClick} />);
    const btn = getButton(container);
    fireEvent.mouseDown(btn);
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does NOT prevent default mousedown in arrangeTiles mode, so native drag can still start", () => {
    const { container } = render(
      <WordTile word="PIE" isSelected={false} onClick={() => {}} arrangeTiles draggable />
    );
    const btn = getButton(container);
    const notCanceled = fireEvent.mouseDown(btn);
    expect(notCanceled).toBe(true);
  });
});

describe("WordTile selection outline", () => {
  it.each([
    ["an unmarked ordinary selected tile renders none", { isSelected: true }, 0],
    ["a color-marked selected tile renders one", { isSelected: true, tileColor: "blue" }, 1],
    ["a rainbow selected tile renders one", { isSelected: true, isRainbow: true }, 1],
    ["a rainbow unselected tile renders none", { isSelected: false, isRainbow: true }, 0],
  ])("%s", (_name, props, count) => {
    const { container } = render(<WordTile word="PIE" onClick={() => {}} {...props} />);
    expect(container.querySelectorAll("[data-tile-selection]")).toHaveLength(count);
  });

  it("a lifted ordinary tile's outlines carry the same scale as its button", () => {
    const { container } = render(
      <WordTile word="PIE" isSelected tileColor="blue" isLifted onClick={() => {}} />
    );
    const scale = getButton(container).style.scale;
    expect(scale).toBeTruthy();
    for (const outline of ["[data-tile-mark]", "[data-tile-selection]"]) {
      expect(container.querySelector<HTMLElement>(outline)!.style.scale).toBe(scale);
    }
  });

  it("a lifted rainbow's outline scales with its button, and its bar lifts inside the button", () => {
    const { container } = render(
      <WordTile word="PIE" isSelected isRainbow tileColor="blue" isLifted onClick={() => {}} />
    );
    const button = getButton(container);
    expect(button.style.scale).toBeTruthy();
    expect(container.querySelector<HTMLElement>("[data-tile-selection]")!.style.scale).toBe(button.style.scale);
    // A scale of its own would compound with the button's.
    expect(button.querySelector<HTMLElement>("[data-tile-mark]")!.style.scale).toBeFalsy();
  });
});

describe("WordTile rainbow face", () => {
  const themed = { rainbowGradient: "linear-gradient(red, blue)" };

  it.each([
    ["animated", {}],
    ["animated marked", { tileColor: "green" }],
    ["static", { rainbowAnimated: false }],
    ["static marked", { rainbowAnimated: false, tileColor: "green" }],
    ["themed", themed],
  ])("selecting a %s tile leaves the button's classes identical", (_name, props) => {
    const tile = { word: "PIE", isRainbow: true, onClick: () => {}, ...props };
    const { container, rerender } = render(<WordTile {...tile} isSelected={false} />);
    const unselected = getButton(container).className;
    rerender(<WordTile {...tile} isSelected />);
    expect(getButton(container).getAttribute("aria-pressed")).toBe("true");
    expect(getButton(container).className).toBe(unselected);
  });

  it.each([
    ["an animated", {}],
    ["a static", { rainbowAnimated: false }],
    ["a themed", themed],
  ])("%s tile's word is white, not the dark ink", (_name, props) => {
    const { container } = render(<WordTile word="PIE" isSelected={false} isRainbow onClick={() => {}} {...props} />);
    const classes = getButton(container).className.split(/\s+/);
    expect(classes).toContain("text-white");
    expect(classes).not.toContain("text-[#292825]");
  });

  it.each([
    ["an animated", {}],
    ["a static", { rainbowAnimated: false }],
  ])("%s tile's word has no shadow, even when the board's theme offers one", (_name, props) => {
    const { container } = render(
      <WordTile word="PIE" isSelected={false} isRainbow rainbowTextShadow="0 1px 2px black" onClick={() => {}} {...props} />
    );
    expect(getButton(container).style.textShadow).toBeFalsy();
  });

  it("a themed tile keeps the shadow its theme sets", () => {
    const { container } = render(
      <WordTile word="PIE" isSelected={false} isRainbow rainbowTextShadow="0 1px 2px black" onClick={() => {}} {...themed} />
    );
    expect(getButton(container).style.textShadow).toBe("0 1px 2px black");
  });

  it("a marked themed tile has a bar", () => {
    const { container } = render(<WordTile word="PIE" isSelected={false} isRainbow tileColor="blue" onClick={() => {}} {...themed} />);
    const bar = getButton(container).querySelector(".tile-color-bar.tile-bar-blue");
    expect(bar).not.toBeNull();
    expect(bar!.className).not.toMatch(/\bbg-group-/);
  });

  it("a marked image tile has a bar and no text span", () => {
    const { container } = render(<WordTile word="img:cat" isSelected={false} isRainbow tileColor="red" onClick={() => {}} />);
    const button = getButton(container);
    expect(button.querySelector("img")).not.toBeNull();
    expect(button.querySelector("[data-tile-text]")).toBeNull();
    expect(button.querySelector(".tile-color-bar.tile-bar-red")).not.toBeNull();
    expect(button.querySelector('.tile-color-bar[class*="bg-group-"]')).toBeNull();
  });

  it.each([
    ["an animated", {}],
    ["a static", { rainbowAnimated: false }],
    ["a themed", themed],
  ])("%s rainbow button carries the face", (_name, props) => {
    const { container } = render(<WordTile word="PIE" isSelected={false} isRainbow onClick={() => {}} {...props} />);
    expect(getButton(container).classList.contains("tile-rainbow-face")).toBe(true);
  });

  it("an ordinary button does not carry the face", () => {
    const { container } = render(<WordTile word="PIE" isSelected={false} onClick={() => {}} />);
    expect(getButton(container).classList.contains("tile-rainbow-face")).toBe(false);
  });

  it("a selected marked ordinary tile's outlines let taps through and paint in mark, selection, button order", () => {
    const { container } = render(<WordTile word="PIE" isSelected tileColor="green" onClick={() => {}} />);
    const mark = container.querySelector("[data-tile-mark]")!;
    const selection = container.querySelector("[data-tile-selection]")!;
    for (const outline of [mark, selection]) expect(outline.classList.contains("pointer-events-none")).toBe(true);
    expect(mark.nextElementSibling).toBe(selection);
    expect(selection.nextElementSibling).toBe(getButton(container));
  });

  it("a selected marked rainbow keeps its bar inside the button and its selection outline outside", () => {
    const { container } = render(<WordTile word="PIE" isSelected isRainbow tileColor="green" onClick={() => {}} />);
    const button = getButton(container);
    const bar = container.querySelector("[data-tile-mark]")!;
    const selection = container.querySelector("[data-tile-selection]")!;
    expect(bar.classList.contains("tile-color-bar")).toBe(true);
    expect(bar.parentElement).toBe(button);
    expect(selection.classList.contains("pointer-events-none")).toBe(true);
    expect(selection.nextElementSibling).toBe(button);
  });

  it("a tap on a marked rainbow's bar is a tap on the tile", () => {
    const onClick = vi.fn();
    const { container } = render(<WordTile word="PIE" isSelected={false} isRainbow tileColor="green" onClick={onClick} />);
    const bar = container.querySelector("[data-tile-mark]")!;
    expect(bar.classList.contains("pointer-events-none")).toBe(true);
    fireEvent.click(bar);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("selecting a marked rainbow leaves its bar's classes and place in the DOM unchanged", () => {
    const tile = { word: "PIE", isRainbow: true, tileColor: "green", onClick: () => {} };
    const { container, rerender } = render(<WordTile {...tile} isSelected={false} />);
    const button = getButton(container);
    const bar = button.querySelector("[data-tile-mark]")!;
    const word = button.querySelector("[data-tile-text]")!;
    const classes = bar.className;
    expect(bar.previousElementSibling).toBe(word);

    rerender(<WordTile {...tile} isSelected />);

    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.querySelector("[data-tile-mark]")).toBe(bar);
    expect(bar.className).toBe(classes);
    expect(bar.parentElement).toBe(button);
    expect(bar.previousElementSibling).toBe(word);
    expect(bar.nextElementSibling).toBeNull();
  });

  it("an unmarked rainbow has no bar, selected or not", () => {
    for (const isSelected of [false, true]) {
      const { container, unmount } = render(<WordTile word="PIE" isSelected={isSelected} isRainbow onClick={() => {}} />);
      expect(container.querySelector(".tile-color-bar")).toBeNull();
      expect(container.querySelector("[data-tile-mark]")).toBeNull();
      unmount();
    }
  });

  it("clearing a rainbow's mark removes the bar", () => {
    const tile = { word: "PIE", isSelected: false, isRainbow: true, onClick: () => {} };
    const { container, rerender } = render(<WordTile {...tile} tileColor="green" />);
    expect(container.querySelector(".tile-color-bar")).not.toBeNull();
    rerender(<WordTile {...tile} tileColor={null} />);
    expect(container.querySelector(".tile-color-bar")).toBeNull();
  });
});

describe("WordTile word fit", () => {
  // jsdom has no layout or text metrics: an 80px tile, and a ruler at 10px per
  // character. These sizes make all three paths below shrink the word.
  const buttonStyle = { fontSize: "20px", fontWeight: "700", fontFamily: "Inter", letterSpacing: "0px", paddingLeft: "8px", paddingRight: "8px" };
  const ruler = { font: "", measureText: (text: string) => ({ width: text.length * 10 }) };
  let clientWidth = 0;

  beforeEach(() => {
    vi.stubGlobal("getComputedStyle", () => buttonStyle);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ruler as never);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(80);
    vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(() => clientWidth);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const fontSizeAt = (width: number, props: { word: string; isRainbow?: boolean; splitLongWords?: boolean }) => {
    clientWidth = width;
    const { container } = render(<WordTile isSelected={false} onClick={() => {}} {...props} />);
    return container.querySelector<HTMLElement>("[data-tile-text]")!.style.fontSize;
  };

  it.each([
    ["a word on one line", "IDENTIFICATION", {}],
    ["a split word", "IDENTIFICATION", { splitLongWords: true }],
    ["a word too short to split", "TEAPOT", { splitLongWords: true }],
  ])("a rainbow's 4px rim leaves %s at a plain 1px-border tile's size", (_name, word, props) => {
    const plain = fontSizeAt(78, { word, ...props });
    expect(plain).toMatch(/em$/);
    expect(fontSizeAt(72, { word, isRainbow: true, ...props })).toBe(plain);
  });
});

describe("WordTile rainbow word height on fixed-height tiles", () => {
  // jsdom has no layout. A wide Full tile at md: 201px wide, a 108px padding
  // box, and a word whose span is 112px tall at full size (three lines) and
  // shorter in proportion to its em size. Of the word's own text it models one
  // thing: a split word shows two lines, so it is two thirds as tall. That
  // proves which tiles take the height path and that its result reaches the
  // rendered word; whether real lines clear a real bar is a browser check.
  const buttonStyle = { fontSize: "31px", fontWeight: "700", fontFamily: "Inter", letterSpacing: "0px", paddingLeft: "8px", paddingRight: "8px" };
  const ruler = { font: "", measureText: (text: string) => ({ width: text.length * 10 }) };
  const word = "OLD MAN RIVER";
  let wide = true;
  let tileWidth = 201;
  let paddingBox = 108;
  let fullHeight = 112;
  let spanHeightReads = 0;
  // setup.ts defines matchMedia as writable but not configurable, so it is
  // assigned and put back rather than stubbed.
  const setupMatchMedia = window.matchMedia;
  const available = () => paddingBox - rainbowBarReserve(tileWidth) - 2;

  beforeEach(() => {
    spanHeightReads = 0;
    wide = true;
    tileWidth = 201;
    paddingBox = 108;
    fullHeight = 112;
    vi.stubGlobal("getComputedStyle", () => buttonStyle);
    window.matchMedia = ((query: string) => ({
      matches: wide && query === "(min-width: 768px)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ruler as never);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(() => tileWidth);
    vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(() => tileWidth - 2);
    vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(() => paddingBox);
    // WordTile reads offsetHeight only for its text span: every read is a
    // height-path read, of the span it is called on.
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
      if (!this?.hasAttribute?.("data-tile-text")) return 0;
      spanHeightReads++;
      const lines = this.querySelector(".tile-split-head") ? 2 / 3 : 1;
      return Math.ceil(fullHeight * lines * (parseFloat(this.style.fontSize) || 1));
    });
  });

  afterEach(() => {
    window.matchMedia = setupMatchMedia;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const renderedSize = (props: Record<string, unknown>) => {
    const { container } = render(<WordTile word={word} isSelected={false} onClick={() => {}} {...props} />);
    return container.querySelector<HTMLElement>("[data-tile-text]")!.style.fontSize;
  };

  it("a rainbow word that would reach the bar shrinks just enough to clear it", () => {
    const size = renderedSize({ isRainbow: true });
    expect(spanHeightReads).toBeGreaterThan(0);
    expect(size).toMatch(/em$/);
    const scale = parseFloat(size);
    const available = 108 - rainbowBarReserve(201) - 2;
    expect(Math.ceil(112 * scale)).toBeLessThanOrEqual(available);
    expect(Math.ceil(112 * (scale + 0.002))).toBeGreaterThan(available);
  });

  // jsdom can show only that these changes keep the state; the real layout
  // stability (no word movement on selection) is a browser check.
  it("marking, clearing and selecting leave that size as it is", () => {
    const tile = { word, isRainbow: true, onClick: () => {} };
    const { container, rerender } = render(<WordTile {...tile} isSelected={false} />);
    const span = () => container.querySelector<HTMLElement>("[data-tile-text]")!;
    const size = span().style.fontSize;
    expect(size).toMatch(/em$/);
    rerender(<WordTile {...tile} isSelected={false} tileColor="green" />);
    expect(span().style.fontSize).toBe(size);
    rerender(<WordTile {...tile} isSelected tileColor="green" />);
    expect(span().style.fontSize).toBe(size);
    rerender(<WordTile {...tile} isSelected tileColor={null} />);
    expect(span().style.fontSize).toBe(size);
  });

  it.each([
    ["an ordinary tile", {}, true],
    ["a Mini (square) rainbow tile", { isRainbow: true, squareTiles: true }, true],
    ["a rainbow tile below md", { isRainbow: true }, false],
  ])("%s never takes the height path", (_name, props, isWide) => {
    wide = isWide;
    expect(renderedSize(props)).toBe("");
    expect(spanHeightReads).toBe(0);
  });

  it.each([
    ["", {}],
    [" with splitLongWords on (the Full Daily's path) and an unsplit phrase", { splitLongWords: true }],
  ])("unmarked, marked, and marked selected tiles mounted together get one size%s", (_name, props) => {
    const tile = { word, isRainbow: true, onClick: () => {}, ...props };
    const { container } = render(
      <>
        <WordTile {...tile} isSelected={false} />
        <WordTile {...tile} isSelected={false} tileColor="green" />
        <WordTile {...tile} isSelected tileColor="green" />
      </>
    );
    expect(container.querySelector(".tile-split-head")).toBeNull();
    const sizes = [...container.querySelectorAll<HTMLElement>("[data-tile-text]")].map((span) => span.style.fontSize);
    expect(sizes).toHaveLength(3);
    expect(sizes[0]).toMatch(/em$/);
    expect(Math.ceil(fullHeight * parseFloat(sizes[0]))).toBeLessThanOrEqual(available());
    expect(new Set(sizes).size).toBe(1);
  });

  it("a wide rainbow word that already clears the bar is measured and left at full size", () => {
    fullHeight = 75;
    expect(renderedSize({ isRainbow: true })).toBe("");
    expect(spanHeightReads).toBeGreaterThan(0);
  });

  it.each([
    ["the tile has no height yet", () => { paddingBox = 0; }],
    ["the word has no height yet", () => { fullHeight = 0; }],
  ])("a wide rainbow word is left at its width fit when %s", (_name, arrange) => {
    arrange();
    expect(renderedSize({ isRainbow: true })).toBe("");
  });

  // The measure that drops the split runs while the split is still on screen,
  // where the word is two lines and would fit. Measuring that stale DOM would
  // leave the unsplit three lines at full size. The tile must skip it and
  // measure again once the unsplit word renders, which takes splitParts in the
  // effect's dependencies: without it the closure keeps the first render's
  // splitParts, measures the stale split, and no re-run follows.
  it("a word that stops being split when the tile widens is fitted to its unsplit lines, not the stale split", () => {
    tileWidth = 80;
    const { container } = render(<WordTile word="IDENTIFICATION" isRainbow isSelected={false} splitLongWords onClick={() => {}} />);
    expect(container.querySelector(".tile-split-head")).not.toBeNull();
    expect(spanHeightReads).toBe(0);

    act(() => {
      tileWidth = 201;
      window.dispatchEvent(new Event("resize"));
    });

    const span = container.querySelector<HTMLElement>("[data-tile-text]")!;
    expect(container.querySelector(".tile-split-head")).toBeNull();
    expect(span.style.fontSize).toMatch(/em$/);
    expect(Math.ceil(fullHeight * parseFloat(span.style.fontSize))).toBeLessThanOrEqual(available());
  });
});
