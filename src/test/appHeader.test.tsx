/**
 * The Rainbow app header on the secondary pages (MinimalHeader). jsdom has no
 * layout, so the 320px fit is checked in a browser; this pins the controls,
 * their order, the 44px targets, the brand and the hamburger drawer.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSocial } from "@/components/social/appSocial";

let session: { user: { id: string; email: string } } | null = null;
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}));
vi.mock("@/components/social/appSocial", () => ({
  appSocial: () => ({
    api: {
      client: {
        forget() {},
        call: async (op: string) => op === "getMe"
          ? { ok: true, data: { displayName: "Alex", animalId: "fox", backgroundColor: "#DED1F2" } }
          : { ok: true, data: { incoming: [{ requestRef: "r1" }], outgoing: [] } },
      },
    },
    source: {
      read: () => ({ state: { scope: "a", credential: "test" }, accountId: "a", storedOwner: "a", generation: 1, checkRunning: false }),
      subscribe: () => () => {},
    },
  }) as unknown as AppSocial,
}));
// The modals have their own tests; here only whether the header opens them.
vi.mock("@/components/StatsModal", () => ({
  StatsModal: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="Stats" /> : null),
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

import { MinimalHeader } from "@/components/MinimalHeader";
import { gameCatalog } from "@/lib/gameCatalog";

const BRAND_ICON = gameCatalog.find((game) => game.id === "rainbow")!.iconSrc;

function renderHeader() {
  return render(<MemoryRouter initialEntries={["/friends"]}><MinimalHeader /></MemoryRouter>);
}
const header = () => screen.getByTestId("app-header");

beforeEach(() => {
  session = { user: { id: "u1", email: "player@example.test" } };
  vi.stubEnv("VITE_SHARED_SOCIAL", "beta");
});
afterEach(() => vi.unstubAllEnvs());

describe("app header bar", () => {
  it("runs menu, brand, then stats, archive, settings and the profile last, with no book icon", async () => {
    renderHeader();
    // The profile menu is a lazy chunk; a loaded machine can take over a second to bring it in.
    await screen.findByRole("button", { name: "Profile menu, 1 pending notification" }, { timeout: 15000 });
    const names = Array.from(header().querySelectorAll("a, button")).map((el) => el.getAttribute("aria-label"));
    expect(names).toEqual(["Menu", "Home", "My stats", "Puzzle archive", "Settings", "Profile menu, 1 pending notification"]);
    expect(within(header()).queryByRole("link", { name: /how to play/i })).toBeNull();
    expect(header().querySelector(".lucide-book-open")).toBeNull();
    expect(within(header()).getByRole("link", { name: "Puzzle archive" })).toHaveAttribute("href", "/archive");
    // Archive is the plain calendar: no archive box, no page-turn corner.
    const archive = within(header()).getByRole("link", { name: "Puzzle archive" });
    expect(archive.querySelector(".lucide-calendar")).not.toBeNull();
    expect(header().querySelector(".lucide-archive, .lucide-calendar-fold")).toBeNull();
  });

  it("keeps every control a 44px target with a 24px glyph", () => {
    renderHeader();
    for (const name of ["Menu", "My stats", "Puzzle archive", "Settings"]) {
      const control = within(header()).getByLabelText(name);
      expect(control.className).toContain("h-11");
      expect(control.className).toContain("w-11");
      const glyph = control.querySelector("svg")!;
      expect(glyph.getAttribute("class")).toContain("h-6");
      expect(glyph.getAttribute("class")).toContain("w-6");
    }
    expect(within(header()).getByRole("link", { name: "Home" }).className).toContain("h-11");
  });

  it("shows the 3×3 brand icon below md and the one-line wordmark from md, both linking home", () => {
    renderHeader();
    const home = within(header()).getByRole("link", { name: "Home" });
    expect(home).toHaveAttribute("href", "/");
    const icon = screen.getByTestId("brand-icon");
    expect(icon.className).toContain("md:hidden");
    expect(icon.className).toContain("h-10");
    expect(icon.querySelector("img")).toHaveAttribute("src", BRAND_ICON);
    expect(BRAND_ICON).toMatch(/^\/icons\/rainbow-icon-192-[0-9a-f]+\.png$/);
    const wordmark = screen.getByTestId("brand-wordmark");
    expect(wordmark.className).toContain("hidden");
    expect(wordmark.className).toContain("md:block");
  });

  it("opens stats from its button", () => {
    renderHeader();
    fireEvent.click(screen.getByRole("button", { name: "My stats" }));
    expect(screen.getByRole("dialog", { name: "Stats" })).toBeInTheDocument();
  });

  it("leaves the signed-out control to PlayerAuth", async () => {
    session = null;
    renderHeader();
    await act(async () => {});
    expect(within(header()).queryByRole("button", { name: /^Profile menu/ })).toBeNull();
  });
});

describe("hamburger drawer", () => {
  it("lists only the existing destinations, closes on Escape and returns focus to the hamburger", async () => {
    renderHeader();
    const trigger = screen.getByRole("button", { name: "Menu" });
    fireEvent.click(trigger);
    const drawer = await screen.findByRole("dialog", { name: "Menu" });
    const links = within(drawer).getAllByRole("link").map((link) => [link.textContent, link.getAttribute("href")]);
    expect(links).toEqual([
      ["Today's puzzle", "/"],
      ["Rainbow Mini", "/mini"],
      ["Puzzle archive", "/archive"],
      ["Mini archive", "/mini/archive"],
      ["Create a puzzle", "/create"],
      ["How to play", "/how-to-play"],
      ["Friends & Groups", "/friends"],
    ]);
    expect(within(drawer).getByRole("link", { name: "Friends & Groups" })).toHaveAttribute("aria-current", "page");
    expect(within(drawer).getByRole("button", { name: "Give feedback" })).toBeInTheDocument();
    const close = within(drawer).getByRole("button", { name: "Close menu" });
    expect(close.className).toContain("h-11");

    fireEvent.keyDown(drawer, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it("sends Friends & Groups to the Friends home, even from /friends", async () => {
    function Where() {
      const location = useLocation();
      return <p data-testid="where">{`${location.pathname} ${JSON.stringify(location.state)}`}</p>;
    }
    render(<MemoryRouter initialEntries={["/friends"]}><MinimalHeader /><Where /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Menu" })).getByRole("link", { name: "Friends & Groups" }));
    expect(screen.getByTestId("where")).toHaveTextContent('/friends {"friendsHome":true}');
  });

  it("the close button closes it too, and focus returns", async () => {
    renderHeader();
    const trigger = screen.getByRole("button", { name: "Menu" });
    fireEvent.click(trigger);
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Menu" })).getByRole("button", { name: "Close menu" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it("hides Friends & Groups outside the beta", async () => {
    vi.stubEnv("VITE_SHARED_SOCIAL", "off");
    renderHeader();
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    const drawer = await screen.findByRole("dialog", { name: "Menu" });
    expect(within(drawer).queryByRole("link", { name: "Friends & Groups" })).toBeNull();
    expect(within(drawer).getAllByRole("link")).toHaveLength(6);
  });

  it("Give feedback closes the drawer and opens the existing feedback dialog", async () => {
    renderHeader();
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Menu" })).getByRole("button", { name: "Give feedback" }));
    await screen.findByRole("dialog", { name: "Feedback" });
    expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull();
  });

  it("after Give feedback, closing the feedback dialog returns focus to the hamburger", async () => {
    renderHeader();
    const trigger = screen.getByRole("button", { name: "Menu" });
    fireEvent.click(trigger);
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Menu" })).getByRole("button", { name: "Give feedback" }));
    const feedback = await screen.findByRole("dialog", { name: "Feedback" });
    await waitFor(() => expect(feedback.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Feedback" })).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(document.activeElement).not.toBe(document.body);
  });
});
