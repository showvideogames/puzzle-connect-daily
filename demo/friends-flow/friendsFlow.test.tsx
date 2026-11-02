/**
 * The Friends and Groups preview, run for real: the real screens, adapter and
 * session source, with only the fake backend behind them. Run with:
 *   npx vitest run --config demo/friends-flow/vite.config.ts
 *
 * The real sign-in modules and the hub keep state for a whole page load, and a
 * vi.mock factory outlives vi.resetModules, so this file is one page load, in
 * order. Each test starts as a guest on a new day, and later tests lean on who
 * earlier ones made friends. Only canvas is stood in for, because jsdom has none.
 */
import * as supabaseJs from "@supabase/supabase-js";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";
import { joinProblem } from "@/lib/accountFlow";
import { AUTH_STORAGE_KEY } from "@/lib/platformSignIn";
import { SHARING_NOTICE_VERSION } from "@/lib/sharingNotice";
import type { Operations, Result } from "@/social/contract";
import { backend } from "./fakeBackend";
import { createClient, createClientCalls } from "./fakeSupabaseJs";
import { FriendsFlow } from "./FriendsFlow";
import { startPreview } from "./preview";
import type { Preview, Who } from "./preview";

const { photo, seen } = vi.hoisted(() => {
  // A minimal 256 by 256 JPEG, enough for the hub's own checks.
  const bytes = [0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 1, 0, 1, 0, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9];
  return {
    photo: `data:image/jpeg;base64,${btoa(String.fromCharCode(...bytes))}`,
    seen: { calls: 0, options: {} as object, actual: undefined as unknown, mode: "" },
  };
});

vi.mock("@/social/rainbowAdapter", async (importActual) => {
  const actual = await importActual<typeof import("@/social/rainbowAdapter")>();
  return {
    ...actual,
    createRainbowSocial(options: Parameters<typeof actual.createRainbowSocial>[0]) {
      Object.assign(seen, { calls: seen.calls + 1, options, actual: actual.createRainbowSocial, mode: actual.socialMode() });
      return actual.createRainbowSocial(options);
    },
  };
});

vi.mock("@/lib/groupPicture", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/groupPicture")>()),
  prepareGroupPhoto: async () => photo,
}));

const fetchSpy = vi.fn();
let preview: Preview;

function data<T>(answer: Result<T>): T {
  if (answer.ok === false) throw new Error(answer.outcome);
  return answer.data;
}

const openPage = () => render(<FriendsFlow preview={preview} />);

const choose = (who: Who) => fireEvent.change(screen.getByLabelText("Choose a person"), { target: { value: who } });

async function become(who: Who): Promise<void> {
  choose(who);
  await waitFor(() => expect(screen.queryByTestId("flow-waiting")).toBeNull());
}

function openLink(name: string): void {
  const select = screen.getByLabelText("Open a link");
  const option = within(select).getByRole("option", { name }) as HTMLOptionElement;
  fireEvent.change(select, { target: { value: option.value } });
}

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const note = () => screen.getByTestId("flow-note").textContent;
const rows = () => screen.getAllByTestId("result-row").map((row) => row.textContent ?? "");
const ownCode = () => within(screen.getByTestId("friends-home")).getByText(/^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/).textContent ?? "";

function findFriend(code: string): void {
  fireEvent.change(screen.getByLabelText("Enter a friend code"), { target: { value: code } });
  click("Find friend");
}

const openGroupsTab = () => fireEvent.mouseDown(screen.getByRole("tab", { name: "Groups" }), { button: 0 });

