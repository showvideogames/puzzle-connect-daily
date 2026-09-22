import { Link } from "react-router-dom";
import { Star, Play } from "lucide-react";
import { PuzzleModeBadge } from "@/components/PuzzleModeBadge";
import type { CustomPuzzleMode } from "@/lib/customPuzzles";

interface CommunityPuzzleCardProps {
  title: string;
  shortCode: string;
  mode: CustomPuzzleMode;
  /** Shown as "by …"; linked when the designer has a public profile. */
  designerName?: string;
  creatorSlug?: string | null;
  finishedPlays?: number;
  favoriteCount?: number;
}

/**
 * One custom puzzle in a list (creator page, Favorites). The title is the
 * link; the shared type badge sits beside it rather than inside it, since the
 * badge is itself a button.
 */
export function CommunityPuzzleCard({
  title,
  shortCode,
  mode,
  designerName,
  creatorSlug,
  finishedPlays,
  favoriteCount,
}: CommunityPuzzleCardProps) {
  return (
    <li className="rounded-xl border border-border bg-card p-4 flex flex-col gap-2 min-w-0">
      <div className="flex items-start justify-between gap-2">
        <Link
          to={`/p/${shortCode}`}
          className="min-w-0 font-tile font-semibold text-lg text-foreground break-words hover:text-primary
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        >
          {title}
        </Link>
        <PuzzleModeBadge isRainbow={mode === "rainbow"} />
      </div>
      {designerName && (
        <p className="text-xs text-muted-foreground break-words">
          by{" "}
          {creatorSlug ? (
            <Link to={`/creator/${creatorSlug}`} className="font-semibold text-foreground underline underline-offset-2">
              {designerName}
            </Link>
          ) : (
            designerName
          )}
        </p>
      )}
      {(finishedPlays !== undefined || favoriteCount !== undefined) && (
        <p className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
          {finishedPlays !== undefined && (
            <span className="inline-flex items-center gap-1">
              <Play className="w-3 h-3" aria-hidden="true" />
              {finishedPlays} {finishedPlays === 1 ? "play" : "plays"}
            </span>
          )}
          {favoriteCount !== undefined && (
            <span className="inline-flex items-center gap-1">
              <Star className="w-3 h-3" aria-hidden="true" />
              {favoriteCount}
            </span>
          )}
        </p>
      )}
    </li>
  );
}
