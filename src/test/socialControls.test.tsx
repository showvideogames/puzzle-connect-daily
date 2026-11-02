/**
 * The Friends and Groups controls, through the real screens with a stand-in
 * client. Each checks the right operation is called, and that a refusal is shown
 * without claiming success. Flows against the in-memory hub are in the preview's
 * own tests.
 */
import { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FriendsTab } from "@/components/account/FriendsHome";
import { copyLink, linkAnswer, shareOrCopy, type SocialApi } from "@/components/social/socialApi";
import { SocialScreens } from "@/components/social/SocialScreens";
import { SHARING_NOTICE_VERSION } from "@/lib/sharingNotice";
import type { FriendRequestRow, FriendRow, GroupRow, MemberRow, Result } from "@/social/contract";

const GRID = "🟨🟨🟨🟨\n🟩🟩🟩🟩";
const CODE = "abc123abc123";
const LINK = `http://rainbow.test/join/${CODE}`;

const face = { animalId: "owl", backgroundColor: "#F8D0BD" };
const friend = (friendRef: string, name: string): FriendRow => ({ ...face, friendRef, name, since: "2026-10-30T18:00:00.000Z" });
const request = (requestRef: string, name: string): FriendRequestRow => ({ ...face, requestRef, name, sentAt: "2026-10-30T18:00:00.000Z" });
const member = (memberRef: string, name: string, isMe = false): MemberRow => ({ ...face, memberRef, name, isOwner: false, isMe, joinedAt: "2026-10-30T18:00:00.000Z" });
const group = (changes: Partial<GroupRow> = {}): GroupRow => ({
  groupId: "g1",
  name: "Book Nerds",
  emblemId: "book",
  accentColor: "#CCE6CA",
  photo: null,
  photoVersion: 0,
  memberCount: 2,
  isOwner: true,
  myName: "Alex",
  inviteCode: CODE,
  ...changes,
});

const refused = (outcome: string) => ({ ok: false, outcome }) as unknown as Result<never>;
const yes = (data: unknown = {}) => ({ ok: true, data });

type Answer = (args: never) => unknown;

function makeApi(answers: Record<string, Answer>) {
  const all: Record<string, Answer> = {
    getMe: () => yes({ displayName: "Alex", animalId: "fox", backgroundColor: "#DED1F2", friendCode: "AAA-222", friendCount: 0, groupCount: 0 }),
    listFriendRequests: () => yes({ incoming: [], outgoing: [] }),
    listFriends: () => yes([]),
    listResults: () => yes([]),
    listMyGroups: () => yes([]),
    ...answers,
  };
  const call = vi.fn(async (op: string, args: never) => (all[op] ? all[op](args) : refused("unavailable")));
  const share = vi.fn(async () => "done" as const);
  const api: SocialApi = {
    client: { call: call as never, forget: vi.fn() },
    puzzleId: () => "puzzle-1",
    today: () => new Date(2026, 9, 31),
    linkUrl: (code) => `http://rainbow.test/join/${code}`,
    share,
  };
  return { api, call, share };
}

function Screens({ api, start = "friends", onNote }: { api: SocialApi; start?: FriendsTab; onNote: (note: string) => void }) {
  const [tab, setTab] = useState<FriendsTab>(start);
  return (
    <SocialScreens
      api={api}
      signedIn
      code={null}
      tab={tab}
      onTab={setTab}
      onNote={onNote}
      onLeaveLink={vi.fn()}
      onSignIn={vi.fn()}
      onNameLater={vi.fn()}
      guest={<p>guest</p>}
      waiting={<p>waiting</p>}
    />
  );
}

function open(answers: Record<string, Answer>, start?: FriendsTab) {
  const made = makeApi(answers);
  const onNote = vi.fn();
  render(<Screens api={made.api} start={start} onNote={onNote} />);
  return { ...made, onNote };
}

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const opsCalled = (call: ReturnType<typeof makeApi>["call"]) => call.mock.calls.map(([op]) => op);

