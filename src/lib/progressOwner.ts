/**
 * Whose browser progress is on screen.
 *
 * Progress saved in this browser used to live under one key per puzzle, no
 * matter who was playing. Two people sharing a browser therefore shared
 * boards: the second person to open a puzzle saw — and overwrote — the
 * first person's game, and signing out removed nothing.
 *
 * Every save now lives under its owner's own key:
 *
 *   signed in   acct:<user id>/<storage id>
 *   guest       guest:<device id>/<storage id>
 *
 * A guest is keyed by this browser's device identity rather than one shared
 * "guest" slot because that identity is what the server already treats as
 * the guest: it is replaced on sign-out (so the next guest is genuinely a
 * different player) and after the one-time import decision.
 *
 * Saves written before this existed (keyed by the storage id alone) are left
 * exactly where they are and never read by the app: nothing says whose they
 * are, so they are neither attributed to whoever is signed in now nor shown
 * to anyone else.
 *
 * The owner is decided once per identity by OnboardingGate, which already
 * resolves who is playing before any page renders, and handed down through
 * ProgressOwnerContext. Outside that gate (unit tests rendering a board on
 * its own) there is no owner and the unscoped keys are used.
 */
import { createContext, useContext } from "react";
import { progressKey, promptAnswerKey } from "./gameProgress";

export type ProgressOwner =
  | { kind: "account"; userId: string }
  | { kind: "guest"; deviceId: string };

/** The key prefix for one owner's saves; "" when there is no owner. */
export function ownerScope(owner: ProgressOwner | null): string {
  if (!owner) return "";
  return owner.kind === "account" ? `acct:${owner.userId}/` : `guest:${owner.deviceId}/`;
}

/** A stable identity string, for keying React trees and requests by owner. */
export function ownerKey(owner: ProgressOwner | null): string {
  return ownerScope(owner) || "none";
}

export function sameOwner(a: ProgressOwner | null, b: ProgressOwner | null): boolean {
  return ownerKey(a) === ownerKey(b);
}

export const ProgressOwnerContext = createContext<ProgressOwner | null>(null);

/** The player whose progress this page reads and writes. See the file comment. */
export function useProgressOwner(): ProgressOwner | null {
  return useContext(ProgressOwnerContext);
}

/**
 * Bring a guest's saved boards along to the account they have just chosen
 * to import their history into.
 *
 * Only ever called after the player said yes to "Bring your progress with
 * you?" and the server confirmed the import — the same consent that moves
 * their server-side games. Copies, never moves: the guest identity is
 * retired straight afterwards, so its keys are simply never read again. A
 * board the account already has for the same puzzle is kept, not
 * overwritten.
 */
export function copyGuestProgressToAccount(deviceId: string, userId: string): void {
  const from = ownerScope({ kind: "guest", deviceId });
  const to = ownerScope({ kind: "account", userId });
  const prefixes = [progressKey(from), promptAnswerKey(from)];
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && prefixes.some((p) => key.startsWith(p))) keys.push(key);
    }
    for (const key of keys) {
      const target = key.replace(from, to);
      if (localStorage.getItem(target) !== null) continue;
      const value = localStorage.getItem(key);
      if (value !== null) localStorage.setItem(target, value);
    }
  } catch {
    // Storage unavailable: nothing was readable to copy in the first place.
  }
}
