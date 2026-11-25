/**
 * Community part 2 in the client: the card's Community layout (bookmark, violet
 * byline to the creator page's Community view), the monogram avatar, and that
 * bookmarks go through the EXISTING Favorites stores (account RPC when signed
 * in, the guest's device-only `custom-favorite:` flags otherwise), never a new one.
 * The server rules are in npm run e2e:db:follows; the real app in npm run e2e:community.
 */
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
let session: { user: { id: string } } | null = null;
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}));
vi.mock("@/components/GameHeader", () => ({ GameHeader: () => <header>header</header> }));
vi.mock("@/components/SEO", () => ({ SEO: () => null }));

import { CommunityPuzzleCard } from "@/components/CommunityPuzzleCard";
import { CreatorAvatar } from "@/components/community/CreatorAvatar";
import { creatorColor, creatorInitials } from "@/lib/creatorAvatar";
import { useCommunitySaves } from "@/hooks/useCommunitySaves";
import { listLocalFavorites } from "@/lib/customPuzzles";
import { PROFILE_COLORS } from "@/lib/sharedProfile";
import CommunityPage from "@/pages/Community";

const answers: Record<string, unknown> = {};
beforeEach(() => {
  rpc.mockReset();
  localStorage.clear();
  session = null;
  for (const k of Object.keys(answers)) delete answers[k];
  rpc.mockImplementation(async (name: string) => (name in answers ? { data: answers[name], error: null } : { data: null, error: { message: `unexpected ${name}` } }));
});

describe("CommunityPuzzleCard, Community layout", () => {
  it("puts the bookmark top right and links the byline, in violet, to the creator's Community view", () => {
    const onToggle = vi.fn();
    render(<MemoryRouter><ul><CommunityPuzzleCard title="Pantry Raid" shortCode="V2ZEmrAYFs" mode="classic" designerName="Wren Halloway" creatorSlug="wren-halloway-ab12" finishedPlays={7} favoriteCount={1} community={{ bookmark: { saved: true, onToggle } }} /></ul></MemoryRouter>);
    const save = screen.getByRole("button", { name: "Save Pantry Raid to Favorites" });
    expect(save.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(save);
    expect(onToggle).toHaveBeenCalled();
    const byline = screen.getByRole("link", { name: "Wren Halloway" });
    expect(byline.getAttribute("href")).toBe("/creator/wren-halloway-ab12?view=community");
    expect(byline.className).toContain("text-violet-700");
    expect(screen.getByRole("link", { name: "Pantry Raid" }).getAttribute("href")).toBe("/p/V2ZEmrAYFs");
  });

  it("without the Community prop renders as before: no bookmark, plain profile link", () => {
    render(<MemoryRouter><ul><CommunityPuzzleCard title="Pantry Raid" shortCode="V2ZEmrAYFs" mode="classic" designerName="Wren Halloway" creatorSlug="wren-halloway-ab12" favoriteCount={1} /></ul></MemoryRouter>);
    expect(screen.queryByRole("button", { name: /Save/ })).toBeNull();
    expect(screen.getByRole("link", { name: "Wren Halloway" }).getAttribute("href")).toBe("/creator/wren-halloway-ab12");
  });
});

describe("CreatorAvatar", () => {
  it("draws initials from the public name on a stable approved colour", () => {
    expect(creatorInitials("Wren Halloway")).toBe("WH");
    expect(creatorInitials("Pia Maria Lindqvist")).toBe("PL");
    expect(creatorInitials("cher")).toBe("C");
    expect(creatorInitials("   ")).toBe("?");
    expect(creatorColor("wren-halloway-ab12")).toBe(creatorColor("wren-halloway-ab12"));
    expect(PROFILE_COLORS.map((c) => c.hex)).toContain(creatorColor("anything-at-all"));
    render(<CreatorAvatar name="Wren Halloway" slug="wren-halloway-ab12" />);
    expect(screen.getByTestId("creator-avatar").getAttribute("aria-hidden")).toBe("true");
  });
});

const card = { title: "Pantry Raid", creatorName: "Wren Halloway", creatorSlug: "wren-halloway-ab12", mode: "classic" as const, shortCode: "V2ZEmrAYFs", finishedPlays: 7, favoriteCount: 2 };

describe("bookmarks are the existing Favorites", () => {
  it("guest: lists this device's saves and toggles the same custom-favorite:<shareId> flag the puzzle page uses", async () => {
    localStorage.setItem("custom-favorite:legacy-share-id", "1");
    localStorage.setItem("custom-favorite:removed", "0");
    localStorage.setItem("unrelated", "1");
    expect(listLocalFavorites()).toEqual(["legacy-share-id"]);
    answers.get_custom_puzzle_cards = [{ share_id: "legacy-share-id", title: "Link Only Lighthouse", creator_name: "Pia", creator_slug: null, mode: "classic", short_code: "7BKyNbzY7j", finished_plays: 50, favorite_count: 0 }];
    answers.custom_puzzle_share_id = "pantry-share-id";
    const { result } = renderHook(() => useCommunitySaves(null));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.items.map((i) => i.title)).toEqual(["Link Only Lighthouse"]);
    expect(rpc).toHaveBeenCalledWith("get_custom_puzzle_cards", { _share_ids: ["legacy-share-id"] });

    await act(async () => { await result.current.toggle(card); });
    expect(localStorage.getItem("custom-favorite:pantry-share-id")).toBe("1");
    expect(result.current.saved.has("V2ZEmrAYFs")).toBe(true);
    expect(rpc.mock.calls.map(([n]) => n)).not.toContain("set_custom_puzzle_favorite");
    await act(async () => { await result.current.toggle(card); });
    expect(localStorage.getItem("custom-favorite:pantry-share-id")).toBeNull();
  });

  it("signed in: reads get_my_favorites and saves with set_custom_puzzle_favorite, never on the device", async () => {
    answers.get_my_favorites = [{ title: "Pantry Raid", creator_name: "Wren Halloway", creator_slug: "wren-halloway-ab12", mode: "classic", short_code: "V2ZEmrAYFs", favorite_count: 2 }];
    answers.custom_puzzle_share_id = "pantry-share-id";
    answers.set_custom_puzzle_favorite = { favorited: false, favorite_count: 1 };
    const { result } = renderHook(() => useCommunitySaves("account-1"));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.saved.has("V2ZEmrAYFs")).toBe(true);
    let count: number | null = null;
    await act(async () => { count = await result.current.toggle(card); });
    expect(rpc).toHaveBeenCalledWith("set_custom_puzzle_favorite", { _share_id: "pantry-share-id", _favorite: false });
    expect(count).toBe(1);
    expect(result.current.saved.has("V2ZEmrAYFs")).toBe(false);
    expect(listLocalFavorites()).toEqual([]);
  });

  it("a failed account save is rolled back and says so", async () => {
    answers.get_my_favorites = [];
    answers.custom_puzzle_share_id = "pantry-share-id";
    const { result } = renderHook(() => useCommunitySaves("account-1"));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    await act(async () => { await result.current.toggle(card); });
    expect(result.current.saved.has("V2ZEmrAYFs")).toBe(false);
    expect(result.current.note).toBe("Couldn't save. Try again.");
  });
});

