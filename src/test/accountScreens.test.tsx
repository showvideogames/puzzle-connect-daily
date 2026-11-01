import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { User as AuthUser } from "@supabase/supabase-js";
import { AddFriendScreen, type FoundPerson } from "@/components/account/AddFriendScreen";
import { DisplayNameGate } from "@/components/account/DisplayNameGate";
import { FriendInviteCard } from "@/components/account/FriendInviteCard";
import { FriendsHome } from "@/components/account/FriendsHome";
import { GamePicker } from "@/components/account/GamePicker";
import { GroupAppearanceForm } from "@/components/account/GroupAppearanceForm";
import { GroupEmblem } from "@/components/account/GroupEmblem";
import { GroupInviteCard, type GroupInvitePreview } from "@/components/account/GroupInviteCard";
import { GroupsTab } from "@/components/account/GroupsTab";
import { ProfileForm } from "@/components/account/ProfileForm";
import { ResultDetail } from "@/components/account/ResultDetail";
import { SetupScreen } from "@/components/account/SetupScreen";
import { PlayerAuth } from "@/components/PlayerAuth";
import { SettingsModal } from "@/components/SettingsModal";
import { MemoryRouter } from "react-router-dom";
import type { FriendResult } from "@/lib/friendResults";
import { gameCatalog } from "@/lib/gameCatalog";
import { prepareGroupPhoto } from "@/lib/groupPicture";
import { inviteMemberPreview } from "@/lib/invitePreview";
import { loadSettings } from "@/lib/settings";
import { FRIEND_SHARING_NOTICE, GROUP_SHARING_NOTICE, GROUP_VISIBILITY_NOTE, SHARING_NOTICE_VERSION } from "@/lib/sharingNotice";
import { newProfile, type SharedProfile } from "@/lib/sharedProfile";

vi.mock("@/lib/groupPicture", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/groupPicture")>()),
  prepareGroupPhoto: vi.fn(),
}));

const alex: SharedProfile = { version: 1, displayName: "Alex", animalId: "fox", backgroundColor: "#DED1F2" };

const noticeWords = (notice: HTMLElement) => [...notice.querySelectorAll("li")].map((line) => line.textContent).join(" ");

