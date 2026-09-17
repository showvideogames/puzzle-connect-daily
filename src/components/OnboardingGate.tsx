import type { ReactNode } from "react";
import { useAccountOnboarding } from "@/hooks/useAccountOnboarding";
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
  const { state, recheck, addMyProgress, startFresh } = useAccountOnboarding();

  if (state.phase === "checking") {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
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

  return (
    <>
      {children}
      {state.phase === "saving_unavailable" && (
        <SavingUnavailableNotice onRetry={recheck} />
      )}
    </>
  );
}
