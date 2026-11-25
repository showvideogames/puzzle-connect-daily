import { Link } from "react-router-dom";
import { Bookmark } from "lucide-react";
import { PuzzleCover } from "./PuzzleCover";
import { CreatorCoverArt } from "./CreatorCoverArt";
import type { CreatorCover } from "@/lib/creatorCover";
import { coverFor, coverTone } from "@/lib/puzzleCovers";
import type { CustomPuzzleMode } from "@/lib/customPuzzles";
import { cv } from "@/lib/communityStyle";

export interface ExploreCard {
  title: string;
  shortCode: string;
  mode: CustomPuzzleMode;
  creatorName: string;
  creatorSlug: string | null;
  finishedPlays?: number;
  /** The creator's own cover (one emoji, one background), or none. */
  cover?: CreatorCover | null;
}

/**
 * Which art a card shows. "creator": the puzzle's own stored cover (or the
 * neutral default), on every card players browse. "editorial": the
 * hand-illustrated scenes, only where an admin placed the puzzle (Featured,
 * Editor's Picks). Creators never choose editorial art.
 */
export type CardArt = "creator" | "editorial";

export interface BookmarkState {
  saved: boolean;
  onToggle: () => void;
}

const playPath = (code: string) => `/p/${code}`;

function BookmarkButton({ title, bookmark, className = "" }: { title: string; bookmark: BookmarkState; className?: string }) {
  return (
    <button
      type="button"
      onClick={bookmark.onToggle}
      aria-pressed={bookmark.saved}
      aria-label={`Save ${title} to Favorites`}
      title={bookmark.saved ? "Saved to Favorites" : "Save to Favorites"}
      className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-violet-50 dark:hover:bg-white/10 ${cv.focus} ${className}
        ${bookmark.saved ? "text-violet-700 dark:text-violet-300" : "text-[#2b0a5e] dark:text-violet-100"}`}
    >
      <Bookmark aria-hidden="true" className="h-[22px] w-[22px]" strokeWidth={2.25} fill={bookmark.saved ? "currentColor" : "none"} />
    </button>
  );
}

/** "by Name", linked (violet) to the creator page's Community view when they have a public profile. */
export function Byline({ name, slug, className = "", onTone = false }: { name: string; slug: string | null; className?: string; onTone?: boolean }) {
  return (
    <p className={`min-w-0 break-words text-sm ${onTone ? "text-[#3d3550] dark:text-violet-100/80" : "text-muted-foreground"} ${className}`}>
      by{" "}
      {slug ? <Link to={`/creator/${slug}?view=community`} className={`${cv.link} rounded-sm ${cv.focus}`}>{name}</Link> : <span className="font-semibold">{name}</span>}
    </p>
  );
}

function PlayLink({ card, label = "Play", size = "md" }: { card: ExploreCard; label?: string; size?: "md" | "lg" }) {
  return (
    <Link
      to={playPath(card.shortCode)}
      aria-label={`${label} ${card.title}`}
      className={`inline-flex items-center justify-center whitespace-nowrap rounded-full font-extrabold transition-colors active:scale-95 ${cv.play} ${cv.focus}
        ${size === "lg" ? "h-11 px-6 text-base max-[359px]:px-4" : "h-10 px-5 text-sm"}`}
    >
      {label}
    </Link>
  );
}

/** The cover is a pointer shortcut to the same puzzle; keyboards use the title or Play. */
function CoverLink({ card, className, art = "creator" }: { card: ExploreCard; className: string; art?: CardArt }) {
  return (
    <Link to={playPath(card.shortCode)} tabIndex={-1} aria-hidden="true" className={`block overflow-hidden ${className}`}>
      {art === "editorial"
        ? <PuzzleCover cover={coverFor(card.shortCode)} className="h-full w-full" />
        : <CreatorCoverArt cover={card.cover} className="h-full w-full" />}
    </Link>
  );
}

function TitleLink({ card, className = "" }: { card: ExploreCard; className?: string }) {
  return (
    <Link to={playPath(card.shortCode)} data-testid="card-title" className={`min-w-0 break-words font-extrabold leading-tight ${cv.ink} hover:underline rounded-sm ${cv.focus} ${className}`}>
      {card.title}
    </Link>
  );
}

const plays = (n?: number) => (n ? `${n} ${n === 1 ? "play" : "plays"}` : null);

/** One compact, human-chosen Featured Puzzle: tone panel, title, credit, Play, and its cover. */
export function FeaturedCard({ card, bookmark }: { card: ExploreCard; bookmark?: BookmarkState }) {
  const tone = coverTone(coverFor(card.shortCode));
  return (
    <section aria-labelledby="featured-heading" data-testid="featured-puzzle" className="mt-5">
      <div
        className="relative grid grid-cols-[minmax(0,1fr)_38%] max-[359px]:grid-cols-[minmax(0,1fr)_28%] overflow-hidden rounded-3xl sm:grid-cols-[minmax(0,1fr)_44%] [background:var(--tone-light)] dark:[background:var(--tone-dark)]"
        style={{ ["--tone-light" as string]: tone.light, ["--tone-dark" as string]: tone.dark }}
      >
        <div className="flex min-w-0 flex-col items-start gap-1 p-4 pr-2 sm:p-6">
          <h2 id="featured-heading" className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-violet-800 dark:text-violet-200">Featured Puzzle</h2>
          <TitleLink card={card} className="text-[26px] sm:text-[34px]" />
          <Byline name={card.creatorName} slug={card.creatorSlug} onTone />
          <div className="mt-2.5 flex items-center gap-1">
            <PlayLink card={card} label="Play Puzzle" size="lg" />
            {bookmark && <BookmarkButton title={card.title} bookmark={bookmark} />}
          </div>
        </div>
        <CoverLink card={card} art="editorial" className="h-full min-h-[168px]" />
      </div>
    </section>
  );
}

/** A shelf cover card (Editor's Picks, Following, Favorites, search). */
export function CoverCard({ card, bookmark, art = "creator" }: { card: ExploreCard; bookmark?: BookmarkState; art?: CardArt }) {
  return (
    <li className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card" data-testid="community-card">
      <CoverLink card={card} art={art} className="aspect-[16/10] w-full max-[359px]:aspect-[2/1]" />
      <div className="flex flex-1 flex-col gap-0.5 p-3 pt-2.5">
        <div className="flex items-start justify-between gap-1">
          <TitleLink card={card} className="pt-2 text-[17px]" />
          {bookmark && <BookmarkButton title={card.title} bookmark={bookmark} className="-mr-2" />}
        </div>
        <Byline name={card.creatorName} slug={card.creatorSlug} className="-mt-1" />
        <div className="mt-auto flex items-center gap-2 pt-2.5">
          <PlayLink card={card} />
          {plays(card.finishedPlays) && <span className="text-xs text-muted-foreground tabular-nums">{plays(card.finishedPlays)}</span>}
        </div>
      </div>
    </li>
  );
}

/**
 * A Newest row: small cover, title, credit, Play, bookmark. Below 380px Play
 * moves under the credit so the title keeps room (only one Play is displayed).
 */
export function NewestRow({ card, bookmark }: { card: ExploreCard; bookmark?: BookmarkState }) {
  return (
    <li className="flex min-w-0 items-center gap-3 py-3" data-testid="community-card">
      <CoverLink card={card} className="h-[56px] w-[76px] shrink-0 rounded-xl min-[380px]:h-[60px] min-[380px]:w-[84px] sm:h-[68px] sm:w-[104px]" />
      <div className="min-w-0 flex-1">
        <TitleLink card={card} className="block text-base sm:text-[17px]" />
        <Byline name={card.creatorName} slug={card.creatorSlug} />
        <div className="mt-1.5 min-[380px]:hidden"><PlayLink card={card} /></div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <div className="max-[379px]:hidden"><PlayLink card={card} /></div>
        {bookmark && <BookmarkButton title={card.title} bookmark={bookmark} className="-mr-2" />}
      </div>
    </li>
  );
}
