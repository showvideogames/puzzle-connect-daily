/**
 * ACTIVE VISIBLE TIME — how long a player has actually been looking at a
 * playable board.
 *
 * Not wall-clock time since the puzzle loaded. A player who opens the Mini,
 * switches to another app for two hours and comes back has spent two hours
 * away, and counting that would make every shared time meaningless. What this
 * measures is the sum of the stretches during which the document was VISIBLE
 * and the run was still going.
 *
 * ── Why an accumulator and not `Date.now() - startedAt` ───────────────────
 *
 * Three separate facts make the subtraction wrong:
 *
 *   1. Hidden time must not count (the whole point, above).
 *   2. A run SURVIVES A REFRESH. The seconds already banked come back from
 *      the progress blob, and this session has to add onto them rather than
 *      restart from zero — there is no single "started at" instant to
 *      subtract from any more.
 *   3. A React page can mount, unmount and remount (SPA navigation, a Strict
 *      Mode double-invoke, a parent re-key). Each of those would restart a
 *      subtraction-based clock, or, worse, run two of them at once.
 *
 * So time is BANKED: every time the board goes from counting to not counting
 * — hidden, completed, unmounted — the stretch that just ended is added to a
 * running total, and the total is what is stored, shown and shared.
 *
 * ── Monotonic, not wall clock ─────────────────────────────────────────────
 *
 * Stretches are measured with `performance.now()`, which only ever moves
 * forward at a steady rate. `Date.now()` can jump backwards or forwards when
 * the OS corrects the clock, crosses a DST boundary or syncs NTP — on a
 * five-minute puzzle that is the difference between "3m 20s" and "1h 3m 20s".
 * `Date.now()` is used only as a fallback where `performance` is missing.
 *
 * ── This is casual timing ─────────────────────────────────────────────────
 *
 * It is a "that was a fun 90 seconds" number, not a leaderboard or an
 * anti-cheat measure. Anyone determined to report a better time can. Nothing
 * here tries to stop them, and nothing here should grow into trying.
 */

/** Milliseconds from a monotonic source, falling back to the wall clock. */
export function monotonicNow(): number {
  try {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
      return performance.now();
    }
  } catch {
    // performance unavailable (very old or unusual environments)
  }
  return Date.now();
}

/**
 * The banked-time accumulator.
 *
 * Deliberately a plain object with no React, no timers and no DOM: the hook
 * owns WHEN to call these, this owns HOW MUCH time that adds up to, and the
 * arithmetic can be tested directly by feeding it clock values.
 *
 * ── Rounding ──────────────────────────────────────────────────────────────
 *
 * Internally milliseconds; every reported value is `Math.floor(ms / 1000)` —
 * COMPLETED whole seconds, always rounded down, never up. 59.9 seconds reads
 * "59s", not "1m 00s". Rounding down is the honest direction for an elapsed
 * count (you have not finished the 60th second until you have), and flooring
 * once at the edge rather than rounding each stretch means banking one long
 * stretch and banking the same time as ten short ones give the same answer.
 */
export interface ActiveTimer {
  /**
   * Begin counting, if not already counting. Idempotent: calling it twice
   * does not start a second stretch, which is what makes a remount safe.
   */
  resume(now?: number): void;
  /** Stop counting and bank the stretch that just ended. Idempotent. */
  pause(now?: number): void;
  /**
   * Bank any open stretch and refuse to count ever again. Used at
   * completion/loss, so the finished time can never drift afterwards — the
   * result screen, a later refresh and the share text all report the same
   * number.
   */
  freeze(now?: number): void;
  /** Whole active seconds so far, including a stretch still in progress. */
  seconds(now?: number): number;
  /** Is the timer counting right now? */
  readonly running: boolean;
  /** Has freeze() been called? */
  readonly frozen: boolean;
}

export function createActiveTimer(initialSeconds = 0): ActiveTimer {
  // Seeded from whatever a previous visit banked. A negative or non-finite
  // stored value (a corrupt blob) is treated as zero rather than trusted —
  // it must never be able to run the clock backwards.
  let bankedMs = Number.isFinite(initialSeconds) && initialSeconds > 0 ? initialSeconds * 1000 : 0;
  let startedAt: number | null = null;
  let frozen = false;

  const openStretchMs = (now: number) => {
    if (startedAt === null) return 0;
    // A monotonic clock cannot go backwards, but a fallback wall clock can.
    // Clamp at zero so a backwards jump costs the player nothing instead of
    // subtracting from time they genuinely spent.
    return Math.max(0, now - startedAt);
  };

  return {
    resume(now = monotonicNow()) {
      if (frozen || startedAt !== null) return;
      startedAt = now;
    },
    pause(now = monotonicNow()) {
      if (startedAt === null) return;
      bankedMs += openStretchMs(now);
      startedAt = null;
    },
    freeze(now = monotonicNow()) {
      if (startedAt !== null) {
        bankedMs += openStretchMs(now);
        startedAt = null;
      }
      frozen = true;
    },
    seconds(now = monotonicNow()) {
      return Math.floor((bankedMs + openStretchMs(now)) / 1000);
    },
    get running() {
      return startedAt !== null;
    },
    get frozen() {
      return frozen;
    },
  };
}

/**
 * A solve time as a player reads it.
 *
 *   42s        under a minute — bare seconds, no padding, no leading "0m"
 *   1m 30s     a minute or more — seconds padded to two digits so a column
 *   12m 05s    of times lines up and "1m 5s" can't be misread as "1m 50s"
 *
 * Minutes are NOT capped at 59 and never roll into hours: a Mini that took
 * 75 minutes reads "75m 00s". An hours unit on a 3×3 puzzle would be
 * describing a tab someone left open, not a solve.
 *
 * Anything not a usable number — NaN, negative, Infinity — reads "0s" rather
 * than propagating nonsense into a share text.
 */
export function formatActiveTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "0s";
  const whole = Math.floor(totalSeconds);
  if (whole < 60) return `${whole}s`;
  const minutes = Math.floor(whole / 60);
  const seconds = whole % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

/** The share-text line for a solve time, e.g. `⏳ 1m 30s`. */
export function shareTimeLine(totalSeconds: number): string {
  return `⏳ ${formatActiveTime(totalSeconds)}`;
}
