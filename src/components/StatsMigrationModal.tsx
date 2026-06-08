interface StatsMigrationModalProps {
  open: boolean;
  guestStreak: number;
  guestLongest: number;
  guestGamesPlayed: number;
  onImport: () => void;
  onStartFresh: () => void;
}

export function StatsMigrationModal({
  open,
  guestStreak,
  guestLongest,
  guestGamesPlayed,
  onImport,
  onStartFresh,
}: StatsMigrationModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-foreground/20 backdrop-blur-sm" />
      <div className="relative bg-card rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4 animate-pop">
        <h2 className="text-lg font-bold text-center mb-2">
          Welcome back!
        </h2>
        <p className="text-sm text-muted-foreground text-center mb-4">
          We found puzzle stats on this device. Import them to your account?
        </p>

        <div
          className="rounded-lg px-4 py-3 mb-5 space-y-1"
          style={{ background: "hsl(var(--secondary))" }}
        >
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Games played</span>
            <span className="font-semibold">{guestGamesPlayed}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Current streak</span>
            <span className="font-semibold">{guestStreak}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Best streak</span>
            <span className="font-semibold">{guestLongest}</span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <button
            onClick={onImport}
            className="w-full py-2.5 rounded-full text-sm font-semibold transition-colors hover:opacity-90 active:scale-95"
            style={{ background: "hsl(var(--foreground))", color: "hsl(var(--background))" }}
          >
            Import Stats
          </button>
          <button
            onClick={onStartFresh}
            className="w-full py-2.5 rounded-full text-sm font-medium transition-colors hover:bg-secondary active:scale-95 text-muted-foreground"
          >
            Start Fresh
          </button>
        </div>
      </div>
    </div>
  );
}
