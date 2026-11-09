import { accountCheckRunning, accountCheckState, accountSignInGeneration, getCurrentAccount, signInWithPlatform, storedSessionOwner, subscribeToCurrentAccount } from "@/lib/platformSignIn";
import { getSocialWeekPuzzles, getTodaysPuzzle } from "@/lib/puzzles";
import { createGatewayTransport, readStoredAccessToken } from "@/lib/socialTransport";
import type { SessionState } from "@/social/contract";
import { createRainbowSocial, rainbowSession } from "@/social/rainbowAdapter";
import { shareOrCopy, type SocialApi } from "./socialApi";
import type { SessionSource } from "./useSocialSession";

/**
 * The real thing behind the Friends and Groups pages. Only those lazy pages
 * import this file, so none of it is in the main chunk.
 */

export interface AppSocial {
  api: SocialApi;
  source: SessionSource;
  /** Null when the browser is on its way to the sign-in page, or a sentence saying why not. */
  signIn(): Promise<string | null>;
}

let todays: { date: string; id: Promise<string | null> } | null = null;

/** The full daily. Beta covers nothing else. An answer of none isn't kept, so a failed lookup is asked again. */
function todaysPuzzleId(): Promise<string | null> {
  const date = new Date().toLocaleDateString("en-CA");
  if (todays?.date === date) return todays.id;
  const lookup = { date, id: getTodaysPuzzle("full").then((puzzle) => puzzle?.id ?? null, () => null) };
  todays = lookup;
  void lookup.id.then((id) => {
    if (id === null && todays === lookup) todays = null;
  });
  return lookup.id;
}

const source: SessionSource = {
  read() {
    const storedOwner = storedSessionOwner();
    // rainbowSession ends a sign-in it finds out of step, which retires a check
    // still running, and this is read constantly. So while checks are unsettled
    // and someone holds the session, its answer is taken as read: it could only
    // say "checking". Reading never starts or stops an account check.
    const state: SessionState = accountCheckState() === "unsettled" && storedOwner ? "checking" : rainbowSession(readStoredAccessToken);
    return { state, accountId: getCurrentAccount()?.user_id ?? null, storedOwner, generation: accountSignInGeneration(), checkRunning: accountCheckRunning() };
  },
  subscribe: (listener) => subscribeToCurrentAccount(() => listener()),
};

let built: AppSocial | null = null;

/** Built once, the first time a page asks. */
export function appSocial(): AppSocial {
  built ??= {
    api: {
      recentActivity: import.meta.env.VITE_RECENT_COMPLETIONS === "true",
      client: createRainbowSocial({
        transport: createGatewayTransport({ baseUrl: import.meta.env.VITE_SUPABASE_URL, publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY }),
        credentialFor: readStoredAccessToken,
      }),
      puzzleId: todaysPuzzleId,
      weekPuzzles: getSocialWeekPuzzles,
      today: () => new Date(),
      linkUrl: (code) => `${location.origin}/join/${encodeURIComponent(code)}`,
      share: shareOrCopy,
    },
    source,
    signIn: signInWithPlatform,
  };
  return built;
}