beforeAll(async () => {
  vi.stubGlobal("fetch", fetchSpy);
  preview = await startPreview();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(async () => {
  await backend.release();
  history.replaceState(null, "", "/");
  await preview.switchTo("guest");
  preview.nextDay();
});

describe("the real code", () => {
  it("ran the actual factory once, unmodified, in its default mode", async () => {
    const actual = await vi.importActual<typeof import("@/social/rainbowAdapter")>("@/social/rainbowAdapter");
    expect(seen.calls).toBe(1);
    expect(seen.actual).toBe(actual.createRainbowSocial);
    expect(seen.mode).toBe("mock");
    expect(seen.options).not.toHaveProperty("mode");
  });

  it("a switch runs the real account check, and the credential is the fake stored session's", async () => {
    const before = backend.accountChecks();
    await preview.switchTo("alex");
    expect(backend.accountChecks()).toBe(before + 1);
    const stored = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) ?? "{}") as { access_token: string };
    expect(preview.sessionState()).toMatchObject({ credential: stored.access_token });
    expect(data(await preview.client.call("getMe", {})).displayName).toBe("Alex");
  });

  it("a guest gets a real refusal, and has nothing to finish", async () => {
    expect(await preview.client.call("listFriends", {})).toEqual({ ok: false, outcome: "not_signed_in" });
    openPage();
    expect(await screen.findByTestId("flow-guest")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finish today's puzzle" })).toBeDisabled();
  });
});

describe("a friend by code", () => {
  it("goes find, confirm, send, and nobody is a friend until the other person accepts", async () => {
    openPage();
    await become("jordan");
    const jordansCode = ownCode();

    await become("alex");
    click("Add a friend");
    findFriend(jordansCode);
    const found = await screen.findByTestId("found-person");
    expect(found).toHaveTextContent("Jordan");
    expect(within(found).getByTestId("sharing-notice")).toBeInTheDocument();
    expect(data(await preview.client.call("listFriendRequests", {})).outgoing).toEqual([]);

    click("Send request");
    expect(await screen.findByTestId("request-sent")).toHaveTextContent("Jordan needs to accept before you're friends.");
    expect(data(await preview.client.call("listFriends", {}))).toEqual([]);
    click("Back to Friends");
    await screen.findByTestId("friends-home");
    expect(rows().join(" ")).not.toContain("Jordan");

    choose("jordan");
    const card = await screen.findByTestId("friend-invite");
    expect(card).toHaveTextContent("Alex wants to be friends");
    expect(within(card).getByTestId("sharing-notice")).toBeInTheDocument();
    click("Accept");
    expect(await screen.findByRole("heading", { name: "You and Alex are friends" })).toBeInTheDocument();
    click("Continue");
    await screen.findByTestId("friends-home");
    expect(rows().join(" ")).toContain("Alex");

    await become("alex");
    expect(rows().find((row) => row.includes("Jordan"))).toContain("Not played yet");
  });

  it("finding a friend again says so on the screen, in its own sentence", async () => {
    await preview.switchTo("jordan");
    const jordansCode = data(await preview.client.call("getMe", {})).friendCode;
    await preview.switchTo("guest");
    openPage();
    await become("alex");
    click("Add a friend");
    findFriend(jordansCode);
    expect(await screen.findByRole("alert")).toHaveTextContent("You're already friends.");
  });
});

describe("the person with no name", () => {
  async function requestFrom(who: Who, friendCode: string): Promise<void> {
    await preview.switchTo(who);
    const { requestRef } = data(await preview.client.call("findFriendByCode", { friendCode }));
    data(await preview.client.call("sendFriendRequest", { requestRef, noticeVersion: SHARING_NOTICE_VERSION }));
  }

  it("meets the Display Name gate, then sees requests one at a time, and Not now leaves one pending", async () => {
    await preview.switchTo("newcomer");
    const { friendCode } = data(await preview.client.call("getMe", {}));
    expect(await preview.client.call("createFriendInvite", { noticeVersion: SHARING_NOTICE_VERSION })).toEqual({ ok: false, outcome: "needs_display_name" });
    await requestFrom("alex", friendCode);
    await requestFrom("sam", friendCode);
    await preview.switchTo("guest");

    openPage();
    choose("newcomer");
    await screen.findByTestId("display-name-gate");
    click("Choose a Display Name");
    fireEvent.change(await screen.findByLabelText("Display Name"), { target: { value: "Riley" } });
    click("Continue");

    expect(await screen.findByTestId("friend-invite")).toHaveTextContent("Alex wants to be friends");
    expect(screen.getByRole("button", { name: "Decline" })).toBeInTheDocument();
    click("Not now");
    expect(await screen.findByRole("heading", { name: "Sam wants to be friends" })).toBeInTheDocument();
    click("Accept");
    await screen.findByRole("heading", { name: "You and Sam are friends" });
    click("Continue");
    await screen.findByTestId("friends-home");

    expect(data(await preview.client.call("listFriendRequests", {})).incoming.map((row) => row.name)).toEqual(["Alex"]);
    expect(data(await preview.client.call("listFriends", {})).map((row) => row.name)).toEqual(["Sam"]);
  });

  it("a refused send never says sent: the screen goes back a step and says why", async () => {
    await preview.switchTo("newcomer");
    const rileysCode = data(await preview.client.call("getMe", {})).friendCode;
    await preview.switchTo("jordan");
    const jordansCode = data(await preview.client.call("getMe", {})).friendCode;
    await preview.switchTo("guest");

    openPage();
    await become("jordan");
    click("Add a friend");
    findFriend(rileysCode);
    await screen.findByTestId("found-person");

    const { requestRef } = data(await backend.hubCall("newcomer", "findFriendByCode", { friendCode: jordansCode }));
    data(await backend.hubCall("newcomer", "sendFriendRequest", { requestRef, noticeVersion: SHARING_NOTICE_VERSION }));

    click("Send request");
    await screen.findByLabelText("Enter a friend code");
    expect(screen.queryByTestId("request-sent")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("There's already a friend request between you.");

    const [sent] = data(await backend.hubCall("newcomer", "listFriendRequests", {})).outgoing.filter((row) => row.name === "Jordan");
    data(await backend.hubCall("newcomer", "cancelFriendRequest", { requestRef: sent.requestRef }));
  });
});

describe("a friend link", () => {
  it("is a real invite in a preview URL, which a guest can open and a person can accept", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    openPage();
    await become("sam");
    click("Add a friend");
    click("Copy link");
    expect(await screen.findByText("Done.")).toBeInTheDocument();
    const url = new URL(writeText.mock.calls[0][0] as string);
    const code = url.searchParams.get("invite");
    expect(code).toMatch(/^[0-9a-z]{12}$/);
    expect(url.pathname).toBe("/");

    await become("guest");
    openLink("Friend link from Sam");
    expect(location.search).toBe(`?invite=${code}`);
    expect(await screen.findByTestId("friend-invite")).toHaveTextContent("Sam wants to be friends");
    click("Sign in to add Sam");
    expect(note()).toContain("Choose a person in the bar");

    choose("alex");
    fireEvent.click(await screen.findByRole("button", { name: "Add friend" }));
    await screen.findByRole("heading", { name: "You and Sam are friends" });
    click("Continue");
    await screen.findByTestId("friends-home");
    expect(location.search).toBe("");
    expect(rows().join(" ")).toContain("Sam");

    openLink("Friend link from Sam");
    expect(await screen.findByRole("heading", { name: "This invitation isn't working" })).toBeInTheDocument();
    expect(note()).toBe("This invitation has already been used. Ask for a fresh link.");
  });

  it("can't be accepted by the person who made it, and the hub is what refuses", async () => {
    openPage();
    await become("alex");
    click("Add a friend");
    click("Share invite link");
    await screen.findByText("Done.");
    click("Back");
    await screen.findByTestId("friends-home");

    openLink("Friend link from Alex");
    fireEvent.click(await screen.findByRole("button", { name: "Add friend" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That's your own link. Send it to a friend.");
    expect(screen.getByTestId("friend-invite")).toHaveTextContent("Alex wants to be friends");
  });
});

describe("groups", () => {
  const groupNamed = async (name: string) => data(await preview.client.call("listMyGroups", {})).find((group) => group.name === name);

  it("Make a group creates it, styles it with an emblem and a color, and lists it", async () => {
    openPage();
    await become("alex");
    openGroupsTab();
    fireEvent.click(await screen.findByRole("button", { name: "Make a group" }));
    fireEvent.change(screen.getByLabelText("Group name"), { target: { value: "Book Nerds" } });
    fireEvent.click(screen.getByRole("radio", { name: "Book club" }));
    fireEvent.click(screen.getByRole("radio", { name: "Mint" }));
    click("Save group");

    await waitFor(() => expect(screen.getAllByTestId("group-row").map((row) => row.textContent).join(" ")).toContain("Book Nerds1 member"));
    expect(await groupNamed("Book Nerds")).toMatchObject({ emblemId: "book", accentColor: "#CCE6CA", photo: null, memberCount: 1 });
    expect(within(screen.getByLabelText("Open a link")).getByRole("option", { name: "Group link: Book Nerds" })).toBeInTheDocument();
  });

  it("an upload goes through the hub's own picture checks", async () => {
    openPage();
    await become("alex");
    openGroupsTab();
    fireEvent.click(await screen.findByRole("button", { name: "Make a group" }));
    fireEvent.change(screen.getByLabelText("Group name"), { target: { value: "Picture Club" } });
    const file = new File(["picture"], "picture.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByTestId("group-photo-input"), { target: { files: [file] } });
    await screen.findByRole("button", { name: "Use an emblem instead" });
    click("Save group");

    await waitFor(async () => expect(await groupNamed("Picture Club")).toMatchObject({ photo, photoVersion: 1 }));
    await waitFor(() => expect(screen.getAllByTestId("group-row").some((row) => row.querySelector("img")?.getAttribute("src") === photo)).toBe(true));
  });

  it("a guest sees the real preview, signs in as a person and joins, and the group lists it", async () => {
    openPage();
    openLink("Friday Puzzlers");
    const card = await screen.findByTestId("group-invite");
    expect(card).toHaveTextContent("Friday Puzzlers");
    expect(screen.getByTestId("member-preview")).toHaveTextContent("Join Jordan and 1 friend.");
    expect(screen.getByTestId("member-preview").querySelectorAll("img")).toHaveLength(2);
    expect(card.textContent).not.toMatch(/@|token-|user_mock|auth-mock|mistake|Solved/);
    expect(screen.queryByRole("button", { name: "Join group" })).toBeNull();
    click("Sign in to join");
    expect(note()).toContain("Choose a person in the bar");

    choose("alex");
    fireEvent.click(await screen.findByRole("button", { name: "Join group" }));
    expect(await screen.findByText("You're in!")).toBeInTheDocument();
    click("Continue");

    await screen.findByTestId("groups-tab");
    expect(location.search).toBe("");
    expect(screen.getAllByTestId("group-row").map((row) => row.textContent).join(" ")).toContain("Friday Puzzlers3 members");

    openLink("Friday Puzzlers");
    expect(await screen.findByText("You're already a member")).toBeInTheDocument();
    expect(screen.queryByTestId("member-preview")).toBeNull();
  });

  it("removed, already-a-member and broken links are the hub's own answers", async () => {
    openPage();
    await become("alex");

    openLink("Book Club (Alex was removed)");
    expect(await screen.findByText(/You were removed from this group/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Join group" })).toBeNull();

    openLink("Coffee Crew (Alex is a member)");
    expect(await screen.findByText("You're already a member")).toBeInTheDocument();

    openLink("A broken link");
    expect(await screen.findByRole("heading", { name: "This invitation isn't working" })).toBeInTheDocument();
  });

  it("a join the hub refuses is worded through joinProblem, and the card stays", async () => {
    const { groupId, inviteCode } = data(await backend.hubCall("jordan", "createGroup", { name: "Replaced", myName: "Jordan", noticeVersion: SHARING_NOTICE_VERSION }));
    openPage();
    await become("sam");
    history.pushState(null, "", `/?invite=${inviteCode}`);
    fireEvent(window, new PopStateEvent("popstate"));
    const join = await screen.findByRole("button", { name: "Join group" });

    data(await backend.hubCall("jordan", "replaceInvite", { groupId }));
    fireEvent.click(join);

    expect(await screen.findByRole("alert")).toHaveTextContent(joinProblem("invalid_code"));
  });

  it("a join with no notice is refused by the hub itself, and joins nothing", async () => {
    const { inviteCode } = data(await backend.hubCall("jordan", "createGroup", { name: "No Notice", myName: "Jordan", noticeVersion: SHARING_NOTICE_VERSION }));
    await preview.switchTo("sam");
    const args = { code: inviteCode, myName: "Sam" } as Operations["joinGroup"]["args"];

    expect(await preview.client.call("joinGroup", args)).toEqual({ ok: false, outcome: "notice_required" });
    expect(await groupNamed("No Notice")).toBeUndefined();
  });

  it("making a group or a friend link with no notice is refused by the hub itself, and makes nothing", async () => {
    await preview.switchTo("sam");
    const before = data(await preview.client.call("listMyGroups", {})).length;
    const group = { name: "No Notice Mine", myName: "Sam" } as Operations["createGroup"]["args"];

    expect(await preview.client.call("createGroup", group)).toEqual({ ok: false, outcome: "notice_required" });
    expect(await preview.client.call("createFriendInvite", {} as Operations["createFriendInvite"]["args"])).toEqual({ ok: false, outcome: "notice_required" });
    expect(data(await preview.client.call("listMyGroups", {}))).toHaveLength(before);
  });

  it("the screens that make a group or a link show the notice, and send its version", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    openPage();
    await become("jordan");
    openGroupsTab();
    fireEvent.click(await screen.findByRole("button", { name: "Make a group" }));
    expect(within(screen.getByTestId("group-form")).getByTestId("sharing-notice")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Group name"), { target: { value: "Shown First" } });
    click("Save group");
    await waitFor(() => expect(screen.getAllByTestId("group-row").map((row) => row.textContent).join(" ")).toContain("Shown First"));

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Friends" }), { button: 0 });
    click("Add a friend");
    expect(within(screen.getByTestId("add-friend")).getByTestId("sharing-notice")).toBeInTheDocument();
    click("Copy link");
    expect(await screen.findByText("Done.")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledTimes(1);
  });
});

describe("results", () => {
  it("open as locked because the hub left detail out, and to the grid once the viewer finishes", async () => {
    await preview.switchTo("jordan");
    const { code } = data(await preview.client.call("createFriendInvite", { noticeVersion: SHARING_NOTICE_VERSION }));
    await preview.switchTo("sam");
    data(await preview.client.call("acceptFriendInvite", { code, noticeVersion: SHARING_NOTICE_VERSION }));
    await preview.switchTo("guest");
    const stored = backend.storedResultCount();

    openPage();
    await become("jordan");
    click("Finish today's puzzle");
    await waitFor(() => expect(backend.storedResultCount()).toBe(stored + 1));

    await become("sam");
    const row = await screen.findByRole("button", { name: /Jordan/ });
    expect(row).toHaveTextContent("Solved · 2 mistakes");
    fireEvent.click(row);
    expect(screen.getByTestId("result-locked")).toHaveTextContent("Finish today's puzzle to see their details.");

    const answer = data(await preview.client.call("listResults", { gameId: "rainbow", puzzleId: preview.puzzleId() }));
    const locked = answer.find((result) => result.name === "Jordan");
    expect(locked).toMatchObject({ detailLocked: true });
    expect(locked).not.toHaveProperty("detail");

    click("Finish today's puzzle");
    expect(await screen.findByLabelText(/^Guess 1: /)).toBeInTheDocument();
    expect(screen.getByText("Used a hint")).toBeInTheDocument();
    expect(screen.queryByTestId("result-locked")).toBeNull();
    expect(backend.storedResultCount()).toBe(stored + 2);

    // A replay is accepted and stores nothing: the first result stands.
    expect(await preview.finishToday()).toBeNull();
    expect(backend.storedResultCount()).toBe(stored + 2);

    click("Next day");
    await screen.findByTestId("friends-home");
    expect(note()).toContain(preview.puzzleId());
    for (const text of rows()) expect(text).toContain("Not played yet");
  });

  it("shares nothing finished before two people connected", async () => {
    await preview.switchTo("jordan");
    expect(await preview.finishToday()).toBeNull();
    const code = data(await preview.client.call("createFriendInvite", { noticeVersion: SHARING_NOTICE_VERSION })).code;
    await preview.switchTo("newcomer");
    data(await preview.client.call("acceptFriendInvite", { code, noticeVersion: SHARING_NOTICE_VERSION }));

    const answer = data(await preview.client.call("listResults", { gameId: "rainbow", puzzleId: preview.puzzleId() }));
    expect(answer.map((row) => row.name)).not.toContain("Jordan");
  });
});

describe("switching person", () => {
  it("clears everything on the change, with nothing awaited", async () => {
    openPage();
    await become("alex");
    const alexsCode = ownCode();
    click("Add a friend");
    fireEvent.change(screen.getByLabelText("Enter a friend code"), { target: { value: "ABC-234" } });

    choose("jordan");

    expect(screen.queryByTestId("add-friend")).toBeNull();
    expect(screen.queryByDisplayValue("ABC-234")).toBeNull();
    expect(screen.queryByText(alexsCode)).toBeNull();
    expect(screen.getByTestId("flow-waiting")).toBeInTheDocument();
    expect(note()).toBe("");

    await screen.findByTestId("friends-home");
    expect(ownCode()).not.toBe(alexsCode);
    expect(screen.queryByDisplayValue("ABC-234")).toBeNull();
  });

  it("a late answer for the last person never paints", async () => {
    openPage();
    await become("alex");
    const alexsCode = ownCode();
    await become("jordan");
    const jordansCode = ownCode();
    await become("sam");

    backend.holdHubAnswers(true);
    choose("alex");
    await waitFor(() => expect(backend.heldCount()).toBeGreaterThan(0));
    backend.holdHubAnswers(false);
    choose("jordan");
    await screen.findByTestId("friends-home");

    await act(() => backend.release());

    expect(ownCode()).toBe(jordansCode);
    expect(screen.queryByText(alexsCode)).toBeNull();
    expect(note()).toBe("");
  });

  it("the client itself drops that answer as stale", async () => {
    await preview.switchTo("alex");
    backend.holdHubAnswers(true);
    const late = preview.client.call("getMe", {});
    backend.holdHubAnswers(false);
    await preview.switchTo("jordan");
    await backend.release();
    expect(await late).toEqual({ ok: false, outcome: "stale_session" });
  });

  it("keeps an open link, and asks the hub again as the new person", async () => {
    openPage();
    openLink("Coffee Crew (Alex is a member)");
    expect(await screen.findByTestId("member-preview")).toHaveTextContent("Join Jordan and 1 friend.");

    choose("alex");
    expect(screen.queryByTestId("member-preview")).toBeNull();
    expect(await screen.findByText("You're already a member")).toBeInTheDocument();
  });
});

describe("isolation", () => {
  it("the real client is swapped for the fake, and no real one can exist", () => {
    expect(supabase).toBe(backend.client);
    expect(supabaseJs.createClient).toBe(createClient);
  });

  it("nothing reached the network and nothing asked for a real client, in this whole file", () => {
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(createClientCalls.count).toBe(0);
    expect(() => createClient()).toThrow(/synthetic/);
  });

  it("puts no hooks on window", () => {
    expect(Object.getOwnPropertyNames(window).filter((name) => /preview|backend|memoryhub|social|supabase|friendsflow/i.test(name))).toEqual([]);
  });
});
