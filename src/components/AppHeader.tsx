import { BarChart3, Calendar, Lightbulb, Settings } from "lucide-react";
import { Link } from "react-router-dom";
import type { User as AuthUser } from "@supabase/supabase-js";
import { PlayerAuth } from "./PlayerAuth";
import { AppMenuDrawer, HEADER_STROKE, headerGlyph, headerIconButton } from "./AppMenuDrawer";
import { todaysLogo } from "@/lib/themes";
import { gameCatalog } from "@/lib/gameCatalog";

/** The 3×3 rainbow grid: the game catalog's own Rainbow icon, which is also the home-screen icon. */
const BRAND_ICON = gameCatalog.find((game) => game.id === "rainbow")!.iconSrc;

interface AppHeaderProps {
  user: AuthUser | null;
  onSignOut: () => void;
  /** Omit on pages with no stats to show, and the stats button is not rendered. */
  onStats?: () => void;
  /** Omit on pages with no settings to open, and the settings button is not rendered. */
  onSettings?: () => void;
  onFeedback: () => void;
  /** A puzzle in play: a hint button leads the right-hand group, before stats. */
  onHint?: () => void;
  /** Where the calendar goes. A Mini page leads to the Mini archive. */
  archivePath?: string;
  archiveLabel?: string;
  /** The game pages' Settings also carries their menu links, and says so. */
  settingsLabel?: string;
  /** Off where the page has never shown a profile control (signed-out game pages). */
  showProfile?: boolean;
  /** The game pages: the board's 840px width, and only a small gap above the board. */
  game?: boolean;
}

/**
 * The Rainbow app header, the same bar on every page: menu and brand on the
 * left; hint (on a puzzle), stats, archive, settings and the profile picture
 * on the right, with the profile last at the far edge. Archive is a plain
 * calendar. How to Play lives in the menu, so there is no book icon.
 *
 * Fit: six 44px targets plus gaps need about 278px. A 320px phone gives the
 * card about 282px inside, but a narrow desktop window loses ~15px to its
 * scrollbar, so below 360px the gaps and card padding tighten (saving 14px)
 * while every target stays 44px. A hint makes seven targets when the profile
 * picture shows too, which needs about 320px inside the card: below 375px the
 * calendar steps aside then (the archive stays in the menu). The one-line
 * wordmark (8:1) only appears from md up; below that the square icon stands in.
 */
export function AppHeader({
  user,
  onSignOut,
  onStats,
  onSettings,
  onFeedback,
  onHint,
  archivePath = "/archive",
  archiveLabel = "Puzzle archive",
  settingsLabel = "Settings",
  showProfile = true,
  game = false,
}: AppHeaderProps) {
  const crowded = !!onHint && showProfile && !!user;
  return (
    <header className={`w-full mx-auto px-3 ${game ? "max-w-[840px] mb-1 md:mb-2" : "max-w-2xl mb-4"}`} data-testid="app-header">
      <div className="flex h-14 md:h-16 items-center gap-1 max-[359px]:gap-0.5 rounded-2xl border border-border bg-card px-1.5 max-[359px]:px-1 sm:px-2 md:px-3 shadow-sm">
        <AppMenuDrawer onFeedback={onFeedback} />
        <Link
          to="/"
          aria-label="Home"
          className="inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded-xl active:scale-95 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card md:px-1"
        >
          {/* The app icon is a lavender tile around the grid. Cropped to the
              grid's own black frame (19px in on the 192px file) so it reads as
              the brand mark, as in the header concept, not as a phone icon. */}
          <span className="relative block h-10 w-10 overflow-hidden rounded-[6px] md:hidden" data-testid="brand-icon">
            <img src={BRAND_ICON} alt="" aria-hidden="true" width={50} height={50} className="absolute -left-[5px] -top-[5px] h-[50px] w-[50px] max-w-none" />
          </span>
          <img src={todaysLogo()} alt="" aria-hidden="true" className="hidden md:block h-[34px] w-auto" data-testid="brand-wordmark" />
        </Link>

        <div className="ml-auto flex shrink-0 items-center gap-0.5 max-[359px]:gap-0 sm:gap-1.5">
          {onHint && (
            <button type="button" onClick={onHint} className={headerIconButton} aria-label="Get a hint">
              <Lightbulb aria-hidden="true" className={headerGlyph} strokeWidth={HEADER_STROKE} />
            </button>
          )}
          {onStats && (
            <button type="button" onClick={onStats} className={headerIconButton} aria-label="My stats">
              <BarChart3 aria-hidden="true" className={headerGlyph} strokeWidth={HEADER_STROKE} />
            </button>
          )}
          <Link to={archivePath} className={`${headerIconButton} ${crowded ? "max-[374px]:hidden" : ""}`} aria-label={archiveLabel}>
            <Calendar aria-hidden="true" className={headerGlyph} strokeWidth={HEADER_STROKE} />
          </Link>
          {onSettings && (
            <button type="button" onClick={onSettings} className={headerIconButton} aria-label={settingsLabel}>
              <Settings aria-hidden="true" className={headerGlyph} strokeWidth={HEADER_STROKE} />
            </button>
          )}
          {showProfile && (
            <div className="inline-flex h-11 min-w-11 shrink-0 items-center justify-center empty:hidden" data-testid="header-profile">
              <PlayerAuth user={user} onSignOut={onSignOut} profileMenu />
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
