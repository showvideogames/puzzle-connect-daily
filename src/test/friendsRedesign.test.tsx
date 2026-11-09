/**
 * The Friends home and friend profile redesign: the ⋯ menu and its questions,
 * the heading and its separate star, the purple friend code, and the copy toast
 * that never moves the header.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FavoriteStar } from "@/components/account/FavoriteStar";
import { FriendMenu } from "@/components/account/FriendMenu";
import { FriendPreferences } from "@/components/account/FriendPreferences";
import { FriendProfile } from "@/components/account/FriendProfile";
import { FriendsHome } from "@/components/account/FriendsHome";
import type { FriendResult } from "@/lib/friendResults";
import { blockQuestion, removeFriendQuestion } from "@/lib/socialView";
import { shortDate } from "@/components/account/activityDates";
import { FriendWeek } from "@/components/social/FriendWeek";
import type { SocialApi } from "@/components/social/socialApi";

const friend: FriendResult = {
  id: "f1",
  name: "Jordan",
  nickname: "Pal",
  favorite: true,
  isYou: false,
  animalId: "otter",
  backgroundColor: "#CCE6CA",
  gameId: "rainbow",
  status: "solved",
  mistakes: 0,
  detail: null,
};

afterEach(() => {
  Reflect.deleteProperty(navigator, "clipboard");
});

const menuButton = () => screen.getByRole("button", { name: "Manage friendship with Pal" });

async function openMenu() {
  fireEvent.keyDown(menuButton(), { key: "Enter", code: "Enter" });
  return screen.findByRole("menu");
}

async function choose(item: string) {
  await openMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: item }));
  return screen.findByRole("alertdialog");
}

describe("the ⋯ menu on a friend's profile", () => {
  const profile = (onRemove = vi.fn(async () => undefined), onBlock = vi.fn(async () => undefined)) => {
    render(<FriendProfile friend={friend} today={new Date(2026, 10, 5)} resultsAvailable onRemove={onRemove} onBlock={onBlock} onBack={vi.fn()} />);
    return { onRemove, onBlock };
  };

  it("sits at the top right in place of the old disclosure, with Remove friend and Block", async () => {
    profile();
    expect(screen.queryByText("Manage friendship")).toBeNull();
    expect(document.querySelector("details")).toBeNull();
    const menu = await openMenu();
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Remove friend", "Block Pal (Jordan)"]);
  });

  it("asks with the same question and confirm label as before, and only then removes", async () => {
    const { onRemove, onBlock } = profile();
    const question = await choose("Remove friend");
    expect(question).toHaveTextContent(removeFriendQuestion("Pal (Jordan)"));
    expect(onRemove).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(within(question).getByRole("button", { name: "Remove" })));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onBlock).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("asks before blocking, with the block question", async () => {
    const { onRemove, onBlock } = profile();
    const question = await choose("Block Pal (Jordan)");
    expect(question).toHaveTextContent(blockQuestion("Pal (Jordan)"));
    expect(onBlock).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(within(question).getByRole("button", { name: "Block" })));
    expect(onBlock).toHaveBeenCalledTimes(1);
    expect(onRemove).not.toHaveBeenCalled();
  });

  it("returns focus to ⋯ when Escape closes the menu", async () => {
    profile();
    const menu = await openMenu();
    fireEvent.keyDown(menu, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await waitFor(() => expect(menuButton()).toHaveFocus());
  });

  it("returns focus to ⋯ when Escape or Cancel closes the question, and sends nothing", async () => {
    const { onRemove, onBlock } = profile();
    const question = await choose("Remove friend");
    fireEvent.keyDown(question, { key: "Escape", code: "Escape" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await waitFor(() => expect(menuButton()).toHaveFocus());

    const again = await choose("Block Pal (Jordan)");
    fireEvent.click(within(again).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await waitFor(() => expect(menuButton()).toHaveFocus());
    expect(onRemove).not.toHaveBeenCalled();
    expect(onBlock).not.toHaveBeenCalled();
  });

  it("keeps a refusal inside the question, and sends once while it waits", async () => {
    let answer!: (refusal: string) => void;
    const onRemove = vi.fn(() => new Promise<string>((done) => (answer = done)));
    render(<FriendMenu name="Pal" onRemove={onRemove} onBlock={vi.fn()} />);
    const question = await choose("Remove friend");
    const confirm = within(question).getByRole("button", { name: "Remove" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(confirm).toBeDisabled();
    await act(async () => answer("That person isn't on your friends list any more."));
    expect(within(question).getByRole("alert")).toHaveTextContent("That person isn't on your friends list any more.");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(confirm).toBeEnabled();
  });

  it("offers no menu when there is nothing to manage", () => {
    render(<FriendProfile friend={friend} today={new Date(2026, 10, 5)} resultsAvailable onBack={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Manage friendship/ })).toBeNull();
  });
});

describe("the profile heading", () => {
  it("is named only by the friend's name, with the star as its own button beside it", () => {
    render(
      <FriendProfile
        friend={friend}
        today={new Date(2026, 10, 5)}
        resultsAvailable
        favoriteAction={<FavoriteStar size="title" name="Pal" favorite onSave={vi.fn()} />}
        onBack={vi.fn()}
      />,
    );
    const heading = screen.getByRole("heading", { level: 1, name: "Pal" });
    const star = screen.getByRole("button", { name: "Remove Pal from favorites" });
    expect(heading).not.toContainElement(star);
    expect(heading.parentElement).toContainElement(star);
    expect(star).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Public name: Jordan")).toBeInTheDocument();
  });

  it("wraps a 24-character nickname instead of overflowing", () => {
    const long = "Abcdefghijklmnopqrstuvwx";
    expect(long).toHaveLength(24);
    render(<FriendProfile friend={{ ...friend, nickname: long }} today={new Date(2026, 10, 5)} resultsAvailable onBack={vi.fn()} />);
    const heading = screen.getByRole("heading", { level: 1, name: long });
    expect(heading.className).toContain("break-words");
    expect(heading.className).toContain("max-[359px]:text-3xl");
    expect(heading.className).toContain("min-w-0");
  });

  it("opens the private nickname editor from the pill with focus in the field, and Cancel returns it", () => {
    render(<FriendPreferences friend={friend} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Private nickname" }));
    expect(screen.getByLabelText("Private nickname")).toHaveFocus();
    expect(screen.getByLabelText("Private nickname")).toHaveValue("Pal");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Private nickname" })).toHaveFocus();
  });
});

describe("the Friends home header", () => {
  const home = (changes = {}) =>
    render(
      <FriendsHome
        gameName="Rainbow Categories"
        results={[friend]}
        friendCode="R8T-6NZ"
        tab="friends"
        onTabChange={vi.fn()}
        onAddFriend={vi.fn()}
        groups={null}
        {...changes}
      />,
    );

  it("labels the friend code in purple, with the code big and bold", () => {
    home();
    const label = screen.getByTestId("friend-code-label");
    expect(label).toHaveTextContent("Friend code");
    expect(label.className).toContain("text-[hsl(258_90%_50%)]");
    expect(label.className).toContain("dark:text-[hsl(258_100%_82%)]");
    expect(screen.getByText("R8T-6NZ").className).toMatch(/text-xl.*font-black/);
  });

  // The header with each icon reduced to its classes, minus which icon it is.
  const frame = (header: HTMLElement) => {
    const copy = header.cloneNode(true) as HTMLElement;
    copy.querySelectorAll("svg").forEach((svg) => svg.replaceWith(`<svg ${svg.getAttribute("class")?.replace(/lucide-(copy|check)/, "lucide-icon")} aria-hidden=${svg.getAttribute("aria-hidden")}>`));
    return copy.innerHTML;
  };

  it("shows the copy toast outside the header, fixed, so the header only swaps its icon", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
    home();
    const header = screen.getByRole("banner");
    const before = frame(header);
    fireEvent.click(screen.getByRole("button", { name: "Copy friend code" }));
    const toast = await screen.findByText("Copied to clipboard");
    expect(header).not.toContainElement(toast);
    expect(toast).toHaveClass("fixed");
    expect(header.querySelector(".lucide-check")).not.toBeNull();
    expect(frame(header)).toBe(before);
  });

  it("greets by Display Name when it is known, and plainly when it isn't", () => {
    const { unmount } = home({ displayName: "Alex" });
    expect(screen.getByText(/Hi, Alex!/)).toBeInTheDocument();
    unmount();
    home();
    expect(screen.getByText(/Hi there!/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Friends" })).toBeInTheDocument();
  });

  it("names the Add friend button as the reference does", () => {
    const onAddFriend = vi.fn();
    home({ onAddFriend });
    fireEvent.click(screen.getByRole("button", { name: "Add friend" }));
    expect(onAddFriend).toHaveBeenCalledTimes(1);
  });
});

describe("the friend code copy check", () => {
  afterEach(() => vi.useRealTimers());
  const props = { gameName: "Rainbow Categories", results: [friend], tab: "friends" as const, onTabChange: vi.fn(), onAddFriend: vi.fn(), groups: null };
  const clipboard = (writeText: () => Promise<void>) => Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn(writeText) }, configurable: true });
  const button = () => screen.getByRole("button", { name: "Copy friend code" });
  const icon = () => button().querySelector("svg")!;
  const copy = () => act(async () => fireEvent.click(button()));
  const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));

  it("swaps to a check for 2 seconds on success, beside the unchanged toast, label and icon size", async () => {
    vi.useFakeTimers();
    clipboard(async () => undefined);
    render(<FriendsHome {...props} friendCode="R8T-6NZ" />);
    expect(icon()).toHaveClass("lucide-copy");
    await copy();
    expect(icon()).toHaveClass("lucide-check", "h-6", "w-6", "shrink-0");
    expect(icon()).toHaveAttribute("aria-hidden", "true");
    expect(button()).toHaveAccessibleName("Copy friend code");
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("Copied to clipboard");
    await wait(1999);
    expect(icon()).toHaveClass("lucide-check");
    await wait(1);
    expect(icon()).toHaveClass("lucide-copy", "h-6", "w-6", "shrink-0");
    expect(screen.getByRole("status")).toHaveTextContent("Copied to clipboard");
    await wait(800);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows no check when the write is rejected, and a failure clears an earlier check", async () => {
    vi.useFakeTimers();
    clipboard(async () => { throw new Error("denied"); });
    render(<FriendsHome {...props} friendCode="R8T-6NZ" />);
    await copy();
    expect(icon()).toHaveClass("lucide-copy");
    expect(screen.getByRole("status")).toHaveTextContent(/Could not copy/);

    clipboard(async () => undefined);
    await copy();
    expect(icon()).toHaveClass("lucide-check");
    clipboard(async () => { throw new Error("denied"); });
    await copy();
    expect(icon()).toHaveClass("lucide-copy");
  });

  it("renews the 2 seconds on each repeated success", async () => {
    vi.useFakeTimers();
    clipboard(async () => undefined);
    render(<FriendsHome {...props} friendCode="R8T-6NZ" />);
    await copy();
    await wait(1500);
    await copy();
    await wait(1500);
    expect(icon()).toHaveClass("lucide-check");
    await wait(500);
    expect(icon()).toHaveClass("lucide-copy");
  });

  it("ignores an older copy that finishes after a newer one failed", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    clipboard(() => new Promise<void>((done) => (finish = done)));
    render(<FriendsHome {...props} friendCode="R8T-6NZ" />);
    await copy();
    clipboard(async () => { throw new Error("denied"); });
    await copy();
    await act(async () => finish());
    expect(icon()).toHaveClass("lucide-copy");
  });

  it("drops the check for a different code, and leaves no timer after unmount", async () => {
    vi.useFakeTimers();
    clipboard(async () => undefined);
    const { rerender, unmount } = render(<FriendsHome {...props} friendCode="R8T-6NZ" />);
    await copy();
    expect(icon()).toHaveClass("lucide-check");
    rerender(<FriendsHome {...props} friendCode="K2P-9QW" />);
    expect(icon()).toHaveClass("lucide-copy");
    await copy();
    expect(icon()).toHaveClass("lucide-check");
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("Add a favorite", () => {
  const star = (f: FriendResult) => <FavoriteStar name={f.nickname || f.name} favorite={!!f.favorite} onSave={vi.fn()} />;

  it("takes you to All friends, where the stars are, and changes nothing", () => {
    render(<FriendsHome gameName="Rainbow" results={[friend]} friendCode="ABC" tab="friends" onTabChange={vi.fn()} onAddFriend={vi.fn()} groups={null} favoriteAction={star} />);
    fireEvent.click(screen.getByRole("button", { name: "Add a favorite" }));
    expect(within(screen.getByRole("region", { name: "All friends" })).getByRole("heading", { name: /All friends/ })).toHaveFocus();
  });

  it("isn't offered without stars or without friends, and with no stars there is no card", () => {
    const { unmount } = render(<FriendsHome gameName="Rainbow" results={[friend]} friendCode="ABC" tab="friends" onTabChange={vi.fn()} onAddFriend={vi.fn()} groups={null} />);
    expect(screen.queryByRole("button", { name: "Add a favorite" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Favorite friends" })).toBeNull();
    expect(screen.queryByText("Star a friend to keep them close.")).toBeNull();
    unmount();
    render(<FriendsHome gameName="Rainbow" results={[]} friendCode="ABC" tab="friends" onTabChange={vi.fn()} onAddFriend={vi.fn()} groups={null} favoriteAction={star} />);
    expect(screen.queryByRole("button", { name: "Add a favorite" })).toBeNull();
    expect(screen.getByText("Star a friend to keep them close.")).toBeInTheDocument();
  });
});

describe("long names in All friends", () => {
  it("wraps a 24-character nickname to two lines instead of cutting it to a few letters", () => {
    const long = "Bartholomew the Puzzler!";
    expect(long).toHaveLength(24);
    render(<FriendsHome gameName="Rainbow" results={[{ ...friend, nickname: long }]} friendCode="ABC" tab="friends" onTabChange={vi.fn()} onAddFriend={vi.fn()} groups={null} />);
    const name = within(screen.getByRole("region", { name: "All friends" })).getByText(long);
    expect(name.className).toContain("line-clamp-2");
    expect(name.className).not.toMatch(/\btruncate\b/);
  });
});

describe("readable dates and colors", () => {
  it("shows a puzzle's publication day like the other dates, with no time-zone shift", async () => {
    const rows = [{ puzzleId: "a", puzzleDate: "2026-09-22", puzzleTitle: "#102", completedAt: new Date(2026, 10, 4, 12).toISOString(), result: { friendRef: "f1", isMe: false, summary: { solved: true, mistakes: 1 }, detailLocked: true, detail: null } }];
    const api = { today: () => new Date(2026, 10, 5), recentActivity: true, client: { call: vi.fn().mockResolvedValue({ ok: true, data: { rows, hasMore: false } }) } } as unknown as SocialApi;
    render(<FriendWeek api={api} friend={friend} />);
    const expected = new Date(2026, 8, 22).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    expect(await screen.findByText(new RegExp(`Published ${expected}`))).toBeInTheDocument();
    expect(screen.queryByText(/2026-09-22/)).toBeNull();
    expect(shortDate("not a date")).toBe("not a date");
  });

  it("uses the shared readable red for Block and the confirm button", async () => {
    render(<FriendMenu name="Pal" publicName="Jordan" onRemove={vi.fn()} onBlock={vi.fn()} />);
    await openMenu();
    expect(screen.getByRole("menuitem", { name: "Block Pal (Jordan)" }).className).toContain("dark:text-red-400");
    fireEvent.click(screen.getByRole("menuitem", { name: "Block Pal (Jordan)" }));
    const question = await screen.findByRole("alertdialog");
    const confirm = within(question).getByRole("button", { name: "Block" });
    expect(confirm.className).toContain("bg-[hsl(0_72%_45%)]");
    expect(confirm.getAttribute("style")).toBeNull();
  });
});
