import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import type { User as AuthUser } from "@supabase/supabase-js";
import { ACCOUNTS_ENABLED, deleteMyAccount, signInWithPlatform } from "@/lib/platformSignIn";

interface PlayerAuthProps {
  user: AuthUser | null;
  onSignOut: () => void;
  forceOpen?: boolean;
  onForceClose?: () => void;
  hideTrigger?: boolean;
  /**
   * Which edge the signed-in account dropdown hangs from, i.e. which
   * DIRECTION it opens. Default "right" is tuned for the site header, where
   * the icon sits at the far right of the screen. "left" is for a context
   * where the icon sits near the LEFT of its container (SettingsModal's Menu
   * row), so the dropdown grows rightward and stays on-screen.
   */
  dropdownAlign?: "left" | "right";
}

function PersonIcon({ filled, className }: { filled: boolean; className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
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

/**
 * The account control: one "Sign In" that leaves for the shared sign-in page,
 * and, once signed in, a small menu with Sign Out and account deletion.
 *
 * Rainbow keeps no passwords and sends no email: there is nothing to sign up
 * for, reset or confirm here. When accounts are switched off by configuration
 * (see lib/platformSignIn.ts) this component renders nothing for a guest, so
 * the whole game is guest-only without any other change.
 */
export function PlayerAuth({ user, onSignOut, forceOpen = false, onForceClose, hideTrigger = false, dropdownAlign = "right" }: PlayerAuthProps) {
  const [showAuth, setShowAuth] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // forceOpen opens whichever UI actually applies right now: the sign-in
  // dialog when signed out, the account dropdown when signed in, so an
  // external trigger (e.g. SettingsModal's "Sign In" row) need not know
  // which auth state the user is in.
  useEffect(() => {
    if (!forceOpen) return;
    if (user) setShowDropdown(true);
    else setShowAuth(true);
  }, [forceOpen, user]);
  const wasDropdownOpenRef = useRef(false);
  useEffect(() => {
    if (wasDropdownOpenRef.current && !showDropdown) onForceClose?.();
    wasDropdownOpenRef.current = showDropdown;
  }, [showDropdown, onForceClose]);

  useEffect(() => {
    if (!showDropdown) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
        setConfirmDelete(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showDropdown]);

  async function handleSignIn() {
    setLeaving(true);
    const problem = await signInWithPlatform();
    if (problem) {
      toast.error(problem);
      setLeaving(false);
    }
    // On success the browser is leaving for the sign-in page.
  }

  async function handleDelete() {
    setDeleting(true);
    const result = await deleteMyAccount();
    setDeleting(false);
    if (!result.ok) {
      toast.error(result.message ?? "Could not delete the account.");
      return;
    }
    setShowDropdown(false);
    setConfirmDelete(false);
    toast.success("Your Rainbow Categories account was deleted.");
  }

  // ── Signed in ──
  if (user) {
    return (
      <div className="relative shrink-0" ref={dropdownRef}>
        <button
          onClick={() => { setShowDropdown((v) => !v); setConfirmDelete(false); }}
          className="p-1 sm:p-2 rounded-lg hover:bg-secondary transition-colors duration-150 active:scale-95"
          aria-label="Account"
        >
          <PersonIcon filled className="w-4 h-4 sm:w-5 sm:h-5" />
        </button>

        {showDropdown && (
          <div
            className={`absolute ${dropdownAlign === "left" ? "left-0" : "right-0"} top-full mt-1 rounded-xl shadow-xl overflow-hidden`}
            style={{
              background: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              minWidth: "220px",
              zIndex: 9999,
            }}
            data-testid="account-menu"
          >
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
              <p className="text-sm font-medium truncate" data-testid="account-email">{user.email}</p>
            </div>
            {!confirmDelete ? (
              <div className="py-1">
                <button
                  onClick={() => { setShowDropdown(false); onSignOut(); }}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-secondary transition-colors"
                >
                  Sign Out
                </button>
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-secondary transition-colors"
                  style={{ color: "hsl(0 84% 60%)" }}
                >
                  Delete account…
                </button>
              </div>
            ) : (
              <div className="p-4 space-y-3">
                <p className="text-sm">Delete your Rainbow Categories account and its history? This cannot be undone.</p>
                <p className="text-xs text-muted-foreground">Your sign-in itself is not affected; signing in again starts a fresh account.</p>
                <div className="flex gap-2">
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="flex-1 py-2 rounded-full text-sm font-semibold transition-colors hover:opacity-90 active:scale-95 disabled:opacity-50"
                    style={{ background: "hsl(0 84% 60%)", color: "white" }}
                  >
                    {deleting ? "Deleting…" : "Delete"}
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    disabled={deleting}
                    className="flex-1 py-2 rounded-full text-sm font-medium transition-colors hover:bg-secondary active:scale-95"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Signed out ──
  if (!ACCOUNTS_ENABLED) return null;

  const handleModalClose = () => {
    setShowAuth(false);
    onForceClose?.();
  };

  return (
    <>
      {!hideTrigger && (
        <button
          onClick={() => setShowAuth(true)}
          className="p-1 sm:p-2 rounded-lg hover:bg-secondary transition-colors duration-150 active:scale-95 shrink-0"
          aria-label="Sign in"
        >
          <PersonIcon filled={false} className="w-4 h-4 sm:w-5 sm:h-5" />
        </button>
      )}

      {showAuth && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-foreground/20 backdrop-blur-sm"
            onClick={handleModalClose}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="player-auth-heading"
            className="relative bg-card rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4"
          >
            <h2 id="player-auth-heading" className="text-lg font-bold text-center mb-1">
              Sign In
            </h2>
            <p className="text-xs text-muted-foreground text-center mb-5">
              Sign in to keep your stats and streaks on every device. Your guest games on this browser can come with you.
            </p>
            <button
              type="button"
              onClick={handleSignIn}
              disabled={leaving}
              data-testid="platform-sign-in"
              className="w-full py-2.5 rounded-full text-sm font-semibold transition-colors hover:opacity-90 active:scale-95 disabled:opacity-50"
              style={{ background: "hsl(var(--foreground))", color: "hsl(var(--background))" }}
            >
              {leaving ? "Opening sign-in…" : "Continue to sign in"}
            </button>
            <p className="text-[10px] text-muted-foreground text-center leading-relaxed mt-4">
              By signing in, you agree to our{" "}
              <Link to="/terms" className="underline hover:text-foreground">Terms of Service</Link>
              {" "}and{" "}
              <Link to="/privacy" className="underline hover:text-foreground">Privacy Policy</Link>.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
