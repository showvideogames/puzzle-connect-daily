import { BarChart3, Lightbulb, BookOpen, Archive, Calendar, Settings } from "lucide-react";
import { Link } from "react-router-dom";
import { PlayerAuth } from "./PlayerAuth";
import { todaysLogo, isJuly4 } from "@/lib/themes";
import { FULL_FORMAT, type PuzzleFormat } from "@/lib/puzzleFormat";
import type { User as AuthUser } from "@supabase/supabase-js";

const STACKED_LOGO = "/rainbow-connect-logo-stacked.png";

interface GameHeaderProps {
  /** Omit on pages with no stats to show, and the stats icon is not rendered. */
  onStatsClick?: () => void;
  onHowToPlayClick?: () => void;
  onSettingsClick?: () => void;
  onHintClick?: () => void;
  showHint?: boolean;
  user: AuthUser | null;
  onSignOut: () => void;
  // "minimal" is the redesigned daily-homepage header: exactly 3 icons (hint,
  // stats, gear) at the wider board-matching width. How to Play, Archive, and
  // Account move into the Settings modal's new Menu section on that variant.
  variant?: "default" | "minimal";
  // Hides the same How to Play / Archive / Account icons as "minimal" (down
  // to hint/stats/settings), but keeps the "default" variant's width —
  // for pages like ArchivePuzzle that want Daily's simplified icon set
  // without the wider homepage board layout. Pair with SettingsModal's
  // showMenuLinks so those items are still reachable from Settings.
  simplifiedIcons?: boolean;
  // Widens the header to the same max-w-[840px] the "minimal" variant uses
  // — WIDTH only, independent of icon set. Deliberately separate from
  // `variant`: ArchivePuzzle wants the wider, board-matching header but
  // NOT `variant="minimal"`'s own Calendar/Archive icon, which would
  // duplicate the page's own "← Archive" nav button just below. Pair with
  // simplifiedIcons there to widen without adding that icon.
  wideHeader?: boolean;
  /**
   * Which game this header belongs to. Its only effect is WHERE the calendar
   * icon and the Settings menu's archive link point — a header on a Mini page
   * must lead to the Mini archive, not the Full one.
   *
   * Defaults to Full, so every existing call site is unchanged. Nothing about
   * the layout, icon count, sizing or tap targets varies by format: this adds
   * no control and removes none.
   */
  format?: PuzzleFormat;
}

