import { useState, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import type { User as AuthUser } from "@supabase/supabase-js";

interface PlayerAuthProps {
  user: AuthUser | null;
  onSignOut: () => void;
}

function PersonIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle
        cx="12" cy="8" r="4"
        fill={filled ? "hsl(var(--foreground))" : "none"}
        stroke="hsl(var(--foreground))"
        strokeWidth="1.75"
      />
      <path
        d="M4 20c0-4 3.6-7 8-7s8 3 8 7"
        fill={filled ? "hsl(var(--foreground))" : "none"}
        stroke="hsl(var(--foreground))"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function PlayerAuth({ user, onSignOut }: PlayerAuthProps) {
  const [showAuth, setShowAuth] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showDropdown) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
        setShowChangePassword(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showDropdown]);

  async function handleSignOut() {
    setShowDropdown(false);
    onSignOut();
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setChangingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) toast.error(error.message);
    else {
      toast.success("Password updated!");
      setShowChangePassword(false);
      setShowDropdown(false);
      setNewPassword("");
    }
    setChangingPassword(false);
  }

  // ── Logged in ──
  if (user) {
    return (
      <div className="relative shrink-0" ref={dropdownRef}>
        <button
          onClick={() => { setShowDropdown((v) => !v); setShowChangePassword(false); }}
          className="p-2 rounded-lg hover:bg-secondary transition-colors duration-150 active:scale-95"
          aria-label="Account"
        >
          <PersonIcon filled />
        </button>

        {showDropdown && (
          <div
            className="absolute right-0 top-full mt-1 rounded-xl shadow-xl z-50 overflow-hidden"
            style={{
              background: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              minWidth: "200px",
            }}
          >
            {!showChangePassword ? (
              <>
                <div className="px-4 py-3" style={{ borderBottom: "1px solid hsl(var(--border))" }}>
                  <p style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: "hsl(var(--muted-foreground))",
                    marginBottom: "2px",
                  }}>
                    Signed in as
                  </p>
                  <p className="text-sm font-medium truncate">{user.email}</p>
                </div>
                <div className="py-1">
                  <button
                    onClick={() => setShowChangePassword(true)}
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-secondary transition-colors"
                  >
                    Change Password
                  </button>
                  <button
                    onClick={handleSignOut}
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-secondary transition-colors"
                    style={{ color: "hsl(0 84% 60%)" }}
                  >
                    Sign Out
                  </button>
                </div>
              </>
            ) : (
              <form onSubmit={handleChangePassword} className="p-4 space-y-3">
                <div className="flex items-center gap-2 mb-1">
                  <button
                    type="button"
                    onClick={() => setShowChangePassword(false)}
                    className="text-xs hover:opacity-70 transition-opacity"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    ←
                  </button>
                  <p className="text-sm font-semibold">Change Password</p>
                </div>
                <div>
                  <Label htmlFor="new-pw" className="text-xs">New Password</Label>
                  <Input
                    id="new-pw"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={6}
                    className="h-8 text-sm mt-1"
                  />
                </div>
                <Button type="submit" className="w-full h-8 text-xs" disabled={changingPassword}>
                  {changingPassword ? "Updating…" : "Update Password"}
                </Button>
              </form>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Logged out ──
  return (
    <>
      <button
        onClick={() => setShowAuth(true)}
        className="p-2 rounded-lg hover:bg-secondary transition-colors duration-150 active:scale-95 shrink-0"
        aria-label="Sign in"
      >
        <PersonIcon filled={false} />
      </button>

      {showAuth && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-foreground/20 backdrop-blur-sm"
            onClick={() => setShowAuth(false)}
          />
          <div className="relative bg-card rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-lg font-bold text-center mb-1">
              {isSignUp ? "Create Account" : "Sign In"}
            </h2>
            <p className="text-xs text-muted-foreground text-center mb-4">
              {isSignUp
                ? "Sign up to track your stats and streaks."
                : "Sign in to see puzzle stats."}
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setLoading(true);
                if (isSignUp) {
                  const { error } = await supabase.auth.signUp({ email, password });
                  if (error) toast.error(error.message);
                  else { toast.success("Account created!"); setShowAuth(false); }
                } else {
                  const { error } = await supabase.auth.signInWithPassword({ email, password });
                  if (error) toast.error(error.message);
                  else setShowAuth(false);
                }
                setLoading(false);
              }}
              className="space-y-3"
            >
              <div>
                <Label htmlFor="player-email" className="text-xs">Email</Label>
                <Input
                  id="player-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-9 text-sm"
                />
              </div>
              <div>
                <Label htmlFor="player-pw" className="text-xs">Password</Label>
                <Input
                  id="player-pw"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-9 text-sm"
                />
              </div>
              <Button type="submit" className="w-full h-9 text-sm" disabled={loading}>
                {loading ? "…" : isSignUp ? "Sign Up" : "Sign In"}
              </Button>
              <button
                type="button"
                onClick={() => setIsSignUp(!isSignUp)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-center"
              >
                {isSignUp ? "Already have an account? Sign in" : "Need an account? Sign up"}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
