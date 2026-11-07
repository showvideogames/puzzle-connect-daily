import { Archive, BarChart3, Settings } from "lucide-react";
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
  onStats: () => void;
  onSettings: () => void;
  onFeedback: () => void;
}

/**
 * The Rainbow app header for the secondary pages: menu and brand on the left;
 * stats, archive, profile and settings on the right, in the header concept's
 * order. How to Play lives in the menu now, so there is no book icon.
 *
 * Fit: at 320px the card's inside is about 282px, and six 44px targets with
 * their gaps take about 274px, so nothing scrolls sideways. The one-line
 * wordmark (8:1) only appears from md up; below that the square icon stands in.
 */
export function AppHeader({ user, onSignOut, onStats, onSettings, onFeedback }: AppHeaderProps) {
  return (
    <header className="w-full max-w-2xl mx-auto px-3 mb-4" data-testid="app-header">
      <div className="flex h-14 md:h-16 items-center gap-1 rounded-2xl border border-border bg-card px-1.5 sm:px-2 md:px-3 shadow-sm">
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

        <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1.5">
          <button type="button" onClick={onStats} className={headerIconButton} aria-label="My stats">
            <BarChart3 aria-hidden="true" className={headerGlyph} strokeWidth={HEADER_STROKE} />
          </button>
          <Link to="/archive" className={headerIconButton} aria-label="Puzzle archive">
            <Archive aria-hidden="true" className={headerGlyph} strokeWidth={HEADER_STROKE} />
          </Link>
          <div className="inline-flex h-11 min-w-11 shrink-0 items-center justify-center empty:hidden" data-testid="header-profile">
            <PlayerAuth user={user} onSignOut={onSignOut} profileMenu />
          </div>
          <button type="button" onClick={onSettings} className={headerIconButton} aria-label="Settings">
            <Settings aria-hidden="true" className={headerGlyph} strokeWidth={HEADER_STROKE} />
          </button>
        </div>
      </div>
    </header>
  );
}
