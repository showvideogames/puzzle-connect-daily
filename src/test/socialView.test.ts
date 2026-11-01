import { describe, expect, it } from "vitest";
import {
  acceptProblem,
  findProblem,
  foundPerson,
  friendInvite,
  friendLinkProblem,
  friendRequest,
  friendResults,
  groupInvite,
  groupPictureProblem,
  groupSummary,
  isGroupPreview,
  makeGroupProblem,
  profileFromMe,
  sendProblem,
  socialProblem,
} from "@/lib/socialView";
import { joinProblem } from "@/lib/accountFlow";
import { SHARING_NOTICE_VERSION } from "@/lib/sharingNotice";
import { CURRENT_NOTICE_VERSION, OUTCOMES } from "@/social/contract";
import type { FriendInvitePreview, FriendRequestRow, FriendRow, GroupInvitePreview, GroupRow, Operations, ResultRow } from "@/social/contract";

const GRID = "🟨🟨🟨🟨\n🟩🟩🟩🟩";

const me: Operations["getMe"]["data"] = {
  displayName: "Alex",
  animalId: "fox",
  backgroundColor: "#DED1F2",
  friendCode: "R8T-6NZ",
  friendCount: 2,
  groupCount: 1,
};

const friend = (friendRef: string, name: string | null): FriendRow => ({
  friendRef,
  name,
  animalId: "owl",
  backgroundColor: "#F8D0BD",
  since: "2026-10-30T18:00:00.000Z",
});

/** A row as the hub would send it, plus whatever a test adds. */
const row = (friendRef: string | null, changes: object = {}): ResultRow =>
  ({
    friendRef,
    isMe: friendRef === null,
    name: "Jordan",
    animalId: "owl",
    backgroundColor: "#F8D0BD",
    summary: { solved: true, mistakes: 2 },
    detail: GRID,
    detailLocked: false,
    ...changes,
  }) as ResultRow;

/** As the hub sends a locked row: the detail key isn't there at all. */
function lockedRow(friendRef: string): ResultRow {
  const { detail: _left, ...locked } = row(friendRef, { detailLocked: true });
  return locked as ResultRow;
}

const resultOf = (rows: ResultRow[], friends = [friend("f1", "Jordan")]) => friendResults({ me, friends, rows });

describe("friendResults", () => {
  it("puts the viewer first, as not played until they have a result", () => {
    const [you] = resultOf([]);
    expect(you).toMatchObject({ id: "you", isYou: true, name: "Alex", status: "not-played", mistakes: 0, detail: null, gameId: "rainbow" });
  });

  it("joins friends to results by ref, and a friend with no result is not played, with nothing invented", () => {
    const friends = [friend("f1", "Jordan"), friend("f2", "Sam")];
    const [, jordan, sam] = friendResults({ me, friends, rows: [row("f1")] });
    expect(jordan).toMatchObject({ id: "f1", name: "Jordan", status: "solved", mistakes: 2, detail: GRID, isYou: false });
    expect(sam).toEqual({ id: "f2", name: "Sam", isYou: false, animalId: "owl", backgroundColor: "#F8D0BD", gameId: "rainbow", status: "not-played", mistakes: 0, detail: null });
  });

  it("reads Rainbow's summary, solved or not", () => {
    const [, jordan] = resultOf([row("f1", { summary: { solved: false, mistakes: 4 } })]);
    expect(jordan).toMatchObject({ status: "not-solved", mistakes: 4 });
  });

  it("shows the viewer's own result, which carries its own detail", () => {
    const [you] = resultOf([row(null, { summary: { solved: true, mistakes: 1 } })]);
    expect(you).toMatchObject({ isYou: true, status: "solved", mistakes: 1, detail: GRID });
  });

  it("leaves out a row with no friend behind it, because that sharing has ended", () => {
    const shown = resultOf([row("someone-else")]);
    expect(shown.map((result) => result.id)).toEqual(["you", "f1"]);
    expect(shown[1].status).toBe("not-played");
  });

  it("does not take a group row for a friend's", () => {
    const groupRow = { memberRef: "f1", isMe: false, name: "Jordan", animalId: "owl", backgroundColor: "#F8D0BD", summary: { solved: true, mistakes: 0 }, detail: GRID, detailLocked: false } as ResultRow;
    expect(resultOf([groupRow])[1].status).toBe("not-played");
  });

  it("treats a summary of the wrong shape as no result, never as a number on screen", () => {
    for (const summary of [{ seconds: 95 }, { solved: "yes", mistakes: 1 }, { solved: true, mistakes: -1 }, { solved: true }, null]) {
      expect(resultOf([row("f1", { summary })])[1]).toMatchObject({ status: "not-played", mistakes: 0, detail: null });
    }
  });

  it("gives a friend without a name Rainbow's own wording", () => {
    expect(resultOf([], [friend("f1", null)])[1].name).toBe("A Rainbow player");
  });
});

