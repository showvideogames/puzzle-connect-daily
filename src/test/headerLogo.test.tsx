/**
 * Header logo sizing. jsdom has no layout engine, so this pins the sizing
 * classes and the parts of the earlier header work that must survive
 * (44px tap targets, Calendar hidden below 430px, Create button); actual
 * overflow at 320-430px and desktop is verified in a real browser.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) } },
}));

import { GameHeader } from "@/components/GameHeader";

function renderHeader() {
  return render(
    <MemoryRouter>
      <GameHeader
        onStatsClick={() => {}}
        onHowToPlayClick={() => {}}
        onSettingsClick={() => {}}
        onHintClick={() => {}}
        showHint
        user={null}
        onSignOut={() => {}}
        variant="minimal"
      />
    </MemoryRouter>
  );
}

describe("shared header", () => {
  it("logo is 128px wide on mobile (stacked mark, never shrinks), 36px tall on tablet, 56px on desktop, aspect ratio preserved", () => {
    const { container } = renderHeader();
    const logos = Array.from(container.querySelectorAll("a[aria-label='Home'] img")) as HTMLImageElement[];
    expect(logos).toHaveLength(2);
    const [stacked, oneLine] = logos;
    expect(stacked.getAttribute("src")).toContain("stacked");
    expect(stacked.className).toContain("w-[128px]"); // mobile
    expect(stacked.className).toContain("shrink-0");
    expect(stacked.className).toContain("h-auto");
    expect(stacked.className).toContain("md:hidden");
    expect(stacked.className).toContain("lg:h-14");
    expect(stacked.className).toContain("lg:w-auto");
    expect(oneLine.className).toContain("md:block");
    expect(oneLine.className).toContain("lg:hidden");
    expect(oneLine.className).toContain("h-9"); // 36px tablet
    expect(oneLine.className).toContain("w-auto");
  });

  it("keeps every utility control at 44x44, the Create button, and the Calendar hidden below 430px", () => {
    renderHeader();
    for (const name of ["Get a hint", "My stats", "Settings and menu", "Puzzle archive"]) {
      const el = screen.getByLabelText(name);
      expect(el.className).toContain("w-11");
      expect(el.className).toContain("h-11");
    }
    expect(screen.getByLabelText("Puzzle archive").className).toContain("max-[429px]:hidden");
    expect(screen.getByRole("link", { name: "Create a puzzle" })).toBeTruthy();
  });

  it("the header Create button is desktop-only (hidden below sm) and phone glyphs are 24px inside the 44px target", () => {
    renderHeader();
    const create = screen.getByRole("link", { name: "Create a puzzle" });
    expect(create.className).toMatch(/(^|\s)hidden(\s|$)/);
    expect(create.className).toContain("sm:inline-flex");
    expect(create).toHaveTextContent("+ Create a Puzzle");
    for (const name of ["Get a hint", "My stats", "Settings and menu"]) {
      const glyph = screen.getByLabelText(name).querySelector("svg")!;
      expect(glyph.getAttribute("class")).toContain("w-6");
      expect(glyph.getAttribute("class")).toContain("h-6");
    }
  });
});
