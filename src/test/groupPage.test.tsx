import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GroupPage, type GroupView } from "@/components/account/GroupPage";
import { LIMITS } from "@/social/contract";

const group = (changes: Partial<GroupView> = {}): GroupView => ({
  groupId: "g1",
  name: "Book Nerds",
  emblemId: "book",
  photo: null,
  accentColor: "#CCE6CA",
  memberCount: 4,
  isOwner: true,
  inviteCode: "abc123abc123",
  ...changes,
});

function page(changes: Partial<GroupView> = {}, props: Partial<Parameters<typeof GroupPage>[0]> = {}) {
  const handlers = {
    onBack: vi.fn(),
    onShare: vi.fn(async () => undefined),
    onCopy: vi.fn(async () => undefined),
    onLeave: vi.fn(async () => undefined as string | void),
    onEditPicture: vi.fn(),
    onMembers: vi.fn(),
    onEditDescription: vi.fn(),
    onDelete: vi.fn(async () => undefined as string | void),
  };
  const view = render(<GroupPage group={group(changes)} results={[]} today={new Date(2026, 10, 5)} {...handlers} {...props} />);
  return { ...handlers, view };
}

const button = (name: string) => screen.getByRole("button", { name });
const escape = () => fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
const openSettings = () => {
  fireEvent.click(button("Group settings"));
  return screen.getByRole("dialog", { name: "Group settings" });
};
const choices = (dialog: HTMLElement) => within(dialog).getAllByRole("button").map((each) => each.textContent || each.getAttribute("aria-label"));

describe("the group page's top row", () => {
  it("puts Back on the left, then Invite and a separate gear on the right", () => {
    page();
    const row = button("Back").parentElement!;
    expect(within(row).getByRole("button", { name: "Invite" })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Group settings" })).toBeInTheDocument();
    expect(screen.queryByText("Group settings & members")).toBeNull();
    expect(screen.queryByRole("region", { name: "Send an invitation" })).toBeNull();
  });

  it("gives a member the gear with only View members and Leave, even if owner handlers are passed", () => {
    page({ isOwner: false, inviteCode: null });
    const dialog = openSettings();
    expect(choices(dialog)).toEqual(["View members", "Leave group", "Close"]);
    for (const name of ["Edit description", "Edit group picture", "Delete group"]) expect(within(dialog).queryByRole("button", { name })).toBeNull();
  });

  it("gives an owner the owner-only items too, in the old order", () => {
    page();
    const dialog = openSettings();
    expect(choices(dialog)).toEqual(["Edit description", "Edit group picture", "View members", "Delete group", "Leave group", "Close"]);
  });

  it("leaves out an owner item whose feature is off", () => {
    page({}, { onDelete: undefined, onEditDescription: undefined });
    expect(choices(openSettings())).toEqual(["Edit group picture", "View members", "Leave group", "Close"]);
  });

  it("opens the member list and the editors from the dialog", () => {
    const handlers = page();
    fireEvent.click(within(openSettings()).getByRole("button", { name: "View members" }));
    expect(handlers.onMembers).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(within(openSettings()).getByRole("button", { name: "Edit description" }));
    expect(handlers.onEditDescription).toHaveBeenCalledTimes(1);
    fireEvent.click(within(openSettings()).getByRole("button", { name: "Edit group picture" }));
    expect(handlers.onEditPicture).toHaveBeenCalledTimes(1);
  });

  it("keeps Leave and Delete behind a second step inside the dialog", async () => {
    const handlers = page();
    handlers.onDelete.mockResolvedValueOnce("We couldn't delete the group. Refresh it before trying again.");
    let dialog = openSettings();
    fireEvent.click(within(dialog).getByRole("button", { name: "Leave group" }));
    expect(handlers.onLeave).not.toHaveBeenCalled();
    expect(within(dialog).getByTestId("inline-confirm")).toHaveTextContent("Leave Book Nerds?");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(handlers.onLeave).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Leave group" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Leave" }));
    await waitFor(() => expect(handlers.onLeave).toHaveBeenCalledTimes(1));
    escape();
    dialog = openSettings();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete group" }));
    expect(handlers.onDelete).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete group permanently" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("couldn't delete");
    expect(handlers.onDelete).toHaveBeenCalledTimes(1);
  });

  it("closes the settings on Escape and returns focus to the gear", async () => {
    page();
    openSettings();
    escape();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(button("Group settings")));
  });
});

describe("Invite", () => {
  it.each([
    ["an owner with a code", {}, {}, true],
    ["an owner whose code is null", { inviteCode: null }, {}, false],
    ["a member, who never gets a code", { isOwner: false, inviteCode: null }, {}, false],
    ["a member sent a code by mistake", { isOwner: false }, {}, false],
    ["a member allowed to invite, with a code", { isOwner: false }, { canInvite: true }, true],
    ["a member allowed to invite, without a code", { isOwner: false, inviteCode: null }, { canInvite: true }, false],
    ["an owner whose permission check said no", {}, { canInvite: false }, false],
  ] as const)("follows the invite rule for %s", (_who, changes, props, shown) => {
    page(changes, props);
    expect(screen.queryByRole("button", { name: "Invite" }) !== null).toBe(shown);
    expect(screen.queryByRole("button", { name: "Share invite link" })).toBeNull();
    expect(screen.getByRole("button", { name: "Group settings" })).toBeInTheDocument();
  });

  it("holds Share and Copy, closes on Escape and returns focus to Invite", async () => {
    const handlers = page();
    fireEvent.click(button("Invite"));
    const dialog = screen.getByRole("dialog", { name: "Send an invitation" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Share invite link" }));
    expect(await within(dialog).findByText("Done.")).toBeInTheDocument();
    expect(handlers.onShare).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(handlers.onCopy).toHaveBeenCalledTimes(1));
    escape();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(button("Invite")));
  });

  it("shows an invitation problem inside while open, on the page otherwise, and never twice", () => {
    const { view } = page({}, { invitationProblem: "We couldn't check invitation permission. Please try again." });
    expect(screen.getByRole("alert")).toHaveTextContent("couldn't check");
    fireEvent.click(button("Invite"));
    expect(screen.getAllByText(/couldn't check/)).toHaveLength(1);
    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent("couldn't check");
    // Losing permission while it is open takes Invite away and puts the sentence back on the page.
    view.rerender(<GroupPage group={group()} canInvite={false} invitationProblem="You no longer have invitation permission." results={[]} today={new Date(2026, 10, 5)} onBack={vi.fn()} onShare={vi.fn()} onCopy={vi.fn()} onLeave={vi.fn()} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Invite" })).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("You no longer have invitation permission.");
  });
});

describe("identity", () => {
  it("shows the emblem beside a big name and the member count, and lets a longest-allowed name wrap", () => {
    const name = "The Saturday Morning Puzzle Club of Utah";
    expect(name).toHaveLength(LIMITS.groupNameMax);
    page({ name });
    const heading = screen.getByRole("heading", { level: 1, name });
    expect(heading.className).toContain("font-black");
    expect(heading.className).toContain("break-words");
    expect(heading.parentElement!.className).toContain("min-w-0");
    expect(screen.getByText("4 members")).toBeInTheDocument();
    const emblem = screen.getByTestId("group-page").querySelector("img")!;
    expect(emblem).toHaveAttribute("src", "/shared-assets/groups/book.webp");
    expect(emblem.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
