import { useEffect, useRef, useState } from "react";
import { Rainbow, Grid2x2 } from "lucide-react";

const RAINBOW_MODE_TITLE = "Hidden Rainbow";
const RAINBOW_MODE_BODY = "This puzzle contains a fifth connection made from one word in each group.";
const noRainbowModeTitle = (groupCount: number) =>
  `${GROUP_COUNT_WORD[groupCount] ?? groupCount} Groups Only`;
const NO_RAINBOW_MODE_BODY = "This puzzle does not contain a hidden Rainbow.";

// Spelled out for the tooltip heading, which reads as prose. Falls back to
// the digit for any size not listed.
const GROUP_COUNT_WORD: Record<number, string> = { 3: "Three", 4: "Four" };

export interface PuzzleModeBadgeProps {
  isRainbow: boolean;
  /**
   * How many categories this puzzle has — 4 on a Full board, 3 on a Mini.
   * Drives the non-Rainbow label so a Mini never claims "4 Groups". Defaults
   * to 4, so every existing call site is unchanged.
   */
  groupCount?: number;
}

// Compact puzzle-mode badge — RAINBOW when the puzzle has hidden-Rainbow
// data, 4 GROUPS otherwise. Both variants share the exact same geometry
// (height/radius/padding/font/icon size/border width); only the fill color,
// icon, and label differ, so neither reads as more "correct" than the
// other. Rainbow's fill reuses the existing .rainbow-tile gradient (the
// same one real in-game rainbow tiles use) rather than introducing a new
// brand color, per "use the current Rainbow Connect visual language."
//
// Standalone (not GameBoard-specific) so any page/context can opt in —
// GameBoard renders it only when its own showModeBadge prop is true, and a
// future non-GameBoard puzzle surface can render <PuzzleModeBadge /> the
// same way without depending on GameBoard at all.
export function PuzzleModeBadge({ isRainbow, groupCount = 4 }: PuzzleModeBadgeProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent | TouchEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("touchstart", handleClick);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("touchstart", handleClick);
    };
  }, [open]);

  const Icon = isRainbow ? Rainbow : Grid2x2;
  const groupsLabel = `${groupCount} Groups`;
  const title = isRainbow ? RAINBOW_MODE_TITLE : noRainbowModeTitle(groupCount);
  const body = isRainbow ? RAINBOW_MODE_BODY : NO_RAINBOW_MODE_BODY;

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`${isRainbow ? "Rainbow" : groupsLabel} puzzle mode — tap for details`}
        className={`inline-flex items-center gap-1 sm:gap-1.5 h-6 sm:h-7 pl-1.5 pr-2 sm:pl-2 sm:pr-2.5
          rounded-full border text-[10px] sm:text-[11px] font-bold uppercase tracking-wide
          transition-transform active:scale-95
          ${isRainbow
            ? "rainbow-tile text-white border-transparent"
            : "bg-secondary text-muted-foreground border-border"}`}
      >
        <Icon className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />
        {isRainbow ? "Rainbow" : groupsLabel}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 z-50 w-max max-w-[220px]
            rounded-xl px-3 py-2.5 shadow-lg text-left bg-foreground text-background"
        >
          <p className="text-[10px] font-bold uppercase tracking-wide mb-0.5">{title}</p>
          <p className="text-xs leading-snug opacity-90">{body}</p>
        </div>
      )}
    </div>
  );
}
