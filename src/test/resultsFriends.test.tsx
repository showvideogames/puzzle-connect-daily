/**
 * Friends' results and Up next in the results popup, through the real popup and
 * the real lazy section, with a stand-in client and session (no network). Also
 * the /friends page opening Add a friend when the popup's Add friends asks.
 *
 * jsdom only: these check what is rendered and which operations are called,
 * not layout, scrolling, colours or the real sign-in page.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSocial } from "@/components/social/appSocial";
import type { SocialApi } from "@/components/social/socialApi";
import type { SessionFacts } from "@/components/social/useSocialSession";
import { FULL_FORMAT, MINI_FORMAT } from "@/lib/puzzleFormat";
import type { FriendRow, GroupRow, MemberRow, Result, ResultRow } from "@/social/contract";

const holder = vi.hoisted(() => ({ social: null as unknown }));

vi.mock("@/components/social/appSocial", () => ({ appSocial: vi.fn(() => holder.social) }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: {
      getUser: vi.fn(),
      getSession: vi.fn(),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      signOut: vi.fn(),
    },
  },
}));

vi.mock("@/lib/gameStats", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/gameStats")>()),
  loadStatsFromSupabase: vi.fn(async () => ({
    gamesPlayed: 3,
    gamesWon: 3,
    currentStreak: 0,
    maxStreak: 2,
    lastPlayedDate: null,
    guessDistribution: [3, 0, 0, 0, 0],
    rainbowSpotRate: null,
    rainbowSpottedCount: 0,
    hardestFirstCount: 0,
    perfectGamesCount: 3,
    noHintsUsedCount: 3,
  })),
}));

import { appSocial } from "@/components/social/appSocial";
import { ResultsDialog } from "@/components/ResultsDialog";
import { SocialPage } from "@/components/social/SocialPage";

// ── Stand-ins ──

const face = { animalId: "owl", backgroundColor: "#F8D0BD" };
const friend = (friendRef: string, name: string | null): FriendRow => ({ ...face, friendRef, name, since: "2026-10-30T18:00:00.000Z" });
const member = (memberRef: string, name: string, isMe = false): MemberRow => ({ ...face, memberRef, name, isOwner: false, isMe, joinedAt: "2026-10-30T18:00:00.000Z" });
const group = (groupId: string, name: string): GroupRow => ({
  groupId,
  name,
  emblemId: "book",
  accentColor: "#CCE6CA",
  photo: null,
  photoVersion: 0,
  memberCount: 2,
  isOwner: false,
  myName: "Alex G",
  inviteCode: null,
});
const friendRow = (friendRef: string | null, name: string, solved: boolean, mistakes: number, extra: Partial<Pick<ResultRow, "detail" | "detailLocked">> = {}): ResultRow => ({
  ...face,
  isMe: friendRef === null,
  name,
  friendRef,
  summary: { solved, mistakes },
  detailLocked: false,
  ...extra,
});
const memberRow = (memberRef: string, name: string, solved: boolean, mistakes: number, isMe = false): ResultRow => ({
  ...face,
  isMe,
  name,
  memberRef,
  summary: { solved, mistakes },
  detailLocked: false,
});

/** A row whose summary also carries a solve time, as the server will send for Mini. */
const timedRow = (friendRef: string | null, name: string, solved: boolean, mistakes: number, seconds: unknown): ResultRow => ({
  ...friendRow(friendRef, name, solved, mistakes),
  summary: { solved, mistakes, seconds } as unknown as ResultRow["summary"],
});
const timedMemberRow = (memberRef: string, name: string, solved: boolean, mistakes: number, seconds: unknown, isMe = false): ResultRow => ({
  ...memberRow(memberRef, name, solved, mistakes, isMe),
  summary: { solved, mistakes, seconds } as unknown as ResultRow["summary"],
});

const refused = (outcome: string) => ({ ok: false, outcome }) as unknown as Result<never>;
const yes = (data: unknown = {}) => ({ ok: true, data });

type Answer = (args: never) => unknown;

function makeApi(answers: Record<string, Answer> = {}) {
  const all: Record<string, Answer> = {
    getMe: () => yes({ displayName: "Alex", animalId: "fox", backgroundColor: "#DED1F2", friendCode: "AAA-222", friendCount: 0, groupCount: 0 }),
    listFriendRequests: () => yes({ incoming: [], outgoing: [] }),
    listFriends: () => yes([]),
    listResults: () => yes([]),
    listMyGroups: () => yes([]),
    ...answers,
  };
  const call = vi.fn(async (op: string, args: never) => (all[op] ? all[op](args) : refused("unavailable")));
  const api: SocialApi = {
    client: { call: call as never, forget: vi.fn() },
    puzzleId: () => "some-other-puzzle",
    today: () => new Date(2026, 10, 2),
    linkUrl: (code) => `http://rainbow.test/join/${code}`,
    share: vi.fn(async () => "done" as const),
  };
  return { api, call };
}

