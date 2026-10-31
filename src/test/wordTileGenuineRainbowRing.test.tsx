import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { WordTile } from "@/components/WordTile";

describe("annotations preserve independent selection and erase cleanly", () => {
  it.each(["yellow", "green", "blue", "red"])("%s annotation retains selection and clears on ordinary and Rainbow tiles", (color) => {
    for (const isRainbow of [false, true]) for (const isSelected of [false, true]) {
      const props = { word: "SUN", isRainbow, isSelected, onClick: vi.fn() };
      const { container, rerender, unmount } = render(<WordTile {...props} />);
      const button = container.querySelector("button")!;
      const originalClass = button.className;
      rerender(<WordTile {...props} tileColor={color} />);
      expect(button.className).toBe(originalClass);
      expect(button.getAttribute("data-tile-color")).toBe(color);
      expect(button.getAttribute("aria-pressed")).toBe(String(isSelected));
      expect(container.querySelector("[data-tile-mark]")?.getAttribute("data-tile-mark")).toBe(color);
      expect(button.querySelector("[data-tile-mark]")).toBeNull();
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