export function GameHeader({
  onStatsClick,
  onHowToPlayClick,
  onSettingsClick,
  onHintClick,
  showHint = false,
  user,
  onSignOut,
  variant = "default",
  simplifiedIcons = false,
  wideHeader = false,
  format = FULL_FORMAT,
}: GameHeaderProps) {
  const isMinimal = variant === "minimal";
  const hideExtraIcons = isMinimal || simplifiedIcons;
  const isWide = isMinimal || wideHeader;
  // The 3/4-icon case (Daily's "minimal" header and ArchivePuzzle's/
  // Archive's simplifiedIcons) is the only one any page actually uses today
  // — the full (up to 5-6 icon) default variant isn't used anywhere (the
  // former last consumer, a standalone FreePuzzle page, was consolidated
  // into ArchivePuzzle/simplifiedIcons). A real 44x44px tap target with a
  // visibly larger, bolder 30px glyph, per the "obviously clickable" polish
  // request — a fixed size at every breakpoint, since the touch-target
  // minimum matters most on the narrow phones that already fit it fine (see
  // the responsive logo sizing this pairs with, below). The default
  // variant's own tighter, breakpoint-scaled sizing is untouched in case a
  // future page needs the full icon set.
  const iconButtonClass = hideExtraIcons
    ? "w-11 h-11 flex items-center justify-center shrink-0 rounded-full text-slate hover:bg-secondary hover:text-foreground active:scale-95 active:bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    : "p-1 sm:p-2.5 rounded-full hover:bg-secondary transition-colors active:scale-95";
  // Phones get a 24px glyph inside the 44px target so the logo can be the
  // dominant element; sm+ keeps the larger 30px glyph.
  const iconGlyphClass = hideExtraIcons ? "w-6 h-6 sm:w-[30px] sm:h-[30px]" : "w-4 h-4 sm:w-5 sm:h-5 text-slate";
  const iconStrokeWidth = hideExtraIcons ? 2.5 : undefined;
  return (
    <header className={`flex items-center w-full mx-auto py-3 gap-0.5 sm:gap-2 ${isWide ? "max-w-[840px] px-2 sm:px-3 md:px-0" : "max-w-lg px-1.5 sm:px-2"}`}>
      <Link to="/" className="active:scale-95 transition-transform shrink-0" aria-label="Home">
        {isJuly4() ? (
          // Holiday override applies to both sizes — there's no stacked
          // variant of the flag logo, so it isn't part of the mobile/desktop
          // swap below; this one <img> just keeps today's existing behavior.
          <img src={todaysLogo()} alt="Rainbow Connect" className="h-[clamp(11px,3.7vw,40px)] min-[360px]:h-[clamp(11px,4.3vw,40px)] w-auto" />
        ) : (
          <>
            {/* Logo sizing. The one-line wordmark is ~8.4:1, so at any
                legible height it is far wider than a phone header can spare
                (3-4 44px tap targets plus the Create pill leave ~100px at
                320px). Below md the header therefore uses the compact stacked
                wordmark (~2.4:1) at 32px tall (about 77px wide), which fits at
                every width down to 320px while staying the dominant element.
                md-lg uses the one-line wordmark at 36px; lg+ keeps the larger
                stacked wordmark. Aspect ratio is always preserved (w-auto). */}
            <img
              src={STACKED_LOGO}
              alt="Rainbow Connect"
              className="block md:hidden lg:block w-[128px] max-w-none shrink-0 h-auto lg:w-auto lg:h-14"
            />
            <img
              src={todaysLogo()}
              alt="Rainbow Connect"
              className="hidden md:block lg:hidden h-9 w-auto"
            />
          </>
        )}
      </Link>

      <div className={`ml-auto flex items-center shrink-0 ${hideExtraIcons ? "gap-1 sm:gap-1.5" : "gap-0 sm:gap-1"}`}>
        {/* Every header tap target stays 44x44. Daily's 4-icon header cannot fit
            that plus the logo below ~430px, so there the Calendar icon is
            hidden (Archive stays one tap away in Settings > Menu). */}
        {/* Desktop-only (sm+, 640px): phones drop the pill so the logo and the
            three utility icons have room; Create stays reachable from the
            page-level "Create Your Own" CTA and Settings > Menu. Prominent but
            compact: the Ink primary-button colors, a real link. */}
        <Link
          to="/create"
          aria-label="Create a puzzle"
          className="hidden sm:inline-flex items-center justify-center shrink-0 whitespace-nowrap h-9 px-3.5 mr-1
            rounded-full bg-primary text-primary-foreground hover:bg-primary/90 active:scale-95 transition
            text-sm font-bold
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          + Create a Puzzle
        </Link>
        {showHint && (
          <button
            onClick={onHintClick}
            className={iconButtonClass}
            aria-label="Get a hint"
          >
            <Lightbulb className={iconGlyphClass} strokeWidth={iconStrokeWidth} />
          </button>
        )}
        {onStatsClick && (
          <button
            onClick={onStatsClick}
            className={iconButtonClass}
            aria-label="My stats"
          >
            <BarChart3 className={iconGlyphClass} strokeWidth={iconStrokeWidth} />
          </button>
        )}
        {/* Daily-homepage-only: the "minimal" variant's own dedicated
            Archive icon (a calendar, not the box-shaped Archive icon used
            below on the default variant) — Archive/ArchivePuzzle already
            have their own in-page Archive navigation, so this is scoped to
            isMinimal specifically rather than the shared hideExtraIcons
            flag, to avoid a redundant/self-linking icon on those pages. */}
        {isMinimal && (
          <Link
            to={format.archivePath}
            className={`${iconButtonClass} max-[429px]:hidden`}
            aria-label={format.id === "full" ? "Puzzle archive" : `${format.name} puzzle archive`}
          >
            <Calendar className={iconGlyphClass} strokeWidth={iconStrokeWidth} />
          </Link>
        )}
        {!hideExtraIcons && (
          <button
            onClick={onHowToPlayClick}
            className="p-1 sm:p-2.5 rounded-full hover:bg-secondary transition-colors active:scale-95"
            aria-label="How to play"
          >
            <BookOpen className="w-4 h-4 sm:w-5 sm:h-5 text-slate" />
          </button>
        )}
        {!hideExtraIcons && (
          <Link
            to={format.archivePath}
            className="p-1 sm:p-2.5 rounded-full hover:bg-secondary transition-colors active:scale-95"
            aria-label={format.id === "full" ? "Puzzle archive" : `${format.name} puzzle archive`}
          >
            <Archive className="w-4 h-4 sm:w-5 sm:h-5 text-slate" />
          </Link>
        )}
        {onSettingsClick && (
          <button
            onClick={onSettingsClick}
            className={iconButtonClass}
            aria-label={hideExtraIcons ? "Settings and menu" : "Settings"}
          >
            <Settings className={iconGlyphClass} strokeWidth={iconStrokeWidth} />
          </button>
        )}
        {!hideExtraIcons && <PlayerAuth user={user} onSignOut={onSignOut} />}
      </div>
    </header>
  );
}
