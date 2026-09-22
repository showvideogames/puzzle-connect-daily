/**
 * WordTile border/focus behavior:
 *
 *   1. A palette-colored (Color Palette Mode painted) tile keeps its 3px
 *      selection border on mobile but steps up to 4px at the md: breakpoint
 *      — width stays constant between selected/unselected so there's no
 *      layout shift on toggle (see WordTile.tsx's stateClasses comment).
 *   2. A plain neutral selected tile (no paint, no rainbow) is untouched —
 *      still the pre-existing 1px border, no md: override.
 *   3. A mouse/touch selection (mousedown) never leaves the tile focused,
 *      so the focus-visible ring can't double up with the tile's own
 *      selection border — the "double border" bug. Keyboard activation
 *      doesn't go through mousedown, so it's unaffected.
 *   4. That mousedown guard is skipped in arrangeTiles mode, where native
 *      HTML5 drag-to-reorder depends on the same mousedown.
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { WordTile } from "@/components/WordTile";

function getButton(container: HTMLElement) {
  const btn = container.querySelector("button");
  if (!btn) throw new Error("tile button not found");
  return btn;
}

describe("WordTile border width", () => {
  it("a palette-colored selected tile is 3px on mobile, 4px from md: up", () => {
    const { container } = render(
      <WordTile word="PIE" isSelected onClick={() => {}} tileColor="yellow" />
    );
    const btn = getButton(container);
    expect(btn.className).toContain("border-[3px]");
    expect(btn.className).toContain("md:border-[4px]");
  });

  it("a palette-colored UNselected tile keeps the same width (transparent border, no shift)", () => {
    const { container } = render(
      <WordTile word="PIE" isSelected={false} onClick={() => {}} tileColor="yellow" />
    );
    const btn = getButton(container);
    expect(btn.className).toContain("border-[3px]");
    expect(btn.className).toContain("md:border-[4px]");
    expect(btn.className).toContain("border-transparent");
  });

  it("a neutral (unpainted) selected tile is untouched — no md: border override", () => {
    const { container } = render(
      <WordTile word="PIE" isSelected onClick={() => {}} />
    );
    const btn = getButton(container);
    expect(btn.className).not.toContain("md:border-[4px]");
    expect(btn.className).toContain("border-tile-selected");
  });
});

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
