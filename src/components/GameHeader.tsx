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
}: GameHeaderProps) {
  const isMinimal = variant === "minimal";
  return (
    <header className={`flex items-center w-full mx-auto py-3 gap-2 ${isMinimal ? "max-w-[840px] px-3 md:px-0" : "max-w-lg px-2"}`}>
      <Link to="/" className="active:scale-95 transition-transform shrink-0" aria-label="Home">
        <img
          src={todaysLogo()}
          alt="Rainbow Categories"
          // The minimal (homepage) header only has 3 icons, so the logo has
          // room to stay full-size past ~480px; below that it scales down
          // (aspect ratio preserved via width:auto) so the header never
          // horizontally overflows even at a 320px viewport. The default
          // (archive) header keeps its original fixed size unchanged.
          className={isMinimal ? "h-[clamp(14px,5.8vw,28px)] w-auto" : undefined}
          style={isMinimal ? undefined : { maxHeight: "28px", width: "auto" }}
        />
      </Link>

      <div className="ml-auto flex items-center gap-1 shrink-0">
        {showHint && (
          <button
            onClick={onHintClick}
            className="p-2.5 rounded-lg hover:bg-secondary transition-colors active:scale-95"
            aria-label="Get a hint"
          >
            <Lightbulb className="w-5 h-5 text-slate" />
          </button>
        )}
        <button
          onClick={onStatsClick}
          className="p-2.5 rounded-lg hover:bg-secondary transition-colors active:scale-95"
          aria-label="My stats"
        >
          <BarChart3 className="w-5 h-5 text-slate" />
        </button>
        {!isMinimal && (
          <button
            onClick={onHowToPlayClick}
            className="p-2.5 rounded-lg hover:bg-secondary transition-colors active:scale-95"
            aria-label="How to play"
          >
            <BookOpen className="w-5 h-5 text-slate" />
          </button>
        )}
        {!isMinimal && (
          <Link
            to="/archive"
            className="p-2.5 rounded-lg hover:bg-secondary transition-colors active:scale-95"
            aria-label="Puzzle archive"
          >
            <Archive className="w-5 h-5 text-slate" />
          </Link>
        )}
        {onSettingsClick && (
          <button
            onClick={onSettingsClick}
            className="p-2.5 rounded-lg hover:bg-secondary transition-colors active:scale-95"
            aria-label={isMinimal ? "Settings and menu" : "Settings"}
          >
            <Settings className="w-5 h-5 text-slate" />
          </button>
        )}
        {!isMinimal && <PlayerAuth user={user} onSignOut={onSignOut} />}
      </div>
    </header>
  );
}
