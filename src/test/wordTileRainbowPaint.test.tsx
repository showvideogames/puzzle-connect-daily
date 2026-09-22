/**
 * WordTile's dual-annotation rendering: a tile can carry a Rainbow mark
 * (tileRainbow), a regular category color (tileColor), both, or neither —
 * modeled as two fully independent props (see useGame's tileRainbowMarks
 * state comment). This file checks the CLASS-LEVEL contract each combination
 * renders:
 *
 *   - Rainbow only: the gradient background, no category ring.
 *   - Regular color only: unchanged from before this feature (COLOR_STYLES).
 *   - Rainbow + a category color: gradient background AND a separate inset
 *     ring overlay in that color — never a combination value/class.
 *   - The selection border (3px mobile / 4px desktop, ink color) is present
 *     independent of the ring, on every combination.
 *   - The ring overlay is implemented as its own element (not a box-shadow/
 *     ring utility on the button), so it can never collide with the
 *     focus-visible ring — see the mousedown/focus tests below.
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

describe("WordTile Rainbow-mark + category-color combinations", () => {
  it("Rainbow only: gradient background, selection border, no ring", () => {
    const { container } = render(
      <WordTile word="PIE" isSelected={false} onClick={() => {}} tileRainbow />
    );
    const btn = getButton(container);
    expect(btn.className).toContain("rainbow-tile");
    expect(btn.className).toContain("border-[3px]");
    expect(btn.className).toContain("md:border-[4px]");
    expect(getRing(container)).toBeNull();
  });

  it("Regular color only (no Rainbow mark): unchanged existing behavior", () => {
    const { container } = render(
      <WordTile word="PIE" isSelected={false} onClick={() => {}} tileColor="green" />
    );
    const btn = getButton(container);
    expect(btn.className).toContain("bg-group-2");
    expect(btn.className).not.toContain("rainbow-tile");
    expect(getRing(container)).toBeNull();
  });

  it.each(["yellow", "green", "blue", "red"] as const)(
    "Rainbow + %s: gradient background stays the tile background, plus a %s inset ring",
    (color) => {
      const ringClass: Record<string, string> = {
        yellow: "border-group-1",
        green: "border-group-2",
        blue: "border-group-3",
        red: "border-group-4",
      };
      const { container } = render(
        <WordTile word="PIE" isSelected={false} onClick={() => {}} tileRainbow tileColor={color} />
      );
      const btn = getButton(container);
      // Gradient is preserved as the background — never replaced by the
      // solid category fill (colorStyle.bg would be e.g. "bg-group-1").
      expect(btn.className).toContain("rainbow-tile");
      expect(btn.className).not.toMatch(/\bbg-group-\d\b/);
      const ring = getRing(container);
      expect(ring).not.toBeNull();
      expect(ring!.className).toContain(ringClass[color]);
    }
  );

  it("replacing a Rainbow tile's regular color updates the ring without removing Rainbow", () => {
    const { container, rerender } = render(
      <WordTile word="PIE" isSelected={false} onClick={() => {}} tileRainbow tileColor="green" />
    );
    expect(getRing(container)!.className).toContain("border-group-2");
    expect(getButton(container).className).toContain("rainbow-tile");

    rerender(<WordTile word="PIE" isSelected={false} onClick={() => {}} tileRainbow tileColor="blue" />);
    expect(getRing(container)!.className).toContain("border-group-3");
    expect(getRing(container)!.className).not.toContain("border-group-2");
    expect(getButton(container).className).toContain("rainbow-tile");
  });

  it("removing Rainbow reveals the retained regular color as the normal solid background", () => {
    const { container, rerender } = render(
      <WordTile word="PIE" isSelected={false} onClick={() => {}} tileRainbow tileColor="red" />
    );
    expect(getButton(container).className).toContain("rainbow-tile");
    expect(getRing(container)).not.toBeNull();

    rerender(<WordTile word="PIE" isSelected={false} onClick={() => {}} tileRainbow={false} tileColor="red" />);
    const btn = getButton(container);
    expect(btn.className).not.toContain("rainbow-tile");
    expect(btn.className).toContain("bg-group-4");
    // No ring once it's a plain colored tile again — the color IS the fill.
    expect(getRing(container)).toBeNull();
  });

  it("selection border and the category ring render simultaneously and independently", () => {
    const { container } = render(
      <WordTile word="PIE" isSelected onClick={() => {}} tileRainbow tileColor="yellow" />
    );
    const btn = getButton(container);
    // Selection border: the existing ink/foreground selection color, still
    // the responsive 3px/4px width.
    expect(btn.className).toContain("border-foreground");
    expect(btn.className).toContain("border-[3px]");
    expect(btn.className).toContain("md:border-[4px]");
    // Category ring: present, in its own element, unaffected by selection.
    const ring = getRing(container);
    expect(ring).not.toBeNull();
    expect(ring!.className).toContain("border-group-1");
    // They are genuinely two different DOM nodes.
    expect(ring).not.toBe(btn);
  });

  it("a Rainbow-only selected tile keeps the normal selection border (no ring rendered)", () => {
    const { container } = render(
      <WordTile word="PIE" isSelected onClick={() => {}} tileRainbow />
    );
    const btn = getButton(container);
    expect(btn.className).toContain("border-foreground");
    expect(getRing(container)).toBeNull();
  });
});

describe("WordTile mouse vs keyboard focus with a Rainbow+color tile", () => {
  it("mousedown still prevents default (no focus ring stacking with the category ring)", () => {
    const { container } = render(
      <WordTile word="PIE" isSelected={false} onClick={() => {}} tileRainbow tileColor="blue" />
    );
    const btn = getButton(container);
    const notCanceled = fireEvent.mouseDown(btn);
    expect(notCanceled).toBe(false);
  });

  it("click still fires normally through a mousedown on a Rainbow+color tile", () => {
    const onClick = vi.fn();
    const { container } = render(
      <WordTile word="PIE" isSelected={false} onClick={onClick} tileRainbow tileColor="blue" />
    );
    const btn = getButton(container);
    fireEvent.mouseDown(btn);
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("keeps the focus-visible ring classes on the button regardless of the Rainbow+color ring overlay", () => {
    const { container } = render(
      <WordTile word="PIE" isSelected={false} onClick={() => {}} tileRainbow tileColor="blue" />
    );
    const btn = getButton(container);
    // The focus-visible ring lives on the BUTTON's own box-shadow; the
    // category ring is a separate overlay element (getRing), so both classes
    // must coexist untouched.
    expect(btn.className).toContain("focus-visible:ring-2");
    expect(btn.className).toContain("focus-visible:ring-ring");
    expect(getRing(container)).not.toBeNull();
  });

  it("keyboard-style focus() still satisfies :focus-visible on a Rainbow+color tile", () => {
    const { container } = render(
      <WordTile word="PIE" isSelected={false} onClick={() => {}} tileRainbow tileColor="blue" />
    );
    const btn = getButton(container);
    btn.focus();
    expect(document.activeElement).toBe(btn);
    expect(btn.matches(":focus-visible")).toBe(true);
  });
});
