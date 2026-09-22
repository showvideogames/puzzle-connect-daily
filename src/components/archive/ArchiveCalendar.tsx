import { ChevronLeft, ChevronRight } from "lucide-react";
import { DAYS, MONTHS } from "@/lib/archiveMonth";

/**
 * The month selector + day grid + legend shared by every archive.
 *
 * Moved VERBATIM out of pages/Archive.tsx — same markup, same classes, same
 * constants — so the Full archive renders pixel-for-pixel what it always has,
 * while the Mini archive gets the same calendar instead of a second one that
 * would drift from it. The page above still owns everything that differs
 * between the two: which puzzles exist, what a day's status is, where a click
 * navigates, and the Full-only Free/Emoji collections below.
 *
 * The one genuinely conditional piece is the Rainbow legend entry, which a
 * format with no bonus category must not claim (see `showRainbowLegend`).
 */

// "none" = a future day that hasn't happened yet but already has a
// published puzzle waiting — rendered with the same neutral look as
// "unplayed" but never clickable.
// "no-puzzle" = there is no puzzle for this date at all (a gap in the
// archive, or a future day nothing has been published for yet) — visually
// distinct from "unplayed" (a puzzle exists, just hasn't been played) via
// its own inverted-theme fill (see STATUS_CELL_CLASSES below).
export type DayStatus = "unplayed" | "in-progress" | "won" | "won-rainbow" | "failed" | "none" | "no-puzzle";

/**
 * The words a day cell's accessible name uses for each state — the spoken
 * equivalent of the colour tints below, and the same vocabulary the visible
 * legend at the bottom of the calendar uses.
 */
const DAY_STATUS_LABEL: Record<DayStatus, string> = {
  unplayed: "unplayed",
  "in-progress": "in progress",
  won: "completed",
  "won-rainbow": "completed with the Rainbow",
  failed: "failed",
  none: "unplayed",
  "no-puzzle": "no puzzle",
};

// ── Calendar status tints ────────────────────────────────────────────────────
// Whole-cell tints, not badges/dots — literal hue constants (matching the
// site's real category colors). Alpha is tuned to read as a clearly
// noticeable colored tile at a glance (roughly 28-35% light / 30-40% dark
// per status — dark mode runs a bit stronger since the same tint reads
// fainter over a dark neutral than over the light cream page), while
// staying well short of the fully-saturated category-card colors used
// elsewhere in the app.
const STATUS_CELL_CLASSES: Record<Exclude<DayStatus, "none" | "won-rainbow" | "no-puzzle">, string> = {
  unplayed: "bg-card border-border",
  "in-progress": "bg-[hsl(48_89%_60%/0.32)] dark:bg-[hsl(48_89%_60%/0.35)] border-border",
  won: "bg-[hsl(125_45%_50%/0.32)] dark:bg-[hsl(125_45%_50%/0.36)] border-border",
  failed: "bg-[hsl(5_74%_58%/0.28)] dark:bg-[hsl(5_74%_58%/0.32)] border-border",
};

// "No puzzle" cells read as greyed-out/disabled — dimmer than an available
// "unplayed" date, never a highlighted or achievement-like state. Reuses
// the same disabled-bg/disabled-fg tokens the Shuffle/Clear/Submit controls
// already use for their own disabled look (light: soft warm gray fill,
// medium muted gray number; dark: charcoal fill, muted gray number), so
// this stays visually consistent with "disabled" everywhere else in the
// app instead of introducing a new one-off treatment.
const NO_PUZZLE_CELL_CLASS = "bg-disabled-bg border-border";
const NO_PUZZLE_NUMBER_CLASS = "text-disabled-fg";

const RAINBOW_CELL_GRADIENT =
  "linear-gradient(135deg, hsl(48 89% 60% / 0.40), hsl(125 45% 50% / 0.38), hsl(203 65% 55% / 0.38), hsl(258 90% 62% / 0.40), hsl(5 74% 58% / 0.38))";
