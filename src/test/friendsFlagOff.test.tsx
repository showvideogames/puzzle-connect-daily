/**
 * Recent completions switched off, as in production for this release: the home
 * card shows today's results from listResults, and a friend's profile reads this
 * week's puzzles with one listResults per exact puzzle id. recentCompletions is
 * never asked for. Switched on, the new reader is used as before.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SocialApi } from "@/components/social/socialApi";
import { SocialScreens } from "@/components/social/SocialScreens";
import { FriendsHome } from "@/components/account/FriendsHome";

const face = { animalId: "owl", backgroundColor: "#F8D0BD" };
const yes = (data: unknown = {}) => ({ ok: true, data });
const jordanRow = (mistakes: number, detailLocked = true) => ({ ...face, friendRef: "friend-1", isMe: false, name: "Jordan", summary: { solved: true, mistakes }, detailLocked });

function makeApi({ recentActivity = false, weekPuzzles = true } = {}) {
  const answers: Record<string, (args: { puzzleId?: string }) => unknown> = {
    getMe: () => yes({ displayName: "Alex", animalId: "fox", backgroundColor: "#DED1F2", friendCode: "AAA-222", friendCount: 1, groupCount: 0 }),
    listFriendRequests: () => yes({ incoming: [], outgoing: [] }),
    listFriends: () => yes([{ ...face, friendRef: "friend-1", name: "Jordan", since: "2026-10-01T18:00:00.000Z" }]),
    listMyGroups: () => yes([]),
    listBlocks: () => yes([]),
    listResults: ({ puzzleId }) => yes(puzzleId === "p-mon" ? [jordanRow(2)] : puzzleId === "puzzle-1" ? [jordanRow(1)] : []),
    recentCompletions: () =>
      yes({ rows: [{ puzzleId: "puzzle-1", puzzleDate: "2026-09-22", puzzleTitle: "#102", completedAt: new Date(2026, 9, 31, 12).toISOString(), result: jordanRow(1) }], hasMore: false }),
  };
  const call = vi.fn(async (op: string, args: never) => (answers[op] ? answers[op](args) : { ok: false, outcome: "unavailable" }));
  const week = vi.fn(async () => [
    { id: "p-mon", date: "2026-10-27" },
    { id: "puzzle-1", date: "2026-10-31" },
  ]);
  const api: SocialApi = {
    client: { call: call as never, forget: vi.fn() },
    puzzleId: () => "puzzle-1",
    today: () => new Date(2026, 9, 31),
    linkUrl: (code) => `http://rainbow.test/join/${code}`,
    share: vi.fn(async () => "done" as const),
    recentActivity,
    ...(weekPuzzles ? { weekPuzzles: week } : {}),
  };
  render(
    <SocialScreens api={api} signedIn code={null} tab="friends" onTab={vi.fn()} onNote={vi.fn()} onLeaveLink={vi.fn()} onSignIn={vi.fn()} onNameLater={vi.fn()} guest={<p>guest</p>} waiting={<p>waiting</p>} />,
  );
  return { call, week };
}

const ops = (call: ReturnType<typeof makeApi>["call"]) => call.mock.calls.map(([op]) => op);

async function openJordan() {
  const all = await screen.findByRole("region", { name: "All friends" });
  fireEvent.click(within(all).getByRole("button", { name: /Jordan/ }));
  return screen.findByTestId("friend-profile");
}

describe("with recent completions off", () => {
  it("shows today's results on the home card, titled Today, without asking for recent completions", async () => {
    const { call } = makeApi();
    const today = await screen.findByRole("region", { name: "Today" });
    expect(await within(today).findByText("Solved · 1 mistake")).toBeInTheDocument();
    expect(within(today).getByRole("heading", { name: "Today" })).toBeInTheDocument();
    expect(screen.queryByText("Recent activity is not available yet.")).toBeNull();
    expect(call).toHaveBeenCalledWith("listResults", { gameId: "rainbow", puzzleId: "puzzle-1" });
    expect(ops(call)).not.toContain("recentCompletions");
  });

  it("reads a friend's week one exact puzzle at a time, and shows only played days, newest first", async () => {
    const { call, week } = makeApi();
    await openJordan();
    const list = await screen.findByRole("list", { name: "Puzzles played in the last 7 days" });
    expect(week).toHaveBeenCalledWith("2026-10-25", "2026-10-31");
    expect(call).toHaveBeenCalledWith("listResults", { gameId: "rainbow", puzzleId: "p-mon" });
    expect(call).toHaveBeenCalledWith("listResults", { gameId: "rainbow", puzzleId: "puzzle-1" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((row) => within(row).getByText(/^Solved/).textContent)).toEqual(["Solved · 1 mistake", "Solved · 2 mistakes"]);
    // The spoiler gate is unchanged, and a puzzle's own day isn't repeated as "Published".
    expect(within(list).getAllByText("Finish this same puzzle to see their details.")).toHaveLength(2);
    expect(within(list).queryByText(/Published/)).toBeNull();
    expect(within(screen.getByRole("region", { name: "Recent activity" })).getByText("Last 7 days")).toBeInTheDocument();
    expect(screen.queryByText(/first completions/)).toBeNull();
    expect(ops(call)).not.toContain("recentCompletions");
  });

  it("falls back to the profile's own summary when there is no weekly reader either", async () => {
    const { call } = makeApi({ weekPuzzles: false });
    const profile = await openJordan();
    expect(within(profile).queryByRole("list", { name: "Puzzles played in the last 7 days" })).toBeNull();
    expect(within(profile).queryByText("Recent activity is not available yet.")).toBeNull();
    await waitFor(() => expect(within(profile).getByText("Solved · 1 mistake")).toBeInTheDocument());
    expect(ops(call)).not.toContain("recentCompletions");
  });
});

describe("with recent completions on", () => {
  it("keeps the Recent activity card and the profile's recent reader, not the weekly one", async () => {
    const { call, week } = makeApi({ recentActivity: true });
    const recent = await screen.findByRole("region", { name: "Recent activity" });
    expect(await within(recent).findByText("Solved · 1 mistake")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Today" })).toBeNull();
    await openJordan();
    await screen.findByRole("list", { name: "Latest 25 completions" });
    expect(screen.getByText("Last 7 days · first completions")).toBeInTheDocument();
    expect(call).toHaveBeenCalledWith("recentCompletions", expect.objectContaining({ friendRef: "friend-1" }));
    expect(week).not.toHaveBeenCalled();
  });
});

it("titles the card Recent activity only when the recent list is given", () => {
  const props = { gameName: "Rainbow", results: [], friendCode: "ABC", tab: "friends" as const, onTabChange: vi.fn(), onAddFriend: vi.fn(), groups: null, today: new Date(2026, 9, 31) };
  const { unmount } = render(<FriendsHome {...props} activity={<p>list</p>} />);
  expect(screen.getByRole("heading", { name: "Recent activity" })).toBeInTheDocument();
  unmount();
  render(<FriendsHome {...props} />);
  expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument();
  expect(screen.getByText("No one has played today's puzzle yet.")).toBeInTheDocument();
});
