import { Fragment, type ReactNode } from "react";
import { useAccountOnboarding } from "@/hooks/useAccountOnboarding";
import { ProgressOwnerContext, ownerKey } from "@/lib/progressOwner";
import { OnboardingModal } from "./OnboardingModal";
import { SavingUnavailableNotice } from "./SavingUnavailableNotice";

/**
 * Wraps the app and decides what a failure is allowed to take away.
 *
 * The distinction this file exists to enforce:
 *
 *   PUZZLE CONTENT missing  -> blocking error with Retry (handled where the
 *                              puzzle is loaded — there is nothing to play)
 *   SAVING unavailable      -> keep playing, show a small notice (the puzzle
 *                              is fine; only recording is not)
 *
 * So a failure to mint a credential, an unreachable RPC, or the cutover
 * window before the migration lands all leave the game playable. The player
 * is told plainly that it may not count, and nothing is ever recorded as
 * saved when it was not — no writes succeed, so no aggregate, history,
 * streak or Daily Stats entry moves.
 *
 * The one genuinely blocking case here is the one-time import decision: the
 * database refuses to create sessions for an account that still owes it, so
 * letting the board render would produce exactly the silently-losing board
 * this design avoids everywhere else.
 */
export function OnboardingGate({ children }: { children: ReactNode }) {
  const { state, owner, recheck, addMyProgress, startFresh } = useAccountOnboarding();

  // No player known yet — or a different one signing in or out. Nothing from
  // the previous player stays on screen while the server is asked.
  if (state.phase === "checking" || !owner) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background" data-testid="onboarding-checking">
        <div className="h-8 w-8 rounded-full border-2 border-muted-foreground/30 border-t-foreground animate-spin" />
      </div>
    );
  }

  if (state.phase === "decision") {
    return (
      <OnboardingModal
        gamesPlayed={state.gamesPlayed}
        currentStreak={state.currentStreak}
        longestStreak={state.longestStreak}
        email={state.email}
        degraded={state.degraded}
        onAddProgress={() => void addMyProgress()}
        onStartFresh={() => void startFresh()}
      />
    );
  }

  // Every page reads and writes the browser progress of this player only
  // (lib/progressOwner.ts). Keyed by the player too, so a change of player
  // rebuilds every page from scratch rather than carrying any state across.
  return (
    <ProgressOwnerContext.Provider value={owner}>
      <Fragment key={ownerKey(owner)}>{children}</Fragment>
      {state.phase === "saving_unavailable" && (
        <SavingUnavailableNotice onRetry={recheck} />
      )}
    </ProgressOwnerContext.Provider>
  );
}
