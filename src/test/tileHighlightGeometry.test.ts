/**
 * Tile highlights stay inside each tile's own box, except that a selection
 * outline may reach past it by a small amount: never far enough for adjacent
 * selected tiles to meet at the board's compact gaps, and not at all on the
 * narrow tablet, where the Full board runs edge to edge. A rainbow tile keeps
 * one geometry selected or not, and its color mark is a bar inside the tile,
 * so selecting it cannot squeeze the art or move the bar. jsdom has no layout,
 * so this works out the CSS's own lengths against each board's tokens; the
 * rendered geometry is a browser check.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fitScaleToHeight, rainbowBarReserve } from "@/lib/rainbowWordFit";

const read =(file: string) => fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");
const css = read("index.css").replace(/\/\*[\s\S]*?\*\//g, "");
const board = read("components/GameBoard.tsx");
const tileGrid = board.split("\n").find((line) => line.includes("animate-shake")) ?? "";
const wordTile = read("components/WordTile.tsx");
// The button's real text size and line height, and the height of a tile that
// cannot grow.
const [minFont, fontShare, maxFont] = (wordTile.match(/text-\[clamp\((\d+)px,([\d.]+)cqw,(\d+)px\)\]/) ?? []).slice(1).map(Number);
const lineHeight = Number(wordTile.match(/lineHeight:\s*([\d.]+)/)?.[1]);
const fixedHeight = Number(wordTile.match(/md:h-\[(\d+)px\]/)?.[1]);
const [, squareClasses, flatClasses] = wordTile.match(/squareTiles \? "([^"]*)" : "([^"]*)"/) ?? [];

// Every innermost `selector { body }`, including those nested in @media.
const parse = (text: string) => [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));
const rules = parse(css);
// `rules` flattens at-rule blocks into the others, so these are parsed alone.
const blockFrom = (opener: string, closer: string) => {
  const start = css.indexOf(opener);
  return parse(css.slice(start, css.indexOf(closer, start) + closer.length));
};
const clock = blockFrom("@supports (transition-behavior", "\n}");
const edgeToEdge = blockFrom("@media (min-width: 768px) and (max-width: 864.98px)", "\n  }");
const layered = blockFrom("@layer utilities {", "\n}");
const scopes = (selector: string) => selector.split(",").map((s) => s.trim());
const boardGaps = (selector: string) =>
  rules.filter((r) => r.selector === selector).flatMap((r) => [...r.body.matchAll(/--board-gap:\s*([^;]+);/g)].map((m) => m[1]));
const bodyOf = (selector: string) => rules.find((r) => r.selector === selector)?.body ?? "";
const decl = (selector: string, property: string) => bodyOf(selector).match(new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`))?.[1] ?? "";
const [baseTokens, mdTokens] = rules.filter((r) => r.selector === ".tile-shell").map((r) => r.body);
const px = (body: string, token: string) => Number(body.match(new RegExp(`${token}:\\s*(\\d+)px`))?.[1]);

type Tokens = Record<string, string>;
const tokensIn = (body: string): Tokens => Object.fromEntries([...body.matchAll(/(--tile-[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
// What a CSS length comes to on a board with these tokens, in px. These rules
// only use var(), calc(), max() and + - *, which are valid JavaScript once the
// units are gone. Throws rather than return NaN, which would compare equal.
const lengthOf = (value: string, tokens: Tokens): number => {
  let source = value;
  while (source.includes("var(")) source = source.replace(/var\((--[\w-]+)\)/g, (_, name) => tokens[name]);
  const length = new Function(`return ${source.replace(/px/g, "").replace(/calc\(/g, "(").replace(/max\(/g, "Math.max(")};`)();
  if (!Number.isFinite(length)) throw new Error(`"${value}" has no length`);
  return length;
};
const size = (token: string, tokens: Tokens) => lengthOf(`var(--tile-${token})`, tokens);
const measure = (selector: string, property: string, tokens: Tokens) => lengthOf(decl(selector, property), tokens);
// The bar's tokens are clamp()s of the tile's own width, so they only come to
// a length on a tile of a given width.
const onTile = (tokens: Tokens, width: number): Tokens =>
  Object.fromEntries(
    Object.entries(tokens).map(([name, value]) => {
      const clamped = value.match(/^clamp\((\d+)px,\s*(\d+)cqw,\s*(\d+)px\)$/);
      if (!clamped) return [name, value];
      const [min, share, max] = clamped.slice(1).map(Number);
      return [name, `${Math.min(max, Math.max(min, (share * width) / 100))}px`];
    })
  );

const rainbow = '.tile-shell[data-tile-kind="rainbow"]';
const rainbowOutline = `${rainbow} > .tile-selection-outline`;
const face = ".tile-rainbow-face";
const selectedFace = '.tile-shell[data-tile-selected="true"] > .tile-rainbow-face';
const bar = ".tile-color-bar";
const focusRing = `${face}:has(> ${bar}):focus-visible`;
const staticFocus = ".rainbow-tile-static.tile-keyboard-focus:focus-visible";
const wordOverBar = `${face}:has(> ${bar}) > [data-tile-text]`;
const fixedFace = `${face}.md\\:h-\\[110px\\]`;
const wordClearance = `${fixedFace}:has(> ${bar}):has(> [data-tile-text])`;
const clearedWord = `${fixedFace}:has(> ${bar}) > [data-tile-text]`;
const darkBand = '.dark .tile-shell[data-tile-kind="ordinary"][data-tile-selected="true"] > .tile-color-outline';
const nonWide = ".gap-1\\.5:not(.md\\:gap-3) > .tile-shell";

// The radius is a clamp() in the CSS; any value inside it will do here.
const phone: Tokens = { ...tokensIn(baseTokens), "--tile-radius": "12px" };
const md: Tokens = { ...phone, ...tokensIn(mdTokens) };
const nonWideMd: Tokens = { ...md, ...tokensIn(bodyOf(nonWide)) };
const narrowTablet: Tokens = { ...md, ...tokensIn(edgeToEdge[0]?.body ?? "") };

const outreaching: [string, Tokens][] = [["phones", phone], ["md", md], ["non-wide Full at md", nonWideMd]];
const everyBoard: [string, Tokens][] = [...outreaching, ["the narrow tablet", narrowTablet]];
// [board, its tokens, its gap in px]
const adjacent: [string, Tokens, number][] = [
  ["Full on a phone", phone, 6],
  ["Mini on a phone", phone, 8],
  ["non-wide Full at md", nonWideMd, 6],
  ["Mini at md", md, 8],
  ["wide Full at md", md, 12],
];
// [board, its tile's width in px]. Mini stops growing at its 330px board.
const phoneTiles: [string, number][] = [
  ["Full at 320", 69.5],
  ["Full at 375", 83.25],
  ["Full at 430", 97],
  ["Mini at 320", 93.33],
  ["Mini at its widest", 104.66],
];
const miniAtMd = 104.66;
// [board, its tokens, its tile's width in px]; a non-wide Full's board is 496px.
const wideFixedTiles: [string, Tokens, number][] = [
  ["wide Full at md", md, 201],
  ["wide Full on the narrow tablet", narrowTablet, 183],
];
const fixedTiles: [string, Tokens, number][] = [...wideFixedTiles, ["non-wide Full at md", nonWideMd, 119.5]];

// [color, the bar's approved fill, the category token it is richer than], in
// the CSS's order.
const barColors: [string, string, string][] = [
  ["red", "#E8262B", "--group-4"],
  ["yellow", "#FFC20E", "--group-1"],
  ["green", "#1FAE4B", "--group-2"],
  ["blue", "#1E6FF0", "--group-3"],
];
const rootTokens = rules.find((r) => r.selector === ":root" && r.body.includes("--group-1:"))?.body ?? "";
// HSL saturation of a #RRGGBB color, in percent.
const saturationOf = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  return max === min ? 0 : ((max - min) / (1 - Math.abs(2 * lightness - 1))) * 100;
};

const barReach = (tokens: Tokens) => measure(bar, "bottom", tokens) + measure(bar, "height", tokens);
const lastRowMinimum = decl(wordClearance, "grid-template-rows").match(/^minmax\(0, 1fr\) auto minmax\((.+), 1fr\)$/)?.[1] ?? "";
// Where the grid puts `lines` of text on a tile of fixed height. The rows above
// and below the text are 1fr, until the last row's minimum is more than that.
// Lengths only hold while the text and that row fit the padding box.
const wordOn = (tokens: Tokens, width: number, lines: number) => {
  const sized = onTile(tokens, width);
  const box = fixedHeight - 2 * size("rainbow-inset", tokens);
  const font = Math.min(maxFont, Math.max(minFont, (fontShare * width) / 100));
  const text = lines * font * lineHeight;
  const below = Math.max((box - text) / 2, lengthOf(lastRowMinimum, sized));
  return { box, text, below, above: box - text - below, reach: barReach(sized) };
};

const negativeInsets = (tokens: Tokens) =>
  rules
    .filter((r) => /\.tile-(color|selection)-outline/.test(r.selector) && decl(r.selector, "inset"))
    .filter((r) => measure(r.selector, "inset", tokens) < 0)
    .map((r) => r.selector);

describe("tile highlight geometry", () => {
  it.each([
    ["gap-1.5", ".board-bars", "6px"],
    ["md:gap-3", ".board-bars.board-bars-wide", "12px"],
    ["gap-2", ".board-bars.board-bars-square", "8px"],
  ])("the tile grid's %s matches %s at %s, so solved rows stay in step", (utility, selector, gap) => {
    expect(tileGrid.split(/[\s"`]+/)).toContain(utility);
    expect(boardGaps(selector)).toEqual([gap]);
  });

  it("nothing reserves room around the board any more", () => {
    expect(css + board).not.toContain("tile-mark-grid");
    expect(css).not.toContain("--board-padding");
  });

  it.each(outreaching)("on %s only dark's selection outline and the rainbow's use a negative inset", (_name, tokens) => {
    expect(negativeInsets(tokens)).toEqual([".dark .tile-selection-outline", rainbowOutline]);
  });

  it.each(adjacent)("on %s a selected rainbow's outline leaves at least 1px per side between neighbours", (_name, tokens, gap) => {
    const reach = 0 - measure(rainbowOutline, "inset", tokens);
    expect(reach).toBe(size("stroke", tokens) - size("rainbow-inset", tokens));
    expect(gap / 2 - reach).toBeGreaterThanOrEqual(1);
  });

  it.each(everyBoard)("on %s the rainbow's outline meets the art's rim", (_name, tokens) => {
    const strokeInner = measure(rainbowOutline, "inset", tokens) + size("stroke", tokens);
    expect(strokeInner).toBe(size("rainbow-inset", tokens));
    // The face's padding box curves at the tile's radius less its border.
    expect(measure(rainbowOutline, "border-radius", tokens) - size("stroke", tokens)).toBe(size("radius", tokens) - size("rainbow-inset", tokens));
  });

  it("a rainbow has no ring: no rule styles its .tile-color-outline, and the ring's tokens are gone", () => {
    expect(rules.filter((r) => r.selector.includes('[data-tile-kind="rainbow"]') && r.selector.includes(".tile-color-outline"))).toEqual([]);
    expect(css).not.toContain("--tile-band");
    expect(css).not.toContain("--tile-rainbow-gap");
  });

  it.each([
    ["Full at 320", 69.5, 1],
    ["wide Full at md", 201, 2],
  ])("on %s the bar's thin white border follows the tile's width", (_name, width, border) => {
    expect(decl(bar, "border")).toBe("var(--tile-bar-border) solid #fff");
    expect(size("bar-border", onTile(phone, width))).toBe(border);
  });

  it("each bar color has exactly one rule, in the utilities layer, the same in both themes", () => {
    const colorRules = rules.filter((r) => r.selector.includes(".tile-bar-"));
    expect(colorRules.map((r) => r.selector)).toEqual(barColors.map(([name]) => `.tile-bar-${name}`));
    expect(colorRules.filter((r) => /\.dark\b/.test(r.selector))).toEqual([]);
    for (const [name, hex] of barColors) expect(decl(`.tile-bar-${name}`, "background-color")).toBe(hex);
    for (const r of colorRules) expect(layered).toContainEqual(r);
  });

  it.each(barColors)("the %s bar is more saturated than its category color", (_name, hex, group) => {
    const category = Number(rootTokens.match(new RegExp(`${group}:\\s*[\\d.]+ ([\\d.]+)%`))?.[1]);
    expect(category).toBeGreaterThan(0);
    expect(saturationOf(hex)).toBeGreaterThan(category);
  });

  it("no viewport rule overrides the bar's border", () => {
    expect(Object.keys(tokensIn(mdTokens))).not.toContain("--tile-bar-border");
  });

  it.each(phoneTiles)("on phones up to 430 wide, %s: the bar stays within the tile's 16px bottom padding", (_name, width) => {
    expect(barReach(onTile(phone, width))).toBeLessThanOrEqual(16);
  });

  it("from md up a marked rainbow's word on a fixed-height tile lays out in centered rows, not in the tile's padding", () => {
    const at = css.indexOf(wordClearance);
    expect(css.slice(css.lastIndexOf("@media", at), at)).toMatch(/^@media \(min-width: 768px\) \{\s*$/);
    expect(decl(wordClearance, "display")).toBe("grid");
    expect(decl(wordClearance, "grid-template-columns")).toBe("minmax(0, 1fr)");
    expect(decl(wordClearance, "justify-items")).toBe("center");
    expect(decl(wordClearance, "padding-block")).toBe("0 !important");
    expect(decl(clearedWord, "grid-row")).toBe("2");
    expect(decl(clearedWord, "min-width")).toBe("min-content");
  });

  it("only fixed-height tiles get those rows: Mini can grow, and py-4 already clears its bar", () => {
    const laidOut = rules.filter((r) => r.selector.includes(face) && /grid-|padding-block/.test(r.body));
    expect(laidOut.map((r) => r.selector)).toEqual([wordClearance, clearedWord]);
    expect(flatClasses).toContain("md:h-[110px]");
    expect(squareClasses).not.toContain("md:h-[110px]");
    expect(bodyOf(".tile-base")).toContain("py-4");
    expect(barReach(onTile(md, miniAtMd)) + 2).toBeLessThanOrEqual(16);
  });

  it.each(fixedTiles)("on %s one line stays exactly centered", (_name, tokens, width) => {
    const { above, below } = wordOn(tokens, width, 1);
    expect(above).toBeCloseTo(below);
  });

  it.each(fixedTiles)("on %s two lines fit and end at least 2px above the bar's top", (_name, tokens, width) => {
    const { above, below, reach } = wordOn(tokens, width, 2);
    expect(above).toBeGreaterThanOrEqual(0);
    expect(below - reach).toBeGreaterThanOrEqual(2);
  });

  it.each(wideFixedTiles)("on %s three lines at full size do not fit above the bar, so WordTile shrinks them", (_name, tokens, width) => {
    const { box, text, reach } = wordOn(tokens, width, 3);
    expect(text + reach).toBeGreaterThan(box);
  });

  it.each(fixedTiles)("on %s WordTile's room for a word never shrinks two lines at full size", (_name, tokens, width) => {
    const { box, text } = wordOn(tokens, width, 2);
    expect(text).toBeLessThanOrEqual(box - rainbowBarReserve(width) - 2);
  });

  it.each(wideFixedTiles)("on %s three lines at WordTile's fitted size sit 2px under the top and 2px over the bar", (_name, tokens, width) => {
    const { box, text: fullText } = wordOn(tokens, width, 3);
    // Any floor below the answer will do; the model has no rewrap.
    const scale = fitScaleToHeight((s) => fullText * s, box - rainbowBarReserve(width) - 2, 1, 0.25);
    expect(scale).toBeLessThan(1);
    const text = fullText * scale;
    const below = Math.max((box - text) / 2, lengthOf(lastRowMinimum, onTile(tokens, width)));
    expect(box - text - below).toBeGreaterThanOrEqual(1.99);
    expect(below - barReach(onTile(tokens, width))).toBeGreaterThanOrEqual(2);
  });

  it("a word that cannot clear the bar paints on top of it, at every width", () => {
    expect(decl(wordOverBar, "position")).toBe("relative");
    expect(decl(wordOverBar, "z-index")).toBe("1");
    expect(bodyOf(bar)).not.toContain("z-index");
    expect(css.indexOf(wordOverBar)).toBeLessThan(css.lastIndexOf("@media", css.indexOf(wordClearance)));
  });

  it("no rainbow word gets a shadow or an outline from the CSS", () => {
    const onWords = rules.filter((r) => /rainbow|\[data-tile-text\]|\.tile-base\[aria-pressed/.test(r.selector));
    expect(onWords.length).toBeGreaterThan(0);
    expect(onWords.filter((r) => /text-shadow|text-stroke/.test(r.body))).toEqual([]);
  });

  it("no highlight paints page color outward from a tile", () => {
    expect(rules.filter((r) => /box-shadow:(?!\s*inset)[^;]*hsl\(var\(--background\)\)/.test(r.body))).toEqual([]);
  });

  it("the art's clip is in un-layered CSS after the gradients, or .rainbow-tile's shorthand would reset it", () => {
    const selectors = rules.map((r) => r.selector);
    expect(layered.length).toBeGreaterThan(0);
    expect(layered.filter((r) => r.selector.includes(face))).toEqual([]);
    expect(selectors.indexOf(face)).toBeGreaterThan(selectors.lastIndexOf(".rainbow-tile"));
    expect(selectors.indexOf(face)).toBeGreaterThan(selectors.lastIndexOf(".rainbow-tile-static"));
    expect(decl(face, "background-origin")).toBe("border-box !important");
  });

  it("both clips are !important, or a themed tile's inline background would reset them", () => {
    expect(decl(face, "background-clip")).toBe("padding-box !important");
    expect(decl(selectedFace, "background-clip")).toBe("border-box !important");
  });

  it("the face's rim is a transparent border, so the whole tile stays tappable", () => {
    expect(decl(face, "border")).toBe("var(--tile-rainbow-inset) solid transparent");
  });

  it("selection restyles no rainbow button beyond the art's clip, and never the bar", () => {
    expect(rules.filter((r) => r.selector.includes("rainbow") && r.selector.includes("aria-pressed"))).toEqual([]);
    const onSelection = rules.filter((r) => r.selector.includes("data-tile-selected") && (r.selector.includes(face) || r.selector.includes(bar)));
    expect(onSelection.map((r) => r.selector)).toEqual([selectedFace]);
    expect(bodyOf(selectedFace).trim()).toBe("background-clip: border-box !important;");
  });

  it("dark's selection outline reaches exactly as far as a plain selected tile's shadow", () => {
    const spread = rules
      .filter((r) => r.selector === '.dark .tile-neutral:not([data-tile-color])[aria-pressed="true"]')
      .map((r) => Number(r.body.match(/box-shadow:\s*0 0 0 (\d+)px/)?.[1]));
    expect(spread).toEqual([1, 2]);
    expect([px(baseTokens, "--tile-stroke-out"), px(mdTokens, "--tile-stroke-out")]).toEqual(spread);
    expect(bodyOf(".dark .tile-selection-outline")).toContain("var(--tile-stroke-out)");
  });

  it.each(everyBoard)("on %s dark's ordinary band sits directly inside the stroke, 1px under it with 2px visible", (_name, tokens) => {
    const strokeInner = size("stroke", tokens) - size("stroke-out", tokens);
    const bandOuter = measure(darkBand, "inset", tokens);
    expect(bandOuter).toBe(strokeInner - 1);
    expect(bandOuter + measure(darkBand, "border-width", tokens) - strokeInner).toBe(2);
  });

  it("dark restyles a color band only on ordinary tiles, so a rainbow's geometry is one in both themes", () => {
    const dark = rules.filter((r) => /^\.dark\b/.test(r.selector) && r.selector.includes(".tile-color-outline"));
    expect(dark.map((r) => r.selector)).toEqual([darkBand]);
  });

  it("where the wide Full board runs edge to edge, nothing reaches past a tile", () => {
    expect(edgeToEdge.map((r) => r.selector)).toEqual([
      ".md\\:gap-3 > .tile-shell",
      '.dark .md\\:gap-3 > .tile-shell > .tile-neutral:not([data-tile-color])[aria-pressed="true"]',
    ]);
    expect(size("stroke-out", narrowTablet)).toBe(0);
    expect(size("rainbow-inset", narrowTablet)).toBe(size("stroke", narrowTablet));
    expect(negativeInsets(narrowTablet)).toEqual([]);
  });

  it("there, dark's plain selection turns its shadow inward and keeps the full stroke", () => {
    const border = Number(bodyOf(".dark .tile-neutral").match(/border:\s*(\d+)px/)?.[1]);
    const inward = Number(edgeToEdge[1]?.body.match(/box-shadow:\s*inset 0 0 0 (\d+)px/)?.[1]);
    expect(border + inward).toBe(size("stroke", narrowTablet));
  });

  it("a non-wide Full board keeps the phone's stroke at md, because its gap stays 6px", () => {
    expect(size("stroke", md)).toBeGreaterThan(size("stroke", phone));
    expect(size("stroke", nonWideMd)).toBe(size("stroke", phone));
    const at = css.indexOf(nonWide);
    expect(css.slice(css.lastIndexOf("@media", at), at)).toMatch(/^@media \(min-width: 768px\) \{\s*$/);
  });

  it("only a marked rainbow's focus ring moves, selected or not", () => {
    const moved = rules.filter((r) => r.selector.includes("rainbow") && /outline-offset:/.test(r.body));
    expect(moved.map((r) => r.selector)).toEqual([focusRing]);
  });

  it.each(everyBoard)("on %s that focus ring's 2px sit just inside the rim, clear of the bar", (_name, tokens) => {
    const inset = size("rainbow-inset", tokens);
    const innerEdge = 0 - measure(focusRing, "outline-offset", tokens);
    expect(innerEdge).toBe(inset + 2);
    // The bar's bottom is measured from inside the rim. Smallest tile: tightest.
    expect(innerEdge).toBeLessThan(inset + measure(bar, "bottom", onTile(tokens, phoneTiles[0][1])));
  });

  it("only the static rainbow's focus ring changes color, to the dark ink, from un-layered CSS", () => {
    const colored = rules.filter((r) => /outline-color:/.test(r.body));
    expect(colored.map((r) => r.selector)).toEqual([staticFocus]);
    expect(decl(staticFocus, "outline-color")).toBe("#292825");
    expect(layered.filter((r) => r.selector === staticFocus)).toEqual([]);
  });

  it("an unmarked selected tile gets its ink only under .dark", () => {
    const ink = rules
      .flatMap((r) => scopes(r.selector))
      .filter((s) => s.includes('.tile-neutral:not([data-tile-color])[aria-pressed="true"]'));
    expect(ink.length).toBeGreaterThan(0);
    for (const selector of ink) expect(selector).toMatch(/^\.dark /);
  });

  it("an ordinary tile shows its color band only under .dark", () => {
    const outline = rules.filter((r) => r.selector.includes('[data-tile-kind="ordinary"]') && r.selector.includes(".tile-color-outline"));
    const shown = outline.filter((r) => /display:(?!\s*none)/.test(r.body)).flatMap((r) => scopes(r.selector));
    expect(outline.some((r) => /display:\s*none/.test(r.body))).toBe(true);
    expect(shown.length).toBeGreaterThan(0);
    for (const selector of shown) expect(selector).toMatch(/^\.dark /);
  });

  it.each([".tile-color-outline", ".tile-selection-outline"])("%s paints above the opaque button", (selector) => {
    expect(bodyOf(selector)).toMatch(/z-index:\s*1;/);
  });

  it("the selection stroke's base rule applies in both themes", () => {
    expect(bodyOf(".tile-selection-outline")).toMatch(/border:\s*var\(--tile-stroke\) solid var\(--tile-selection-ink\);/);
  });

  it("a marked ordinary tile's border is transparent outside .dark, so light has no inner color edge", () => {
    expect(bodyOf(".tile-neutral[data-tile-color]")).toMatch(/border-color:\s*transparent;/);
  });

  it("every Rainbow tile on a board reads one clock on the grid's wrapper", () => {
    const host = "div:has(> .grid > .tile-shell > .rainbow-tile)";
    expect(bodyOf("@property --rainbow-shift-x")).toMatch(/inherits:\s*true;/);
    const tile = clock.find((r) => r.selector === ".tile-shell > .rainbow-tile")?.body ?? "";
    expect(tile).toMatch(/animation:\s*none;/);
    expect(tile).toContain("var(--rainbow-shift-x)");
    const owners = rules.filter((r) => /animation:\s*rainbow-shift-shared\b/.test(r.body)).map((r) => r.selector);
    expect(owners).toEqual([host]);
    expect(clock.map((r) => r.selector)).toContain(host);
  });

  it("only board tiles join the clock, so other Rainbow elements keep their own animation", () => {
    expect(clock.map((r) => r.selector)).not.toContain(".rainbow-tile");
  });

  it("the clock's overrides come after the base .rainbow-tile rule", () => {
    const base = css.indexOf("animation: rainbow-shift 3s");
    expect(base).toBeGreaterThan(-1);
    expect(css.indexOf("@supports (transition-behavior")).toBeGreaterThan(base);
  });

  it("older browsers keep the per-tile animation as the fallback", () => {
    expect(rules.some((r) => r.selector === ".rainbow-tile" && /animation:\s*rainbow-shift\s/.test(r.body))).toBe(true);
  });

  it("the static Rainbow tile stays off the clock", () => {
    const fixed = rules.filter((r) => r.selector.includes(".rainbow-tile-static"));
    expect(fixed.length).toBeGreaterThan(0);
    for (const { selector, body } of fixed) expect(body, selector).not.toMatch(/animation|--rainbow-shift-x/);
  });
});
