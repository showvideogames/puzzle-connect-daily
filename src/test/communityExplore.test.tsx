/**
 * Community part 3, Explore's home: a human-chosen Featured Puzzle and
 * Editor's Picks shown only when they exist (no empty shells), Newest always,
 * covers that come from the short code alone, and a visible Play and bookmark
 * per card. Server rules: npm run e2e:db:curation; real app: explore.spec.ts.
 */
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}));
vi.mock("@/components/SEO", () => ({ SEO: () => null }));

import CommunityPage from "@/pages/Community";
import { COVER_IDS, coverFor } from "@/lib/puzzleCovers";
import { PuzzleCover } from "@/components/community/PuzzleCover";

const row = (title: string, code: string, creator = "Wren Halloway", slug: string | null = "wren-halloway-ab12", plays = 0) => ({
  title, creator_name: creator, creator_slug: slug, mode: "classic", short_code: code, finished_plays: plays, favorite_count: 0, listed_at: "2026-11-01T00:00:00Z",
});
const answers: Record<string, unknown> = {};
beforeEach(() => {
  rpc.mockReset();
  localStorage.clear();
  for (const k of Object.keys(answers)) delete answers[k];
  answers.get_custom_puzzle_cards = [];
  rpc.mockImplementation(async (name: string) => (name in answers ? { data: answers[name], error: null } : { data: null, error: { message: `unexpected ${name}` } }));
});
const renderHome = () => render(<MemoryRouter initialEntries={["/community"]}><CommunityPage /></MemoryRouter>);

describe("Explore home", () => {
  it("shows the Featured Puzzle, Editor's Picks in order, and Newest independently", async () => {
    answers.get_community_explore = { featured: row("Pantry Raid", "PantryAAAA"), picks: [row("Turn Of The Tides", "TidesAAAAA", "Odie Marsh", "odie-marsh-cd34"), row("Something In The Air", "AirAAAAAAA", "Pia", null, 4)] };
    answers.list_community_newest = { items: [row("Fictional Fresh", "FreshAAAAA"), row("Pantry Raid", "PantryAAAA")], has_more: false };
    renderHome();
    const featured = await screen.findByTestId("featured-puzzle");
    expect(within(featured).getByText("Featured Puzzle")).toBeTruthy();
    expect(within(featured).getByRole("link", { name: "Play Puzzle Pantry Raid" }).getAttribute("href")).toBe("/p/PantryAAAA");
    expect(within(featured).getByRole("button", { name: "Save Pantry Raid to Favorites" })).toBeTruthy();
    const picks = screen.getByTestId("picks-grid");
    expect(within(picks).getAllByTestId("card-title").map((e) => e.textContent)).toEqual(["Turn Of The Tides", "Something In The Air"]);
    expect(within(picks).getByRole("link", { name: "Odie Marsh" }).getAttribute("href")).toBe("/creator/odie-marsh-cd34?view=community");
    expect(within(picks).queryByRole("link", { name: "Pia" })).toBeNull(); // no profile: plain credit
    expect(within(picks).getByText("4 plays")).toBeTruthy();
    expect(screen.queryByText(/^0 plays$/)).toBeNull(); // no empty counts
    // Newest: everything listed, by the server's first-listing order; the Featured Puzzle may appear there too.
    expect(within(screen.getByTestId("newest-list")).getAllByTestId("card-title").map((e) => e.textContent)).toEqual(["Fictional Fresh", "Pantry Raid"]);
    expect(screen.getByRole("link", { name: "See all newest puzzles" }).getAttribute("href")).toBe("/community?view=newest");
    expect(screen.getByRole("link", { name: "Create A Puzzle" }).getAttribute("href")).toBe("/create");
    expect(rpc).toHaveBeenCalledWith("list_community_newest", { _limit: 6, _before_listed_at: undefined, _before_short_code: undefined });
  });

  it("no selections, or curation unavailable: no editorial shells, Newest leads", async () => {
    answers.get_community_explore = { featured: null, picks: [] };
    answers.list_community_newest = { items: [row("Fictional Fresh", "FreshAAAAA")], has_more: false };
    const { unmount } = renderHome();
    expect(await screen.findByTestId("newest-list")).toBeTruthy();
    expect(screen.queryByTestId("featured-puzzle")).toBeNull();
    expect(screen.queryByText("Featured Puzzle")).toBeNull();
    expect(screen.queryByTestId("editors-picks")).toBeNull();
    unmount();
    delete answers.get_community_explore; // the call fails
    renderHome();
    expect(await screen.findByTestId("newest-list")).toBeTruthy();
    expect(screen.queryByTestId("featured-puzzle")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("covers", () => {
  it("come only from the short code: stable, independent of the title, from a small set", () => {
    expect(coverFor("V2ZEmrAYFs")).toEqual(coverFor("V2ZEmrAYFs"));
    const seen = new Set(Array.from({ length: 400 }, (_, i) => coverFor(`code${i}x`).scene));
    expect([...seen].sort()).toEqual([...COVER_IDS].sort());
    expect(coverFor.length).toBe(1); // nothing but the code goes in
  });

  it("are decorative pictures with no text", () => {
    for (const scene of COVER_IDS) {
      const { container, unmount } = render(<PuzzleCover cover={coverFor(`seed-${scene}`)} />);
      const svg = container.querySelector("svg")!;
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(svg.textContent).toBe("");
      expect(svg.querySelector("text")).toBeNull();
      unmount();
    }
  });
});
