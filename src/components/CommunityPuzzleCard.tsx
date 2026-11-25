import { Link } from "react-router-dom";
import { Bookmark, Star, Play } from "lucide-react";
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
  /**
   * The Community layout (preview): a bookmark at the top right, the type badge
   * beside the counts, and a violet byline linking to the creator page's
   * Community view. Omitted everywhere else, which renders exactly as before.
   */
  community?: {
    bookmark?: { saved: boolean; onToggle: () => void };
  };
}

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card";
/** Violet bylines, from the approved archive design's link colour; lighter in dark mode for contrast. */
export const communityLink = "font-semibold text-violet-700 underline-offset-2 hover:underline dark:text-violet-300";

function Counts({ finishedPlays, favoriteCount, labelled = false }: { finishedPlays?: number; favoriteCount?: number; labelled?: boolean }) {
  if (finishedPlays === undefined && favoriteCount === undefined) return null;
  return (
    <span className="inline-flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
      {finishedPlays !== undefined && (
        <span className="inline-flex items-center gap-1">
          <Play className="w-3 h-3" aria-hidden="true" />
          {finishedPlays} {finishedPlays === 1 ? "play" : "plays"}
        </span>
      )}
      {favoriteCount !== undefined && (
        <span className="inline-flex items-center gap-1">
          <Star className="w-3 h-3" aria-hidden="true" />
          {labelled && <span className="sr-only">Favorites: </span>}
          {favoriteCount}
        </span>
      )}
    </span>
  );
}

/**
 * One custom puzzle in a list (creator page, Favorites, Community). The title is
 * the link; the shared type badge sits beside it rather than inside it, since
 * the badge is itself a button.
 */
export function CommunityPuzzleCard({
  title,
  shortCode,
  mode,
  designerName,
  creatorSlug,
  finishedPlays,
  favoriteCount,
  community,
}: CommunityPuzzleCardProps) {
  const titleLink = (
    <Link
      to={`/p/${shortCode}`}
      className="min-w-0 font-tile font-semibold text-lg text-foreground break-words hover:text-primary
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
    >
      {title}
    </Link>
  );

  if (community) {
    const bookmark = community.bookmark;
    return (
      <li className="rounded-xl border border-border bg-card p-4 pr-2 flex flex-col gap-2 min-w-0" data-testid="community-card">
        <div className="flex items-start justify-between gap-1">
          <div className="min-w-0 pt-1.5">{titleLink}</div>
          {bookmark && (
            <button
              type="button"
              onClick={bookmark.onToggle}
              aria-pressed={bookmark.saved}
              aria-label={`Save ${title} to Favorites`}
              title={bookmark.saved ? "Saved to Favorites" : "Save to Favorites"}
              className={`-mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-secondary ${focusRing}
                ${bookmark.saved ? "text-violet-700 dark:text-violet-300" : "text-muted-foreground"}`}
            >
              <Bookmark aria-hidden="true" className="h-5 w-5" strokeWidth={2.25} fill={bookmark.saved ? "currentColor" : "none"} />
            </button>
          )}
        </div>
        {designerName && (
          <p className="pr-2 text-sm text-muted-foreground break-words">
            by{" "}
            {creatorSlug ? (
              <Link to={`/creator/${creatorSlug}?view=community`} className={`${communityLink} rounded-sm ${focusRing}`}>
                {designerName}
              </Link>
            ) : (
              designerName
            )}
          </p>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 pr-2">
          <PuzzleModeBadge isRainbow={mode === "rainbow"} />
          <Counts finishedPlays={finishedPlays} favoriteCount={favoriteCount} labelled />
        </div>
      </li>
    );
  }

  return (
    <li className="rounded-xl border border-border bg-card p-4 flex flex-col gap-2 min-w-0">
      <div className="flex items-start justify-between gap-2">
        {titleLink}
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