function renderPage(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><CommunityPage /></MemoryRouter>);
}

describe("Community page, guest", () => {
  it("Explore is the default tab, with Newest selected and Puzzles mode", async () => {
    answers.list_community_puzzles = { items: [], has_more: false };
    answers.get_custom_puzzle_cards = [];
    renderPage("/community");
    expect(screen.getByRole("link", { name: "Explore" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "Newest" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Puzzles" }).getAttribute("aria-pressed")).toBe("true");
    expect(await screen.findByText("No Community puzzles yet.")).toBeTruthy();
    // No unplayed filter: Rainbow has no reliable per-player play record for custom puzzles.
    expect(screen.queryByRole("button", { name: /unplayed/i })).toBeNull();
  });

  it("Creators mode searches creators and hides the puzzle sort", async () => {
    answers.search_community_creators = { items: [{ display_name: "Wren Halloway", public_slug: "wren-halloway-ab12", listed_count: 2, follower_count: 3, followed_by_me: false, is_me: false }], has_more: false };
    answers.get_custom_puzzle_cards = [];
    renderPage("/community?mode=creators");
    expect(await screen.findByRole("link", { name: "Wren Halloway" })).toBeTruthy();
    expect(screen.getByText("2 puzzles in Community · 3 followers")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Sort puzzles" })).toBeNull();
    expect(screen.getByRole("searchbox", { name: "Search creators" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Follow Wren Halloway" }));
    expect(await screen.findByText("Sign in to follow creators.")).toBeTruthy();
    expect(rpc.mock.calls.map(([n]) => n)).not.toContain("set_creator_follow");
  });

  it("Following asks a guest to sign in, never calls the feed", async () => {
    answers.get_custom_puzzle_cards = [];
    renderPage("/community?tab=following");
    expect(await screen.findByText("Follow creators to see their newest puzzles here.")).toBeTruthy();
    expect(rpc.mock.calls.map(([n]) => n)).not.toContain("get_following_feed");
  });

  it("Favorites says it is private and device-only for a guest", async () => {
    answers.get_custom_puzzle_cards = [];
    renderPage("/community?tab=favorites");
    expect(await screen.findByText("No favorites yet.")).toBeTruthy();
    expect(screen.getByText(/Saved on this device only, and only you can see them/)).toBeTruthy();
  });
});
