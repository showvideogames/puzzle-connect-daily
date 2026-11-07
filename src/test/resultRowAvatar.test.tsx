import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { GroupPage } from "@/components/account/GroupPage";
import { ResultRow } from "@/components/account/ResultRow";
import type { FriendResult } from "@/lib/friendResults";

const result = { id: "m2", name: "Jordan", isYou: false, animalId: "owl", backgroundColor: "#F8D0BD", gameId: "rainbow", status: "solved", mistakes: 1, detail: null } as FriendResult;
const avatar = () => screen.getByTestId("result-row").querySelector("img");

it("keeps the 48px avatar by default and takes a larger one when asked", () => {
  const view = render(<ul><ResultRow result={result} open={false} onToggle={vi.fn()} /></ul>);
  expect(avatar()).toHaveAttribute("width", "48");
  view.rerender(<ul><ResultRow result={result} open={false} onToggle={vi.fn()} avatarSize={56} /></ul>);
  expect(avatar()).toHaveAttribute("width", "56");
});

it("the group page's Today rows use 56px avatars, with the date beside the Today heading", () => {
  render(
    <GroupPage
      group={{ groupId: "g", name: "Book Nerds", emblemId: "book", photo: null, accentColor: "#CCE6CA", memberCount: 2, isOwner: false, inviteCode: null }}
      results={[result]} today={new Date(2026, 10, 4)} onBack={vi.fn()} onShare={vi.fn()} onCopy={vi.fn()} onLeave={vi.fn()}
    />,
  );
  expect(avatar()).toHaveAttribute("width", "56");
  const heading = screen.getByRole("heading", { level: 2, name: "Today" });
  expect(heading.parentElement!.className).toContain("items-start");
  expect(heading.nextElementSibling).toHaveTextContent("Nov 4, 2026");
});
