interface OnboardingModalProps {
  gamesPlayed: number;
  currentStreak: number;
  longestStreak: number;
  email: string | null;
  /** The device credential could not be verified: no numbers, no import. */
  degraded: boolean;
  onAddProgress: () => void;
  onStartFresh: () => void;
}

/**
 * The one-time decision a brand-new account is offered when the browser it
 * was created on already holds guest history.
 *
 * Deliberately has no dismiss affordance. The account cannot play until the
 * decision resolves (the database refuses to create sessions while it is
 * pending), so an exit that resolved nothing would strand the player.
 */
export function OnboardingModal({
  gamesPlayed,
  currentStreak,
  longestStreak,
  email,
  degraded,
  onAddProgress,
  onStartFresh,
}: OnboardingModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-foreground/20 backdrop-blur-sm" />
      <div className="relative bg-card rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4 animate-pop">
        {degraded ? (
          <>
            <h2 className="text-lg font-bold text-center mb-2">
              We couldn't verify this device
            </h2>
            <p className="text-sm text-muted-foreground text-center mb-5">
              There may be earlier progress saved in this browser, but we can't
              confirm it belongs to you, so we can't add it to your account.
              You can start fresh — your future games will be saved to
              {email ? ` ${email}` : " your account"}.
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={onStartFresh}
                className="w-full py-2.5 rounded-full text-sm font-semibold transition-colors hover:opacity-90 active:scale-95"
                style={{ background: "hsl(var(--foreground))", color: "hsl(var(--background))" }}
              >
                Start Fresh
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-lg font-bold text-center mb-2">
              Bring your progress with you?
            </h2>
            <p className="text-sm text-muted-foreground text-center mb-4">
              We found {gamesPlayed} {gamesPlayed === 1 ? "game" : "games"} played
              on this device. Would you like to add them to
              {email ? ` ${email}` : " your account"}?
            </p>

            <div
              className="rounded-lg px-4 py-3 mb-5 space-y-1"
              style={{ background: "hsl(var(--secondary))" }}
            >
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Games played</span>
                <span className="font-semibold">{gamesPlayed}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Current streak</span>
                <span className="font-semibold">{currentStreak}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Best streak</span>
                <span className="font-semibold">{longestStreak}</span>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <button
                onClick={onAddProgress}
                className="w-full py-2.5 rounded-full text-sm font-semibold transition-colors hover:opacity-90 active:scale-95"
                style={{ background: "hsl(var(--foreground))", color: "hsl(var(--background))" }}
              >
                Add My Progress
              </button>
              <button
                onClick={onStartFresh}
                className="w-full py-2.5 rounded-full text-sm font-medium transition-colors hover:bg-secondary active:scale-95 text-muted-foreground"
              >
                Start Fresh
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