const RAINBOW_CELL_GRADIENT_DARK =
  "linear-gradient(135deg, hsl(48 89% 60% / 0.46), hsl(125 45% 50% / 0.44), hsl(203 65% 55% / 0.44), hsl(258 90% 62% / 0.46), hsl(5 74% 58% / 0.44))";

// Solid (non-pale) version for the compact legend dots, where a diluted
// tint would be too faint to read as a 8px swatch.
const RAINBOW_LEGEND_GRADIENT =
  "linear-gradient(135deg, hsl(48 89% 69%), hsl(125 38% 67%), hsl(203 59% 68%), hsl(258 90% 66%), hsl(5 74% 67%))";

interface MonthSelectorProps {
  viewYear: number;
  viewMonth: number;
  canGoBack: boolean;
  canGoForward: boolean;
  onPrev: () => void;
  onNext: () => void;
}

/**
 * Floating pill month selector — visually separate from (and elevated
 * above) the calendar card below it.
 */
export function ArchiveMonthSelector({ viewYear, viewMonth, canGoBack, canGoForward, onPrev, onNext }: MonthSelectorProps) {
  return (
    <div className="flex justify-center mb-3 sm:mb-4">
      <div
        className="inline-flex items-center gap-3 sm:gap-4 bg-card border border-border rounded-full pl-2 pr-2 py-2
          shadow-[0_1px_2px_rgba(30,25,20,0.04),0_4px_14px_rgba(30,25,20,0.07)]
          dark:shadow-[0_1px_2px_rgba(0,0,0,0.25),0_4px_14px_rgba(0,0,0,0.4)]"
      >
        <button
          onClick={onPrev}
          disabled={!canGoBack}
          className="w-9 h-9 sm:w-10 sm:h-10 shrink-0 grid place-items-center rounded-full bg-secondary/70 text-foreground
            hover:bg-secondary transition-colors active:scale-95 disabled:opacity-30 disabled:hover:bg-secondary/70"
          aria-label="Previous month"
        >
          <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5" />
        </button>
        <p className="text-base sm:text-lg font-bold tracking-tight whitespace-nowrap px-1 min-w-[9.5rem] sm:min-w-[11rem] text-center">
          {MONTHS[viewMonth]} {viewYear}
        </p>
        <button
          onClick={onNext}
          disabled={!canGoForward}
          className="w-9 h-9 sm:w-10 sm:h-10 shrink-0 grid place-items-center rounded-full bg-secondary/70 text-foreground
            hover:bg-secondary transition-colors active:scale-95 disabled:opacity-30 disabled:hover:bg-secondary/70"
          aria-label="Next month"
        >
          <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" />
        </button>
      </div>
    </div>
  );
}

interface ArchiveCalendarProps {
  viewYear: number;
  viewMonth: number;
  /** Today in the player's local calendar, as YYYY-MM-DD. */
  todayStr: string;
  /** Does a puzzle exist for this date at all? */
  hasPuzzleOn: (dateStr: string) => boolean;
  getDayStatus: (dateStr: string, isPast: boolean) => DayStatus;
  onDayClick: (dateStr: string) => void;
  /**
   * Whether the legend offers the Rainbow entry. False for a format with no
   * bonus category — a legend claiming a state the board can never reach
   * would be a lie, not a harmless extra row.
   */
  showRainbowLegend?: boolean;
}

