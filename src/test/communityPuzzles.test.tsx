/**
 * Community Puzzles preview: the flag, the menu row it adds (and nothing else
 * when off), the browse view's states, and the client mapping. The listing
 * rules themselves are enforced and tested in SQL (npm run e2e:db:community)
 * and through the real app (npm run e2e:community).
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { communityPuzzlesOn } from "@/lib/communityFlag";
import { AppMenuDrawer } from "@/components/AppMenuDrawer";
import { CommunityView } from "@/pages/Community";
import { listCommunityPuzzles, type CommunityPuzzleListing } from "@/lib/customPuzzles";

const EXISTING = ["Today's puzzle", "Rainbow Mini", "Puzzle archive", "Mini archive", "Create a puzzle", "How to play"];

async function menuLinks() {
  render(<MemoryRouter><AppMenuDrawer onFeedback={() => {}} /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "Menu" }));
  const nav = await screen.findByRole("navigation", { name: "Main menu" });
  return within(nav).getAllByRole("link").map((a) => a.textContent);
}

describe("communityPuzzlesOn", () => {
  it("is on only for the explicit preview value", () => {
    expect(communityPuzzlesOn("preview")).toBe(true);
    for (const v of [undefined, "", "true", "on", "beta", "PREVIEW", true, 1]) expect(communityPuzzlesOn(v)).toBe(false);
  });
});

describe("menu", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("flag off: exactly the existing links, no Community row", async () => {
    vi.stubEnv("VITE_COMMUNITY_PUZZLES", "");
    expect(await menuLinks()).toEqual(EXISTING);
  });

  it("flag on: Community Puzzles sits before Create, every existing link kept", async () => {
    vi.stubEnv("VITE_COMMUNITY_PUZZLES", "preview");
    const links = await menuLinks();
    expect(links.filter((l) => l !== "Community Puzzles")).toEqual(EXISTING);
    expect(links.indexOf("Community Puzzles")).toBe(links.indexOf("Create a puzzle") - 1);
  });
});

const items: CommunityPuzzleListing[] = [
  { title: "A Little Offbeat", creatorName: "Wren Halloway", creatorSlug: "wren-halloway-ab12", mode: "rainbow", shortCode: "md42M6fUAj", finishedPlays: 12, favoriteCount: 2 },
  { title: "The Usual Suspects", creatorName: "Odie Marsh", creatorSlug: null, mode: "classic", shortCode: "Qbw9MZ6wkA", finishedPlays: 1, favoriteCount: 0 },
];

function view(over: Partial<Parameters<typeof CommunityView>[0]> = {}) {
  const props = {
    query: "", onQuery: vi.fn(), sort: "newest" as const, onSort: vi.fn(), status: "ready" as const, items, hasMore: false,
    loadingMore: false, moreError: false, onRetry: vi.fn(), onMore: vi.fn(), shownQuery: "", ...over,
  };
  render(<MemoryRouter><CommunityView {...props} /></MemoryRouter>);
  return props;
}

describe("CommunityView", () => {
  it("shows the heading, Create link, sorts and cards linking to the existing share route", () => {
    const p = view();
    expect(screen.getByRole("heading", { level: 1, name: "Community Puzzles" })).toBeTruthy();
    expect(screen.getByText("Play puzzles made by other Rainbow players.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Create A Puzzle/ }).getAttribute("href")).toBe("/create");
    expect(screen.getByRole("link", { name: "A Little Offbeat" }).getAttribute("href")).toBe("/p/md42M6fUAj");
    expect(screen.getByRole("link", { name: "Wren Halloway" }).getAttribute("href")).toBe("/creator/wren-halloway-ab12");
    // No profile: the name is plain text, never a guessed link.
    expect(screen.queryByRole("link", { name: "Odie Marsh" })).toBeNull();
    expect(screen.getByText("12 plays")).toBeTruthy();
    expect(screen.getByText("1 play")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Newest" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Most Played" }));
    expect(p.onSort).toHaveBeenCalledWith("plays");
  });

  it("loading, error with Retry, empty feed, no matches, and Show more", () => {
    const { unmount } = render(<MemoryRouter><CommunityView query="" onQuery={vi.fn()} sort="newest" onSort={vi.fn()} status="loading" items={[]} hasMore={false} loadingMore={false} moreError={false} onRetry={vi.fn()} onMore={vi.fn()} shownQuery="" /></MemoryRouter>);
    expect(screen.getByTestId("community-loading")).toBeTruthy();
    expect(screen.getByRole("main").getAttribute("aria-busy")).toBe("true");
    unmount();

    const failed = view({ status: "error", items: [] });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(failed.onRetry).toHaveBeenCalled();
    screen.getByText("Couldn't load Community puzzles.");
    document.body.innerHTML = "";

    view({ items: [] });
    screen.getByText("No Community puzzles yet.");
    document.body.innerHTML = "";

    const none = view({ items: [], query: "zzz", shownQuery: "zzz" });
    screen.getByText("No puzzles match “zzz”.");
    // The input's ✕ and the empty state both clear the search.
    for (const b of screen.getAllByRole("button", { name: "Clear search" })) fireEvent.click(b);
    expect(none.onQuery).toHaveBeenCalledTimes(2);
    expect(none.onQuery).toHaveBeenCalledWith("");
    document.body.innerHTML = "";

    const more = view({ hasMore: true });
    fireEvent.click(screen.getByRole("button", { name: "Show more puzzles" }));
    expect(more.onMore).toHaveBeenCalled();
  });
});

describe("listCommunityPuzzles", () => {
  beforeEach(() => rpc.mockReset());

  it("sends a bounded request and maps card fields only", async () => {
    rpc.mockResolvedValue({
      data: { items: [{ title: "A Little Offbeat", creator_name: "Wren Halloway", creator_slug: null, mode: "rainbow", short_code: "md42M6fUAj", finished_plays: 3, favorite_count: 1, listed_at: "2026-11-01" }], has_more: true },
      error: null,
    });
    const page = await listCommunityPuzzles({ query: "  wren ", sort: "plays", offset: 24 });
    expect(rpc).toHaveBeenCalledWith("list_community_puzzles", { _query: "wren", _sort: "plays", _limit: 24, _offset: 24 });
    expect(page).toEqual({ hasMore: true, items: [{ title: "A Little Offbeat", creatorName: "Wren Halloway", creatorSlug: null, mode: "rainbow", shortCode: "md42M6fUAj", finishedPlays: 3, favoriteCount: 1 }] });
  });

  it("throws on failure, so the page can offer Retry instead of an empty feed", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "down" } });
    await expect(listCommunityPuzzles({})).rejects.toBeTruthy();
  });
});