async function addFriend(answers: Record<string, Answer>) {
  const made = open(answers);
  fireEvent.click(await screen.findByRole("button", { name: "Add a friend" }));
  return made;
}

function find(code = "K7M-4PX") {
  fireEvent.change(screen.getByLabelText("Enter a friend code"), { target: { value: code } });
  click("Find friend");
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "share");
  Reflect.deleteProperty(navigator, "clipboard");
});

describe("Add a friend", () => {
  it.each([
    ["already_friends", "You're already friends."],
    ["request_pending", "There's already a friend request between you."],
    ["slow_down", "You've looked up a lot of friend codes today. Please try again tomorrow."],
  ])("gives %s its own sentence, not the catch-all", async (outcome, sentence) => {
    await addFriend({ findFriendByCode: () => refused(outcome) });
    find();
    expect(await screen.findByRole("alert")).toHaveTextContent(sentence);
    expect(screen.queryByText(/couldn't find anyone/)).toBeNull();
  });

  it("keeps the catch-all for an unknown code", async () => {
    await addFriend({ findFriendByCode: () => refused("not_found") });
    find();
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't find anyone with that code.");
  });

  it("sends the ref and the notice version from the step that showed the notice, and only then", async () => {
    const { call } = await addFriend({
      findFriendByCode: () => yes({ ...face, requestRef: "lookup-1", name: "Jordan" }),
      sendFriendRequest: () => yes(),
    });
    find();
    await screen.findByTestId("found-person");
    expect(opsCalled(call)).not.toContain("sendFriendRequest");
    click("Send request");
    expect(await screen.findByTestId("request-sent")).toBeInTheDocument();
    expect(call).toHaveBeenCalledWith("sendFriendRequest", { requestRef: "lookup-1", noticeVersion: SHARING_NOTICE_VERSION });
  });

  it("a refused send says why and never says Request sent", async () => {
    await addFriend({
      findFriendByCode: () => yes({ ...face, requestRef: "lookup-1", name: "Jordan" }),
      sendFriendRequest: () => refused("slow_down"),
    });
    find();
    await screen.findByTestId("found-person");
    click("Send request");
    expect(await screen.findByRole("alert")).toHaveTextContent("You've sent a lot of friend requests today.");
    expect(screen.queryByText("Request sent")).toBeNull();
  });

  it("a refused link says why and not Done", async () => {
    const { share } = await addFriend({ createFriendInvite: () => refused("slow_down") });
    click("Share invite link");
    expect(await screen.findByRole("alert")).toHaveTextContent("You've made a lot of friend links today.");
    expect(screen.queryByText("Done.")).toBeNull();
    expect(share).not.toHaveBeenCalled();
  });

  it("makes a friend link with the notice version, and shares that link", async () => {
    const { call, share } = await addFriend({ createFriendInvite: () => yes({ code: CODE, expiresAt: "2026-11-14T18:00:00.000Z" }) });
    click("Share invite link");
    expect(await screen.findByText("Done.")).toBeInTheDocument();
    expect(call).toHaveBeenCalledWith("createFriendInvite", { noticeVersion: SHARING_NOTICE_VERSION });
    expect(share).toHaveBeenCalledWith(LINK);
  });
});

describe("sent requests", () => {
  it("are listed, and Cancel calls cancelFriendRequest with that ref, then reloads the list", async () => {
    let outgoing = [request("sent-1", "Jordan")];
    const { call } = await addFriend({
      listFriendRequests: () => yes({ incoming: [], outgoing }),
      cancelFriendRequest: () => {
        outgoing = [];
        return yes();
      },
    });
    click("Cancel request to Jordan");
    await waitFor(() => expect(screen.queryByTestId("sent-requests")).toBeNull());
    expect(call).toHaveBeenCalledWith("cancelFriendRequest", { requestRef: "sent-1" });
  });

  it("show a refusal and stay", async () => {
    await addFriend({
      listFriendRequests: () => yes({ incoming: [], outgoing: [request("sent-1", "Jordan")] }),
      cancelFriendRequest: () => refused("not_found"),
    });
    click("Cancel request to Jordan");
    expect(await screen.findByRole("alert")).toHaveTextContent("That friend request is no longer waiting.");
    expect(screen.getByTestId("sent-request")).toHaveTextContent("Jordan");
  });
});

describe("a waiting request", () => {
  const waiting = (rows: FriendRequestRow[]) => ({ listFriendRequests: () => yes({ incoming: rows, outgoing: [] }) });

  it("Decline calls declineFriendRequest, with no notice version, and moves on", async () => {
    const { call } = open({ ...waiting([request("in-1", "Jordan")]), declineFriendRequest: () => yes() });
    await screen.findByRole("heading", { name: "Jordan wants to be friends" });
    click("Decline");
    await screen.findByTestId("friends-home");
    expect(call).toHaveBeenCalledWith("declineFriendRequest", { requestRef: "in-1" });
  });

  it("a refused decline stays on the card and says why", async () => {
    open({ ...waiting([request("in-1", "Jordan")]), declineFriendRequest: () => refused("not_found") });
    await screen.findByRole("heading", { name: "Jordan wants to be friends" });
    click("Decline");
    expect(await screen.findByRole("alert")).toHaveTextContent("That friend request is no longer waiting.");
    expect(screen.getByRole("heading", { name: "Jordan wants to be friends" })).toBeInTheDocument();
  });

  it("a refused accept shows on the card and never says you're friends", async () => {
    open({ ...waiting([request("in-1", "Jordan")]), acceptFriendRequest: () => refused("too_many_friends") });
    await screen.findByRole("heading", { name: "Jordan wants to be friends" });
    click("Accept");
    expect(await screen.findByRole("alert")).toHaveTextContent("One of you has as many friends as you can have.");
    expect(screen.queryByText(/are friends/)).toBeNull();
  });
});

describe("an opened friend", () => {
  const withJordan = { listFriends: () => yes([friend("friend-1", "Jordan")]) };

  it("can be opened with no result, and each action needs a second step", async () => {
    const { call } = open({ ...withJordan, removeFriend: () => yes() });
    fireEvent.click(await screen.findByRole("button", { name: /Jordan/ }));
    click("Remove friend");
    expect(opsCalled(call)).not.toContain("removeFriend");
    expect(screen.getByTestId("inline-confirm")).toHaveTextContent("Remove Jordan from your friends?");
    expect(screen.queryByRole("dialog")).toBeNull();
    click("Cancel");
    expect(screen.queryByTestId("inline-confirm")).toBeNull();
    expect(opsCalled(call)).not.toContain("removeFriend");
  });

  it("Remove calls removeFriend with the friendRef, then reloads", async () => {
    let friends = [friend("friend-1", "Jordan")];
    const { call } = open({
      listFriends: () => yes(friends),
      removeFriend: () => {
        friends = [];
        return yes();
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: /Jordan/ }));
    click("Remove friend");
    click("Remove");
    await waitFor(() => expect(screen.queryByText("Jordan")).toBeNull());
    expect(call).toHaveBeenCalledWith("removeFriend", { friendRef: "friend-1" });
  });

  it("Block calls block with the friendRef", async () => {
    const { call } = open({ ...withJordan, block: () => yes({ blockRef: "block-1" }) });
    fireEvent.click(await screen.findByRole("button", { name: /Jordan/ }));
    click(/^Block$/);
    expect(screen.getByTestId("inline-confirm")).toHaveTextContent("Block Jordan?");
    fireEvent.click(within(screen.getByTestId("inline-confirm")).getByRole("button", { name: "Block" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("block", { ref: "friend-1" }));
  });

  it("a refusal stays beside the action and the friend stays", async () => {
    open({ ...withJordan, removeFriend: () => refused("not_found") });
    fireEvent.click(await screen.findByRole("button", { name: /Jordan/ }));
    click("Remove friend");
    click("Remove");
    expect(await screen.findByRole("alert")).toHaveTextContent("That person isn't on your friends list any more.");
    expect(screen.getAllByText("Jordan").length).toBeGreaterThan(0);
  });

  it("offers nothing on your own row", async () => {
    open(withJordan);
    await screen.findByTestId("friends-home");
    expect(screen.queryByRole("button", { name: /^You/ })).toBeNull();
  });
});

describe("a group's page", () => {
  const members = () => yes([member("m1", "Alex", true), member("m2", "Jordan")]);
  const resultRow = (memberRef: string, changes: object) => ({ ...face, memberRef, isMe: false, name: "Jordan", summary: { solved: true, mistakes: 2 }, ...changes });

  async function openGroup(answers: Record<string, Answer>, row: GroupRow = group()) {
    const made = open({ listMyGroups: () => yes([row]), listMembers: members, ...answers }, "groups");
    fireEvent.click(await screen.findByRole("button", { name: /Book Nerds/ }));
    await screen.findByTestId("group-page");
    return made;
  }

  it("shows the group, its members, and asks for today's results for this group", async () => {
    const { call } = await openGroup({});
    await screen.findByText("Jordan");
    expect(screen.getByRole("heading", { level: 1, name: "Book Nerds" })).toBeInTheDocument();
    expect(screen.getByText("2 members")).toBeInTheDocument();
    expect(screen.getByTestId("group-page").querySelector("img")).toHaveAttribute("src", "/shared-assets/groups/book.webp");
    expect(call).toHaveBeenCalledWith("listResults", { gameId: "rainbow", puzzleId: "puzzle-1", groupId: "g1" });
    expect(call).toHaveBeenCalledWith("listMembers", { groupId: "g1" });
  });

  it("a locked result shows its summary, and holds no detail", async () => {
    await openGroup({ listResults: () => yes([resultRow("m2", { detailLocked: true })]) });
    fireEvent.click(await screen.findByRole("button", { name: /Jordan/ }));
    expect(screen.getByText("Solved · 2 mistakes")).toBeInTheDocument();
    expect(screen.getByTestId("result-locked")).toHaveTextContent("Finish today's puzzle to see their details.");
    expect(screen.queryByTestId("result-detail")).toBeNull();
  });

  it("a locked result stays locked even if the answer wrongly carries a grid", async () => {
    await openGroup({ listResults: () => yes([resultRow("m2", { detailLocked: true, detail: GRID })]) });
    fireEvent.click(await screen.findByRole("button", { name: /Jordan/ }));
    expect(screen.getByTestId("result-locked")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Guess 1/)).toBeNull();
  });

  it("an unlocked result opens to its grid", async () => {
    await openGroup({ listResults: () => yes([resultRow("m2", { detailLocked: false, detail: GRID })]) });
    fireEvent.click(await screen.findByRole("button", { name: /Jordan/ }));
    expect(screen.getByLabelText("Guess 1: All yellow")).toBeInTheDocument();
  });

  it("someone who hasn't played can't be opened", async () => {
    await openGroup({});
    await screen.findByText("Jordan");
    expect(screen.getAllByText("Not played yet")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Jordan/ })).toBeNull();
  });

  it("says why a group won't load", async () => {
    await openGroup({ listMembers: () => refused("not_a_member") });
    expect(await screen.findByRole("alert")).toHaveTextContent("You're not in this group any more.");
  });

  it("the owner's Share uses the real code", async () => {
    const { share } = await openGroup({});
    click("Share invite link");
    expect(await screen.findByText("Done.")).toBeInTheDocument();
    expect(share).toHaveBeenCalledWith(LINK);
  });

  it("the owner's Copy writes the real link", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await openGroup({});
    click("Copy link");
    expect(await screen.findByText("Done.")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(LINK);
  });

  it.each([
    ["an owner with a null code", group({ inviteCode: null })],
    ["a member, who never gets a code", group({ isOwner: false, inviteCode: null })],
    ["a member sent a code by mistake", group({ isOwner: false })],
  ])("has no Share or Copy for %s", async (_who, row) => {
    await openGroup({}, row);
    expect(screen.queryByRole("button", { name: "Share invite link" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();
  });

  it("Leave takes a second step, calls leaveGroup, and goes back with a note", async () => {
    const { call, onNote } = await openGroup({ leaveGroup: () => yes({ closed: false }) });
    click("Leave group");
    expect(opsCalled(call)).not.toContain("leaveGroup");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("inline-confirm")).toHaveTextContent("Leave Book Nerds?");
    click("Leave");
    await waitFor(() => expect(screen.queryByTestId("group-page")).toBeNull());
    expect(call).toHaveBeenCalledWith("leaveGroup", { groupId: "g1" });
    expect(onNote).toHaveBeenCalledWith("You left Book Nerds.");
  });

  it("a refused leave stays on the page and says why", async () => {
    const { onNote } = await openGroup({ leaveGroup: () => refused("unavailable") });
    click("Leave group");
    click("Leave");
    expect(await screen.findByRole("alert")).toHaveTextContent("Friends and Groups aren't available right now.");
    expect(screen.getByTestId("group-page")).toBeInTheDocument();
    expect(onNote).not.toHaveBeenCalledWith(expect.stringContaining("You left"));
  });

  it("Back returns to the list", async () => {
    await openGroup({});
    click("Back");
    expect(await screen.findByTestId("groups-tab")).toBeInTheDocument();
  });
});

describe("handing over a link", () => {
  const stubShare = (share: unknown) => Object.defineProperty(navigator, "share", { value: share, configurable: true });
  const stubClipboard = (writeText: unknown) => Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

  it("uses the share sheet where there is one", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    stubShare(share);
    expect(await shareOrCopy(LINK)).toBe("done");
    expect(share).toHaveBeenCalledWith({ url: LINK });
  });

  it("treats closing the sheet as nothing happening", async () => {
    stubShare(vi.fn().mockRejectedValue(Object.assign(new Error("closed"), { name: "AbortError" })));
    const writeText = vi.fn();
    stubClipboard(writeText);
    expect(await shareOrCopy(LINK)).toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("falls back to the clipboard with no sheet, or one that refuses", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    expect(await shareOrCopy(LINK)).toBe("done");
    stubShare(vi.fn().mockRejectedValue(new Error("no")));
    expect(await shareOrCopy(LINK)).toBe("done");
    expect(writeText).toHaveBeenCalledTimes(2);
  });

  it("says so when even the clipboard won't take it, and gives the link", async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error("no")));
    expect(await copyLink(LINK)).toBe("failed");
    expect(linkAnswer("failed", LINK)).toContain(LINK);
    expect(linkAnswer("cancelled", LINK)).toBe(false);
    expect(linkAnswer("done", LINK)).toBeUndefined();
  });
});

