import type { ReactNode } from "react";
import { useAccountOnboarding } from "@/hooks/useAccountOnboarding";
import { OnboardingModal } from "./OnboardingModal";

/**
 * Wraps the whole app so no route can start a game before onboarding has
 * resolved.
 *
 * This is a courtesy, not the enforcement: create_game_session refuses a
 * pending account outright, so a client that skipped this would simply find
 * that nothing saves. The gate exists so that failure is a clear screen
 * instead of a board that silently loses every move.
 *
 * Anonymous players are never gated — guest play must work with no account
 * and no decision to make.
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

  if (state.phase === "unavailable") {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center bg-background">
        <h1 className="text-xl font-bold">Just a moment</h1>
        <p className="text-sm text-muted-foreground max-w-xs">
          We're finishing a quick update. This page will pick it up
          automatically — or tap below to try now.
        </p>
        <button
          onClick={() => void recheck()}
          className="px-5 py-2.5 rounded-full text-sm font-semibold transition-colors hover:opacity-90 active:scale-95"
          style={{ background: "hsl(var(--foreground))", color: "hsl(var(--background))" }}
        >
          Try again
        </button>
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

  return <>{children}</>;
}
