import { BarChart3, Lightbulb, BookOpen, Archive, Settings } from "lucide-react";
import { Link } from "react-router-dom";
import { PlayerAuth } from "./PlayerAuth";
import { todaysLogo } from "@/lib/themes";
import type { User as AuthUser } from "@supabase/supabase-js";

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
}: GameHeaderProps) {
  const isMinimal = variant === "minimal";
  const hideExtraIcons = isMinimal || simplifiedIcons;
  // The 3-icon case (Daily's "minimal" header and ArchivePuzzle's
  // simplifiedIcons) has plenty of room even at 320px, so those icons get a
  // bigger, constant (non-responsive) touch target — a real 34-38px circular
  // tap area with an 18-20px glyph, per the polish request. The default
  // variant's larger icon set (Archive calendar, FreePuzzle: up to 5-6
  // icons) keeps the tighter, breakpoint-scaled sizing that was specifically
  // tuned to avoid header overflow at narrow widths with that many icons.
  const iconButtonClass = hideExtraIcons
    ? "p-2 rounded-full hover:bg-secondary transition-colors active:scale-95"
    : "p-1 sm:p-2.5 rounded-full hover:bg-secondary transition-colors active:scale-95";
  const iconGlyphClass = hideExtraIcons
    ? "w-5 h-5 text-slate"
    : "w-4 h-4 sm:w-5 sm:h-5 text-slate";
  return (
    <header className={`flex items-center w-full mx-auto py-3 gap-1 sm:gap-2 ${isMinimal ? "max-w-[840px] px-3 md:px-0" : "max-w-lg px-1.5 sm:px-2"}`}>
      <Link to="/" className="active:scale-95 transition-transform shrink-0" aria-label="Home">
        <img
          src={todaysLogo()}
          alt="Rainbow Connect"
          // Scales down at narrow viewports (aspect ratio preserved via
          // width:auto) — the floor/vw-coefficient are tuned against the
          // tightest case (FreePuzzle's full 6-icon header at 320px) so the
          // header never horizontally overflows there. The 28px→40px ceiling
          // bump only matters well past mobile: every variant's header hits
          // its own max-width (840px minimal / 512px default) long before
          // 40px-tall renders, so this just stops the logo from staying
          // capped at a comparatively tiny 28px on desktop, where there was
          // hundreds of pixels of unused gap before the icons.
          className="h-[clamp(14px,5.8vw,40px)] w-auto"
        />
      </Link>

      <div className={`ml-auto flex items-center shrink-0 ${hideExtraIcons ? "gap-1.5 sm:gap-2" : "gap-0 sm:gap-1"}`}>
        {showHint && (
          <button
            onClick={onHintClick}
            className={iconButtonClass}
            aria-label="Get a hint"
          >
            <Lightbulb className={iconGlyphClass} />
          </button>
        )}
        <button
          onClick={onStatsClick}
          className={iconButtonClass}
          aria-label="My stats"
        >
          <BarChart3 className={iconGlyphClass} />
        </button>
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
            <Settings className={iconGlyphClass} />
          </button>
        )}
        {!hideExtraIcons && <PlayerAuth user={user} onSignOut={onSignOut} />}
      </div>
    </header>
  );
}
