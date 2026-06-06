import { useState } from "react";
import { BarChart3, Lightbulb, Menu, X, BookOpen, Archive, Settings } from "lucide-react";
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

export function GameHeader({
  onStatsClick,
  onHowToPlayClick,
  onSettingsClick,
  onHintClick,
  showHint = false,
  user,
  onSignOut,
}: GameHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  const drawerItemClass =
    "flex items-center gap-3 w-full px-5 py-3 text-sm font-medium hover:bg-secondary transition-colors active:scale-95 text-left";

  return (
    <>
      <header className="relative flex items-center w-full max-w-lg mx-auto py-3 px-2">
        {/* Left: hamburger */}
        <button
          onClick={() => setMenuOpen(true)}
          className="p-2 rounded-lg hover:bg-secondary transition-colors active:scale-95"
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5 text-muted-foreground" />
        </button>

        {/* Center: logo — absolutely positioned so it's always truly centered */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Link to="/" className="pointer-events-auto active:scale-95 transition-transform" aria-label="Home">
            <img
              src="/textlogo.png"
              alt="Rainbow Categories"
              style={{ maxHeight: "28px", width: "auto" }}
            />
          </Link>
        </div>

        {/* Right: hint + stats */}
        <div className="ml-auto flex items-center gap-1">
          {showHint && (
            <button
              onClick={onHintClick}
              className="p-2 rounded-lg hover:bg-secondary transition-colors active:scale-95"
              aria-label="Get a hint"
            >
              <Lightbulb className="w-5 h-5 text-muted-foreground" />
            </button>
          )}
          <button
            onClick={onStatsClick}
            className="p-2 rounded-lg hover:bg-secondary transition-colors active:scale-95"
            aria-label="My stats"
          >
            <BarChart3 className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>
      </header>

      {/* Drawer backdrop */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-40 bg-foreground/20 backdrop-blur-sm"
          onClick={() => setMenuOpen(false)}
        />
      )}

      {/* Slide-in drawer */}
      <div
        className="fixed top-0 left-0 z-50 h-full w-64 flex flex-col shadow-2xl transition-transform duration-200"
        style={{
          background: "hsl(var(--card))",
          borderRight: "1px solid hsl(var(--border))",
          transform: menuOpen ? "translateX(0)" : "translateX(-100%)",
        }}
      >
        {/* Drawer header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid hsl(var(--border))" }}>
          <img src="/textlogo.png" alt="Rainbow Categories" style={{ maxHeight: "22px", width: "auto" }} />
          <button
            onClick={() => setMenuOpen(false)}
            className="p-1.5 rounded-lg hover:bg-secondary transition-colors active:scale-95"
            aria-label="Close menu"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Drawer nav */}
        <nav className="flex flex-col py-2 flex-1">
          <button
            onClick={() => { onHowToPlayClick(); setMenuOpen(false); }}
            className={drawerItemClass}
          >
            <BookOpen className="w-4 h-4 text-muted-foreground" />
            How to Play
          </button>
          <Link
            to="/archive"
            onClick={() => setMenuOpen(false)}
            className={drawerItemClass}
          >
            <Archive className="w-4 h-4 text-muted-foreground" />
            Archive
          </Link>
          {onSettingsClick && (
            <button
              onClick={() => { onSettingsClick(); setMenuOpen(false); }}
              className={drawerItemClass}
            >
              <Settings className="w-4 h-4 text-muted-foreground" />
              Settings
            </button>
          )}
        </nav>

        {/* Account at bottom */}
        <div className="px-5 py-4" style={{ borderTop: "1px solid hsl(var(--border))" }}>
          <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">Account</p>
          <PlayerAuth user={user} onSignOut={onSignOut} />
        </div>
      </div>
    </>
  );
}
