/**
 * My Puzzles in the client: the ways in (profile menu, Settings, account
 * menu) and the defensive reading of list_my_custom_puzzles. The server side
 * (owner-only, fields, bounds) is npm run e2e:db:my-puzzles; the page itself
 * runs against the local stack in e2e/community/my-puzzles.spec.ts.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args), auth: { getSession: () => Promise.resolve({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } },
}));

import { ProfileMenu } from "@/components/account/ProfileMenu";
import { PlayerAuth } from "@/components/PlayerAuth";
import { SettingsModal } from "@/components/SettingsModal";
import { listMyPuzzles } from "@/lib/customPuzzles";
import { loadSettings } from "@/lib/settings";

const user = { id: "u1", email: "maker@example.invalid" } as User;
function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}
afterEach(() => rpc.mockReset());

describe("ways in", () => {
  it("the profile menu offers My puzzles only when a page passes it", async () => {
    const onMyPuzzles = vi.fn();
    const { unmount } = render(<ProfileMenu signedIn profile={null} pendingCount={0} onProfile={vi.fn()} onFriends={vi.fn()} onAccount={vi.fn()} onMyPuzzles={onMyPuzzles} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Profile menu" }), { key: "Enter", code: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "My puzzles" }));
    expect(onMyPuzzles).toHaveBeenCalledTimes(1);
    unmount();
    render(<ProfileMenu signedIn profile={null} pendingCount={0} onProfile={vi.fn()} onFriends={vi.fn()} onAccount={vi.fn()} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Profile menu" }), { key: "Enter", code: "Enter" });
    expect(await screen.findByRole("menuitem", { name: "My profile" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "My puzzles" })).toBeNull();
  });

  it("Settings shows My Puzzles to a signed-in player, which opens /my-puzzles, and never to a guest", () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <MemoryRouter>
        <SettingsModal open onClose={onClose} settings={loadSettings()} onSettingsChange={vi.fn()} showMenuLinks user={user} onSignOut={vi.fn()} />
        <Where />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "My Puzzles" }));
    expect(onClose).toHaveBeenCalled();
    expect(screen.getByTestId("where")).toHaveTextContent("/my-puzzles");
    unmount();
    render(
      <MemoryRouter>
        <SettingsModal open onClose={vi.fn()} settings={loadSettings()} onSettingsChange={vi.fn()} showMenuLinks user={null} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("button", { name: "My Puzzles" })).toBeNull();
  });

  it("the signed-in account menu links to My puzzles", () => {
    render(<MemoryRouter><PlayerAuth user={user} onSignOut={vi.fn()} forceOpen /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "My puzzles" })).toHaveAttribute("href", "/my-puzzles");
  });
});

describe("listMyPuzzles", () => {
  it("maps the owner's rows and drops anything malformed to a safe default", async () => {
    rpc.mockResolvedValue({
      data: {
        items: [
          { share_id: "s1", short_code: "Abcdefgh2", title: "Mixtape Memories", creator_name: "Wren", mode: "classic", visibility: "public", hidden: false, listed: false, can_list: true, created_at: "2025-03-14T10:00:00Z", cover_emoji: null, cover_emoji_2: null, cover_emoji_3: null, cover_background: null },
          { share_id: "s2", short_code: "Abcdefgh3", title: "Night Owls", creator_name: "Wren", mode: "rainbow", visibility: "private", hidden: false, listed: false, can_list: false, created_at: "2026-11-20T10:00:00Z", cover_emoji: "1F989", cover_emoji_2: "1F989", cover_emoji_3: null, cover_background: "indigo-stars" },
          { share_id: "s3", short_code: "Abcdefgh4", title: "Odd", creator_name: "Wren", mode: "<b>", visibility: "weird", hidden: 1, listed: true, can_list: true, created_at: "2026-11-21T10:00:00Z", cover_emoji: "1F438", cover_background: "url(x)" },
        ],
        has_more: true,
        total: 30,
      },
      error: null,
    });
    const r = await listMyPuzzles({ offset: 24 });
    expect(rpc).toHaveBeenCalledWith("list_my_custom_puzzles", { _limit: 24, _offset: 24 });
    expect(r.hasMore).toBe(true);
    expect(r.total).toBe(30);
    expect(r.items.map((p) => [p.title, p.mode, p.visibility, p.hidden, p.listed, p.canList, p.cover])).toEqual([
      ["Mixtape Memories", "classic", "public", false, false, true, null],
      ["Night Owls", "rainbow", "private", false, false, false, null], // a repeated emoji is no cover at all
      ["Odd", "classic", "public", true, true, true, null],
    ]);
  });

  it("throws when the server refuses (signed out)", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "sign in to see your puzzles" } });
    await expect(listMyPuzzles()).rejects.toMatchObject({ message: "sign in to see your puzzles" });
  });
});
