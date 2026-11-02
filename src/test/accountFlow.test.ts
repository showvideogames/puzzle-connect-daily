import { beforeEach, describe, expect, it } from "vitest";
import {
  cleanInviteCode,
  clearPendingInvite,
  forgetSetupLater,
  joinProblem,
  nextAccountStep,
  pendingInviteCode,
  rememberPendingInvite,
  rememberSetupLater,
  setupLaterChosen,
  type AccountFlowState,
} from "@/lib/accountFlow";
import type { SharedProfile } from "@/lib/sharedProfile";

const finished: SharedProfile = { version: 1, displayName: "Alex", animalId: "fox", backgroundColor: "#DED1F2" };
const code = "fridaypuzzl3";

const state = (changes: Partial<AccountFlowState>): AccountFlowState => ({
  signedIn: true,
  profile: finished,
  pendingInvite: null,
  showPicker: false,
  isNewAccount: false,
  setupLater: false,
  onGameplayPage: false,
  ...changes,
});

describe("nextAccountStep", () => {
  it("leaves a guest alone, and shows an invitation before any sign-in", () => {
    expect(nextAccountStep(state({ signedIn: false, profile: null }))).toBe("guest");
    expect(nextAccountStep(state({ signedIn: false, profile: null, pendingInvite: code }))).toBe("invite-preview");
  });

  it("offers a new account setup on arrival, even from a puzzle page", () => {
    expect(nextAccountStep(state({ profile: null, isNewAccount: true }))).toBe("profile-setup");
    expect(nextAccountStep(state({ profile: null, isNewAccount: true, onGameplayPage: true }))).toBe("profile-setup");
    expect(nextAccountStep(state({ profile: { ...finished, displayName: undefined }, isNewAccount: true }))).toBe("profile-setup");
  });

  it("offers an existing account setup only away from a puzzle", () => {
    expect(nextAccountStep(state({ profile: null }))).toBe("profile-setup");
    expect(nextAccountStep(state({ profile: null, onGameplayPage: true }))).toBe("return");
  });

  it("goes back to the previous page when an existing player chooses Later", () => {
    expect(nextAccountStep(state({ profile: null, setupLater: true }))).toBe("return");
  });

  it("lets a new player reach the games without finishing setup", () => {
    expect(nextAccountStep(state({ profile: null, isNewAccount: true, setupLater: true, showPicker: true }))).toBe("picker");
  });

  it("never gates a game on a profile: no step blocks a player who chose Later", () => {
    for (const isNewAccount of [true, false]) {
      for (const onGameplayPage of [true, false]) {
        const step = nextAccountStep(state({ profile: null, setupLater: true, isNewAccount, onGameplayPage }));
        expect(step).toBe("return");
      }
    }
  });

  it("does not repeat setup for a finished profile, and sends them back where they were", () => {
    expect(nextAccountStep(state({}))).toBe("return");
    expect(nextAccountStep(state({ isNewAccount: true }))).toBe("return");
  });

  it("goes to the picker after a new player's setup", () => {
    expect(nextAccountStep(state({ isNewAccount: true, showPicker: true }))).toBe("picker");
  });

  it("holds an invitation through setup, then asks before the picker", () => {
    expect(nextAccountStep(state({ profile: null, isNewAccount: true, pendingInvite: code }))).toBe("profile-setup");
    expect(nextAccountStep(state({ isNewAccount: true, pendingInvite: code, showPicker: true }))).toBe("invite-join");
  });

  it("offers setup first for an invitation, even to an existing player who came from a puzzle", () => {
    expect(nextAccountStep(state({ profile: null, pendingInvite: code, onGameplayPage: true }))).toBe("profile-setup");
  });

  it("still reaches the Join step after Later, where the Display Name is asked for", () => {
    expect(nextAccountStep(state({ profile: null, pendingInvite: code, setupLater: true }))).toBe("invite-join");
  });

  it("asks a returning player with an invitation without setup", () => {
    expect(nextAccountStep(state({ pendingInvite: code }))).toBe("invite-join");
  });

  it("never blocks a player because the profile could not be fetched", () => {
    expect(nextAccountStep(state({ profile: "unavailable" }))).toBe("return");
    expect(nextAccountStep(state({ profile: "unavailable", pendingInvite: code }))).toBe("return");
    expect(nextAccountStep(state({ profile: "unavailable", isNewAccount: true }))).toBe("return");
  });
});

describe("Later", () => {
  beforeEach(() => {
    forgetSetupLater("player-a");
    forgetSetupLater("player-b");
  });

  it("is remembered for that account only", () => {
    rememberSetupLater("player-a");
    expect(setupLaterChosen("player-a")).toBe(true);
    expect(setupLaterChosen("player-b")).toBe(false);
    forgetSetupLater("player-a");
    expect(setupLaterChosen("player-a")).toBe(false);
  });
});

describe("the pending invitation", () => {
  beforeEach(() => clearPendingInvite());

  it("survives until it is cleared", () => {
    rememberPendingInvite(code);
    expect(pendingInviteCode()).toBe(code);
    expect(pendingInviteCode()).toBe(code);
    clearPendingInvite();
    expect(pendingInviteCode()).toBeNull();
  });

  it("accepts only the contract's twelve lowercase letters and digits", () => {
    expect(cleanInviteCode(" FRIDAYPUZZL3 ")).toBe(code);
    expect(cleanInviteCode("short")).toBeNull();
    expect(cleanInviteCode("fridaypuzzl34")).toBeNull();
    expect(cleanInviteCode("friday-puzzl")).toBeNull();
    expect(cleanInviteCode(null)).toBeNull();
  });

  it("does not trust what is in storage", () => {
    localStorage.setItem("rc-pending-invite", "<script>alert(1)</script>");
    expect(pendingInviteCode()).toBeNull();
  });

  it("refuses to store something that is not a code", () => {
    rememberPendingInvite("not a code");
    expect(pendingInviteCode()).toBeNull();
  });
});

describe("joinProblem", () => {
  it("has wording for the contract's refusals and a fallback for anything else", () => {
    expect(joinProblem("group_full")).toBe("This group is full.");
    expect(joinProblem("something_new")).toBe("We couldn't join the group just now. Please try again.");
  });
});
