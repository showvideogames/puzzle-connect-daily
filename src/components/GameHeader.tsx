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
  return (
    <header className={`flex items-center w-full mx-auto py-3 gap-1 sm:gap-2 ${isMinimal ? "max-w-[840px] px-3 md:px-0" : "max-w-lg px-1.5 sm:px-2"}`}>
      <Link to="/" className="active:scale-95 transition-transform shrink-0" aria-label="Home">
        <img
          src={todaysLogo()}
          alt="Rainbow Categories"
          // Scales down at narrow viewports (aspect ratio preserved via
          // width:auto), capping at 28px tall once there's room — applies to
          // both variants so the header never horizontally overflows at a
          // 320px viewport, whether it's the homepage's 3 icons or the
          // default variant's larger icon set (archive/free-puzzle pages).
          className="h-[clamp(14px,5.8vw,28px)] w-auto"
        />
      </Link>

      <div className="ml-auto flex items-center gap-0 sm:gap-1 shrink-0">
        {showHint && (
          <button
            onClick={onHintClick}
            className="p-1 sm:p-2.5 rounded-lg hover:bg-secondary transition-colors active:scale-95"
            aria-label="Get a hint"
          >
            <Lightbulb className="w-4 h-4 sm:w-5 sm:h-5 text-slate" />
          </button>
        )}
        <button
          onClick={onStatsClick}
          className="p-1 sm:p-2.5 rounded-lg hover:bg-secondary transition-colors active:scale-95"
          aria-label="My stats"
        >
          <BarChart3 className="w-4 h-4 sm:w-5 sm:h-5 text-slate" />
        </button>
        {!hideExtraIcons && (
          <button
            onClick={onHowToPlayClick}
            className="p-1 sm:p-2.5 rounded-lg hover:bg-secondary transition-colors active:scale-95"
            aria-label="How to play"
          >
            <BookOpen className="w-4 h-4 sm:w-5 sm:h-5 text-slate" />
          </button>
        )}
        {!hideExtraIcons && (
          <Link
            to="/archive"
            className="p-1 sm:p-2.5 rounded-lg hover:bg-secondary transition-colors active:scale-95"
            aria-label="Puzzle archive"
          >
            <Archive className="w-4 h-4 sm:w-5 sm:h-5 text-slate" />
          </Link>
        )}
        {onSettingsClick && (
          <button
            onClick={onSettingsClick}
            className="p-1 sm:p-2.5 rounded-lg hover:bg-secondary transition-colors active:scale-95"
            aria-label={hideExtraIcons ? "Settings and menu" : "Settings"}
          >
            <Settings className="w-4 h-4 sm:w-5 sm:h-5 text-slate" />
          </button>
        )}
        {!hideExtraIcons && <PlayerAuth user={user} onSignOut={onSignOut} />}
      </div>
    </header>
  );
}
