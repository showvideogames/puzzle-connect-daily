import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { GroupFlow } from "@/components/social/GroupFlow";
import type { SocialApi } from "@/components/social/socialApi";

const face = { animalId: "owl", backgroundColor: "#F8D0BD" };
const member = (memberRef: string, name: string, isMe = false) => ({ ...face, memberRef, name, isOwner: false, isMe, joinedAt: "2026-10-30T18:00:00.000Z" });
const answers: Record<string, unknown> = { listMembers: [member("m1", "Alex", true), member("m2", "Jordan")], listResults: [] };
const api = {
  client: { call: vi.fn(async (op: string) => (op in answers ? { ok: true, data: answers[op] } : { ok: false, outcome: "unavailable" })), forget: vi.fn() },
  puzzleId: () => "puzzle-1",
  today: () => new Date(2026, 9, 31),
  linkUrl: (code: string) => `http://rainbow.test/join/${code}`,
  share: vi.fn(),
} as unknown as SocialApi;
const group = { groupId: "g1", name: "Book Nerds", emblemId: "book" as const, photo: null, accentColor: "#CCE6CA" as const, memberCount: 2, isOwner: false, inviteCode: null };

it("moves focus to the Members heading from the settings dialog, and back to the gear on Back", async () => {
  render(<GroupFlow api={api} group={group} onBack={vi.fn()} onReload={vi.fn(async () => undefined)} onLeft={vi.fn()} />);
  await screen.findByTestId("group-page");
  // Arriving on the page does not steal focus.
  expect(document.activeElement).toBe(document.body);
  fireEvent.click(screen.getByRole("button", { name: "Group settings" }));
  fireEvent.click(screen.getByRole("button", { name: "View members" }));
  const heading = await screen.findByRole("heading", { level: 1, name: "Members" });
  await waitFor(() => expect(document.activeElement).toBe(heading));
  // Radix's own clean-up runs after the dialog unmounts; focus must still be on the heading.
  await new Promise((done) => setTimeout(done, 20));
  expect(document.activeElement).toBe(heading);
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  await screen.findByTestId("group-page");
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Group settings" })));
});
