/**
 * setFriendPreference replaces a friend's whole preference row. A star and a
 * nickname saved close together go one at a time, each laid over the row the
 * one before it saved, so neither undoes the other.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SocialApi } from "@/components/social/socialApi";
import { SocialScreens } from "@/components/social/SocialScreens";

const face = { animalId: "owl", backgroundColor: "#F8D0BD" };
const yes = (data: unknown = {}) => ({ ok: true, data });
type Row = { friendRef: string; favorite: boolean; nickname: string | null };

beforeEach(() => vi.stubEnv("VITE_SOCIAL_PREFERENCES", "true"));
afterEach(() => vi.unstubAllEnvs());

function open() {
  let stored: Row[] = [];
  const held: (() => void)[] = [];
  const writes: Row[] = [];
  const answers: Record<string, (args: never) => unknown> = {
    getMe: () => yes({ displayName: "Alex", animalId: "fox", backgroundColor: "#DED1F2", friendCode: "AAA-222", friendCount: 1, groupCount: 0 }),
    listFriendRequests: () => yes({ incoming: [], outgoing: [] }),
    listFriends: () => yes([{ ...face, friendRef: "friend-1", name: "Jordan", since: "2026-10-01T18:00:00.000Z" }]),
    listMyGroups: () => yes([]),
    listResults: () => yes([]),
    listBlocks: () => yes([]),
    listFriendPreferences: () => yes(stored),
    // Each write waits until the test lets it land, then replaces the whole row.
    setFriendPreference: (row: Row) => {
      writes.push(row);
      return new Promise((done) =>
        held.push(() => {
          stored = [row];
          done(yes());
        }),
      );
    },
  };
  const call = vi.fn(async (op: string, args: never) => (answers[op] ? answers[op](args) : { ok: false, outcome: "unavailable" }));
  const api: SocialApi = {
    client: { call: call as never, forget: vi.fn() },
    puzzleId: () => "puzzle-1",
    today: () => new Date(2026, 9, 31),
    linkUrl: (code) => `http://rainbow.test/join/${code}`,
    share: vi.fn(async () => "done" as const),
  };
  render(
    <SocialScreens api={api} signedIn code={null} tab="friends" onTab={vi.fn()} onNote={vi.fn()} onLeaveLink={vi.fn()} onSignIn={vi.fn()} onNameLater={vi.fn()} guest={<p>guest</p>} waiting={<p>waiting</p>} />,
  );
  const land = async () => {
    await waitFor(() => expect(held.length).toBeGreaterThan(0));
    await act(async () => held.shift()!());
  };
  return { writes, land, stored: () => stored };
}

async function openJordan() {
  const all = await screen.findByRole("region", { name: "All friends" });
  fireEvent.click(within(all).getByRole("button", { name: "Jordan" }));
  await screen.findByTestId("friend-profile");
}

function saveNickname(nickname: string) {
  fireEvent.click(screen.getByRole("button", { name: "Private nickname" }));
  fireEvent.change(screen.getByLabelText("Private nickname"), { target: { value: nickname } });
  fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));
}

it("keeps a star when a nickname is saved before the star's write lands", async () => {
  const { writes, land, stored } = open();
  await openJordan();
  fireEvent.click(screen.getByRole("button", { name: "Add Jordan to favorites" }));
  await waitFor(() => expect(writes).toHaveLength(1));
  saveNickname("Pal");
  // The nickname waits its turn behind the star.
  expect(writes).toHaveLength(1);
  await land();
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes).toEqual([
    { friendRef: "friend-1", favorite: true, nickname: null },
    { friendRef: "friend-1", favorite: true, nickname: "Pal" },
  ]);
  await land();
  expect(stored()).toEqual([{ friendRef: "friend-1", favorite: true, nickname: "Pal" }]);
  expect(await screen.findByRole("heading", { level: 1, name: "Pal" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Remove Pal from favorites" })).toHaveAttribute("aria-pressed", "true");
});

it("keeps a nickname when the star is pressed before the nickname's write lands", async () => {
  const { writes, land, stored } = open();
  await openJordan();
  saveNickname("Pal");
  await waitFor(() => expect(writes).toHaveLength(1));
  fireEvent.click(screen.getByRole("button", { name: "Add Jordan to favorites" }));
  expect(writes).toHaveLength(1);
  await land();
  await waitFor(() => expect(writes).toHaveLength(2));
  expect(writes[1]).toEqual({ friendRef: "friend-1", favorite: true, nickname: "Pal" });
  await land();
  expect(stored()).toEqual([{ friendRef: "friend-1", favorite: true, nickname: "Pal" }]);
});