describe("Edit profile", () => {
  const editor = async (answers: Record<string, Answer> = {}) => {
    const made = open({ setProfile: () => yes(), ...answers });
    fireEvent.click(await screen.findByRole("button", { name: "Edit profile" }));
    return made;
  };

  it("opens the same editor from Friends and saves the name, avatar and color with setProfile", async () => {
    const { call, onNote } = await editor();

    fireEvent.change(screen.getByLabelText("Display Name"), { target: { value: "Alexa" } });
    fireEvent.click(screen.getByLabelText(/^owl$/i));
    fireEvent.click(screen.getAllByRole("radio").find((radio) => radio.getAttribute("value") === "#CCE6CA")!);
    click("Save changes");

    await waitFor(() => expect(call).toHaveBeenCalledWith("setProfile", { displayName: "Alexa", animalId: "owl", backgroundColor: "#CCE6CA" }));
    expect(await screen.findByTestId("friends-home")).toBeInTheDocument();
    expect(onNote).toHaveBeenCalledWith("Profile saved.");
  });

  it("keeps the editor and what was typed when the save is refused", async () => {
    const { onNote } = await editor({ setProfile: () => refused("bad_name") });

    fireEvent.change(screen.getByLabelText("Display Name"), { target: { value: "Alexa" } });
    click("Save changes");

    await waitFor(() => expect(onNote).toHaveBeenCalled());
    expect(screen.getByLabelText("Display Name")).toHaveValue("Alexa");
    expect(onNote).not.toHaveBeenCalledWith("Profile saved.");
  });

  it("Cancel goes back without saving", async () => {
    const { call } = await editor();

    click("Cancel");

    expect(await screen.findByTestId("friends-home")).toBeInTheDocument();
    expect(opsCalled(call)).not.toContain("setProfile");
  });

  it("opens straight into the editor when asked to, as Settings does", async () => {
    const made = makeApi({});
    render(
      <SocialScreens api={made.api} signedIn code={null} tab="friends" onTab={vi.fn()} onNote={vi.fn()} onLeaveLink={vi.fn()} onSignIn={vi.fn()} onNameLater={vi.fn()} guest={<p>guest</p>} waiting={<p>waiting</p>} startEditingProfile />,
    );
    expect(await screen.findByRole("button", { name: "Save changes" })).toBeInTheDocument();
    expect(screen.getByLabelText("Display Name")).toHaveValue("Alex");
  });
});

