import { profileIsComplete, type SharedProfile } from "./sharedProfile";

/**
 * What a player sees next once they arrive with or without an account, a
 * profile and a group invitation. One pure decision, so the order of the steps
 * lives in one place and can be tested without a server.
 *
 *   guest with an invitation   the invitation, before any sign-in
 *   guest                      nothing: every game stays open to them
 *   no finished profile        setup, with Later, but only when it interrupts
 *                              nothing (see below); an invitation waits
 *   an invitation is waiting   an explicit Join, never an automatic one
 *   just finished setup, or
 *   answered an invitation     the game picker
 *   anything else              back where they were, which is today's sign-in
 *
 * Setup is an offer, not a wall. A new account sees it on arrival and an
 * existing account sees it away from a puzzle in play, and either can choose
 * Later. Only Friends and Groups need a Display Name, and that is checked where
 * they are used (hasDisplayName), never here: no game depends on a profile.
 *
 * A profile that could not be fetched is not a blocked player. It follows the
 * rule in components/OnboardingGate.tsx: a failure in a background service
 * never takes away a puzzle that works. They carry on, and any invitation
 * stays waiting for a visit where it can be answered.
 */
export type AccountStep =
  | "guest"
  | "invite-preview"
  | "profile-setup"
  | "invite-join"
  | "picker"
  | "return";

/** `profile` is "unavailable" when the server could not be asked. */
export interface AccountFlowState {
  signedIn: boolean;
  profile: SharedProfile | null | "unavailable";
  pendingInvite: string | null;
  /** A new player finished setup or chose Later, or an invitation was answered, on this visit. */
  showPicker: boolean;
  /** This sign-in created the account. */
  isNewAccount: boolean;
  /** They chose Later for setup. */
  setupLater: boolean;
  /** The page behind this is a puzzle, which setup must never interrupt. */
  onGameplayPage: boolean;
}

export function nextAccountStep(state: AccountFlowState): AccountStep {
  if (!state.signedIn) return state.pendingInvite ? "invite-preview" : "guest";
  if (state.profile === "unavailable") return "return";
  const offerSetup = !profileIsComplete(state.profile) && !state.setupLater;
  if (offerSetup && (state.pendingInvite || state.isNewAccount || !state.onGameplayPage)) return "profile-setup";
  if (state.pendingInvite) return "invite-join";
  return state.showPicker ? "picker" : "return";
}

/** Rainbow's wording for the contract's joinGroup refusals. Outcomes are stable words; wording is each game's own. */
export function joinProblem(outcome: string): string {
  switch (outcome) {
    case "group_full":
      return "This group is full.";
    case "too_many_groups":
      return "You've joined as many groups as you can.";
    case "slow_down":
      return "You've joined a lot of groups today. Please try again tomorrow.";
    case "invalid_code":
      return "This invitation isn't working. Ask for a fresh link.";
    case "removed":
      return "You were removed from this group, so you can't rejoin.";
    default:
      return "We couldn't join the group just now. Please try again.";
  }
}

const PENDING_INVITE_KEY = "rc-pending-invite";

/** The contract's invite code: exactly twelve of 0-9 and a-z. Anything else is not a code. */
export function cleanInviteCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toLowerCase();
  return /^[0-9a-z]{12}$/.test(code) ? code : null;
}

/**
 * Keeps the invitation through the trip to the sign-in page. In localStorage
 * rather than beside the return path in sessionStorage, because a sign-up can
 * finish in another tab, as CrossPuns found.
 */
export function rememberPendingInvite(code: string): void {
  const clean = cleanInviteCode(code);
  if (!clean) return;
  try {
    localStorage.setItem(PENDING_INVITE_KEY, clean);
  } catch {
    // storage blocked: the player can open the invitation link again
  }
}

/** Read it back. Always re-validated: storage is not trusted. */
export function pendingInviteCode(): string | null {
  try {
    return cleanInviteCode(localStorage.getItem(PENDING_INVITE_KEY));
  } catch {
    return null;
  }
}

export function clearPendingInvite(): void {
  try {
    localStorage.removeItem(PENDING_INVITE_KEY);
  } catch {
    // ignore
  }
}

const SETUP_LATER_KEY = "rc-profile-later:";

/** Later is remembered per account, so someone else on this browser still gets their own offer. */
export function rememberSetupLater(accountId: string): void {
  try {
    localStorage.setItem(SETUP_LATER_KEY + accountId, "1");
  } catch {
    // storage blocked: the offer simply comes back next visit
  }
}

export function setupLaterChosen(accountId: string): boolean {
  try {
    return localStorage.getItem(SETUP_LATER_KEY + accountId) === "1";
  } catch {
    return false;
  }
}

export function forgetSetupLater(accountId: string): void {
  try {
    localStorage.removeItem(SETUP_LATER_KEY + accountId);
  } catch {
    // ignore
  }
}
