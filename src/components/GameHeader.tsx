import { BarChart3, Lightbulb, BookOpen, Archive, Calendar, Settings } from "lucide-react";
import { Link } from "react-router-dom";
import { PlayerAuth } from "./PlayerAuth";
import { todaysLogo, isJuly4 } from "@/lib/themes";
import type { User as AuthUser } from "@supabase/supabase-js";

const STACKED_LOGO = "/rainbow-connect-logo-stacked.png";

interface GameHeaderProps {
  onStatsClick: () => void;
  onHowToPlayClick: () => void;
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
  const iconGlyphClass = hideExtraIcons ? "w-[30px] h-[30px]" : "w-4 h-4 sm:w-5 sm:h-5 text-slate";
  const iconStrokeWidth = hideExtraIcons ? 2.5 : undefined;
  return (
    <header className={`flex items-center w-full mx-auto py-3 gap-0.5 sm:gap-2 ${isWide ? "max-w-[840px] px-2 sm:px-3 md:px-0" : "max-w-lg px-1.5 sm:px-2"}`}>
      <Link to="/" className="active:scale-95 transition-transform shrink-0" aria-label="Home">
        {isJuly4() ? (
          // Holiday override applies to both sizes — there's no stacked
          // variant of the flag logo, so it isn't part of the mobile/desktop
          // swap below; this one <img> just keeps today's existing behavior.
          <img src={todaysLogo()} alt="Rainbow Connect" className="h-[clamp(11px,4.3vw,40px)] w-auto" />
        ) : (
          <>
            <img
              src={todaysLogo()}
              alt="Rainbow Connect"
              // Scales down at narrow viewports (aspect ratio preserved via
              // width:auto) — the floor/vw-coefficient are tuned against the
              // tightest real case: Daily's "minimal" 4-icon header (hint,
              // stats, calendar, settings) at 320px, now that those icons are
              // full 44x44px tap targets rather than the old ~36px ones —
              // so the header never horizontally overflows there. The
              // 28px→40px ceiling bump only matters well past mobile: every
              // header hits its own max-width (840px when isWide, 512px
              // otherwise) long before 40px-tall renders, so this just stops
              // the logo from staying capped at a comparatively tiny 28px on
              // desktop, where there was hundreds of pixels of unused gap
              // before the icons.
              // Hidden at lg+ in favor of the stacked wordmark below — md/tablet
              // widths keep this one-line logo, since a tablet-sized header
              // still reads as "mobile/tablet" for this design.
              className="block lg:hidden h-[clamp(11px,4.3vw,40px)] w-auto"
            />
            {/* Desktop-only stacked two-line wordmark ("Rainbow" / "Connect"),
                shown from lg (1024px) up. Fixed height rather than fluid —
                unlike the mobile logo, desktop headers don't have the same
                narrow-viewport pressure, and a fixed cap keeps it from ever
                reading as oversized on very wide screens. */}
            <img
              src={STACKED_LOGO}
              alt="Rainbow Connect"
              className="hidden lg:block h-14 w-auto"
            />
          </>
        )}
      </Link>

      <div className={`ml-auto flex items-center shrink-0 ${hideExtraIcons ? "gap-0.5 sm:gap-1.5" : "gap-0 sm:gap-1"}`}>
        {showHint && (
          <button
            onClick={onHintClick}
            className={iconButtonClass}
            aria-label="Get a hint"
          >
            <Lightbulb className={iconGlyphClass} strokeWidth={iconStrokeWidth} />
          </button>
        )}
        <button
          onClick={onStatsClick}
          className={iconButtonClass}
          aria-label="My stats"
        >
          <BarChart3 className={iconGlyphClass} strokeWidth={iconStrokeWidth} />
        </button>
        {/* Daily-homepage-only: the "minimal" variant's own dedicated
            Archive icon (a calendar, not the box-shaped Archive icon used
            below on the default variant) — Archive/ArchivePuzzle already
            have their own in-page Archive navigation, so this is scoped to
            isMinimal specifically rather than the shared hideExtraIcons
            flag, to avoid a redundant/self-linking icon on those pages. */}
        {isMinimal && (
          <Link
            to="/archive"
            className={iconButtonClass}
            aria-label="Puzzle archive"
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
            to="/archive"
            className="p-1 sm:p-2.5 rounded-full hover:bg-secondary transition-colors active:scale-95"
            aria-label="Puzzle archive"
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
