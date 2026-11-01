/**
 * The Rainbow binding for shared Friends / Groups: contract version 0, section
 * 9. Mock only and off by default: nothing in the app imports it, and there is
 * deliberately no live transport here. Whoever calls createRainbowSocial
 * supplies the transport, and only tests do. Not portable: this is the one file
 * in src/social that knows about Rainbow.
 *
 * rainbowSession is synchronous because the portable client asks for the
 * session synchronously, before and after every call. It never touches the
 * Supabase client: the credential comes only from credentialFor, and the stored
 * session's owner comes from platformSignIn.
 *
 * Only a Rainbow account gets a session (the client-side view of rainbow_uid()).
 * Null means a confirmed guest or someone who is not an account in this game:
 * a guest may preview invites, so null is only for what is known. Everything
 * still unknown is "checking": a check running or failed, a stored session
 * nobody can read, and anything unexpected.
 */

import {
  ACCOUNTS_ENABLED,
  AUTH_STORAGE_KEY,
  accountCheckState,
  accountSignInGeneration,
  forgetAccountConfirmation,
  getCurrentAccount,
  sessionOwner,
  storedSessionOwner,
} from "@/lib/platformSignIn";
import { createSocialClient, disabledSocialClient } from "./client";
import type { SocialClient } from "./client";
import type { SessionState, SocialTransport } from "./contract";

export type SocialMode = "mock" | "off";

interface SocialEnv {
  VITE_SHARED_SOCIAL?: unknown;
  PROD?: unknown;
}

/** Mock needs the exact flag outside a production build. Everything else is off. */
export function socialMode(env: SocialEnv = import.meta.env): SocialMode {
  return env.VITE_SHARED_SOCIAL === "mock" && env.PROD !== true ? "mock" : "off";
}

// ── The scope: one random value per continuous sign-in ──
//
// Kept per sign-in generation, which moves when the person changes or a
// confirmation is forgotten. A re-check that publishes the same person keeps
// the scope, and so does one that fails at ensure_account. A failed user check
// in onboarding forgets the confirmation, so that re-check does rotate it. That
// is safe: a new scope only drops answers still on their way.

interface HeldScope {
  generation: number;
  value: string;
}

let held: HeldScope | null = null;

function currentScope(): string {
  const generation = accountSignInGeneration();
  if (held?.generation !== generation) {
    held = { generation, value: crypto.randomUUID() };
  }
  return held.value;
}

/** The sign-in is over, however we learned it: the next one is checked afresh and gets a new scope. */
function endSignIn(): void {
  forgetAccountConfirmation();
}

/**
 * A sign-out or a change of person in another tab never reaches
 * publishAccount() here, so this event is how this tab learns the sign-in is
 * over. A write for the same person is a token refresh, and one that can't be
 * read says nothing. With no current account there is no sign-in to end, but a
 * readable write does end a not-an-account answer, which described the session
 * before it. A check in flight reads as unsettled, so it is left to finish.
 */
function endsSignIn(event: StorageEvent): boolean {
  if (event.key === null) return true;
  if (event.key !== AUTH_STORAGE_KEY) return false;
  if (event.newValue === null) return true;
  const writtenFor = sessionOwner(event.newValue);
  if (writtenFor === null) return false;
  const account = getCurrentAccount();
  if (account === null) return accountCheckState() === "not_an_account";
  return writtenFor !== account.user_id;
}

// Registered at load, so a sign-out before the first rainbowSession() call
// still counts. Off registers nothing.
if (socialMode() === "mock" && typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (endsSignIn(event)) endSignIn();
  });
}

/**
 * The signed-in Rainbow account's session, "checking", or null. credentialFor
 * is called only for a confirmed account whose stored session matches. Makes no
 * rpc call and starts no account check.
 */
export function rainbowSession(credentialFor: () => string | null): SessionState {
  try {
    if (socialMode() !== "mock" || !ACCOUNTS_ENABLED) return null;

    // Asked first, in every state: a same-tab sign-out that never reached
    // publishAccount() must also stop a check that is still running.
    const storedOwner = storedSessionOwner();
    if (storedOwner === null) {
      endSignIn();
      return null;
    }
    if (storedOwner === undefined) {
      endSignIn();
      return "checking";
    }

    const account = getCurrentAccount();
    const checkState = accountCheckState();
    if (!account && checkState === "not_an_account") return null;
    if (!account || checkState === "unsettled") return "checking";

    if (account.user_id !== storedOwner) {
      endSignIn();
      return "checking";
    }

    // An older check's late ok can republish an account after the newest check
    // said not an account, so only "confirmed" goes on.
    if (checkState !== "confirmed") return "checking";

    const credential = credentialFor();
    if (!credential) return "checking";

    return { scope: currentScope(), credential };
  } catch {
    // Never null: an unexpected failure must not look like a guest.
    return "checking";
  }
}

export function createRainbowSocial({ mode = socialMode(), transport, credentialFor }: {
  mode?: SocialMode;
  transport: SocialTransport;
  credentialFor: () => string | null;
}): SocialClient {
  // A production build refuses mock even when a caller asks for it by name.
  if (mode !== "mock" || import.meta.env.PROD === true) return disabledSocialClient("unavailable");
  return createSocialClient({ getSession: () => rainbowSession(credentialFor), transport });
}
