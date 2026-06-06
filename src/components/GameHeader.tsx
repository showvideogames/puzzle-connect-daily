import { useState } from "react";
import { BarChart3, Lightbulb, Menu, X, BookOpen, Archive, Settings } from "lucide-react";
import { Link } from "react-router-dom";
import { PlayerAuth } from "./PlayerAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
  const [showSignIn, setShowSignIn] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  const drawerItemClass =
    "flex items-center gap-3 w-full px-5 py-3 text-sm font-medium hover:bg-secondary transition-colors active:scale-95 text-left";

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setChangingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Password updated!");
      setShowChangePassword(false);
      setNewPassword("");
    }
    setChangingPassword(false);
  }

  function closeMenu() {
    setMenuOpen(false);
    setShowChangePassword(false);
    setNewPassword("");
  }

  return (
    <>
      <header className="flex items-center w-full max-w-lg mx-auto py-3 px-2 gap-2">
        {/* Left: hamburger + logo in normal flow */}
        <button
          onClick={() => setMenuOpen(true)}
          className="p-2 rounded-lg hover:bg-secondary transition-colors active:scale-95 shrink-0"
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5 text-muted-foreground" />
        </button>

        <Link to="/" className="active:scale-95 transition-transform shrink-0" aria-label="Home">
          <img
            src="/textlogo.png"
            alt="Rainbow Categories"
            style={{ maxHeight: "28px", width: "auto" }}
          />
        </Link>

        {/* Right: hint + stats + archive */}
        <div className="ml-auto flex items-center gap-1 shrink-0">
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
          <Link
            to="/archive"
            className="p-2 rounded-lg hover:bg-secondary transition-colors active:scale-95"
            aria-label="Puzzle archive"
          >
            <Archive className="w-5 h-5 text-muted-foreground" />
          </Link>
        </div>
      </header>

      {/* Drawer backdrop */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-40 bg-foreground/20 backdrop-blur-sm"
          onClick={closeMenu}
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
        <div
          className="flex items-center justify-between px-5 py-4 shrink-0"
          style={{ borderBottom: "1px solid hsl(var(--border))" }}
        >
          <img src="/textlogo.png" alt="Rainbow Categories" style={{ maxHeight: "22px", width: "auto" }} />
          <button
            onClick={closeMenu}
            className="p-1.5 rounded-lg hover:bg-secondary transition-colors active:scale-95"
            aria-label="Close menu"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Drawer nav */}
        <nav className="flex flex-col py-2 flex-1 overflow-y-auto">
          <button
            onClick={() => { onHowToPlayClick(); closeMenu(); }}
            className={drawerItemClass}
          >
            <BookOpen className="w-4 h-4 text-muted-foreground" />
            How to Play
          </button>
          <Link
            to="/archive"
            onClick={closeMenu}
            className={drawerItemClass}
          >
            <Archive className="w-4 h-4 text-muted-foreground" />
            Archive
          </Link>
          {onSettingsClick && (
            <button
              onClick={() => { onSettingsClick(); closeMenu(); }}
              className={drawerItemClass}
            >
              <Settings className="w-4 h-4 text-muted-foreground" />
              Settings
            </button>
          )}
        </nav>

        {/* Account — fully inline */}
        <div
          className="px-5 py-4 shrink-0"
          style={{ borderTop: "1px solid hsl(var(--border))" }}
        >
          <p
            className="text-xs font-semibold text-muted-foreground mb-3"
            style={{ letterSpacing: "0.06em", textTransform: "uppercase" }}
          >
            Account
          </p>

          {user ? (
            showChangePassword ? (
              /* Change password form */
              <form onSubmit={handleChangePassword} className="space-y-3">
                <div className="flex items-center gap-2 mb-1">
                  <button
                    type="button"
                    onClick={() => { setShowChangePassword(false); setNewPassword(""); }}
                    className="text-xs hover:opacity-70 transition-opacity"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    ←
                  </button>
                  <p className="text-sm font-semibold">Change Password</p>
                </div>
                <div>
                  <Label htmlFor="drawer-new-pw" className="text-xs">New Password</Label>
                  <Input
                    id="drawer-new-pw"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={6}
                    className="h-8 text-sm mt-1"
                    autoFocus
                  />
                </div>
                <Button type="submit" className="w-full h-8 text-xs" disabled={changingPassword}>
                  {changingPassword ? "Updating…" : "Update Password"}
                </Button>
              </form>
            ) : (
              /* Signed-in account options */
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground truncate px-1 mb-2">{user.email}</p>
                <button
                  onClick={() => setShowChangePassword(true)}
                  className="w-full text-left text-sm font-medium py-1.5 px-3 rounded-lg hover:bg-secondary transition-colors active:scale-95"
                >
                  Change Password
                </button>
                <button
                  onClick={() => { onSignOut(); closeMenu(); }}
                  className="w-full text-left text-sm font-medium py-1.5 px-3 rounded-lg hover:bg-secondary transition-colors active:scale-95"
                  style={{ color: "hsl(0 84% 60%)" }}
                >
                  Sign Out
                </button>
              </div>
            )
          ) : (
            /* Logged out */
            <button
              onClick={() => { setMenuOpen(false); setShowSignIn(true); }}
              className="w-full py-2 rounded-full text-sm font-semibold transition-colors hover:opacity-90 active:scale-95"
              style={{ background: "hsl(var(--foreground))", color: "hsl(var(--background))" }}
            >
              Sign In
            </button>
          )}
        </div>
      </div>

      {/* Auth modal — only rendered when logged out; hideTrigger prevents any visible icon */}
      {!user && (
        <PlayerAuth
          user={null}
          onSignOut={onSignOut}
          hideTrigger
          forceOpen={showSignIn}
          onForceClose={() => setShowSignIn(false)}
        />
      )}
    </>
  );
}