describe("a locked result", () => {
  it("still shows its summary, with a null detail", () => {
    expect(resultOf([lockedRow("f1")])[1]).toMatchObject({ status: "solved", mistakes: 2, detail: null });
  });

  it("can't carry detail, even from a row that breaks the contract by sending some", () => {
    for (const detail of [GRID, "", [true, false], 0]) {
      expect(resultOf([row("f1", { detailLocked: true, detail })])[1].detail).toBeNull();
    }
  });

  it("opens only for an explicit false, so a missing or odd flag stays closed", () => {
    for (const detailLocked of [undefined, null, "false", 0, 1]) {
      expect(resultOf([row("f1", { detailLocked })])[1].detail).toBeNull();
    }
    expect(resultOf([row("f1", { detailLocked: false })])[1].detail).toBe(GRID);
  });

  it("applies to the viewer's own row too", () => {
    expect(resultOf([row(null, { detailLocked: true })])[0].detail).toBeNull();
  });

  it("maps an unlocked result with no detail to null", () => {
    expect(resultOf([row("f1", { detail: null })])[1].detail).toBeNull();
  });
});

describe("profileFromMe", () => {
  it("keeps only what a profile holds", () => {
    expect(profileFromMe(me)).toEqual({ version: 1, displayName: "Alex", animalId: "fox", backgroundColor: "#DED1F2" });
  });

  it("has no displayName key until one is chosen, so the Display Name gate shows", () => {
    expect(profileFromMe({ ...me, displayName: null })).toEqual({ version: 1, animalId: "fox", backgroundColor: "#DED1F2" });
  });
});