export function ArchiveCalendar({
  viewYear,
  viewMonth,
  todayStr,
  hasPuzzleOn,
  getDayStatus,
  onDayClick,
  showRainbowLegend = true,
}: ArchiveCalendarProps) {
  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;

  return (
    <div
      className="w-full bg-card border border-border/70 rounded-[28px] px-3 sm:px-5 pt-4 sm:pt-5 pb-4 sm:pb-5
        shadow-[0_1px_2px_rgba(30,25,20,0.03),0_8px_24px_rgba(30,25,20,0.045)]
        dark:shadow-[0_1px_2px_rgba(0,0,0,0.22),0_8px_24px_rgba(0,0,0,0.4)]"
    >
      {/* Weekday headers */}
      <div className="grid grid-cols-7 mb-1.5">
        {DAYS.map((d) => (
          <div key={d} className="text-center py-1 text-[10px] sm:text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid — every cell (real or blank) is the same aspect-square
          size, so numbers never shift and rows always line up. Status is
          communicated purely by the cell's own fill/gradient; the date
          number's position never changes to make room for a marker. */}
      <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
        {Array.from({ length: totalCells }).map((_, i) => {
          const dayNum = i - firstDay + 1;
          if (dayNum < 1 || dayNum > daysInMonth) {
            return <div key={i} className="aspect-square" />;
          }

          const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
          const isPast = dateStr < todayStr;
          const isToday = dateStr === todayStr;
          const hasPuzzle = hasPuzzleOn(dateStr);
          const isClickable = isPast && hasPuzzle;
          const status = getDayStatus(dateStr, isPast);
          const isRainbow = status === "won-rainbow";
          const isNoPuzzle = status === "no-puzzle";
          const cellClass = isRainbow
            ? "border-border"
            : isNoPuzzle
              ? NO_PUZZLE_CELL_CLASS
              : STATUS_CELL_CLASSES[status === "none" ? "unplayed" : status];

          return (
            <button
              key={i}
              onClick={() => onDayClick(dateStr)}
              disabled={!isClickable}
              // The visible label is a bare number, which is all the cell has
              // room for and all a sighted reader needs in a month grid. On
              // its own it makes a poor accessible name — "12" says nothing
              // about which month, and nothing about the state the colour is
              // communicating. The full date plus the status word carries
              // both. Status is announced only for a day that HAS a puzzle;
              // "no puzzle" days already say so.
              aria-label={`${dateStr}${isNoPuzzle ? " — no puzzle" : `, ${DAY_STATUS_LABEL[status]}`}`}
              className={`relative aspect-square w-full grid place-items-center rounded-lg sm:rounded-xl border transition-[filter] duration-150
                ${cellClass}
                ${isToday ? "ring-2 ring-inset ring-ink" : ""}
                ${isClickable ? "hover:brightness-[0.96] cursor-pointer active:scale-95" : "cursor-default"}`}
              style={isRainbow ? { backgroundImage: RAINBOW_CELL_GRADIENT } : undefined}
            >
              {/* Dark mode gets its own slightly stronger gradient overlay
                  (painted on top, same rounding) rather than swapping the
                  base style — Tailwind's dark: variant can't conditionally
                  pick between two inline-style values. */}
              {isRainbow && (
                <span
                  className="absolute inset-0 rounded-lg sm:rounded-xl hidden dark:block"
                  style={{ backgroundImage: RAINBOW_CELL_GRADIENT_DARK }}
                  aria-hidden="true"
                />
              )}
              <span className={`relative text-sm sm:text-base font-semibold tabular-nums leading-none ${isNoPuzzle ? NO_PUZZLE_NUMBER_CLASS : "text-foreground"}`}>
                {dayNum}
              </span>
            </button>
          );
        })}
      </div>

      {/* Legend — compact, wraps to two lines on very small screens rather
          than competing with the calendar for space. */}
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 mt-4 pt-3.5 border-t border-border/70 text-[11px] sm:text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: "hsl(125 38% 60%)" }} /> Completed
        </span>
        {showRainbowLegend && (
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundImage: RAINBOW_LEGEND_GRADIENT }} /> Rainbow
          </span>
        )}
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: "hsl(45 85% 58%)" }} /> In progress
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: "hsl(5 70% 62%)" }} /> Failed
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full shrink-0 border border-border bg-card" /> Unplayed
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full shrink-0 border border-border bg-disabled-bg" /> No puzzle
        </span>
      </div>
    </div>
  );
}
