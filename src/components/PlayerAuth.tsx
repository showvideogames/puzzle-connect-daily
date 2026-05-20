import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
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

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
      <path d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.592.102-1.167.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  );
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

type AuthView = "signin" | "signup" | "forgot";

export function PlayerAuth({ user, onSignOut }: PlayerAuthProps) {
  const [showAuth, setShowAuth] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [view, setView] = useState<AuthView>("signin");
  const [resetSent, setResetSent] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [signingInGoogle, setSigningInGoogle] = useState(false);
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

  async function handleGoogleSignIn() {
    setSigningInGoogle(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) {
      toast.error(error.message);
      setSigningInGoogle(false);
    }
    // On success the browser redirects to Google — no need to clear loading.
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
            className="absolute right-0 top-full mt-1 rounded-xl shadow-xl overflow-hidden"
            style={{
              background: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              minWidth: "200px",
              zIndex: 9999,
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
            onClick={() => { setShowAuth(false); setView("signin"); setResetSent(false); }}
          />
          <div className="relative bg-card rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-lg font-bold text-center mb-1">
              {view === "signup" ? "Create Account" : view === "forgot" ? "Reset your password" : "Sign In"}
            </h2>
            <p className="text-xs text-muted-foreground text-center mb-4">
              {view === "signup"
                ? "Sign up to track your stats and streaks."
                : view === "forgot"
                  ? "Enter your email and we'll send you a reset link."
                  : "Sign in to see puzzle stats."}
            </p>

            {view !== "forgot" && (
              <>
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={signingInGoogle || loading}
                  className="w-full h-9 text-sm font-medium rounded-md border border-border bg-card
                    hover:bg-secondary transition-colors active:scale-[0.98]
                    disabled:opacity-50 disabled:cursor-default
                    flex items-center justify-center gap-2"
                >
                  <GoogleIcon />
                  {signingInGoogle ? "Redirecting…" : `Sign ${view === "signup" ? "up" : "in"} with Google`}
                </button>
                <div className="flex items-center gap-3 my-4">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-xs text-muted-foreground">or</span>
                  <div className="flex-1 h-px bg-border" />
                </div>
              </>
            )}

            {view === "forgot" ? (
              resetSent ? (
                <div className="space-y-4 text-center">
                  <p className="text-sm">Check your email for a reset link.</p>
                  <button
                    type="button"
                    onClick={() => { setView("signin"); setResetSent(false); }}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    ← Back to sign in
                  </button>
                </div>
              ) : (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setLoading(true);
                    const { error } = await supabase.auth.resetPasswordForEmail(email, {
                      redirectTo: "https://rainbowcategories.com/reset-password",
                    });
                    setLoading(false);
                    if (error) toast.error(error.message);
                    else setResetSent(true);
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
                  <Button type="submit" className="w-full h-9 text-sm" disabled={loading}>
                    {loading ? "…" : "Send reset link"}
                  </Button>
                  <button
                    type="button"
                    onClick={() => setView("signin")}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-center"
                  >
                    ← Back to sign in
                  </button>
                </form>
              )
            ) : (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setLoading(true);
                  if (view === "signup") {
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
                  {view === "signin" && (
                    <button
                      type="button"
                      onClick={() => setView("forgot")}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-right mt-1"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <Button type="submit" className="w-full h-9 text-sm" disabled={loading}>
                  {loading ? "…" : view === "signup" ? "Sign Up" : "Sign In"}
                </Button>
                {view === "signup" && (
                  <p className="text-[10px] text-muted-foreground text-center leading-relaxed">
                    By signing up, you agree to our{" "}
                    <Link to="/terms" className="underline hover:text-foreground">Terms of Service</Link>
                    {" "}and{" "}
                    <Link to="/privacy" className="underline hover:text-foreground">Privacy Policy</Link>.
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => setView(view === "signup" ? "signin" : "signup")}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-center"
                >
                  {view === "signup" ? "Already have an account? Sign in" : "Need an account? Sign up"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
