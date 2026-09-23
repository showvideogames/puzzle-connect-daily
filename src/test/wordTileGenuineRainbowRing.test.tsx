/**
 * WordTile's category-color inset ring on a GENUINE Rainbow tile.
 *
 * Corrects an earlier, wrong version of this feature that let players paint
 * an arbitrary tile "Rainbow" through the color palette (a fake `tileRainbow`
 * prop, decoupled from real gameplay). That prop no longer exists. The ring
 * now attaches to the REAL gameplay `isRainbow` flag — set only once a
 * player has actually found the puzzle's Rainbow answer (see
 * GameBoard.tsx's `rainbowWords`/`bonusRainbowWords`) — combined with the
 * existing `tileColor` paint, which a player can still apply to any tile,
 * genuine Rainbow or not.
 *
 *   - isRainbow without a color: the plain gradient, unchanged from before
 *     this whole feature ever existed.
 *   - isRainbow + a category color: gradient stays the background, the
 *     category color renders as a separate 4px inset ring.
 *   - The selection border (ink color, 3px mobile / 4px desktop) is present
 *     independent of the ring, exactly as for a plain colored tile.
 *   - The ring is a separate DOM element (not a box-shadow/ring utility on
 *     the button), so it can never collide with the focus-visible ring —
 *     verified with the same mousedown/keyboard-focus checks as the
 *     existing plain-color-tile suite.
 *   - A tile with NO isRainbow never gets a ring, no matter its tileColor —
 *     that's just the existing plain colored-tile behavior.
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { WordTile } from "@/components/WordTile";

function getButton(container: HTMLElement) {
  const btn = container.querySelector("button");
  if (!btn) throw new Error("tile button not found");
  return btn;
}

function getRing(container: HTMLElement) {
  return container.querySelector('button > span[aria-hidden="true"]');
}

describe("WordTile genuine-Rainbow + category-color ring", () => {
  it("isRainbow alone: gradient background, responsive selection border, no ring", () => {
    const { container } = render(
      <WordTile word="PIE" isSelected={false} onClick={() => {}} isRainbow />
    );
    const btn = getButton(container);
    expect(btn.className).toContain("rainbow-tile");
    expect(btn.className).toContain("border-[3px]");
    expect(btn.className).toContain("md:border-[4px]");
    expect(getRing(container)).toBeNull();
  });

  it("a tile with a color but NOT genuinely Rainbow: existing plain colored-tile behavior, no ring", () => {
    const { container } = render(
      <WordTile word="PIE" isSelected={false} onClick={() => {}} tileColor="green" />
    );
    const btn = getButton(container);
    expect(btn.className).toContain("bg-group-2");
    expect(btn.className).not.toContain("rainbow-tile");
    expect(getRing(container)).toBeNull();
  });

  it.each(["yellow", "green", "blue", "red"] as const)(
    "genuine Rainbow + %s: gradient stays the background, plus a %s inset ring",
    (color) => {
      const ringClass: Record<string, string> = {
        yellow: "border-group-1",
        green: "border-group-2",
        blue: "border-group-3",
        red: "border-group-4",
      };
      const { container } = render(
        <WordTile word="PIE" isSelected={false} onClick={() => {}} isRainbow tileColor={color} />
      );
      const btn = getButton(container);
      expect(btn.className).toContain("rainbow-tile");
      expect(btn.className).not.toMatch(/\bbg-group-\d\b/);
      const ring = getRing(container);
      expect(ring).not.toBeNull();
      expect(ring!.className).toContain(ringClass[color]);
    }
  );

  it("erasing the category color (tileColor -> null) removes only the ring; the gradient stays", () => {
    const { container, rerender } = render(
      <WordTile word="PIE" isSelected={false} onClick={() => {}} isRainbow tileColor="blue" />
    );
    expect(getRing(container)).not.toBeNull();
    expect(getButton(container).className).toContain("rainbow-tile");

    rerender(<WordTile word="PIE" isSelected={false} onClick={() => {}} isRainbow tileColor={null} />);
    const btn = getButton(container);
    expect(btn.className).toContain("rainbow-tile");
    expect(getRing(container)).toBeNull();
  });

  it("replacing the category color updates the ring without touching the gradient", () => {
    const { container, rerender } = render(
      <WordTile word="PIE" isSelected={false} onClick={() => {}} isRainbow tileColor="green" />
    );
    expect(getRing(container)!.className).toContain("border-group-2");

    rerender(<WordTile word="PIE" isSelected={false} onClick={() => {}} isRainbow tileColor="blue" />);
    expect(getRing(container)!.className).toContain("border-group-3");
    expect(getRing(container)!.className).not.toContain("border-group-2");
    expect(getButton(container).className).toContain("rainbow-tile");
  });

  it("selection border and the category ring render simultaneously and independently", () => {
    const { container } = render(
      <WordTile word="PIE" isSelected onClick={() => {}} isRainbow tileColor="yellow" />
    );
    const btn = getButton(container);
    expect(btn.className).toContain("border-foreground");
    expect(btn.className).toContain("border-[3px]");
    expect(btn.className).toContain("md:border-[4px]");
    const ring = getRing(container);
    expect(ring).not.toBeNull();
    expect(ring!.className).toContain("border-group-1");
    expect(ring).not.toBe(btn);
  });

  it("a selected genuine-Rainbow tile with no color keeps the normal selection border (no ring)", () => {
    const { container } = render(
      <WordTile word="PIE" isSelected onClick={() => {}} isRainbow />
    );
    const btn = getButton(container);
    expect(btn.className).toContain("border-foreground");
    expect(getRing(container)).toBeNull();
  });

  /**
   * The white gap.
   *
   * Replaces an earlier 1px hsl(var(--ink)/0.4) separator that sat on the
   * ring's inner edge only. Three things are pinned here, because each one
   * is a way the gap could regress into not doing its job:
   *
   *   1. There is a gap on BOTH sides of the ring (an outset shadow and an
   *      inset one). Inner-only leaves the ring touching the gradient at the
   *      tile's rim, which is the case this change exists to fix.
   *   2. It is a LITERAL white, not a theme token. A token would flip to
   *      near-black in dark mode and put the category color straight back
   *      against a moving multicolor background.
   *   3. The span is inset by the gap rather than sitting at inset-0, which
   *      is what keeps the outset shadow inside the button's padding box
   *      instead of painting over the 3px mobile selection border.
   */
  it.each(["yellow", "green", "blue", "red"] as const)(
    "the %s ring is separated from the gradient by white on BOTH sides",
    (color) => {
      const { container } = render(
        <WordTile word="PIE" isSelected={false} onClick={() => {}} isRainbow tileColor={color} />
      );
      const ring = getRing(container) as HTMLElement;
      const shadow = ring.style.boxShadow.toLowerCase();
      // Exactly one INSET layer (the inner gap) and, since the string does
      // not begin with it, exactly one OUTSET layer before it (the outer
      // gap). Asserted this way rather than by splitting on commas because
      // jsdom rewrites #ffffff as rgb(255, 255, 255), whose own commas would
      // break a naive split.
      expect(shadow.split("inset").length - 1).toBe(1);
      expect(shadow.startsWith("inset")).toBe(false);
      // Both gaps are white, and neither is a theme token that would flip
      // to a dark color in dark mode.
      const white = shadow.includes("#ffffff") || shadow.includes("rgb(255, 255, 255)");
      expect(white).toBe(true);
      expect(shadow).not.toContain("var(--");
      // The ring itself is still the plain category-color border class, so
      // the gap never became the thing drawing the color.
      expect(ring.className).toContain("border-[4px]");
      expect(ring.style.boxShadow).not.toContain("hsl(var(--group");
    }
  );

  it("the ring is inset by the gap, so the outer gap cannot eat the selection border", () => {
    const { container } = render(
      <WordTile word="PIE" isSelected onClick={() => {}} isRainbow tileColor="blue" />
    );
    const ring = getRing(container) as HTMLElement;
    // inset-0 would let the outset shadow paint over the button's own
    // 3px/4px border; a non-zero inset keeps it inside the padding box.
    expect(ring.style.inset).toBe("2px");
    expect(ring.className).not.toContain("inset-0");
    // and the selection border is still fully the button's own.
    expect(getButton(container).className).toContain("border-foreground");
    expect(getButton(container).className).toContain("border-[3px]");
  });

  it("the gap does not change the ring's own 4px thickness", () => {
    const { container } = render(
      <WordTile word="PIE" isSelected={false} onClick={() => {}} isRainbow tileColor="green" />
    );
    const ring = getRing(container) as HTMLElement;
    expect(ring.className).toContain("border-[4px]");
    expect(ring.className).toContain("border-group-2");
  });
});

