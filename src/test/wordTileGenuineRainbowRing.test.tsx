import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { WordTile } from "@/components/WordTile";

const MARKS = [
  ["yellow", "tile-bar-yellow", "border-group-1"],
  ["green", "tile-bar-green", "border-group-2"],
  ["blue", "tile-bar-blue", "border-group-3"],
  ["red", "tile-bar-red", "border-group-4"],
];

// Animated, static and themed.
const FACES = [{}, { rainbowAnimated: false }, { rainbowGradient: "linear-gradient(red, blue)" }];

describe("annotations preserve independent selection and erase cleanly", () => {
  it.each(MARKS)("%s annotation on any Rainbow face is a %s bar inside the button, and clears", (color, barClass) => {
    for (const face of FACES) for (const isSelected of [false, true]) {
      const props = { word: "SUN", isRainbow: true, isSelected, onClick: vi.fn(), ...face };
      const { container, rerender, unmount } = render(<WordTile {...props} />);
      const button = container.querySelector("button")!;
      const originalClass = button.className;
      rerender(<WordTile {...props} tileColor={color} />);
      expect(button.className).toBe(originalClass);
      expect(button.getAttribute("data-tile-color")).toBe(color);
      expect(button.getAttribute("aria-pressed")).toBe(String(isSelected));
      const bar = button.querySelector("[data-tile-mark]");
      expect(bar?.getAttribute("data-tile-mark")).toBe(color);
      expect(bar?.classList.contains("tile-color-bar")).toBe(true);
      expect(bar?.classList.contains(barClass)).toBe(true);
      // The bar's own colors, not the shared category ones.
      expect(bar?.className).not.toMatch(/\bbg-group-/);
      expect(container.querySelectorAll("[data-tile-mark]")).toHaveLength(1);
      expect(container.querySelector(".tile-color-outline")).toBeNull();
      fireEvent.click(button);
      expect(props.onClick).toHaveBeenCalledOnce();
      rerender(<WordTile {...props} tileColor={null} />);
      expect(container.querySelector("[data-tile-mark]")).toBeNull();
      expect(button.hasAttribute("data-tile-color")).toBe(false);
      expect(button.className).toBe(originalClass);
      unmount();
    }
  });

  it.each(MARKS)("%s annotation on an ordinary tile stays outside the button with no bar, and clears", (color, _barClass, bandClass) => {
    for (const isSelected of [false, true]) {
      const props = { word: "SUN", isSelected, onClick: vi.fn() };
      const { container, rerender, unmount } = render(<WordTile {...props} />);
      const button = container.querySelector("button")!;
      const originalClass = button.className;
      rerender(<WordTile {...props} tileColor={color} />);
      expect(button.className).toBe(originalClass);
      expect(button.getAttribute("data-tile-color")).toBe(color);
      expect(button.getAttribute("aria-pressed")).toBe(String(isSelected));
      const mark = container.querySelector("[data-tile-mark]");
      expect(mark?.getAttribute("data-tile-mark")).toBe(color);
      expect(mark?.classList.contains("tile-color-outline")).toBe(true);
      expect(mark?.classList.contains(bandClass)).toBe(true);
      expect(button.querySelector("[data-tile-mark]")).toBeNull();
      expect(container.querySelector(".tile-color-bar")).toBeNull();
      fireEvent.click(button);
      expect(props.onClick).toHaveBeenCalledOnce();
      rerender(<WordTile {...props} tileColor={null} />);
      expect(container.querySelector("[data-tile-mark]")).toBeNull();
      expect(button.hasAttribute("data-tile-color")).toBe(false);
      expect(button.className).toBe(originalClass);
      unmount();
    }
  });
});
