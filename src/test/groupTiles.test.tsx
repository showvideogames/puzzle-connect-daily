import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { GroupsTab, type GroupSummary } from "@/components/account/GroupsTab";

const groups: GroupSummary[] = ["Puzzle Pals", "Beta Test Group", "Book Nerds"].map((name, i) => ({ groupId: `g${i}`, name, emblemId: "campfire", photo: null, accentColor: "#DED1F2", memberCount: i + 1 }));

it("the compact list shows the first two groups as tiles, in order, with no create or order controls", () => {
  const onOpen = vi.fn();
  render(<GroupsTab compact groups={groups} onCreate={vi.fn()} onOpen={onOpen} onReorder={vi.fn()} />);
  const tiles = screen.getAllByTestId("group-row");
  expect(tiles[0].parentElement!.className).toContain("min-[360px]:grid-cols-2");
  expect(tiles.map((tile) => tile.textContent)).toEqual(["Puzzle Pals1 member", "Beta Test Group2 members"]);
  expect(within(tiles[0]).getByText("Puzzle Pals").className).toContain("font-extrabold");
  expect(tiles[0].querySelector("img")).toHaveAttribute("src", "/shared-assets/groups/campfire.webp");
  fireEvent.click(within(tiles[1]).getByRole("button", { name: /Beta Test Group/ }));
  expect(onOpen).toHaveBeenCalledWith("g1");
  expect(screen.queryByRole("button", { name: "Make a group" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Reorder groups" })).toBeNull();
});

it("the Groups tab keeps every group, Make a group, and Reorder once there are two to order", () => {
  const one = render(<GroupsTab groups={groups.slice(0, 1)} onCreate={vi.fn()} onOpen={vi.fn()} onReorder={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Make a group" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Reorder groups" })).toBeNull();
  one.unmount();
  render(<GroupsTab groups={groups} onCreate={vi.fn()} onOpen={vi.fn()} onReorder={vi.fn()} />);
  expect(screen.getAllByTestId("group-row")).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "Reorder groups" }));
  expect(screen.getByRole("region", { name: "Reorder groups" })).toBeInTheDocument();
});

it("an empty list says so plainly and still offers Make a group", () => {
  render(<GroupsTab groups={[]} onCreate={vi.fn()} />);
  expect(screen.getByText("You're not in any groups yet.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Make a group" })).toBeInTheDocument();
});
