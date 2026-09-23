/**
 * Custom Puzzle Community layer: type badge, header Create action, short
 * links, favorites, creator profiles, and result sharing.
 *
 * Uses the REAL wrappers (lib/customPuzzles), hook (useCustomFavorite),
 * components and share-text builders against the in-memory Supabase fake. The
 * fake only mirrors the SQL; the SQL itself (backfill, collision retry,
 * privacy, cascades) was executed on a real Postgres engine when the
 * 20260920000000 migration was written.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { FakeSupabase, rowId } from "./fakeSupabase";

const db = new FakeSupabase();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => db.from(t),
    rpc: (n: string, a: Record<string, unknown>) => db.rpc(n, a),
    auth: {
      getUser: () => db.auth.getUser(),
      getSession: async () => {
        const id = db.currentUserId();
        return { data: { session: id ? { user: { id } } : null } };
      },
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signOut: async () => {},
    },
  },
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: () => {} }));
// The board is not under test here; it just reports which puzzle identity it was given.
vi.mock("@/components/GameBoard", () => ({
  GameBoard: ({ puzzle }: { puzzle: { id: string; shortCode?: string | null } }) => (
    <div data-testid="board" data-puzzle-id={puzzle.id} data-short-code={puzzle.shortCode ?? ""} />
  ),
}));

import {
  createCustomPuzzle,
  customPuzzlePath,
  getCreatorProfile,
  getCustomPuzzleByShareId,
  getCustomPuzzleByShortCode,
  getMyFavorites,
  isLocalFavorite,
  setCustomPuzzleFavorite,
  type CreateCustomPuzzleInput,
} from "@/lib/customPuzzles";
import { useCustomFavorite } from "@/hooks/useCustomFavorite";
import { buildCustomShareText, buildOfficialShareText, shareLinkText } from "@/lib/shareText";
import { CustomPuzzleHeader } from "@/components/CustomPuzzleHeader";
import { FavoriteButton } from "@/components/FavoriteButton";
import { GameHeader } from "@/components/GameHeader";
import CustomPuzzle from "@/pages/CustomPuzzle";
import CreatorProfilePage from "@/pages/CreatorProfile";

const SHORT_CODE = /^[2-9A-HJKMNP-Za-hjkmnp-z]{10}$/;
const U1 = "user-1";
const U2 = "user-2";

const input = (over: Partial<CreateCustomPuzzleInput> = {}, mode: "classic" | "rainbow" = "classic"): CreateCustomPuzzleInput => ({
  creatorName: "Sam West",
  title: "Golf Words",
  visibility: "public",
  content: {
    mode,
    groups: [
      { category: "Colors", words: ["BLUE", "GREEN", "RED", "YELLOW"], hintWord: null },
      { category: "Car Parts", words: ["BATTERY", "HOOD", "TIRE", "TRUNK"], hintWord: null },
      { category: "Singers", words: ["HOUSTON", "MARS", "MERCURY", "SWIFT"], hintWord: null },
      { category: "House", words: ["BIRD", "DOG", "TREE", "WHITE"], hintWord: null },
    ],
    wordOrder: [
      "BLUE", "GREEN", "RED", "YELLOW", "BATTERY", "HOOD", "TIRE", "TRUNK",
      "HOUSTON", "MARS", "MERCURY", "SWIFT", "BIRD", "DOG", "TREE", "WHITE",
    ],
    rainbowHerring: mode === "rainbow" ? ["BLUE", "TIRE", "SWIFT", "TREE"] : null,
    rainbowCategoryName: mode === "rainbow" ? "Mixed Bag" : null,
    rainbowHintWord: null,
    alphabetizeCompleted: true,
  },
  ...over,
});

async function mint() {
  const { data } = await db.rpc("create_device_identity");
  return (Array.isArray(data) ? data[0] : data) as { device_id: string; device_token: string };
}

beforeEach(async () => {
  for (const t of Object.keys(db.tables)) db.tables[t] = [];
  db.shortCodeQueue = [];
  db.shortCodeDraws = 0;
  db.rpcUnavailable = false;
  localStorage.clear();
  const id = await mint();
  localStorage.setItem("rc-device-id", id.device_id);
  localStorage.setItem("rc-device-token", id.device_token);
  db.signIn(null);
  db.writeLog = [];
  db.rpcLog = [];
});

// ── 1. Puzzle-type badge ────────────────────────────────────────────────────
describe("custom puzzle header: type badge and byline", () => {
  const renderHeader = (over: Partial<React.ComponentProps<typeof CustomPuzzleHeader>> = {}) =>
    render(
      <MemoryRouter>
        <CustomPuzzleHeader
          title="Golf Words"
          designerName="Sam West"
          creatorSlug={null}
          isRainbow={false}
          onBack={() => {}}
          onOpenPuzzleStats={() => {}}
          favorite={{ favorited: false, count: 0, onToggle: () => {} }}
          {...over}
        />
      </MemoryRouter>
    );

  it("a Classic puzzle shows the shared 4 GROUPS badge", () => {
    renderHeader({ isRainbow: false });
    const badge = screen.getByRole("button", { name: /4 groups puzzle mode/i });
    expect(badge).toHaveTextContent(/4 groups/i);
    expect(badge.className).toMatch(/uppercase/); // renders as 4 GROUPS, exactly like Archive
    expect(screen.queryByRole("button", { name: /rainbow puzzle mode/i })).toBeNull();
  });

  it("a Rainbow puzzle shows the shared RAINBOW badge", () => {
    renderHeader({ isRainbow: true });
    const badge = screen.getByRole("button", { name: /rainbow puzzle mode/i });
    expect(badge).toHaveTextContent(/rainbow/i);
    expect(badge.className).toMatch(/rainbow-tile/);
  });

  it("keeps the title, the Create back button, and the 'by Designer | badge' order", () => {
    renderHeader({ isRainbow: true });
    expect(screen.getByRole("heading", { level: 1, name: "Golf Words" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create/i })).toBeInTheDocument();
    const row = screen.getByTestId("custom-meta-row");
    expect(row.textContent).toMatch(/^by Sam West\|/);
    expect(within(row).getByRole("button", { name: /rainbow puzzle mode/i })).toBeInTheDocument();
  });

  it("the metadata row wraps and lets a long designer name break instead of overflowing", () => {
    const longName = "Bartholomew-Alexander ".repeat(3).trim() + " Wolfeschlegelsteinhausenbergerdorff";
    renderHeader({ designerName: longName });
    const row = screen.getByTestId("custom-meta-row");
    expect(row.className).toMatch(/flex-wrap/);
    const designer = screen.getByText(new RegExp(longName.slice(0, 20)));
    expect(designer.className).toMatch(/break-words/);
    expect(designer.className).toMatch(/max-w-full/);
    expect(designer.className).toMatch(/min-w-0/);
  });

  it("a signed-in creator's name links to their profile; an anonymous designer is plain text", () => {
    const { unmount } = renderHeader({ designerName: "Sam West", creatorSlug: "sam-west-k7m2" });
    expect(screen.getByRole("link", { name: "Sam West" })).toHaveAttribute("href", "/creator/sam-west-k7m2");
    unmount();

    renderHeader({ designerName: "Anon Designer", creatorSlug: null });
    expect(screen.getByText(/Anon Designer/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Anon Designer/ })).toBeNull();
  });
});

// ── 2. Header Create action ─────────────────────────────────────────────────
describe("shared header Create action", () => {
  const renderShared = (props: Partial<React.ComponentProps<typeof GameHeader>> = {}) =>
    render(
      <MemoryRouter>
        <GameHeader user={null} onSignOut={() => {}} simplifiedIcons wideHeader {...props} />
      </MemoryRouter>
    );

  it("renders a labelled link to /create (desktop label only; hidden on phones by CSS)", () => {
    renderShared({ onStatsClick: () => {}, onSettingsClick: () => {}, showHint: true, onHintClick: () => {} });
    const create = screen.getByRole("link", { name: "Create a puzzle" });
    expect(create).toHaveAttribute("href", "/create");
    expect(create).toHaveTextContent("+ Create a Puzzle");
    expect(create.className).toMatch(/bg-primary/); // the Ink primary treatment
  });

  it("leaves Help/Stats/Settings/logo intact", () => {
    renderShared({ onStatsClick: () => {}, onSettingsClick: () => {}, showHint: true, onHintClick: () => {} });
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("button", { name: "Get a hint" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "My stats" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /settings/i })).toBeInTheDocument();
  });

  it("a page with no stats to show can omit the stats icon", () => {
    renderShared({ onSettingsClick: () => {} });
    expect(screen.queryByRole("button", { name: "My stats" })).toBeNull();
  });
});

// ── 3. Short links ──────────────────────────────────────────────────────────
describe("short links", () => {
  it("a new puzzle receives a valid short code alongside its long share id", async () => {
    const r = await createCustomPuzzle(input());
    expect(r.shortCode).toMatch(SHORT_CODE);
    expect(r.shareId).toBeTruthy();
    expect(customPuzzlePath({ id: r.shareId, shortCode: r.shortCode })).toBe(`/p/${r.shortCode}`);
  });

  it("retries when a drawn code collides, and the puzzle still gets a unique one", async () => {
    const first = await createCustomPuzzle(input({ title: "First" }));
    db.shortCodeDraws = 0;
    db.shortCodeQueue = [first.shortCode!, first.shortCode!, "ZZZZZZZZ22"];
    const second = await createCustomPuzzle(input({ title: "Second" }));
    expect(second.shortCode).toBe("ZZZZZZZZ22");
    expect(second.shortCode).not.toBe(first.shortCode);
    expect(db.shortCodeDraws).toBe(3);
  });

  it("the long link and the short link load the same puzzle with the same identity", async () => {
    const r = await createCustomPuzzle(input({ title: "Same Puzzle" }, "rainbow"));
    const byLong = await getCustomPuzzleByShareId(r.shareId);
    const byShort = await getCustomPuzzleByShortCode(r.shortCode!);
    expect(byLong).not.toBeNull();
    expect(byShort).toEqual(byLong);
    // puzzle.id is the long share id on BOTH routes, which is what the local
    // progress key (custom:<shareId>), favorites and results are keyed on.
    expect(byShort!.puzzle.id).toBe(r.shareId);
    expect(byLong!.puzzle.id).toBe(r.shareId);
  });

  it("codes are case-sensitive", async () => {
    const r = await createCustomPuzzle(input());
    const swapped = r.shortCode!.split("").map((c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase())).join("");
    expect(await getCustomPuzzleByShortCode(swapped)).toBeNull();
    expect(await getCustomPuzzleByShortCode("nope")).toBeNull();
  });

  it("a legacy puzzle with no short code keeps its permanent long link", () => {
    expect(customPuzzlePath({ id: "abc123", shortCode: null })).toBe("/custom/abc123");
  });

  it("a Private puzzle opens by its exact code but never appears on a public creator page", async () => {
    db.signIn(U1);
    const pub = await createCustomPuzzle(input({ title: "Public One", visibility: "public" }));
    const priv = await createCustomPuzzle(input({ title: "Private One", visibility: "private" }));
    db.signIn(null);

    const opened = await getCustomPuzzleByShortCode(priv.shortCode!);
    expect(opened?.visibility).toBe("private");

    const slug = (await getCustomPuzzleByShortCode(pub.shortCode!))!.creatorSlug!;
    const profile = await getCreatorProfile(slug);
    expect(profile!.puzzles.map((p) => p.title)).toEqual(["Public One"]);
    expect(JSON.stringify(profile)).not.toContain(priv.shortCode!);
  });

  describe("both routes render the same puzzle without redirecting", () => {
    function LocationProbe() {
      return <span data-testid="loc">{useLocation().pathname}</span>;
    }
    const renderRoutes = (start: string) =>
      render(
        <HelmetProvider>
          <MemoryRouter initialEntries={[start]}>
            <LocationProbe />
            <Routes>
              <Route path="/p/:shortCode" element={<CustomPuzzle />} />
              <Route path="/custom/:shareId" element={<CustomPuzzle />} />
            </Routes>
          </MemoryRouter>
        </HelmetProvider>
      );

    it("/p/:shortCode and /custom/:shareId hand the board the same puzzle identity", async () => {
      const r = await createCustomPuzzle(input({ title: "Route Puzzle" }));

      const short = renderRoutes(`/p/${r.shortCode}`);
      const shortBoard = await screen.findByTestId("board");
      expect(shortBoard).toHaveAttribute("data-puzzle-id", r.shareId);
      expect(shortBoard).toHaveAttribute("data-short-code", r.shortCode!);
      expect(screen.getByTestId("loc")).toHaveTextContent(`/p/${r.shortCode}`); // no redirect
      short.unmount();

      renderRoutes(`/custom/${r.shareId}`);
      const longBoard = await screen.findByTestId("board");
      expect(longBoard).toHaveAttribute("data-puzzle-id", r.shareId);
      expect(longBoard).toHaveAttribute("data-short-code", r.shortCode!);
      expect(screen.getByTestId("loc")).toHaveTextContent(`/custom/${r.shareId}`); // old link stays as-is
      expect(screen.getByRole("heading", { level: 1, name: "Route Puzzle" })).toBeInTheDocument();
    });

    it("an unknown code shows the not-found state", async () => {
      renderRoutes("/p/AAAAAAAAAA");
      expect(await screen.findByText("Puzzle not found.")).toBeInTheDocument();
    });
  });
});

// ── 4. Favorites ────────────────────────────────────────────────────────────
describe("favorites", () => {
  it("a signed-in favorite creates exactly one row; repeats do not duplicate", async () => {
    const r = await createCustomPuzzle(input());
    db.signIn(U1);
    expect(await setCustomPuzzleFavorite(r.shareId, true)).toEqual({ favorited: true, favoriteCount: 1 });
    expect(await setCustomPuzzleFavorite(r.shareId, true)).toEqual({ favorited: true, favoriteCount: 1 });
    expect(db.tables.custom_puzzle_favorites).toHaveLength(1);
  });

  it("unfavorite removes only that user's favorite", async () => {
    const r = await createCustomPuzzle(input());
    db.signIn(U1);
    await setCustomPuzzleFavorite(r.shareId, true);
    db.signIn(U2);
    await setCustomPuzzleFavorite(r.shareId, true);
    expect(db.tables.custom_puzzle_favorites).toHaveLength(2);

    expect(await setCustomPuzzleFavorite(r.shareId, false)).toEqual({ favorited: false, favoriteCount: 1 });
    expect(db.tables.custom_puzzle_favorites.map((f) => f.user_id)).toEqual([U1]);
  });

  it("one user cannot modify another user's favorite", async () => {
    const r = await createCustomPuzzle(input());
    db.signIn(U1);
    await setCustomPuzzleFavorite(r.shareId, true);
    db.signIn(U2);
    // U2 has no favorite of their own: "unfavorite" must not touch U1's.
    await setCustomPuzzleFavorite(r.shareId, false);
    expect(db.tables.custom_puzzle_favorites.map((f) => f.user_id)).toEqual([U1]);
    // ...and the tables refuse direct writes/reads for every client role.
    expect((await db.from("custom_puzzle_favorites").insert({ custom_puzzle_id: "x", user_id: U2 })).error).toBeTruthy();
    expect((await db.from("custom_puzzle_favorites").select("*")).data).toEqual([]);
    expect((await db.from("creator_profiles").select("*")).data).toEqual([]);
  });

  it("the public count and favorited_by_me come from authenticated favorites only", async () => {
    const r = await createCustomPuzzle(input());
    db.signIn(U1);
    await setCustomPuzzleFavorite(r.shareId, true);
    expect((await getCustomPuzzleByShareId(r.shareId))!.favoritedByMe).toBe(true);
    db.signIn(U2);
    const asOther = (await getCustomPuzzleByShareId(r.shareId))!;
    expect(asOther.favoritedByMe).toBe(false);
    expect(asOther.favoriteCount).toBe(1);
    db.signIn(null);
    expect((await getCustomPuzzleByShareId(r.shareId))!.favoritedByMe).toBe(false);
  });

  it("a guest is refused by the database; no row is written", async () => {
    const r = await createCustomPuzzle(input());
    db.signIn(null);
    expect(await setCustomPuzzleFavorite(r.shareId, true)).toBeNull();
    expect(db.tables.custom_puzzle_favorites).toHaveLength(0);
  });

  it("logged-out favorites stay local, namespaced, and do not touch the public count", async () => {
    const r = await createCustomPuzzle(input());
    db.rpcLog = [];
    const { result } = renderHook(() =>
      useCustomFavorite({ shareId: r.shareId, serverFavorited: false, serverCount: 3, userId: null })
    );
    expect(result.current.favorited).toBe(false);
    await act(async () => { await result.current.toggle(); });

    expect(result.current.favorited).toBe(true);
    expect(result.current.count).toBe(3);
    expect(result.current.note).toBe("Saved on this device");
    expect(localStorage.getItem(`custom-favorite:${r.shareId}`)).toBe("1");
    expect(isLocalFavorite(r.shareId)).toBe(true);
    expect(db.rpcLog).not.toContain("set_custom_puzzle_favorite");
    expect(db.tables.custom_puzzle_favorites).toHaveLength(0);
    expect((await getCustomPuzzleByShareId(r.shareId))!.favoriteCount).toBe(0);

    // remembered on the next visit
    const again = renderHook(() =>
      useCustomFavorite({ shareId: r.shareId, serverFavorited: false, serverCount: 3, userId: null })
    );
    expect(again.result.current.favorited).toBe(true);
  });

  it("a signed-in toggle updates optimistically and a double click sends one request", async () => {
    const r = await createCustomPuzzle(input());
    db.signIn(U1);
    db.rpcLog = [];
    const { result } = renderHook(() =>
      useCustomFavorite({ shareId: r.shareId, serverFavorited: false, serverCount: 0, userId: U1 })
    );
    await act(async () => {
      void result.current.toggle();
      void result.current.toggle(); // double click while the first is in flight
    });
    await waitFor(() => expect(result.current.favorited).toBe(true));
    expect(result.current.count).toBe(1);
    expect(db.rpcLog.filter((n) => n === "set_custom_puzzle_favorite")).toHaveLength(1);
    expect(db.tables.custom_puzzle_favorites).toHaveLength(1);
  });

  it("a failed signed-in save reverts and says so", async () => {
    const r = await createCustomPuzzle(input());
    db.signIn(U1);
    const { result } = renderHook(() =>
      useCustomFavorite({ shareId: "does-not-exist", serverFavorited: false, serverCount: 2, userId: U1 })
    );
    await act(async () => { await result.current.toggle(); });
    expect(result.current.favorited).toBe(false);
    expect(result.current.count).toBe(2);
    expect(result.current.note).toMatch(/couldn't save/i);
    expect(r.shareId).toBeTruthy();
  });

  it("favoriting touches only custom tables — never official or Beta data", async () => {
    const r = await createCustomPuzzle(input());
    db.signIn(U1);
    db.writeLog = [];
    await setCustomPuzzleFavorite(r.shareId, true);
    await setCustomPuzzleFavorite(r.shareId, false);
    for (const w of db.writeLog) expect(["custom_puzzle_favorites"]).toContain(w.table);
    for (const t of ["game_sessions", "guess_events", "hint_events", "game_results", "user_streaks", "puzzle_aggregates", "beta_playtests", "beta_feedback", "puzzles"]) {
      expect(db.tables[t]).toHaveLength(0);
    }
  });

  it("the signed-in Favorites list returns only that user's active puzzles, newest first", async () => {
    const a = await createCustomPuzzle(input({ title: "A" }));
    const b = await createCustomPuzzle(input({ title: "B" }, "rainbow"));
    db.signIn(U1);
    await setCustomPuzzleFavorite(a.shareId, true);
    await new Promise((r) => setTimeout(r, 5));
    await setCustomPuzzleFavorite(b.shareId, true);
    const mine = await getMyFavorites();
    expect(mine.map((f) => f.title)).toEqual(["B", "A"]);
    expect(mine[0]).toMatchObject({ mode: "rainbow", shortCode: b.shortCode });
    db.signIn(U2);
    expect(await getMyFavorites()).toEqual([]);
    db.signIn(null);
    expect(await getMyFavorites()).toEqual([]);
  });

  describe("FavoriteButton", () => {
    it("exposes pressed state, hides a zero count, and reserves the status row", () => {
      const { rerender } = render(<FavoriteButton favorited={false} count={0} onToggle={() => {}} />);
      const btn = screen.getByRole("button", { name: /favorite/i });
      expect(btn).toHaveAttribute("aria-pressed", "false");
      expect(btn).toHaveTextContent("Favorite");
      expect(btn.textContent).not.toMatch(/\d/);
      const status = screen.getByRole("status");
      expect(status).toHaveTextContent("");
      const widthBefore = btn.className;

      rerender(<FavoriteButton favorited count={12} onToggle={() => {}} note="Saved on this device" />);
      const pressed = screen.getByRole("button", { name: /favorited/i });
      expect(pressed).toHaveAttribute("aria-pressed", "true");
      expect(pressed).toHaveTextContent("Favorited");
      expect(pressed).toHaveTextContent("12");
      expect(screen.getByRole("status")).toHaveTextContent("Saved on this device");
      // fixed width: toggling cannot shift the layout
      expect(pressed.className).toMatch(/w-\[9\.75rem\]/);
      expect(widthBefore).toMatch(/w-\[9\.75rem\]/);
    });

    it("is keyboard-operable", () => {
      const onToggle = vi.fn();
      render(<FavoriteButton favorited={false} count={0} onToggle={onToggle} />);
      const btn = screen.getByRole("button", { name: /favorite/i });
      btn.focus();
      expect(btn).toHaveFocus();
      fireEvent.click(btn); // Enter/Space on a <button> dispatch click
      expect(onToggle).toHaveBeenCalledTimes(1);
    });
  });
});

// ── 5. Creator profiles ─────────────────────────────────────────────────────
describe("creator profiles", () => {
  it("a signed-in creator gets a slug; an anonymous puzzle has none", async () => {
    db.signIn(U1);
    const signed = await createCustomPuzzle(input({ title: "Signed" }));
    db.signIn(null);
    const anon = await createCustomPuzzle(input({ title: "Anon", creatorName: "Nobody" }));

    expect((await getCustomPuzzleByShareId(signed.shareId))!.creatorSlug).toMatch(/^sam-west-[a-z0-9]{4}$/);
    expect((await getCustomPuzzleByShareId(anon.shareId))!.creatorSlug).toBeNull();
    expect(db.tables.creator_profiles).toHaveLength(1);

    db.signIn(U1);
    await createCustomPuzzle(input({ title: "Signed 2" }));
    expect(db.tables.creator_profiles).toHaveLength(1); // one profile per account
  });

  async function seedCreator() {
    db.signIn(U1);
    const oldest = await createCustomPuzzle(input({ title: "Oldest" }));
    await new Promise((r) => setTimeout(r, 3));
    const middle = await createCustomPuzzle(input({ title: "Middle" }, "rainbow"));
    await new Promise((r) => setTimeout(r, 3));
    const newest = await createCustomPuzzle(input({ title: "Newest" }));
    const priv = await createCustomPuzzle(input({ title: "Secret", visibility: "private" }));
    const hidden = await createCustomPuzzle(input({ title: "Hidden" }));
    db.tables.custom_puzzles.find((p) => p.share_id === hidden.shareId)!.moderation_status = "hidden";
    // plays: Oldest 3, Middle 1;  favorites: Middle 2, Newest 1
    const play = (shareId: string, n: number) => {
      const pid = rowId(db.tables.custom_puzzles.find((p) => p.share_id === shareId)!.id);
      db.tables.custom_puzzle_stats.push({
        custom_puzzle_id: pid, wins: n, losses: 0,
        guesses_4: n, guesses_5: 0, guesses_6: 0, guesses_7: 0, guesses_8_plus: 0, win_guess_total: n * 4,
      });
    };
    play(oldest.shareId, 3);
    play(middle.shareId, 1);
    play(priv.shareId, 9); // must never count toward the profile
    db.signIn(U1);
    await setCustomPuzzleFavorite(middle.shareId, true);
    await setCustomPuzzleFavorite(newest.shareId, true);
    db.signIn(U2);
    await setCustomPuzzleFavorite(middle.shareId, true);
    await setCustomPuzzleFavorite(priv.shareId, true); // private favorites never count either
    db.signIn(null);
    return (await getCustomPuzzleByShareId(oldest.shareId))!.creatorSlug!;
  }

  it("lists only Public, non-moderated puzzles and totals only those", async () => {
    const slug = await seedCreator();
    const p = (await getCreatorProfile(slug))!;
    expect(p.displayName).toBe("Sam West");
    expect(p.puzzles.map((x) => x.title).sort()).toEqual(["Middle", "Newest", "Oldest"]);
    expect(p.puzzleCount).toBe(3);
    expect(p.totalPlays).toBe(4); // 3 + 1; the private puzzle's 9 excluded
    expect(p.totalFavorites).toBe(3); // Middle 2 + Newest 1; private's excluded
  });

  it("sorts by Newest, Most Played and Most Favorited", async () => {
    const slug = await seedCreator();
    expect((await getCreatorProfile(slug, "newest"))!.puzzles.map((x) => x.title)).toEqual(["Newest", "Middle", "Oldest"]);
    expect((await getCreatorProfile(slug, "plays"))!.puzzles.map((x) => x.title)).toEqual(["Oldest", "Middle", "Newest"]);
    expect((await getCreatorProfile(slug, "favorites"))!.puzzles.map((x) => x.title)).toEqual(["Middle", "Newest", "Oldest"]);
  });

  it("returns no email, auth UUID, database id or long share id", async () => {
    const slug = await seedCreator();
    const { data } = await db.rpc("get_creator_profile", { _slug: slug, _sort: "newest" });
    const text = JSON.stringify(data);
    expect(text).not.toContain(U1);
    expect(text).not.toMatch(/email|user_id|share_id|"id"/i);
    for (const p of (data as { puzzles: Record<string, unknown>[] }).puzzles) {
      expect(Object.keys(p).sort()).toEqual(["created_at", "favorite_count", "finished_plays", "mode", "short_code", "title"]);
    }
    expect(await getCreatorProfile("no-such-creator")).toBeNull();
  });

  describe("creator page", () => {
    const renderProfile = (slug: string) =>
      render(
        <HelmetProvider>
          <MemoryRouter initialEntries={[`/creator/${slug}`]}>
            <Routes>
              <Route path="/creator/:publicSlug" element={<CreatorProfilePage />} />
            </Routes>
          </MemoryRouter>
        </HelmetProvider>
      );

    it("shows the name, totals, multiple puzzle cards with badges, and re-sorts", async () => {
      const slug = await seedCreator();
      renderProfile(slug);
      expect(await screen.findByRole("heading", { level: 1, name: "Sam West" })).toBeInTheDocument();

      const totals = screen.getByTestId("creator-totals");
      expect(totals).toHaveTextContent("3Puzzles");
      expect(totals).toHaveTextContent("4Plays");
      expect(totals).toHaveTextContent("3Favorites");

      const titles = () => screen.getAllByRole("link").filter((a) => a.getAttribute("href")?.startsWith("/p/")).map((a) => a.textContent);
      expect(titles()).toEqual(["Newest", "Middle", "Oldest"]);
      expect(screen.getAllByRole("button", { name: /puzzle mode/i })).toHaveLength(3); // shared badge on every card
      expect(screen.queryByText("Secret")).toBeNull();
      expect(screen.queryByText("Hidden")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Most Played" }));
      await waitFor(() => expect(titles()).toEqual(["Oldest", "Middle", "Newest"]));
      fireEvent.click(screen.getByRole("button", { name: "Most Favorited" }));
      await waitFor(() => expect(titles()).toEqual(["Middle", "Newest", "Oldest"]));
    });

    it("shows a friendly empty state for a creator with no public puzzles", async () => {
      db.signIn(U2);
      const onlyPrivate = await createCustomPuzzle(input({ visibility: "private", creatorName: "Quiet One" }));
      const slug = (await getCustomPuzzleByShareId(onlyPrivate.shareId))!.creatorSlug!;
      db.signIn(null);
      renderProfile(slug);
      expect(await screen.findByText("No public puzzles yet.")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Most Played" })).toBeNull();
    });

    it("shows not-found for an unknown creator", async () => {
      renderProfile("ghost-zzzz");
      expect(await screen.findByText("Creator not found.")).toBeInTheDocument();
    });
  });
});

// ── 6. Result sharing ───────────────────────────────────────────────────────
describe("custom result sharing", () => {
  const lines = ["🟨🟨🟨🟦", "🟨🟨🟨🟨", "🟩🟩🟩🟩", "🟦🟦🟦🟦", "🟥🟥🟥🟥"];

  it("uses the real title, the real result rows and the short link", () => {
    const text = buildCustomShareText({
      title: "Puzzle 😈",
      lines,
      origin: "https://rainbowcategories.com",
      path: "/p/7Km2Qx8LpA",
    });
    expect(text).toBe(
      [
        "Rainbow Categories 🌈",
        "Puzzle 😈",
        "🟨🟨🟨🟦",
        "🟨🟨🟨🟨",
        "🟩🟩🟩🟩",
        "🟦🟦🟦🟦",
        "🟥🟥🟥🟥",
        "rainbowcategories.com/p/7Km2Qx8LpA",
        "🧩 Play this puzzle! ⬆️",
      ].join("\n")
    );
  });

  it("passes Rainbow rows and hint markers through exactly as the game produced them", () => {
    const rows = ["💡", "🟨🟨🟨🟨", "🌈🌈🌈🌈", "🟩🟩🟩🟩"];
    const text = buildCustomShareText({ title: "T", lines: rows, origin: "https://x.example", path: "/p/AAAAAAAAAA" });
    expect(text.split("\n").slice(2, 6)).toEqual(rows);
  });

  it("builds the link from the running origin, never a hardcoded host", () => {
    expect(shareLinkText("https://staging.example.com", "/p/abc")).toBe("staging.example.com/p/abc");
    expect(shareLinkText("http://localhost:8080", "/p/abc")).toBe("localhost:8080/p/abc");
    const text = buildCustomShareText({ title: "T", lines, origin: "http://localhost:8080", path: "/p/abc" });
    expect(text).not.toContain("rainbowcategories.com");
  });

  it("falls back to the permanent long link for a puzzle without a short code", () => {
    const path = customPuzzlePath({ id: "LONGSHAREID", shortCode: null });
    expect(buildCustomShareText({ title: "T", lines, origin: "https://rainbowcategories.com", path })).toContain(
      "rainbowcategories.com/custom/LONGSHAREID"
    );
  });

  it("Daily/Archive/Beta share text is unchanged", () => {
    expect(buildOfficialShareText("#50", ["🟨🟨🟨🟨", "🟩🟩🟩🟩"])).toBe(
      "Puzzle #50\n🟨🟨🟨🟨\n🟩🟩🟩🟩\nrainbowcategories.com"
    );
    expect(buildOfficialShareText(null, ["🟨🟨🟨🟨"])).toBe("Rainbow Categories\n🟨🟨🟨🟨\nrainbowcategories.com");
    expect(buildOfficialShareText("  ", ["🟥🟥🟥🟥"])).toBe("Rainbow Categories\n🟥🟥🟥🟥\nrainbowcategories.com");
    // no custom-only wording leaks into it
    expect(buildOfficialShareText("#50", lines)).not.toMatch(/Play this puzzle|\/p\//);
  });
});