describe("what a screen can be handed", () => {
  const HOSTILE = { email: "a@example.test", globalUserId: "user_1", results: [GRID], detail: GRID, summary: { solved: true, mistakes: 0 }, friendCode: "ABC-234", groupId: "g1", inviteCode: "abc123abc123", requestRef: "r1", myName: "Al" };

  const groupRow: GroupRow = { groupId: "g1", name: "Book Nerds", emblemId: "book", accentColor: "#CCE6CA", photo: null, photoVersion: 0, memberCount: 3, isOwner: true, myName: "Al", inviteCode: "abc123abc123" };

  const groupPreview: GroupInvitePreview = {
    name: "Friday Puzzlers",
    emblemId: "campfire",
    accentColor: "#DED1F2",
    photo: null,
    isMember: false,
    isRemoved: false,
    memberPreview: { faces: [{ animalId: "owl", backgroundColor: "#F8D0BD" }], leadName: "Jordan", memberCount: 2 },
  };

  it("a group row keeps no id, no code and no name in the group", () => {
    expect(groupSummary({ ...groupRow, ...HOSTILE })).toEqual({ name: "Book Nerds", emblemId: "book", photo: null, accentColor: "#CCE6CA", memberCount: 3 });
  });

  it("a group preview maps only the fields the card takes, and each face only a face", () => {
    const hostile = { ...groupPreview, ...HOSTILE, memberPreview: { ...groupPreview.memberPreview, ...HOSTILE, faces: [{ ...groupPreview.memberPreview?.faces[0], ...HOSTILE }] } };
    const mapped = groupInvite(hostile);
    expect(Object.keys(mapped).sort()).toEqual(["accentColor", "emblemId", "isMember", "isRemoved", "memberPreview", "name", "photo"]);
    expect(mapped.memberPreview).toEqual({ faces: [{ animalId: "owl", backgroundColor: "#F8D0BD" }], leadName: "Jordan", memberCount: 2 });
    expect(JSON.stringify(mapped)).not.toMatch(/example\.test|user_1|abc123|ABC-234/);
  });

  it("a member or a removed person has an empty member preview, which the card never draws", () => {
    expect(groupInvite({ ...groupPreview, isMember: true, memberPreview: null }).memberPreview).toEqual({ faces: [], leadName: "", memberCount: 0 });
  });

  it("a friend preview, a request and a found person keep a name and a face", () => {
    const face = { animalId: "owl", backgroundColor: "#F8D0BD" };
    const preview: FriendInvitePreview = { ...face, inviterName: "Jordan" };
    const request: FriendRequestRow = { ...face, requestRef: "r1", name: "Jordan", sentAt: "2026-10-30T18:00:00.000Z" };
    const card = { inviterName: "Jordan", inviter: face };
    expect(friendInvite({ ...preview, ...HOSTILE })).toEqual(card);
    expect(friendRequest({ ...request, ...HOSTILE })).toEqual(card);
    expect(foundPerson({ ...face, requestRef: "r1", name: "Jordan", ...HOSTILE })).toEqual({ displayName: "Jordan", ...face });
  });

  it("gives a person without a name Rainbow's own wording", () => {
    const face = { animalId: "owl", backgroundColor: "#F8D0BD" };
    expect(friendInvite({ ...face, inviterName: null }).inviterName).toBe("A Rainbow player");
    expect(foundPerson({ ...face, requestRef: "r1", name: null }).displayName).toBe("A Rainbow player");
  });

  it("falls back to the setup default for an avatar or color this game can't draw", () => {
    expect(friendInvite({ animalId: "dragon", backgroundColor: "#000000", inviterName: "Jordan" }).inviter).toEqual({ animalId: "fox", backgroundColor: "#DED1F2" });
    expect(groupSummary({ ...groupRow, emblemId: "castle" }).emblemId).toBe("campfire");
  });

  it("tells the two previews apart by isMember", () => {
    expect(isGroupPreview(groupPreview)).toBe(true);
    expect(isGroupPreview({ animalId: "owl", backgroundColor: "#F8D0BD", inviterName: "Jordan" })).toBe(false);
  });
});

describe("the wording", () => {
  const wordings = { socialProblem, findProblem, sendProblem, acceptProblem, friendLinkProblem, makeGroupProblem, groupPictureProblem };

  it.each(Object.entries(wordings))("%s has a sentence for every outcome, and never shows the outcome itself", (_name, wording) => {
    for (const outcome of OUTCOMES) {
      expect(wording(outcome)).toMatch(/^[A-Z].*[.]$/);
      expect(wording(outcome)).not.toContain(outcome);
    }
  });

  it("gives each daily limit its own sentence, saying what the limit was on", () => {
    expect(findProblem("slow_down")).toContain("looked up a lot of friend codes");
    expect(sendProblem("slow_down")).toContain("sent a lot of friend requests");
    expect(friendLinkProblem("slow_down")).toContain("made a lot of friend links");
    expect(makeGroupProblem("slow_down")).toContain("made a lot of groups");
    expect(joinProblem("slow_down")).toContain("joined a lot of groups");
  });

  it("words what a find, a send and an accept can each be told", () => {
    expect(findProblem("already_friends")).toBe("You're already friends.");
    expect(findProblem("request_pending")).toBe("There's already a friend request between you.");
    expect(sendProblem("not_found")).toBe("That request has run out of time. Find your friend again.");
    expect(acceptProblem("own_invite")).toBe("That's your own link. Send it to a friend.");
    expect(acceptProblem("invite_used")).toBe("This invitation has already been used. Ask for a fresh link.");
    expect(acceptProblem("needs_display_name")).toBe("Choose a Display Name first.");
  });

  it("says a group exists whenever only its picture failed", () => {
    for (const outcome of OUTCOMES) expect(groupPictureProblem(outcome)).toContain("Your group was made");
  });
});

describe("the notice version", () => {
  it("is the one the hub asks for, so a screen that shows the notice can say so", () => {
    expect(SHARING_NOTICE_VERSION).toBe(CURRENT_NOTICE_VERSION);
  });
});
