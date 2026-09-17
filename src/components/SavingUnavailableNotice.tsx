import { useState } from "react";

/**
 * A small, non-blocking banner shown when secure recording is unavailable.
 *
 * It exists to keep one promise: never let a player believe a game was saved
 * when it was not. The puzzle itself is unaffected — it is in memory, fully
 * playable, and the result and share grid are produced locally — so taking
 * the board away would remove the part that still works.
 *
 * Deliberately not a modal and not dismissible-to-silence: it stays until
 * saving actually comes back, because the caveat stays true until then.
 */
export function SavingUnavailableNotice({ onRetry }: { onRetry: () => void | Promise<void> }) {
  const [retrying, setRetrying] = useState(false);

  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div
      role="status"
      className="fixed bottom-0 inset-x-0 z-40 px-3 pb-3 pointer-events-none"
    >
      <div
        className="mx-auto max-w-md rounded-lg shadow-lg px-4 py-3 flex items-center gap-3 pointer-events-auto"
        style={{ background: "hsl(var(--secondary))" }}
      >
        <p className="text-xs text-foreground/80 flex-1 leading-snug">
          Saving is temporarily unavailable. You can still play, but this game
          may not count toward your stats or streak.
        </p>
        <button
          onClick={() => void retry()}
          disabled={retrying}
          className="shrink-0 text-xs font-semibold rounded-full px-3 py-1.5 transition-opacity hover:opacity-90 active:scale-95 disabled:opacity-60"
          style={{ background: "hsl(var(--foreground))", color: "hsl(var(--background))" }}
        >
          {retrying ? "Trying…" : "Try Again"}
        </button>
      </div>
    </div>
  );
}
