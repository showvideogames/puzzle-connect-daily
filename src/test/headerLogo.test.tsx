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
  it("logo is 32px tall on mobile (stacked mark), 36px on tablet, 56px on desktop, aspect ratio preserved", () => {
    const { container } = renderHeader();
    const logos = Array.from(container.querySelectorAll("a[aria-label='Home'] img")) as HTMLImageElement[];
    expect(logos).toHaveLength(2);
    const [stacked, oneLine] = logos;
    expect(stacked.getAttribute("src")).toContain("stacked");
    expect(stacked.className).toContain("h-8"); // 32px mobile
    expect(stacked.className).toContain("md:hidden");
    expect(stacked.className).toContain("lg:h-14");
    expect(stacked.className).toContain("w-auto");
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
});