describe("Blocked", () => {
  const unblockOf = async (name: string) => {
    const row = (await screen.findAllByTestId("blocked-person")).find((item) => item.textContent?.includes(name))!;
    return row;
  };

  it("lists the people this person blocked, and Unblock asks first, then calls unblock with that ref and reloads", async () => {
    let blocks = [{ blockRef: "b1", name: "Sam" }];
    const { call } = open({
      listBlocks: () => yes(blocks),
      unblock: () => {
        blocks = [];
        return yes();
      },
    });

    const row = await unblockOf("Sam");
    fireEvent.click(within(row).getByRole("button", { name: "Unblock" }));
    expect(opsCalled(call)).not.toContain("unblock");
    expect(within(row).getByText(/Unblock Sam\?/)).toBeInTheDocument();
    fireEvent.click(within(row).getAllByRole("button", { name: "Unblock" })[0]);

    await waitFor(() => expect(call).toHaveBeenCalledWith("unblock", { blockRef: "b1" }));
    await waitFor(() => expect(screen.queryByTestId("blocked-person")).toBeNull());
  });

  it("Cancel leaves the person blocked", async () => {
    const { call } = open({ listBlocks: () => yes([{ blockRef: "b1", name: "Sam" }]), unblock: () => yes() });

    const row = await unblockOf("Sam");
    fireEvent.click(within(row).getByRole("button", { name: "Unblock" }));
    fireEvent.click(within(row).getByRole("button", { name: "Cancel" }));

    expect(opsCalled(call)).not.toContain("unblock");
    expect(within(row).getByRole("button", { name: "Unblock" })).toBeInTheDocument();
  });

  it("shows nothing when nobody is blocked", async () => {
    open({ listBlocks: () => yes([]) });
    await screen.findByTestId("friends-home");
    expect(screen.queryByRole("region", { name: "Blocked" })).toBeNull();
  });

  it("a refused unblock keeps the person and says why", async () => {
    open({ listBlocks: () => yes([{ blockRef: "b1", name: "Sam" }]), unblock: () => refused("unavailable") });

    const row = await unblockOf("Sam");
    fireEvent.click(within(row).getByRole("button", { name: "Unblock" }));
    fireEvent.click(within(row).getAllByRole("button", { name: "Unblock" })[0]);

    expect(await within(row).findByRole("alert")).not.toBeEmptyDOMElement();
  });

  it("shows someone just blocked without leaving the page", async () => {
    let blocks: { blockRef: string; name: string }[] = [];
    open({
      listFriends: () => yes(blocks.length ? [] : [friend("f1", "Sam")]),
      listBlocks: () => yes(blocks),
      block: () => {
        blocks = [{ blockRef: "b1", name: "Sam" }];
        return yes({ blockRef: "b1" });
      },
    });

    fireEvent.click(await screen.findByRole("button", { name: /^Sam/ }));
    click("Block");
    fireEvent.click(within(screen.getByTestId("inline-confirm")).getByRole("button", { name: "Block" }));

    expect(await unblockOf("Sam")).toBeInTheDocument();
  });
});
