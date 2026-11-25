/**
 * Community Puzzles preview: the flag, the menu row it adds (and nothing else
 * when off), the browse view's states, and the client mapping. The listing
 * rules themselves are enforced and tested in SQL (npm run e2e:db:community)
 * and through the real app (npm run e2e:community). The Explore / Following /
 * Favorites page is covered in communityFollowing.test.tsx.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { communityPuzzlesOn } from "@/lib/communityFlag";
import { AppMenuDrawer } from "@/components/AppMenuDrawer";
import { listCommunityPuzzles } from "@/lib/customPuzzles";

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