describe("ProfileForm", () => {
  it("puts the name first, then color, then avatar", () => {
    render(<ProfileForm mode="setup" initial={newProfile()} onSave={vi.fn()} />);
    const name = screen.getByLabelText("Display Name");
    const color = screen.getByRole("radio", { name: "Lilac" });
    const avatar = screen.getByRole("radio", { name: "Fox" });
    expect(name.compareDocumentPosition(color) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(color.compareDocumentPosition(avatar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("starts with a default avatar and color chosen", () => {
    render(<ProfileForm mode="setup" initial={newProfile()} onSave={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "Fox" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Lilac" })).toBeChecked();
  });

  it("will not continue without a name", () => {
    const onSave = vi.fn();
    render(<ProfileForm mode="setup" initial={newProfile()} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("Display Name"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a display name");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves the trimmed name with the choices made", async () => {
    const onSave = vi.fn();
    render(<ProfileForm mode="setup" initial={newProfile()} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("Display Name"), { target: { value: "  Sam " } });
    fireEvent.click(screen.getByRole("radio", { name: "Mint" }));
    fireEvent.click(screen.getByRole("radio", { name: "Otter" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({ version: 1, displayName: "Sam", animalId: "otter", backgroundColor: "#CCE6CA" });
  });

  it("offers Later on setup, and Later saves nothing", () => {
    const onSave = vi.fn();
    const onLater = vi.fn();
    render(<ProfileForm mode="setup" initial={newProfile()} onSave={onSave} onLater={onLater} />);
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(onLater).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("keeps the short list short until asked for all 30", () => {
    render(<ProfileForm mode="setup" initial={newProfile()} onSave={vi.fn()} />);
    expect(screen.queryByRole("radio", { name: "Ghost" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show all 30 avatars" }));
    expect(screen.getByRole("radio", { name: "Ghost" })).toBeInTheDocument();
  });

  it("shows an avatar from outside the short list when editing it", () => {
    render(<ProfileForm mode="edit" initial={{ ...alex, animalId: "ghost" }} onSave={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "Ghost" })).toBeChecked();
  });

  it("keeps everything chosen when saving fails", async () => {
    render(<ProfileForm mode="setup" initial={newProfile()} onSave={() => Promise.reject(new Error("down"))} />);
    fireEvent.change(screen.getByLabelText("Display Name"), { target: { value: "Sam" } });
    fireEvent.click(screen.getByRole("radio", { name: "Rose" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't save");
    expect(screen.getByLabelText("Display Name")).toHaveValue("Sam");
    expect(screen.getByRole("radio", { name: "Rose" })).toBeChecked();
  });

  it("edits a saved profile, and Cancel saves nothing", () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(<ProfileForm mode="edit" initial={alex} onSave={onSave} onCancel={onCancel} />);
    expect(screen.getByRole("heading", { name: "Edit your profile" })).toBeInTheDocument();
    expect(screen.getByLabelText("Display Name")).toHaveValue("Alex");
    fireEvent.click(screen.getByRole("radio", { name: "Rose" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("GamePicker", () => {
  it("has a Play link to every game's own site, opening safely in a new tab", () => {
    render(<GamePicker games={gameCatalog} />);
    expect(screen.getByRole("heading", { name: "What shall we play?" })).toBeInTheDocument();
    for (const game of gameCatalog) {
      const link = screen.getByRole("link", { name: `Play ${game.title} (opens in a new tab)` });
      expect(link).toHaveAttribute("href", game.href);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
    expect(screen.getAllByTestId("game-card")).toHaveLength(7);
  });

  it("is open to a guest, with no profile at all", () => {
    render(<GamePicker games={gameCatalog} profile={null} />);
    expect(screen.getAllByRole("link", { name: /^Play / })).toHaveLength(gameCatalog.length);
    expect(screen.queryByRole("button", { name: "Open your profile" })).toBeNull();
  });

  it("leaves every Play link live beside setup", () => {
    render(<SetupScreen form={<p>form</p>} picker={<GamePicker games={gameCatalog} embedded />} />);
    expect(within(screen.getByTestId("games-beside-setup")).getAllByRole("link")).toHaveLength(gameCatalog.length);
  });

  it("has no filler card: only games in the grid", () => {
    render(<GamePicker games={gameCatalog} />);
    const grid = screen.getByTestId("game-picker").querySelector("ul");
    expect(grid.children).toHaveLength(gameCatalog.length);
  });

  it("gives every game the same size of card", () => {
    render(<GamePicker games={gameCatalog} />);
    for (const card of screen.getAllByTestId("game-card")) expect(card.className).not.toMatch(/col-span/);
  });

  it("falls back to the small icon when a game has no cover", () => {
    render(<GamePicker games={gameCatalog.slice(0, 1)} />);
    const card = screen.getByTestId("game-card");
    expect(card.querySelector("img")).toHaveAttribute("src", gameCatalog[0].iconSrc);
  });

  it("opens profile editing from the corner avatar", () => {
    const onOpenProfile = vi.fn();
    render(<GamePicker games={gameCatalog} profile={alex} onOpenProfile={onOpenProfile} />);
    fireEvent.click(screen.getByRole("button", { name: "Open your profile" }));
    expect(onOpenProfile).toHaveBeenCalledTimes(1);
  });
});

describe("GroupInviteCard", () => {
  const invite: GroupInvitePreview = {
    name: "Friday Puzzlers",
    emblemId: "cards-dice",
    accentColor: "#DED1F2",
    isMember: false,
    isRemoved: false,
    memberPreview: inviteMemberPreview([{ name: "Sam", animalId: "bear", backgroundColor: "#F8E4A0" }, { name: "Jordan", animalId: "owl", backgroundColor: "#F8D0BD" }], 6),
  };
  const noticeText = () => [...screen.getByTestId("sharing-notice").querySelectorAll("li")].map((line) => line.textContent).join(" ");
  const handlers = () => ({ onSignIn: vi.fn(), onChooseName: vi.fn(), onJoin: vi.fn(), onContinue: vi.fn() });

  it("shows a guest the group, and sign-in instead of Join", () => {
    const on = handlers();
    render(<GroupInviteCard invite={invite} signedIn={false} {...on} />);
    const card = screen.getByTestId("group-invite");
    expect(within(card).getByRole("heading", { level: 1 })).toHaveTextContent("Friday Puzzlers");
    expect(card.querySelector("img")).toHaveAttribute("src", "/shared-assets/groups/cards-dice.webp");
    expect(screen.queryByRole("button", { name: "Join group" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sign in to join" }));
    expect(on.onSignIn).toHaveBeenCalledTimes(1);
  });

  it("never joins on its own: only the button does", () => {
    const on = handlers();
    const { rerender } = render(<GroupInviteCard invite={invite} signedIn displayName="Alex" {...on} />);
    rerender(<GroupInviteCard invite={invite} signedIn displayName="Alex" {...on} />);
    expect(on.onJoin).not.toHaveBeenCalled();
    expect(screen.getByText("Alex")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Join group" }));
    expect(on.onJoin).toHaveBeenCalledTimes(1);
  });

  it("uses the owner's sentence, exactly, before sign-in, at Join and without a name", () => {
    const owner = "Your completed daily results are shared automatically with this group across our games. Puzzle details stay hidden until members finish the same puzzle. You can leave anytime.";
    const { rerender } = render(<GroupInviteCard invite={invite} signedIn={false} {...handlers()} />);
    expect(noticeText()).toBe(owner);
    rerender(<GroupInviteCard invite={invite} signedIn displayName="Alex" {...handlers()} />);
    expect(noticeText()).toBe(owner);
    rerender(<GroupInviteCard invite={invite} signedIn {...handlers()} />);
    expect(noticeText()).toBe(owner);
    expect(GROUP_SHARING_NOTICE).toBe(owner);
    expect(SHARING_NOTICE_VERSION).toBe(1);
  });

  it("shows the notice one sentence to a line, without a panel, and the visibility note", () => {
    render(<GroupInviteCard invite={invite} signedIn displayName="Alex" {...handlers()} />);
    const notice = screen.getByTestId("sharing-notice");
    expect(notice.querySelectorAll("li")).toHaveLength(3);
    expect(notice.className).not.toContain("bg-secondary");
    expect(screen.getByText("Your name, avatar and daily results are visible to the group.")).toBeInTheDocument();
    expect(screen.queryByText("Draft wording")).toBeNull();
    expect(screen.queryByText(/Compare daily results/)).toBeNull();
  });

  it("shows the same member preview before sign-in and at Join", () => {
    const { rerender } = render(<GroupInviteCard invite={invite} signedIn={false} {...handlers()} />);
    expect(screen.getByTestId("member-preview")).toHaveTextContent("Join Sam and 5 friends.");
    expect(screen.getByRole("button", { name: "Sign in to join" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Join group" })).toBeNull();
    rerender(<GroupInviteCard invite={invite} signedIn displayName="Alex" {...handlers()} />);
    expect(screen.getByTestId("member-preview")).toHaveTextContent("Join Sam and 5 friends.");
  });

  it("shows no member preview on a removed, broken or already-a-member link", () => {
    const { rerender } = render(<GroupInviteCard invite={{ ...invite, isRemoved: true }} signedIn {...handlers()} />);
    expect(screen.queryByTestId("member-preview")).toBeNull();
    rerender(<GroupInviteCard invite={{ ...invite, isMember: true }} signedIn {...handlers()} />);
    expect(screen.queryByTestId("member-preview")).toBeNull();
    rerender(<GroupInviteCard invite={null} signedIn {...handlers()} />);
    expect(screen.queryByTestId("member-preview")).toBeNull();
    rerender(<GroupInviteCard invite={invite} signedIn joined {...handlers()} />);
    expect(screen.queryByTestId("member-preview")).toBeNull();
  });

  it("says You're invited, with Back and a secondary Not now", () => {
    const on = handlers();
    const onBack = vi.fn();
    render(<GroupInviteCard invite={invite} signedIn displayName="Alex" {...on} onBack={onBack} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("You're invited!");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Friday Puzzlers");
    expect(screen.getByRole("button", { name: "Not now" }).className).toContain("border-2");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(on.onJoin).not.toHaveBeenCalled();
  });

  it("keeps You'll show as, and keeps Join as the primary action", () => {
    render(<GroupInviteCard invite={invite} signedIn displayName="Alex" {...handlers()} />);
    expect(screen.getByText("Alex").parentElement).toHaveTextContent("You'll show as Alex.");
    expect(screen.getByRole("button", { name: "Join group" }).className).toContain("bg-[hsl(258_46%_52%)]");
  });

  it("asks for a Display Name instead of offering Join without one", () => {
    const on = handlers();
    render(<GroupInviteCard invite={invite} signedIn {...on} />);
    expect(screen.queryByRole("button", { name: "Join group" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Choose a Display Name" }));
    expect(on.onChooseName).toHaveBeenCalledTimes(1);
    expect(on.onJoin).not.toHaveBeenCalled();
  });

  it("shows an uploaded group picture instead of the emblem", () => {
    render(<GroupInviteCard invite={{ ...invite, photo: "data:image/jpeg;base64,AAAA" }} signedIn={false} {...handlers()} />);
    expect(screen.getByTestId("group-invite").querySelector("img")).toHaveAttribute("src", "data:image/jpeg;base64,AAAA");
  });

  it("lets a player decline", () => {
    const on = handlers();
    render(<GroupInviteCard invite={invite} signedIn displayName="Alex" {...on} />);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(on.onContinue).toHaveBeenCalledTimes(1);
    expect(on.onJoin).not.toHaveBeenCalled();
  });

  it("shows why a join failed and allows another try", () => {
    render(<GroupInviteCard invite={invite} signedIn displayName="Alex" error="This group is full." {...handlers()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("This group is full.");
    expect(screen.getByRole("button", { name: "Join group" })).toBeEnabled();
  });

  it("offers no Join to someone the owner removed", () => {
    render(<GroupInviteCard invite={{ ...invite, isRemoved: true }} signedIn {...handlers()} />);
    expect(screen.getByRole("status")).toHaveTextContent("removed from this group");
    expect(screen.queryByRole("button", { name: "Join group" })).toBeNull();
  });

  it("offers no Join to a member, or after joining", () => {
    const { rerender } = render(<GroupInviteCard invite={{ ...invite, isMember: true }} signedIn {...handlers()} />);
    expect(screen.getByText("You're already a member")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Join group" })).toBeNull();
    rerender(<GroupInviteCard invite={invite} signedIn joined {...handlers()} />);
    expect(screen.getByText("You're in!")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Join group" })).toBeNull();
  });

  it("says plainly when a link does not work", () => {
    render(<GroupInviteCard invite={null} signedIn={false} {...handlers()} />);
    expect(screen.getByRole("heading")).toHaveTextContent("This invitation isn't working");
  });
});

describe("friend invitations", () => {
  const handlers = () => ({ onSignIn: vi.fn(), onChooseName: vi.fn(), onAdd: vi.fn(), onContinue: vi.fn() });

  it("explains automatic sharing, and only the button accepts", () => {
    const on = handlers();
    render(<FriendInviteCard inviterName="Jordan" signedIn displayName="Alex" {...on} />);
    expect(noticeWords(screen.getByTestId("sharing-notice"))).toBe(FRIEND_SHARING_NOTICE);
    expect(screen.queryByText("Draft wording")).toBeNull();
    expect(on.onAdd).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Add friend" }));
    expect(on.onAdd).toHaveBeenCalledTimes(1);
  });

  it("lets the other person Accept or say Not now", () => {
    const on = handlers();
    render(<FriendInviteCard inviterName="Jordan" inviter={{ animalId: "owl", backgroundColor: "#F8D0BD" }} acceptLabel="Accept" signedIn displayName="Alex" {...on} />);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(on.onContinue).toHaveBeenCalledTimes(1);
    expect(on.onAdd).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(on.onAdd).toHaveBeenCalledTimes(1);
  });

  it("needs a sign-in, then a Display Name", () => {
    const { rerender } = render(<FriendInviteCard inviterName="Jordan" signedIn={false} {...handlers()} />);
    expect(screen.getByRole("button", { name: "Sign in to add Jordan" })).toBeInTheDocument();
    rerender(<FriendInviteCard inviterName="Jordan" signedIn {...handlers()} />);
    expect(screen.getByRole("button", { name: "Choose a Display Name to add Jordan" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add friend" })).toBeNull();
  });

  it("offers Decline beside Not now only when it is given one", () => {
    const onDecline = vi.fn();
    const { rerender } = render(<FriendInviteCard inviterName="Jordan" signedIn displayName="Alex" {...handlers()} />);
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
    rerender(<FriendInviteCard inviterName="Jordan" signedIn displayName="Alex" {...handlers()} onDecline={onDecline} />);
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(onDecline).toHaveBeenCalledTimes(1);
  });

  it("shows a refusal on the card, and offers the same choice again", () => {
    render(<FriendInviteCard inviterName="Jordan" signedIn displayName="Alex" error="That friend request is no longer waiting." {...handlers()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("That friend request is no longer waiting.");
    expect(screen.getByRole("button", { name: "Add friend" })).toBeEnabled();
  });
});

const friendResult = (changes: Partial<FriendResult>): FriendResult => ({
  id: "sam",
  name: "Sam",
  isYou: false,
  animalId: "bear",
  backgroundColor: "#F1CDDA",
  gameId: "rainbow",
  status: "solved",
  mistakes: 1,
  detail: null,
  ...changes,
});

describe("FriendsHome", () => {
  const home = (results: FriendResult[], changes = {}) => (
    <FriendsHome
      gameName="Rainbow Categories"
      results={results}
      friendCode="R8T-6NZ"
      tab="friends"
      onTabChange={vi.fn()}
      onAddFriend={vi.fn()}
      groups={<p>Groups go here</p>}
      today={new Date(2026, 9, 31)}
      {...changes}
    />
  );

  it("puts today's results first, in plain words, with the date from the device", () => {
    render(home([friendResult({ mistakes: 0 }), friendResult({ id: "you", isYou: true, name: "Alex" })]));
    expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument();
    expect(screen.getByText(new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(2026, 9, 31)))).toBeInTheDocument();
    expect(screen.getByText("Solved · 0 mistakes")).toBeInTheDocument();
    expect(screen.getByText("Solved · 1 mistake")).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
  });

  it("does not open a row for someone who has not played", () => {
    render(home([friendResult({ id: "taylor", name: "Taylor", status: "not-played", mistakes: 0 })]));
    expect(screen.getByText("Not played yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Taylor/ })).toBeNull();
  });

  it("opens someone who has not played when there are actions, with no result panel to show", () => {
    const rowActions = (result: FriendResult) => (result.isYou ? null : <button type="button">Do something</button>);
    render(home([friendResult({ id: "you", isYou: true, name: "Alex", status: "not-played", mistakes: 0 }), friendResult({ id: "taylor", name: "Taylor", status: "not-played", mistakes: 0 })], { rowActions }));
    expect(screen.queryByRole("button", { name: /You/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Taylor/ }));
    expect(screen.getByRole("button", { name: "Do something" })).toBeInTheDocument();
    expect(screen.queryByTestId("result-locked")).toBeNull();
    expect(screen.queryByTestId("result-detail")).toBeNull();
  });

  it("keeps a locked row locked when there are actions", () => {
    render(home([friendResult({ detail: null })], { rowActions: () => <button type="button">Do something</button> }));
    fireEvent.click(screen.getByRole("button", { name: /Sam/ }));
    expect(screen.getByTestId("result-locked")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Do something" })).toBeInTheDocument();
  });

  it("opens to a plain locked message when the details were not sent", () => {
    render(home([friendResult({ detail: null })]));
    const row = screen.getByRole("button", { name: /Sam/ });
    expect(row).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(row).toHaveTextContent("Hide");
    expect(screen.getByTestId("result-locked")).toHaveTextContent("Finish today's puzzle to see their details.");
  });

  it("opens to the game's own details once they are sent", () => {
    render(home([friendResult({ detail: "🟨🟨🟨🟨\n🟩🟩🟦🟩\n💡\n🌈🌈🌈🌈" })]));
    fireEvent.click(screen.getByRole("button", { name: /Sam/ }));
    expect(screen.getByLabelText("Guess 1: All yellow")).toBeInTheDocument();
    expect(screen.getByLabelText("Guess 2: green, green, blue, green")).toBeInTheDocument();
    expect(screen.getByText("Used a hint")).toBeInTheDocument();
    expect(screen.getByLabelText("Guess 3: All rainbow")).toBeInTheDocument();
  });

  it("shows only the summary for a game with no detail view yet", () => {
    render(<ResultDetail result={friendResult({ gameId: "some-other-game", detail: "anything", mistakes: 2 })} />);
    expect(screen.getByTestId("result-detail")).toHaveTextContent("Solved · 2 mistakes");
  });

  it("offers Add a friend and copies the friend code", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const onAddFriend = vi.fn();
    render(home([], { onAddFriend }));
    fireEvent.click(screen.getByRole("button", { name: "Add a friend" }));
    expect(onAddFriend).toHaveBeenCalledTimes(1);
    expect(screen.getByText("R8T-6NZ")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
    expect(writeText).toHaveBeenCalledWith("R8T-6NZ");
    expect(await screen.findByText("Copied.")).toBeInTheDocument();
  });

  it("says so plainly when copying fails", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockRejectedValue(new Error("no")) }, configurable: true });
    render(home([]));
    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
    expect(await screen.findByText(/couldn't copy/)).toBeInTheDocument();
  });

  it("has Friends and Groups tabs", () => {
    const onTabChange = vi.fn();
    const { rerender } = render(home([], { onTabChange }));
    expect(screen.getByRole("tab", { name: "Friends" })).toHaveAttribute("aria-selected", "true");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Groups" }), { button: 0 });
    expect(onTabChange).toHaveBeenCalledWith("groups");
    rerender(home([], { tab: "groups" }));
    expect(screen.getByText("Groups go here")).toBeInTheDocument();
  });
});

describe("AddFriendScreen", () => {
  const jordan: FoundPerson = { displayName: "Jordan", animalId: "owl", backgroundColor: "#F8D0BD" };
  const on = () => ({
    onBack: vi.fn(),
    onShareLink: vi.fn(),
    onCopyLink: vi.fn(),
    onFind: vi.fn().mockResolvedValue(jordan),
    onSendRequest: vi.fn(),
  });
  const enterCode = (code: string) => {
    fireEvent.change(screen.getByLabelText("Enter a friend code"), { target: { value: code } });
    fireEvent.click(screen.getByRole("button", { name: "Find friend" }));
  };

  it("offers the link and the code, with the picture above the heading", () => {
    render(<AddFriendScreen pictureSrc="/picture.png" {...on()} />);
    const picture = screen.getByTestId("add-friend-picture");
    const heading = screen.getByRole("heading", { level: 1, name: "Add a friend" });
    expect(picture.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(picture).toHaveAttribute("src", "/picture.png");
    expect(screen.getByRole("button", { name: "Share invite link" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
  });

  it("confirms a link action in neutral words", async () => {
    const handlers = on();
    render(<AddFriendScreen pictureSrc="/picture.png" {...handlers} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(await screen.findByText("Done.")).toBeInTheDocument();
    expect(handlers.onCopyLink).toHaveBeenCalledTimes(1);
  });

  it("shows the person before anything is sent, then waits for them to accept", async () => {
    const handlers = on();
    render(<AddFriendScreen pictureSrc="/picture.png" {...handlers} />);
    enterCode(" k7m4px ");
    await screen.findByTestId("found-person");
    expect(handlers.onFind).toHaveBeenCalledWith("K7M-4PX");
    expect(screen.getByText("Jordan")).toBeInTheDocument();
    expect(handlers.onSendRequest).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByTestId("request-sent")).toHaveTextContent("Jordan needs to accept before you're friends.");
    expect(handlers.onSendRequest).toHaveBeenCalledTimes(1);
  });

  it("shows the sharing notice above Send request once someone is found", async () => {
    render(<AddFriendScreen pictureSrc="/picture.png" {...on()} />);
    enterCode("K7M-4PX");
    const found = await screen.findByTestId("found-person");
    const notice = within(found).getByTestId("sharing-notice");
    expect(noticeWords(notice)).toBe(FRIEND_SHARING_NOTICE);
    const send = within(found).getByRole("button", { name: "Send request" });
    expect(notice.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows whoever makes a link the same notice, above Share and Copy, with no extra step", async () => {
    const handlers = on();
    render(<AddFriendScreen pictureSrc="/picture.png" {...handlers} />);
    const card = screen.getByRole("region", { name: "Send an invitation" });
    const notice = within(card).getByTestId("sharing-notice");
    expect(noticeWords(notice)).toBe(FRIEND_SHARING_NOTICE);
    expect(FRIEND_SHARING_NOTICE).toBe("Your completed daily results are shared automatically with this friend across our games. Puzzle details stay hidden until they finish the same puzzle. You can remove a friend anytime.");
    for (const name of ["Share invite link", "Copy link"]) {
      const button = within(card).getByRole("button", { name });
      expect(notice.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    fireEvent.click(within(card).getByRole("button", { name: "Share invite link" }));
    expect(await screen.findByText("Done.")).toBeInTheDocument();
    expect(handlers.onShareLink).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lets a player go back from the wrong person", async () => {
    const handlers = on();
    render(<AddFriendScreen pictureSrc="/picture.png" {...handlers} />);
    enterCode("K7M-4PX");
    fireEvent.click(await screen.findByRole("button", { name: "Not this person" }));
    expect(screen.getByLabelText("Enter a friend code")).toBeInTheDocument();
    expect(handlers.onSendRequest).not.toHaveBeenCalled();
  });

  it("gives plain messages for a wrong code, a bad code and their own code", async () => {
    const handlers = on();
    handlers.onFind.mockResolvedValueOnce(null).mockResolvedValueOnce("self");
    render(<AddFriendScreen pictureSrc="/picture.png" {...handlers} />);
    enterCode("ZZZ-999");
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't find anyone with that code.");
    enterCode("R8T-6NZ");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("That's your own code."));
    handlers.onFind.mockClear();
    enterCode("hello");
    expect(screen.getByRole("alert")).toHaveTextContent("doesn't look like a friend code");
    expect(handlers.onFind).not.toHaveBeenCalled();
  });

  it("says what its handler says when a code can't be used", async () => {
    const handlers = on();
    handlers.onFind.mockResolvedValueOnce({ problem: "You're already friends." });
    render(<AddFriendScreen pictureSrc="/picture.png" {...handlers} />);
    enterCode("K7M-4PX");
    expect(await screen.findByRole("alert")).toHaveTextContent("You're already friends.");
    expect(screen.queryByText(/couldn't find anyone/)).toBeNull();
  });

  it("never says Request sent for a refused send: it goes back and says why", async () => {
    const handlers = on();
    handlers.onSendRequest.mockResolvedValueOnce("There's already a friend request between you.");
    render(<AddFriendScreen pictureSrc="/picture.png" {...handlers} />);
    enterCode("K7M-4PX");
    fireEvent.click(await screen.findByRole("button", { name: "Send request" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("There's already a friend request between you.");
    expect(screen.queryByTestId("request-sent")).toBeNull();
    expect(screen.queryByText("Request sent")).toBeNull();
  });

  it("doesn't say Done for a link it couldn't make, or one the player cancelled", async () => {
    const handlers = on();
    handlers.onCopyLink.mockResolvedValueOnce("You've made a lot of friend links today. Please try again tomorrow.");
    handlers.onShareLink.mockResolvedValueOnce(false);
    render(<AddFriendScreen pictureSrc="/picture.png" {...handlers} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("made a lot of friend links");
    expect(screen.queryByText("Done.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Share invite link" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.queryByText("Done.")).toBeNull();
  });

  describe("sent requests", () => {
    const sent = [{ id: "r1", ...jordan }];

    it("lists them on the first step only, and has no list without any", async () => {
      const onCancelRequest = vi.fn();
      const { rerender } = render(<AddFriendScreen pictureSrc="/picture.png" {...on()} sentRequests={[]} onCancelRequest={onCancelRequest} />);
      expect(screen.queryByTestId("sent-requests")).toBeNull();
      rerender(<AddFriendScreen pictureSrc="/picture.png" {...on()} sentRequests={sent} onCancelRequest={onCancelRequest} />);
      expect(screen.getByTestId("sent-requests")).toHaveTextContent("Jordan");
      enterCode("K7M-4PX");
      await screen.findByTestId("found-person");
      expect(screen.queryByTestId("sent-requests")).toBeNull();
    });

    it("cancels by id, and shows a refusal beside the row", async () => {
      const onCancelRequest = vi.fn().mockResolvedValue("That friend request is no longer waiting.");
      render(<AddFriendScreen pictureSrc="/picture.png" {...on()} sentRequests={sent} onCancelRequest={onCancelRequest} />);
      fireEvent.click(screen.getByRole("button", { name: "Cancel request to Jordan" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("no longer waiting");
      expect(onCancelRequest).toHaveBeenCalledWith("r1");
    });
  });
});

describe("GroupsTab", () => {
  const coffee = { groupId: "g1", name: "Coffee Crew", emblemId: "coffee" as const, photo: null, accentColor: "#F8D0BD" as const, memberCount: 4 };

  it("opens a group by its id when it can, and keeps two groups of one name apart", () => {
    const onOpen = vi.fn();
    render(<GroupsTab groups={[coffee, { ...coffee, groupId: "g2", memberCount: 1 }]} onCreate={vi.fn()} onOpen={onOpen} />);
    expect(screen.getAllByTestId("group-row")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /1 member/ }));
    expect(onOpen).toHaveBeenCalledWith("g2");
  });

  it("has plain rows when nothing can open them", () => {
    render(<GroupsTab groups={[coffee]} onCreate={vi.fn()} />);
    expect(within(screen.getByTestId("group-row")).queryByRole("button")).toBeNull();
  });

  it("lists groups, and reuses the group form to make one", async () => {
    const onCreate = vi.fn();
    render(<GroupsTab groups={[{ name: "Coffee Crew", emblemId: "coffee", photo: null, accentColor: "#F8D0BD", memberCount: 4 }]} onCreate={onCreate} />);
    expect(screen.getByTestId("group-row")).toHaveTextContent("4 members");
    fireEvent.click(screen.getByRole("button", { name: "Make a group" }));
    fireEvent.change(screen.getByLabelText("Group name"), { target: { value: "Book Nerds" } });
    fireEvent.click(screen.getByRole("radio", { name: "Mint" }));
    fireEvent.click(screen.getByRole("button", { name: "Save group" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ name: "Book Nerds", accentColor: "#CCE6CA" })));
    expect(await screen.findByRole("button", { name: "Make a group" })).toBeInTheDocument();
  });
});

describe("DisplayNameGate", () => {
  it("asks only for a name, and can be left", () => {
    const onChooseName = vi.fn();
    const onNotNow = vi.fn();
    render(<DisplayNameGate onChooseName={onChooseName} onNotNow={onNotNow} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose a Display Name" }));
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(onChooseName).toHaveBeenCalledTimes(1);
    expect(onNotNow).toHaveBeenCalledTimes(1);
  });
});

describe("GroupAppearanceForm", () => {
  const initial = { name: "", emblemId: "cards-dice" as const, photo: null, accentColor: "#DED1F2" as const };

  it("saves a preset emblem with the chosen color", async () => {
    const onSave = vi.fn();
    render(<GroupAppearanceForm initial={initial} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("Group name"), { target: { value: " Book Nerds " } });
    fireEvent.click(screen.getByRole("radio", { name: "Book club" }));
    fireEvent.click(screen.getByRole("radio", { name: "Mint" }));
    fireEvent.click(screen.getByRole("button", { name: "Save group" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({ name: "Book Nerds", emblemId: "book", photo: null, accentColor: "#CCE6CA" });
  });

  it("needs a name", () => {
    const onSave = vi.fn();
    render(<GroupAppearanceForm initial={initial} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "Save group" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Give your group a name");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("refuses a file that is not a picture", async () => {
    render(<GroupAppearanceForm initial={initial} onSave={vi.fn()} />);
    const file = new File(["not a picture"], "notes.txt", { type: "text/plain" });
    fireEvent.change(screen.getByTestId("group-photo-input"), { target: { files: [file] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("choose a picture");
  });

  it("keeps an uploaded picture and lets it be swapped for an emblem", async () => {
    const onSave = vi.fn();
    const photo = "data:image/jpeg;base64,AAAA";
    render(<GroupAppearanceForm initial={{ ...initial, name: "West", photo }} onSave={onSave} />);
    expect(screen.getByRole("radio", { name: "Game night" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Use an emblem instead" }));
    expect(screen.getByRole("radio", { name: "Game night" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Save group" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ photo: null })));
  });

  it("shows the group's color around an uploaded picture", () => {
    const { container } = render(<GroupEmblem emblemId="book" photo="data:image/jpeg;base64,AAAA" color="#CCE6CA" size={80} />);
    expect((container.firstChild as HTMLElement).style.background).toBe("rgb(204, 230, 202)");
  });

  it("shows whoever makes a group the group notice right above Save, then the visibility note, with no extra step", async () => {
    const onSave = vi.fn();
    render(<GroupAppearanceForm initial={{ ...initial, name: "West" }} onSave={onSave} onCancel={vi.fn()} />);
    const notice = screen.getByTestId("sharing-notice");
    expect(noticeWords(notice)).toBe(GROUP_SHARING_NOTICE);
    const row = notice.nextElementSibling as HTMLElement;
    expect(within(row).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Save group" })).toBeInTheDocument();
    const note = screen.getByText(GROUP_VISIBILITY_NOTE);
    expect(note).toHaveTextContent("Your name, avatar and daily results are visible to the group.");
    expect(note.className).toContain("text-sm");
    expect(row.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save group" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  describe("while a picture is being prepared", () => {
    const photo = "data:image/jpeg;base64,AAAA";
    const later = "data:image/jpeg;base64,BBBB";

    /** A prepare that finishes only when the test says so. */
    function holdPrepare() {
      let resolve: (photo: string) => void = () => undefined;
      let reject: (error: Error) => void = () => undefined;
      const held = new Promise<string>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      vi.mocked(prepareGroupPhoto).mockReturnValueOnce(held);
      return {
        finish: (value: string) => act(async () => resolve(value)),
        fail: (error: Error) => act(async () => reject(error)),
      };
    }

    const upload = () => {
      const file = new File(["picture"], "picture.jpg", { type: "image/jpeg" });
      fireEvent.change(screen.getByTestId("group-photo-input"), { target: { files: [file] } });
    };
    const saveButton = () => screen.getByRole("button", { name: "Save group" });
    const preparingButton = () => screen.getByRole("button", { name: "Preparing picture…" });
    const named = { ...initial, name: "West" };

    it("won't save, by button or by submitting the form, and saves the picture once it is ready", async () => {
      const onSave = vi.fn();
      const prepare = holdPrepare();
      render(<GroupAppearanceForm initial={named} onSave={onSave} />);
      upload();

      expect(preparingButton()).toBeDisabled();
      expect(screen.getByRole("button", { name: "Upload a picture" })).toBeDisabled();
      fireEvent.click(preparingButton());
      fireEvent.submit(screen.getByTestId("group-form"));
      expect(onSave).not.toHaveBeenCalled();

      await prepare.finish(photo);
      expect(saveButton()).toBeEnabled();
      expect(screen.getByRole("button", { name: "Change picture" })).toBeEnabled();
      fireEvent.click(saveButton());
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ photo }));
    });

    it("keeps Cancel available", () => {
      const onCancel = vi.fn();
      holdPrepare();
      render(<GroupAppearanceForm initial={named} onSave={vi.fn()} onCancel={onCancel} />);
      upload();
      expect(preparingButton()).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("shows the problem when it fails, and Save works again", async () => {
      const onSave = vi.fn();
      const prepare = holdPrepare();
      render(<GroupAppearanceForm initial={named} onSave={onSave} />);
      upload();
      expect(preparingButton()).toBeDisabled();

      await prepare.fail(new Error("That picture couldn't be opened."));
      expect(screen.getByRole("alert")).toHaveTextContent("That picture couldn't be opened.");
      expect(saveButton()).toBeEnabled();
      expect(screen.getByRole("button", { name: "Upload a picture" })).toBeEnabled();
      fireEvent.click(saveButton());
      await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ photo: null })));
    });

    it.each([
      ["another emblem", "Book club", "book"],
      ["the emblem already chosen", "Game night", "cards-dice"],
    ])("keeps %s picked meanwhile, whenever the old prepare ends", async (_label, radio, emblemId) => {
      const onSave = vi.fn();
      const prepare = holdPrepare();
      render(<GroupAppearanceForm initial={named} onSave={onSave} />);
      upload();

      fireEvent.click(screen.getByRole("radio", { name: radio }));
      expect(saveButton()).toBeEnabled();

      await prepare.finish(photo);
      expect(screen.getByRole("radio", { name: radio })).toBeChecked();
      fireEvent.click(saveButton());
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ emblemId, photo: null }));
    });

    it("leaves behind a picture being replaced when Use an emblem instead is pressed", async () => {
      const onSave = vi.fn();
      const prepare = holdPrepare();
      render(<GroupAppearanceForm initial={{ ...named, photo }} onSave={onSave} />);
      upload();

      fireEvent.click(screen.getByRole("button", { name: "Use an emblem instead" }));
      await prepare.finish(later);
      fireEvent.click(saveButton());
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ photo: null }));
    });

    it("lets a newer upload win, whichever prepare ends first", async () => {
      const onSave = vi.fn();
      const older = holdPrepare();
      const newer = holdPrepare();
      render(<GroupAppearanceForm initial={named} onSave={onSave} />);
      upload();
      upload();

      await older.finish(photo);
      expect(preparingButton()).toBeDisabled();

      await newer.finish(later);
      fireEvent.click(saveButton());
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ photo: later }));
    });

    it("ignores an older upload that fails or ends after a newer one", async () => {
      const onSave = vi.fn();
      const first = holdPrepare();
      const second = holdPrepare();
      const latest = holdPrepare();
      render(<GroupAppearanceForm initial={named} onSave={onSave} />);
      upload();
      upload();
      upload();

      await second.fail(new Error("Overtaken, so never shown."));
      expect(screen.queryByRole("alert")).toBeNull();
      expect(preparingButton()).toBeDisabled();
      await latest.finish(later);
      await first.finish(photo);
      fireEvent.click(saveButton());
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ photo: later }));
    });
  });
});

describe("the Settings menu", () => {
  const modal = (props = {}) => (
    <MemoryRouter>
      <SettingsModal open onClose={vi.fn()} settings={loadSettings()} onSettingsChange={vi.fn()} showMenuLinks {...props} />
    </MemoryRouter>
  );

  it("is unchanged unless a page offers the new entries", () => {
    render(modal());
    expect(screen.queryByRole("button", { name: "All games" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Friends & Groups" })).toBeNull();
  });

  it("offers the game picker and Friends & Groups when asked to", () => {
    const onOpenGames = vi.fn();
    const onOpenSocial = vi.fn();
    render(modal({ onOpenGames, onOpenSocial }));
    fireEvent.click(screen.getByRole("button", { name: "All games" }));
    fireEvent.click(screen.getByRole("button", { name: "Friends & Groups" }));
    expect(onOpenGames).toHaveBeenCalledTimes(1);
    expect(onOpenSocial).toHaveBeenCalledTimes(1);
  });
});

describe("the account menu", () => {
  const user = { id: "someone", email: "alex@example.test" } as AuthUser;

  it("is unchanged unless a page offers profile editing", () => {
    render(<PlayerAuth user={user} onSignOut={vi.fn()} forceOpen />);
    const menu = screen.getByTestId("account-menu");
    expect(within(menu).getAllByRole("button").map((button) => button.textContent)).toEqual(["Sign Out", "Delete account…"]);
  });

  it("adds Edit profile when it is offered, and closes as it opens the editor", () => {
    const onEditProfile = vi.fn();
    render(<PlayerAuth user={user} onSignOut={vi.fn()} forceOpen onEditProfile={onEditProfile} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
    expect(onEditProfile).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("account-menu")).toBeNull();
  });
});
