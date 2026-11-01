import type { SocialApi } from "@/components/social/socialApi";
import { ensureAccount, signOutOfRainbow } from "@/lib/platformSignIn";
import type { Outcome, SessionState } from "@/social/contract";
import { createRainbowSocial, rainbowSession } from "@/social/rainbowAdapter";
import { backend } from "./fakeBackend";
import type { PersonId, SeededLink } from "./fakeBackend";

/**
 * The glue of the preview: no screens and no state of its own. The client is the
 * real adapter in its default mode, and the session is the real session source,
 * reacting to the fake backend. Nothing here sets account state: it arrives only
 * through the real sign-in code.
 */

export type { PersonId };
export type Who = PersonId | "guest";

/** A link one person hands another. */
export type PreviewLink = SeededLink;

/** The screens run on the same small api as the app. The rest is for the bar. */
export interface Preview extends SocialApi {
  choices: { id: PersonId; label: string }[];
  seededLinks: PreviewLink[];
  /** Whoever holds the stored session. */
  who(): Who;
  /** Forgets answers on their way at once, then the real sign-out, then the real account check. */
  switchTo(who: Who): Promise<void>;
  sessionState(): SessionState;
  /** The fake game server reports this person's result. Null when it was taken. */
  finishToday(): Promise<Outcome | null>;
  nextDay(): void;
  puzzleId(): string;
}

async function change(who: Who): Promise<void> {
  await signOutOfRainbow();
  if (who === "guest") return;
  backend.signIn(who);
  // Rainbow's React onboarding hook isn't used here. This is the account check
  // that hook runs after a sign-in, and nothing else of it.
  await ensureAccount();
}

async function begin(): Promise<Preview> {
  // This origin is only this preview, and the memory hub starts empty on load.
  localStorage.clear();
  const seededLinks = await backend.seeded;

  const credentialFor = () => backend.accessToken();
  const client = createRainbowSocial({ transport: backend.transport, credentialFor });

  // One change at a time, in order. Rainbow's ensureAccount has no check of who
  // it is still for, so two running together could leave the account unsettled.
  let changes: Promise<void> = Promise.resolve();

  const switchTo = (who: Who) => {
    client.forget();
    changes = changes.then(() => change(who), () => change(who));
    return changes;
  };

  await switchTo("alex");

  return {
    client,
    choices: backend.choices,
    seededLinks,
    who: () => backend.holder() ?? "guest",
    switchTo,
    sessionState: () => rainbowSession(credentialFor),
    finishToday: () => backend.finishToday(),
    nextDay: () => backend.nextDay(),
    puzzleId: () => backend.puzzleId(),
    today: () => backend.today(),
    linkUrl: (code) => `${location.origin}/?invite=${encodeURIComponent(code)}`,
    // The bar already holds every link, so there is nothing to hand over.
    share: async () => "done",
  };
}

let started: Promise<Preview> | null = null;

/** One page load: seeds the hub once and builds the real client once. */
export function startPreview(): Promise<Preview> {
  started ??= begin();
  return started;
}
