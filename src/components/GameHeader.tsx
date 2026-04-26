import { BarChart3, HelpCircle, Archive, Settings, Lightbulb } from "lucide-react";
import { Link } from "react-router-dom";
import { PlayerAuth } from "./PlayerAuth";
import type { User as AuthUser } from "@supabase/supabase-js";
interface GameHeaderProps {
  onStatsClick: () => void;
  onHowToPlayClick: () => void;
  onSettingsClick?: () => void;
  onHintClick?: () => void;
  showHint?: boolean;
  user: AuthUser | null;
  onSignOut: () => void;
}
export function GameHeader({ onStatsClick, onHowToPlayClick, onSettingsClick, onHintClick, showHint = false, user, onSignOut }: GameHeaderProps) {
  return (
    <header className="flex items-center justify-between w-full max-w-lg mx-auto py-3 px-2">
      <Link to="/" aria-label="Home">
        <img
          src="/rainbow-categories.png"
          alt="Rainbow Categories"
          style={{ height: "52px", width: "auto" }}
        />
      </Link>
      <div className="flex items-center gap-1 shrink-0">
        {showHint && (
          <button
            onClick={onHintClick}
            className="p-2 rounded-lg hover:bg-secondary transition-colors duration-150 active:scale-95"
            aria-label="Get a hint"
          >
            <Lightbulb className="w-5 h-5 text-muted-foreground" />
          </button>
        )}
        <button
          onClick={onStatsClick}
          className="p-2 rounded-lg hover:bg-secondary transition-colors duration-150 active:scale-95"
          aria-label="My stats"
        >
          <BarChart3 className="w-5 h-5 text-muted-foreground" />
        </button>
        <button
          onClick={onHowToPlayClick}
          className="p-2 rounded-lg hover:bg-secondary transition-colors duration-150 active:scale-95"
          aria-label="How to play"
        >
          <HelpCircle className="w-5 h-5 text-muted-foreground" />
        </button>
        <Link
          to="/archive"
          className="p-2 rounded-lg hover:bg-secondary transition-colors duration-150 active:scale-95"
          aria-label="Puzzle archive"
        >
          <Archive className="w-5 h-5 text-muted-foreground" />
        </Link>
        <button
          onClick={onSettingsClick}
          className="p-2 rounded-lg hover:bg-secondary transition-colors duration-150 active:scale-95"
          aria-label="Settings"
        >
          <Settings className="w-5 h-5 text-muted-foreground" />
        </button>
        <PlayerAuth user={user} onSignOut={onSignOut} />
      </div>
    </header>
  );
}
