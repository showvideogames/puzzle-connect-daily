// Pointer focus remains separate from submission selection and color annotations.
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { WordTile } from "@/components/WordTile";

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