describe("WordTile mouse vs keyboard focus on a genuine Rainbow + color tile", () => {
  it("mousedown still prevents default (no focus ring stacking with the category ring)", () => {
    const { container } = render(
      <WordTile word="PIE" isSelected={false} onClick={() => {}} isRainbow tileColor="blue" />
    );
    const btn = getButton(container);
    const notCanceled = fireEvent.mouseDown(btn);
    expect(notCanceled).toBe(false);
  });

  it("click still fires normally through that mousedown", () => {
    const onClick = vi.fn();
    const { container } = render(
      <WordTile word="PIE" isSelected={false} onClick={onClick} isRainbow tileColor="blue" />
    );
    const btn = getButton(container);
    fireEvent.mouseDown(btn);
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("keeps the focus-visible ring classes on the button regardless of the ring overlay", () => {
    const { container } = render(
      <WordTile word="PIE" isSelected={false} onClick={() => {}} isRainbow tileColor="blue" />
    );
    const btn = getButton(container);
    expect(btn.className).toContain("focus-visible:ring-2");
    expect(btn.className).toContain("focus-visible:ring-ring");
    expect(getRing(container)).not.toBeNull();
  });

  it("keyboard-style focus() still satisfies :focus-visible", () => {
    const { container } = render(
      <WordTile word="PIE" isSelected={false} onClick={() => {}} isRainbow tileColor="blue" />
    );
    const btn = getButton(container);
    btn.focus();
    expect(document.activeElement).toBe(btn);
    expect(btn.matches(":focus-visible")).toBe(true);
  });
});
