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

  it("the ring separator uses the theme's --ink token at reduced opacity, not a hardcoded color", () => {
    const { container } = render(
      <WordTile word="PIE" isSelected={false} onClick={() => {}} isRainbow tileColor="red" />
    );
    const ring = getRing(container) as HTMLElement;
    const style = ring.getAttribute("style") ?? "";
    expect(style).toContain("var(--ink)");
    expect(style).not.toMatch(/#[0-9a-fA-F]{3,6}/);
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
