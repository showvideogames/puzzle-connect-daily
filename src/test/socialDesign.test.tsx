import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SocialToast } from "@/components/account/SocialToast";
import { FavoriteStar } from "@/components/account/FavoriteStar";
import { RecentFriendsActivity } from "@/components/social/RecentFriendsActivity";
import { readRecentActivity } from "@/components/social/friendWeekData";
import type { SocialApi } from "@/components/social/socialApi";
import type { FriendResult } from "@/lib/friendResults";
const friend: FriendResult = {
  id: "f",
  name: "Jordan",
  isYou: false,
  animalId: "otter",
  backgroundColor: "#CCE6CA",
  status: "solved",
  mistakes: 0,
  gameId: "rainbow",
  detail: null,
};
const row = {
  friendRef: "f",
  isMe: false,
  summary: { solved: true, mistakes: 1 },
  detailLocked: true,
  detail: "secret grid",
};
function api() {
  return {
    today: () => new Date(2026, 10, 5),
    client: {
      call: vi.fn().mockImplementation(async (_op, args) => ({
        ok: true,
        data: {
          rows: [
            {
              puzzleId: "a",
              puzzleDate: "2026-09-22",
              puzzleTitle: "#102",
              completedAt: new Date(2026, 10, 4, 12).toISOString(),
              result: row,
            },
          ],
          hasMore: false,
        },
      })),
    },
  } as unknown as SocialApi;
}
afterEach(() => vi.useRealTimers());
it("dismisses a fixed toast after a short interval and cancels its timer on unmount", () => {
  vi.useFakeTimers();
  const dismiss = vi.fn();
  const view = render(
    <SocialToast message="Copied to clipboard" onDismiss={dismiss} />,
  );
  expect(screen.getByRole("status")).toHaveClass("fixed");
  act(() => vi.advanceTimersByTime(2800));
  expect(dismiss).toHaveBeenCalledTimes(1);
  view.rerender(<SocialToast message="Again" onDismiss={dismiss} />);
  view.unmount();
  act(() => vi.runAllTimers());
  expect(dismiss).toHaveBeenCalledTimes(1);
});
it("keeps a failed favorite unchanged, reports error and prevents repeated in-flight writes", async () => {
  let finish!: (s: string) => void;
  const save = vi.fn(
    () =>
      new Promise<string>((r) => {
        finish = r;
      }),
  );
  render(<FavoriteStar name="Jordan" favorite={false} onSave={save} />);
  const button = screen.getByRole("button");
  fireEvent.click(button);
  fireEvent.click(button);
  expect(save).toHaveBeenCalledTimes(1);
  expect(button).toBeDisabled();
  await act(async () => finish("Try again"));
  expect(button).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByRole("alert")).toHaveTextContent("Try again");
});
it("only returns real played activity, preserves exact puzzle gates and excludes self", async () => {
  const source = api();
  const rows = await readRecentActivity(
    source,
    [friend, { ...friend, id: "you", isYou: true }],
    source.today(),
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    date: "2026-11-04",
    result: { id: "f", detail: null },
  });
  expect(source.client.call).toHaveBeenCalledTimes(1);
  expect(source.client.call).toHaveBeenCalledWith(
    "recentCompletions",
    expect.objectContaining({
      from: expect.any(String),
      until: expect.any(String),
    }),
  );
  expect(JSON.stringify(rows)).not.toContain("secret grid");
});
it("does not turn an unavailable read into no recent activity", async () => {
  const source = api();
  vi.mocked(source.client.call).mockResolvedValue({
    ok: false,
    outcome: "unavailable",
  });
  render(
    <RecentFriendsActivity api={source} friends={[friend]} onOpen={vi.fn()} />,
  );
  await screen.findByText(/Activity couldn't be loaded/);
  expect(screen.queryByText("No recent activity")).toBeNull();
});
it("discards a response from an old account even when friend references match", async () => {
  const old = api(),
    next = api();
  let finish!: (s: unknown) => void;
  vi.mocked(old.client.call).mockImplementation(
    () =>
      new Promise((r) => {
        finish = r;
      }),
  );
  vi.mocked(next.client.call).mockResolvedValue({
    ok: true,
    data: { rows: [], hasMore: false },
  });
  const view = render(
    <RecentFriendsActivity api={old} friends={[friend]} onOpen={vi.fn()} />,
  );
  view.rerender(
    <RecentFriendsActivity api={next} friends={[friend]} onOpen={vi.fn()} />,
  );
  await screen.findByText("No recent activity");
  await act(async () =>
    finish({
      ok: true,
      data: {
        rows: [
          {
            puzzleId: "a",
            puzzleDate: "2026-09-22",
            puzzleTitle: "#102",
            completedAt: new Date(2026, 10, 4, 12).toISOString(),
            result: row,
          },
        ],
        hasMore: false,
      },
    }),
  );
  expect(screen.queryByText(/Solved/)).toBeNull();
});