const SIGNED_IN: SessionFacts = { state: { scope: "scope-1", credential: "token" }, accountId: "u1", storedOwner: "u1", generation: 1, checkRunning: false };
const GUEST: SessionFacts = { state: null, accountId: null, storedOwner: null, generation: 0, checkRunning: false };
const CHECKING: SessionFacts = { state: "checking", accountId: null, storedOwner: "u1", generation: 0, checkRunning: true };

function stubSocial(facts: SessionFacts, answers: Record<string, Answer> = {}, signIn: () => Promise<string | null> = vi.fn(() => new Promise<string | null>(() => undefined))) {
  const made = makeApi(answers);
  const social: AppSocial = { api: made.api, source: { read: () => facts, subscribe: () => () => undefined }, signIn };
  holder.social = social;
  return { ...made, signIn };
}

const opsCalled = (call: ReturnType<typeof makeApi>["call"]) => call.mock.calls.map(([op]) => op);

function Where() {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname} ${JSON.stringify(location.state)}`}</p>;
}

type DialogProps = Partial<Parameters<typeof ResultsDialog>[0]>;

function openDialog(props: DialogProps = {}) {
  const onOpenChange = vi.fn();
  const view = render(
    <MemoryRouter initialEntries={["/"]}>
      <ResultsDialog
        open
        onOpenChange={onOpenChange}
        headline="Perfect!"
        timeLabel={null}
        resultRows={[]}
        onShare={vi.fn()}
        copied={false}
        statsFormat={FULL_FORMAT}
        statsPending={false}
        showStreak={false}
        animateStreak={false}
        onStreakAnimated={vi.fn()}
        spotTheme={null}
        onSpotRainbow={vi.fn()}
        gameFormat="full"
        officialDaily
        puzzleId="puzzle-1"
        solved
        mistakes={0}
        {...props}
      />
      <Where />
    </MemoryRouter>,
  );
  return { onOpenChange, dialog: screen.getByTestId("results-dialog"), unmount: view.unmount };
}

/** Everything the popup may ask the hub. It only reads, so nothing that changes anything. */
const READS = ["getMe", "listFriendRequests", "listFriends", "listResults", "listMyGroups", "listMembers"];
const expectOnlyReads = (call: ReturnType<typeof makeApi>["call"]) =>
  expect(opsCalled(call).filter((op) => !READS.includes(op))).toEqual([]);

/** The section once its own code has loaded (the Suspense stand-in is marked pending). */
const section = () =>
  waitFor(() => {
    const box = screen.getByTestId("friends-results");
    expect(box.dataset.pending).toBeUndefined();
    return box;
  });
const rows = () => screen.getAllByTestId("friends-result-row");

beforeEach(() => {
  vi.stubEnv("VITE_SHARED_SOCIAL", "beta");
  vi.mocked(appSocial).mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ── Signed out ──

describe("signed out", () => {
  it("shows the owner's lines and the picture; Create an account starts sign-in and stays busy while it opens", async () => {
    const { signIn } = stubSocial(GUEST);
    openDialog();
    const box = await section();
    expect(await within(box).findByText("Keep your progress. Play with pals.")).toBeInTheDocument();
    expect(within(box).getByText("Create an account to save your stats across devices and compare results with friends.")).toBeInTheDocument();
    expect(within(box).getByRole("img", { name: "A bear and a frog holding a heart" }).getAttribute("src")).toBe("/shared-assets/friends/bear-frog-heart.webp");
    fireEvent.click(within(box).getByRole("button", { name: "Create an account" }));
    expect(signIn).toHaveBeenCalledTimes(1);
    // Busy on the one pressed; both disabled, so sign-in can't start twice.
    expect(await within(box).findByRole("button", { name: "Opening sign-in…" })).toBeDisabled();
    expect(within(box).getByRole("button", { name: "Sign in" })).toBeDisabled();
    expect(within(box).queryByRole("button", { name: "Create an account" })).toBeNull();
    // Nothing about the player's own stats needs an account.
    expect(screen.getByTestId("results-stats")).toBeInTheDocument();
    expect(box.textContent).not.toMatch(/sign in to see your stats|need an account/i);
  });

  it("Sign in starts the same sign-in, and a reason it couldn't is shown beside the buttons", async () => {
    const signIn = vi.fn(async () => "Sign-in isn't available right now.");
    stubSocial(GUEST, {}, signIn);
    openDialog();
    const box = await section();
    fireEvent.click(await within(box).findByRole("button", { name: "Sign in" }));
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(await within(box).findByRole("alert")).toHaveTextContent("Sign-in isn't available right now.");
    expect(within(box).getByRole("button", { name: "Create an account" })).toBeEnabled();
  });

  it("a sign-in that answers null (on its way to the sign-in page) stays busy", async () => {
    const signIn = vi.fn(async () => null);
    stubSocial(GUEST, {}, signIn);
    openDialog();
    const box = await section();
    fireEvent.click(await within(box).findByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(signIn).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(within(box).getByRole("button", { name: "Opening sign-in…" })).toBeDisabled();
    expect(within(box).getByRole("button", { name: "Create an account" })).toBeDisabled();
    expect(within(box).queryByRole("alert")).toBeNull();
  });
});

// ── Signed in ──

describe("signed in, Full Daily", () => {
  it("with no friends shows the prompt, and Add friends closes the popup and asks /friends to open Add a friend", async () => {
    stubSocial(SIGNED_IN);
    const { onOpenChange } = openDialog();
    const box = await section();
    expect(await within(box).findByText("Puzzles are better with pals.")).toBeInTheDocument();
    expect(within(box).getByText("Add friends to see how everyone did on today's puzzle.")).toBeInTheDocument();
    expect(within(box).getByRole("img", { name: "A bear and a frog holding a heart" })).toBeInTheDocument();
    fireEvent.click(within(box).getByRole("button", { name: "Add friends" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.getByTestId("where")).toHaveTextContent('/friends {"addFriend":true}');
  });

  it("with friends but no results says so honestly, not the no-friends prompt, and still shows my own row", async () => {
    stubSocial(SIGNED_IN, { listFriends: () => yes([friend("f1", "Sam")]) });
    openDialog({ solved: true, mistakes: 2 });
    const box = await section();
    expect(await within(box).findByText("No friends have finished this puzzle yet")).toBeInTheDocument();
    expect(within(box).queryByText("Puzzles are better with pals.")).toBeNull();
    // The server has no row for me yet, so mine comes from this game.
    expect(rows()).toHaveLength(1);
    expect(rows()[0].dataset.you).toBe("true");
    expect(rows()[0]).toHaveTextContent("Alex (you)");
    expect(rows()[0]).toHaveTextContent("2 mistakes");
    expect(within(box).queryByText("Sam")).toBeNull();
  });

  it("lists only people who finished, ranked by mistakes with losses last, in Rainbow wording, and never a puzzle's detail", async () => {
    const { call } = stubSocial(SIGNED_IN, {
      listFriends: () => yes([friend("f1", "Sam"), friend("f2", "Jordan"), friend("f3", null), friend("f4", "Casey")]),
      listResults: () =>
        yes([
          // Sam's row carries a time; Full never shows or ranks by it.
          { ...timedRow("f1", "Sam", true, 1, 42), detail: "🟨🟨🟨🟨\n🟩🟩🟩🟩" },
          friendRow(null, "Alex", true, 0, { detail: "🟦🟦🟦🟦" }),
          friendRow("f2", "Jordan", false, 4, { detailLocked: true }),
          friendRow("f3", "", true, 2),
          // Someone who isn't a friend any more: never listed.
          friendRow("gone", "Former", true, 0),
        ]),
    });
    openDialog();
    const box = await section();
    await within(box).findByText("Sam");
    const shown = rows();
    expect(shown.map((row) => row.textContent)).toEqual(["Alex (you)No mistakes", "Sam1 mistake", "A Rainbow player2 mistakes", "JordanNot solved"]);
    expect(shown[0].dataset.you).toBe("true");
    expect(shown[0].className).toMatch(/bg-\[hsl\(258/);
    expect(shown[1].dataset.you).toBeUndefined();
    // Casey has no result: not played or still playing, so not listed.
    expect(within(box).queryByText("Casey")).toBeNull();
    expect(within(box).queryByText("Former")).toBeNull();
    // Full: results, never times; and no detail grid anywhere in the popup.
    expect(box.textContent).not.toMatch(/🟨|🟩|🟦|\d+:\d\d|seconds/);
    expect(screen.getByTestId("results-dialog").querySelector("[data-cell]")).toBeNull();
    expect(within(box).getByRole("link", { name: "View all friends" }).getAttribute("href")).toBe("/friends");
    // Asked about this game's puzzle, not whatever the client thinks today's is.
    expect(call).toHaveBeenCalledWith("listResults", { gameId: "rainbow", puzzleId: "puzzle-1" });
    expectOnlyReads(call);
  });

  it("a failed load is an error with Try again, never an empty state, and Try again loads it", async () => {
    let tries = 0;
    stubSocial(SIGNED_IN, {
      listFriends: () => yes([friend("f1", "Sam")]),
      listResults: () => (++tries === 1 ? refused("unavailable") : yes([friendRow("f1", "Sam", true, 3)])),
    });
    openDialog();
    const box = await section();
    expect(await within(box).findByRole("alert")).toHaveTextContent("Couldn't load friends' results right now.");
    expect(within(box).queryByText("No friends have finished this puzzle yet")).toBeNull();
    expect(within(box).queryByText("Puzzles are better with pals.")).toBeNull();
    expect(within(box).queryAllByTestId("friends-result-row")).toHaveLength(0);
    fireEvent.click(within(box).getByRole("button", { name: "Try again" }));
    expect(await within(box).findByText("3 mistakes")).toBeInTheDocument();
    expect(within(box).queryByRole("alert")).toBeNull();
    expect(tries).toBe(2);
  });

  it("keeps groups reachable with no friends, and a group pill loads that group's results", async () => {
    const { call } = stubSocial(SIGNED_IN, {
      listMyGroups: () => yes([group("g1", "Book Nerds")]),
      listMembers: () => yes([member("m1", "Alex G", true), member("m2", "Sam")]),
      listResults: (args: { groupId?: string }) => (args.groupId === "g1" ? yes([memberRow("m2", "Sam", true, 3)]) : yes([])),
    });
    openDialog({ solved: false, mistakes: 4 });
    const box = await section();
    // The Friends pill shows the no-friends prompt, and the group is still there.
    expect(await within(box).findByText("Puzzles are better with pals.")).toBeInTheDocument();
    const pills = within(box).getByRole("group", { name: "Show results for" });
    expect(within(pills).getByRole("button", { name: "Friends" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(pills).getByRole("button", { name: "Book Nerds" }));
    expect(await within(box).findByText("3 mistakes")).toBeInTheDocument();
    expect(within(pills).getByRole("button", { name: "Book Nerds" })).toHaveAttribute("aria-pressed", "true");
    expect(call).toHaveBeenCalledWith("listResults", { gameId: "rainbow", puzzleId: "puzzle-1", groupId: "g1" });
    // Labelled as on the Friends pill: my Display Name, not my name in the
    // group. My loss ranks after Sam's solve, highlighted where it ranks.
    expect(rows().map((row) => row.textContent)).toEqual(["Sam3 mistakes", "Alex (you)Not solved"]);
    expect(rows()[0].dataset.you).toBeUndefined();
    expect(rows()[1].dataset.you).toBe("true");
    // Back to Friends.
    fireEvent.click(within(pills).getByRole("button", { name: "Friends" }));
    expect(await within(box).findByText("Puzzles are better with pals.")).toBeInTheDocument();
    expectOnlyReads(call);
  });

  it("a group where only I have finished says so", async () => {
    stubSocial(SIGNED_IN, {
      listMyGroups: () => yes([group("g1", "Book Nerds")]),
      listMembers: () => yes([member("m1", "Alex G", true), member("m2", "Sam")]),
      listResults: (args: { groupId?: string }) => (args.groupId ? yes([memberRow("m1", "Alex G", true, 1, true)]) : yes([])),
    });
    openDialog({ solved: true, mistakes: 1 });
    const box = await section();
    fireEvent.click(await within(box).findByRole("button", { name: "Book Nerds" }));
    expect(await within(box).findByText("No one else in this group has finished this puzzle yet")).toBeInTheDocument();
    expect(rows().map((row) => row.textContent)).toEqual(["Alex (you)1 mistake"]);
  });

  it("lists only people who finished in a group too: not played left out, losses shown after solves", async () => {
    stubSocial(SIGNED_IN, {
      listFriends: () => yes([friend("f1", "Sam")]),
      listResults: (args: { groupId?: string }) =>
        args.groupId
          ? yes([memberRow("m1", "Alex G", true, 2, true), memberRow("m3", "Lee", false, 4), memberRow("m4", "Bo", true, 0)])
          : yes([friendRow("f1", "Sam", true, 1)]),
      listMyGroups: () => yes([group("g1", "Book Nerds")]),
      listMembers: () => yes([member("m1", "Alex G", true), member("m2", "Pat"), member("m3", "Lee"), member("m4", "Bo")]),
    });
    openDialog({ solved: true, mistakes: 2 });
    const box = await section();
    await within(box).findByText("Sam");
    // Friends tab: Sam (1) ranks above me (2), so my row is not pinned first.
    expect(rows().map((row) => row.textContent)).toEqual(["Sam1 mistake", "Alex (you)2 mistakes"]);
    expect(rows()[1].dataset.you).toBe("true");
    fireEvent.click(within(box).getByRole("button", { name: "Book Nerds" }));
    expect(await within(box).findByText("Bo")).toBeInTheDocument();
    expect(rows().map((row) => row.textContent)).toEqual(["BoNo mistakes", "Alex (you)2 mistakes", "LeeNot solved"]);
    // Pat is a member with no result: not listed.
    expect(within(box).queryByText("Pat")).toBeNull();
  });

  it("labels my row You in both tabs when I have no Display Name yet, never A Rainbow player", async () => {
    stubSocial(SIGNED_IN, {
      getMe: () => yes({ displayName: null, animalId: "fox", backgroundColor: "#DED1F2", friendCode: "AAA-222", friendCount: 1, groupCount: 1 }),
      listFriends: () => yes([friend("f1", "Sam")]),
      listResults: (args: { groupId?: string }) =>
        args.groupId ? yes([memberRow("m2", "Sam", true, 2)]) : yes([friendRow("f1", "Sam", true, 2)]),
      listMyGroups: () => yes([group("g1", "Book Nerds")]),
      listMembers: () => yes([member("m1", "Alex G", true), member("m2", "Sam")]),
    });
    openDialog({ solved: true, mistakes: 0 });
    const box = await section();
    await within(box).findByText("Sam");
    expect(rows()[0].textContent).toBe("YouNo mistakes");
    fireEvent.click(within(box).getByRole("button", { name: "Book Nerds" }));
    await waitFor(() => expect(rows().map((row) => row.textContent)).toEqual(["YouNo mistakes", "Sam2 mistakes"]));
    expect(box.textContent).not.toMatch(/A Rainbow player|Alex G \(you\)/);
  });

  it("uses the server's row for me when there is one, even if this board says otherwise", async () => {
    stubSocial(SIGNED_IN, {
      listFriends: () => yes([friend("f1", "Sam")]),
      listResults: () => yes([friendRow(null, "Alex", true, 0)]),
    });
    openDialog({ solved: false, mistakes: 4 });
    const box = await section();
    expect(await within(box).findByText("No mistakes")).toBeInTheDocument();
    expect(within(box).queryByText("Not solved")).toBeNull();
  });

  it("a read refused by a background account check keeps the placeholder and asks again quietly", async () => {
    let tries = 0;
    stubSocial(SIGNED_IN, {
      listFriends: () => yes([friend("f1", "Sam")]),
      listResults: () => (++tries === 1 ? refused("still_checking") : yes([friendRow("f1", "Sam", true, 1)])),
    });
    openDialog();
    const box = await section();
    await waitFor(() => expect(tries).toBe(1));
    expect(within(box).getByTestId("friends-results-loading")).toBeInTheDocument();
    expect(within(box).queryByRole("alert")).toBeNull();
    // Asked again after RETRY_MS (1 s), on real timers.
    expect(await within(box).findByText("1 mistake", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(within(box).queryByRole("alert")).toBeNull();
    expect(tries).toBe(2);
  });

  it("a read that throws shows the error, not an empty list", async () => {
    stubSocial(SIGNED_IN, { listFriends: () => Promise.reject(new Error("down")) });
    openDialog();
    const box = await section();
    expect(await within(box).findByRole("alert")).toHaveTextContent("Couldn't load friends' results right now.");
    expect(within(box).queryByText("Puzzles are better with pals.")).toBeNull();
    expect(within(box).getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("View all friends closes the popup and opens /friends", async () => {
    stubSocial(SIGNED_IN, { listFriends: () => yes([friend("f1", "Sam")]), listResults: () => yes([friendRow("f1", "Sam", true, 1)]) });
    const { onOpenChange } = openDialog();
    const box = await section();
    fireEvent.click(await within(box).findByRole("link", { name: "View all friends" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.getByTestId("where")).toHaveTextContent("/friends null");
  });

  it("closing the popup while a read is still on its way leaves nothing to update and no warning", async () => {
    let answer: (value: unknown) => void = () => undefined;
    const { call } = stubSocial(SIGNED_IN, {
      listFriends: () => yes([friend("f1", "Sam")]),
      listResults: () => new Promise((resolve) => {
        answer = resolve;
      }),
    });
    const { unmount } = openDialog();
    const box = await section();
    await within(box).findByTestId("friends-results-loading");
    await waitFor(() => expect(opsCalled(call)).toContain("listResults"));
    unmount();
    // Watched only from here: what matters is what the late answer does.
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      answer(yes([friendRow("f1", "Sam", true, 1)]));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(screen.queryByTestId("friends-results")).toBeNull();
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });

  it("a group that won't load says so in its own place, with Try again", async () => {
    stubSocial(SIGNED_IN, {
      listFriends: () => yes([friend("f1", "Sam")]),
      listResults: (args: { groupId?: string }) => (args.groupId ? refused("not_a_member") : yes([friendRow("f1", "Sam", true, 0)])),
      listMyGroups: () => yes([group("g1", "Book Nerds")]),
      listMembers: () => yes([member("m1", "Alex G", true)]),
    });
    openDialog();
    const box = await section();
    await within(box).findByText("Sam");
    fireEvent.click(within(box).getByRole("button", { name: "Book Nerds" }));
    expect(await within(box).findByRole("alert")).toHaveTextContent("Couldn't load friends' results right now.");
    expect(within(box).getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("shows a placeholder inside the section while loading, with the personal result, stats and Share already there", async () => {
    stubSocial(SIGNED_IN, { listFriends: () => yes([friend("f1", "Sam")]), listResults: () => new Promise(() => undefined) });
    const { dialog } = openDialog();
    const box = await section();
    expect(await within(box).findByTestId("friends-results-loading")).toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { name: "Perfect!" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Share Score" })).toBeInTheDocument();
    await waitFor(() => expect(within(within(dialog).getByTestId("results-stats")).getByText("Played").parentElement).toHaveTextContent("3"));
    expect(within(dialog).getByTestId("up-next")).toBeInTheDocument();
    expect(within(box).queryByText("No friends have finished this puzzle yet")).toBeNull();
  });

  it("shows the placeholder while the session is still being checked, and asks nothing yet", async () => {
    const { call } = stubSocial(CHECKING);
    openDialog();
    const box = await section();
    expect(await within(box).findByTestId("friends-results-loading")).toBeInTheDocument();
    expect(call).not.toHaveBeenCalled();
  });
});

describe("Mini Daily", () => {
  const MINI = { gameFormat: "mini" as const, statsFormat: MINI_FORMAT, puzzleId: "mini-7" };

  it("with no server row for me: the honest note and its link, no list and no local row, even when friends have rows", async () => {
    const { call } = stubSocial(SIGNED_IN, {
      listFriends: () => yes([friend("f1", "Sam")]),
      listResults: () => yes([timedRow("f1", "Sam", true, 0, 40)]),
    });
    const { onOpenChange } = openDialog({ ...MINI, solved: true, mistakes: 0 });
    const box = await section();
    expect(await within(box).findByText("Friends' results are shared for the daily Rainbow Categories 4×4 for now.")).toBeInTheDocument();
    const link = within(box).getByRole("link", { name: "See today's results" });
    expect(link.getAttribute("href")).toBe("/friends");
    expect(within(box).queryAllByTestId("friends-result-row")).toHaveLength(0);
    expect(within(box).queryByText("No friends have finished this puzzle yet")).toBeNull();
    // Asked about this Mini's own puzzle, never the Full one.
    expect(call).toHaveBeenCalledWith("listResults", { gameId: "rainbow", puzzleId: "mini-7" });
    expectOnlyReads(call);
    fireEvent.click(link);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.getByTestId("where")).toHaveTextContent("/friends null");
  });

  it("with my server row: a leaderboard by fastest time, shown as m:ss · mistakes, losses and untimed solves placed honestly", async () => {
    const { call } = stubSocial(SIGNED_IN, {
      listFriends: () => yes([friend("f1", "Sam"), friend("f2", "Jo"), friend("f3", "Lee"), friend("f4", "Pat"), friend("f5", "Kit")]),
      listResults: () =>
        yes([
          timedRow(null, "Alex", true, 1, 65),
          timedRow("f1", "Sam", true, 2, 42),
          timedRow("f2", "Jo", false, 3, 20),
          // No usable time: never 0 and never first.
          timedRow("f3", "Lee", true, 0, 0),
          friendRow("f4", "Pat", true, 0),
        ]),
    });
    openDialog({ ...MINI, solved: true, mistakes: 0 });
    const box = await section();
    await within(box).findByText("Sam");
    expect(rows().map((row) => row.textContent)).toEqual([
      "Sam0:42 · 2 mistakes",
      "Alex (you)1:05 · 1 mistake",
      "LeeSolved · No mistakes",
      "PatSolved · No mistakes",
      "JoNot solved",
    ]);
    expect(rows()[1].dataset.you).toBe("true");
    // "(you)" is its own element beside the name, so a long name truncates without hiding it.
    const suffix = within(rows()[1]).getByTestId("you-suffix");
    expect(suffix.textContent).toBe(" (you)");
    expect(suffix.className).toMatch(/\bshrink-0\b/);
    expect(suffix.previousElementSibling?.textContent).toBe("Alex");
    expect(suffix.previousElementSibling?.className).toMatch(/\btruncate\b/);
    expect(within(box).getAllByTestId("you-suffix")).toHaveLength(1);
    // The Mini wording is two unbreakable pieces in a right-aligned box that may
    // shrink, so a narrow row wraps between "1:05 ·" and "1 mistake" before the
    // name gives way; the name area keeps a minimum width for a short name and "(you)".
    const result = within(rows()[1]).getByTestId("result-text");
    expect(result.textContent).toBe("1:05 · 1 mistake");
    expect(result.className).not.toMatch(/\bshrink-0\b|\bmin-w-0\b/);
    expect(result.className).toMatch(/\btext-right\b/);
    expect(within(rows()[1]).getByTestId("row-name").className).toMatch(/min-w-\[6\.5rem\]/);
    const parts = within(result).getAllByTestId("result-part");
    expect(parts.map((part) => part.textContent)).toEqual(["1:05 ·", "1 mistake"]);
    expect(parts.every((part) => /\bwhitespace-nowrap\b/.test(part.className))).toBe(true);
    // A one-part wording stays one piece that never shrinks.
    expect(within(rows()[4]).queryByTestId("result-text")).toBeNull();
    expect(within(rows()[4]).getByText("Not solved").className).toMatch(/\bshrink-0\b/);
    // Kit has no result: not listed.
    expect(within(box).queryByText("Kit")).toBeNull();
    expect(within(box).queryByText(/4×4 for now/)).toBeNull();
    expect(call).toHaveBeenCalledWith("listResults", { gameId: "rainbow", puzzleId: "mini-7" });
    expectOnlyReads(call);
  });

  it("with my server row and no other finishers: my row and the honest empty line", async () => {
    stubSocial(SIGNED_IN, {
      listFriends: () => yes([friend("f1", "Sam")]),
      listResults: () => yes([timedRow(null, "Alex", true, 0, 30)]),
    });
    openDialog({ ...MINI });
    const box = await section();
    expect(await within(box).findByText("No friends have finished this puzzle yet")).toBeInTheDocument();
    expect(rows().map((row) => row.textContent)).toEqual(["Alex (you)0:30 · No mistakes"]);
  });

  it("ranks a group tab by time too", async () => {
    stubSocial(SIGNED_IN, {
      listFriends: () => yes([friend("f1", "Sam")]),
      listResults: (args: { groupId?: string }) =>
        args.groupId
          ? yes([timedMemberRow("m1", "Alex G", true, 0, 90, true), timedMemberRow("m2", "Bo", true, 3, 31)])
          : yes([timedRow(null, "Alex", true, 0, 90)]),
      listMyGroups: () => yes([group("g1", "Book Nerds")]),
      listMembers: () => yes([member("m1", "Alex G", true), member("m2", "Bo")]),
    });
    openDialog({ ...MINI });
    const box = await section();
    fireEvent.click(await within(box).findByRole("button", { name: "Book Nerds" }));
    expect(await within(box).findByText("Bo")).toBeInTheDocument();
    expect(rows().map((row) => row.textContent)).toEqual(["Bo0:31 · 3 mistakes", "Alex (you)1:30 · No mistakes"]);
  });

  it("signed in with no friends shows the usual prompt", async () => {
    stubSocial(SIGNED_IN);
    openDialog({ ...MINI });
    expect(await within(await section()).findByText("Puzzles are better with pals.")).toBeInTheDocument();
  });

  it("signed out shows the sign-in prompt", async () => {
    stubSocial(GUEST);
    openDialog({ ...MINI });
    expect(await within(await section()).findByText("Keep your progress. Play with pals.")).toBeInTheDocument();
  });
});

describe("no Friends' results section", () => {
  it.each([
    ["Archive, Beta or custom", { officialDaily: false }, "beta"],
    ["the flag off", {}, ""],
  ])("for %s, and the social client is never asked for", async (_label, props, flag) => {
    vi.stubEnv("VITE_SHARED_SOCIAL", flag);
    stubSocial(SIGNED_IN);
    const { dialog } = openDialog(props as DialogProps);
    await waitFor(() => expect(within(dialog).getByTestId("up-next")).toBeInTheDocument());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(within(dialog).queryByTestId("friends-results")).toBeNull();
    expect(appSocial).not.toHaveBeenCalled();
    // Everything personal is still there.
    expect(within(dialog).getByRole("button", { name: "Share Score" })).toBeInTheDocument();
  });
});

// ── Up next ──

describe("Up next", () => {
  const cards = (dialog: HTMLElement) => within(within(dialog).getByTestId("up-next")).getAllByRole("link");

  it("after Full: Mini Categories and CrossPuns, with their real icons and no arrows", () => {
    vi.stubEnv("VITE_SHARED_SOCIAL", "");
    const { dialog } = openDialog({ gameFormat: "full" });
    const [mini, crossPuns] = cards(dialog);
    expect(mini).toHaveTextContent("Mini Categories");
    expect(mini).toHaveTextContent("Play");
    expect(mini.getAttribute("href")).toBe("/mini");
    expect(mini.querySelector("img")?.getAttribute("src")).toBe("/icons/mini-icon-192-bf5daacd.png");
    expect(crossPuns).toHaveTextContent("CrossPuns");
    expect(crossPuns.getAttribute("href")).toBe("https://crosspuns.com/");
    expect(crossPuns.getAttribute("target")).toBe("_blank");
    expect(crossPuns.getAttribute("rel")).toBe("noopener noreferrer");
    expect(crossPuns.querySelector("img")?.getAttribute("src")).toBe("/game-icons/crosspuns.png");
    const upNext = within(dialog).getByTestId("up-next");
    expect(upNext.textContent).not.toMatch(/[→›»➜➔⟶>]/);
    expect(upNext.querySelector("svg")).toBeNull();
  });

  it("after Mini: Rainbow Categories and CrossPuns", () => {
    vi.stubEnv("VITE_SHARED_SOCIAL", "");
    const { dialog } = openDialog({ gameFormat: "mini", statsFormat: MINI_FORMAT, timeLabel: "7s" });
    const [full, crossPuns] = cards(dialog);
    expect(full).toHaveTextContent("Rainbow Categories");
    expect(full.getAttribute("href")).toBe("/");
    expect(full.querySelector("img")?.getAttribute("src")).toBe("/icons/rainbow-icon-192-0e09e6d1.png");
    expect(crossPuns.getAttribute("href")).toBe("https://crosspuns.com/");
    expect(within(dialog).getByText("⏳ 7s")).toBeInTheDocument();
  });

  it("a Rainbow card closes the popup as it opens the other game", () => {
    vi.stubEnv("VITE_SHARED_SOCIAL", "");
    const { dialog, onOpenChange } = openDialog({ gameFormat: "full" });
    fireEvent.click(cards(dialog)[0]);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.getByTestId("where")).toHaveTextContent("/mini");
  });
});

// ── /friends opening Add a friend ──

describe("/friends with { addFriend: true }", () => {
  function openFriends(state: unknown) {
    const { api } = stubSocial(SIGNED_IN, { listFriends: () => yes([friend("f1", "Sam")]) });
    render(
      <MemoryRouter initialEntries={[{ pathname: "/friends", state }]}>
        <Routes>
          <Route
            path="/friends"
            element={
              <>
                <SocialPage social={holder.social as AppSocial} code={null} />
                <Where />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    return api;
  }

  it("opens the existing Add a friend flow, and clears the ask so Back or a reload doesn't reopen it", async () => {
    openFriends({ addFriend: true });
    expect(await screen.findByTestId("add-friend")).toBeInTheDocument();
    expect(screen.getByLabelText("Enter a friend code")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/friends null"));
    expect(screen.getByTestId("add-friend")).toBeInTheDocument();
  });

  it("without it, opens the Friends page as before", async () => {
    openFriends(null);
    expect(await screen.findByTestId("friends-home")).toBeInTheDocument();
    expect(screen.queryByTestId("add-friend")).toBeNull();
  });
});
