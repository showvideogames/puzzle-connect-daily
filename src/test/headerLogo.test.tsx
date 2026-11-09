/**
 * The game pages' header: the same AppHeader bar as Friends, with the game's
 * hint, its "Settings and menu" and its signed-out rule. jsdom has no layout
 * engine, so this pins the classes, order and wiring; the fit at 320-1440px and
 * the board's position are checked in a real browser.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import type { AppSocial } from "@/components/social/appSocial";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }) } },
}));
vi.mock("@/components/social/appSocial", () => ({
  appSocial: () => ({
    api: {
      client: {
        forget() {},
        call: async (op: string) => op === "getMe"
          ? { ok: true, data: { displayName: "Alex", animalId: "fox", backgroundColor: "#DED1F2" } }
          : { ok: true, data: { incoming: [], outgoing: [] } },
      },
    },
    source: {
      read: () => ({ state: { scope: "a", credential: "test" }, accountId: "a", storedOwner: "a", generation: 1, checkRunning: false }),
      subscribe: () => () => {},
    },
  }) as unknown as AppSocial,
}));
// The same Radix dialog FeedbackModal is built on, so focus is saved and restored as it really is.
vi.mock("@/components/FeedbackModal", async () => {
  const { Dialog, DialogContent, DialogDescription, DialogTitle } = await import("@/components/ui/dialog");
  return {
    FeedbackModal: ({ open, onClose }: { open: boolean; onClose: () => void }) => (
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent><DialogTitle>Feedback</DialogTitle><DialogDescription>Tell us</DialogDescription><button type="button">Send</button></DialogContent>
      </Dialog>
    ),
  };
});

import { GameHeader } from "@/components/GameHeader";
import { MINI_FORMAT } from "@/lib/puzzleFormat";

const player = { id: "u1", email: "player@example.test" } as User;
type Props = Partial<React.ComponentProps<typeof GameHeader>>;
const handlers = () => ({ onStatsClick: vi.fn(), onSettingsClick: vi.fn(), onHintClick: vi.fn(), onHowToPlayClick: vi.fn() });

function renderHeader(props: Props = {}) {
  return render(
    <MemoryRouter>
      <GameHeader user={null} onSignOut={() => {}} showHint variant="minimal" {...handlers()} {...props} />
    </MemoryRouter>
  );
}
const header = () => screen.getByTestId("app-header");
const names = () => Array.from(header().querySelectorAll("a, button")).map((el) => el.getAttribute("aria-label"));

beforeEach(() => vi.stubEnv("VITE_SHARED_SOCIAL", "beta"));
afterEach(() => vi.unstubAllEnvs());

describe("game header", () => {
  it("is the Friends bar: one rounded, outlined card, the 3×3 icon below md and the one-line wordmark from md", () => {
    renderHeader();
    const card = header().firstElementChild!;
    for (const name of ["rounded-2xl", "border", "border-border", "bg-card", "shadow-sm", "h-14", "md:h-16"]) expect(card.className.split(" ")).toContain(name);
    expect(screen.getByTestId("brand-icon").className).toContain("md:hidden");
    expect(screen.getByTestId("brand-wordmark").className).toContain("hidden md:block");
    expect(header().querySelector("img[src*='stacked']")).toBeNull();
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
  });

  it("runs menu, home, hint, stats, calendar, settings, then the profile last, every one a 44px target", async () => {
    renderHeader({ user: player });
    await screen.findByRole("button", { name: "Profile menu" }, { timeout: 15000 });
    expect(names()).toEqual(["Menu", "Home", "Get a hint", "My stats", "Puzzle archive", "Settings and menu", "Profile menu"]);
    for (const name of ["Menu", "Get a hint", "My stats", "Puzzle archive", "Settings and menu"]) {
      const el = within(header()).getByLabelText(name);
      expect(el.className).toContain("h-11");
      expect(el.className).toContain("w-11");
      expect(el.querySelector("svg")!.getAttribute("class")).toContain("h-6 w-6");
    }
  });

  it("keeps hint, stats and settings working, with no book icon and no header Create button", () => {
    const calls = handlers();
    renderHeader(calls);
    fireEvent.click(screen.getByRole("button", { name: "Get a hint" }));
    fireEvent.click(screen.getByRole("button", { name: "My stats" }));
    fireEvent.click(screen.getByRole("button", { name: "Settings and menu" }));
    expect(calls.onHintClick).toHaveBeenCalledOnce();
    expect(calls.onStatsClick).toHaveBeenCalledOnce();
    expect(calls.onSettingsClick).toHaveBeenCalledOnce();
    expect(header().querySelector(".lucide-book-open, .lucide-archive")).toBeNull();
    expect(within(header()).queryByRole("link", { name: "Create a puzzle" })).toBeNull();
  });

  it("gives a signed-out player no profile control, and leaves the calendar showing at every width", () => {
    renderHeader();
    expect(screen.queryByTestId("header-profile")).toBeNull();
    expect(within(header()).queryByRole("button", { name: /sign in/i })).toBeNull();
    expect(names()).toEqual(["Menu", "Home", "Get a hint", "My stats", "Puzzle archive", "Settings and menu"]);
    expect(screen.getByRole("link", { name: "Puzzle archive" }).className).not.toContain("max-[374px]:hidden");
  });

  it("lets the calendar step aside below 375px only when a hint and the profile picture both show", async () => {
    const { unmount } = renderHeader({ user: player });
    await screen.findByRole("button", { name: "Profile menu" }, { timeout: 15000 });
    expect(screen.getByRole("link", { name: "Puzzle archive" }).className).toContain("max-[374px]:hidden");
    unmount();
    renderHeader({ user: player, showHint: false });
    expect(screen.getByRole("link", { name: "Puzzle archive" }).className).not.toContain("max-[374px]:hidden");
  });

  it("hides the profile picture when Friends and Groups is off, as before", () => {
    vi.stubEnv("VITE_SHARED_SOCIAL", "off");
    renderHeader({ user: player });
    expect(screen.queryByTestId("header-profile")).toBeNull();
  });

  it("points the calendar at the Mini archive on Mini pages", () => {
    renderHeader({ format: MINI_FORMAT });
    expect(screen.getByRole("link", { name: "Mini puzzle archive" })).toHaveAttribute("href", "/mini/archive");
  });

  it("matches the board on game pages (840px, a small gap below) and the Friends width elsewhere", () => {
    const { unmount } = renderHeader();
    expect(header().className).toContain("max-w-[840px]");
    expect(header().className).toContain("mb-1 md:mb-2");
    unmount();
    renderHeader({ variant: "default", showHint: false });
    expect(header().className).toContain("max-w-2xl");
    expect(header().className).toContain("mb-4");
  });

  it("leaves out stats and settings on pages that have none, keeping the menu, home and calendar", () => {
    renderHeader({ onStatsClick: undefined, onSettingsClick: undefined, showHint: false, wideHeader: true });
    expect(names()).toEqual(["Menu", "Home", "Puzzle archive"]);
  });

  it("the menu's Give feedback opens a feedback dialog and gives focus back to the hamburger", async () => {
    renderHeader();
    const menu = screen.getByRole("button", { name: "Menu" });
    menu.focus();
    fireEvent.click(menu);
    const drawer = await screen.findByRole("dialog", { name: "Menu" });
    expect(within(drawer).getByRole("link", { name: "How to play" })).toHaveAttribute("href", "/how-to-play");
    expect(within(drawer).getByRole("link", { name: "Create a puzzle" })).toHaveAttribute("href", "/create");
    fireEvent.click(within(drawer).getByRole("button", { name: "Give feedback" }));
    const feedback = await screen.findByRole("dialog", { name: "Feedback" });
    fireEvent.keyDown(feedback, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Feedback" })).toBeNull());
    await act(async () => { await new Promise((done) => requestAnimationFrame(() => done(null))); });
    await waitFor(() => expect(menu).toHaveFocus());
  });
});
