import { Link } from "react-router-dom";
import { BarChart3, ChevronLeft } from "lucide-react";
import { PuzzleModeBadge } from "@/components/PuzzleModeBadge";
import { FavoriteButton } from "@/components/FavoriteButton";

interface CustomPuzzleHeaderProps {
  title: string;
  designerName: string;
  /** Set only when a signed-in creator made the puzzle; anonymous designer names stay plain text. */
  creatorSlug: string | null;
  isRainbow: boolean;
  onBack: () => void;
  /** Opens this puzzle's aggregate stats (CustomStatsModal), not the player's personal stats. */
  onOpenPuzzleStats: () => void;
  favorite: {
    favorited: boolean;
    count: number;
    onToggle: () => void;
    note?: string | null;
  };
}

/**
 * Title, `by Designer | [type badge]` and the favorite control for a custom
 * puzzle. The badge is the shared PuzzleModeBadge (same one Archive puzzles
 * use), not a lookalike.
 */
export function CustomPuzzleHeader({ title, designerName, creatorSlug, isRainbow, onBack, onOpenPuzzleStats, favorite }: CustomPuzzleHeaderProps) {
  return (
    <div className="w-full max-w-[840px] px-4 mb-1 sm:mb-2">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5 sm:gap-2 mt-1 sm:mt-2">
        <button
          onClick={onBack}
          className="w-[68px] sm:w-[88px] shrink-0 inline-flex items-center justify-center gap-0.5 whitespace-nowrap h-8 sm:h-9 rounded-full border border-border bg-card
            text-foreground text-[11px] sm:text-sm font-semibold
            hover:bg-secondary transition-colors active:scale-95"
        >
          <ChevronLeft className="w-3 h-3 sm:w-4 sm:h-4 shrink-0" />
          Create
        </button>
        <h1
          className="min-w-0 text-center overflow-hidden whitespace-nowrap text-ellipsis
            font-tile font-bold tracking-tight text-foreground text-[clamp(1.375rem,6.5vw,1.75rem)] sm:text-3xl"
        >
          {title}
        </h1>
        <div className="w-[68px] sm:w-[88px] shrink-0" />
      </div>

      {/* The puzzle's actions sit in this row: on phones inline after the
          byline as compact pills, from sm up wrapped onto a centred line of
          their own (basis-full) at full size. One set of controls either way. */}
      <div
        data-testid="custom-meta-row"
        className="mt-1 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs sm:text-sm text-muted-foreground"
      >
        <span className="min-w-0 max-w-full break-words text-center">
          by{" "}
          {creatorSlug ? (
            <Link
              to={`/creator/${creatorSlug}`}
              className="font-semibold text-foreground underline underline-offset-2 hover:text-primary
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            >
              {designerName}
            </Link>
          ) : (
            designerName
          )}
          {/* Trails the designer text (not the badge) so a wrapped row never
              starts a line with an orphaned separator. */}
          <span aria-hidden="true" className="ml-2 text-border select-none">|</span>
        </span>
        <PuzzleModeBadge isRainbow={isRainbow} />
        {/* items-start keeps the two pills aligned even though Favorite
            reserves a status line beneath itself from sm up. */}
        <div
          data-testid="custom-action-row"
          className="inline-flex items-start gap-2 ml-1 sm:ml-0 sm:basis-full sm:justify-center sm:gap-x-3 sm:mt-1"
        >
          <FavoriteButton {...favorite} responsive />
          <button
            type="button"
            onClick={onOpenPuzzleStats}
            className="inline-flex items-center justify-center gap-1.5 h-9 w-9 sm:w-auto sm:px-4 rounded-full border border-border bg-card text-foreground
              text-sm font-semibold hover:bg-secondary transition-colors active:scale-95
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <BarChart3 aria-hidden="true" className="w-4 h-4 shrink-0" />
            <span className="sr-only sm:not-sr-only">Puzzle Stats</span>
          </button>
        </div>
      </div>

    </div>
  );
}
