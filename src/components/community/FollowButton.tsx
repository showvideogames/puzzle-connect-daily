import { useState } from "react";
import { setCreatorFollow } from "@/lib/customPuzzles";

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

interface FollowButtonProps {
  slug: string;
  name: string;
  following: boolean;
  /** undefined while auth resolves; false for a guest. */
  signedIn: boolean | undefined;
  onChange: (state: { following: boolean; followerCount: number }) => void;
  compact?: boolean;
}

/**
 * One-way Follow (preview). Account only: a guest sees why instead of a dead
 * button. Set, never toggled server-side, so a double tap can't flip it.
 * No notifications are sent to anyone.
 */
export function FollowButton({ slug, name, following, signedIn, onChange, compact = false }: FollowButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guestNote, setGuestNote] = useState(false);

  const click = async () => {
    if (!signedIn) { setGuestNote(true); return; }
    setBusy(true);
    setError(null);
    try {
      onChange(await setCreatorFollow(slug, !following));
    } catch (err: unknown) {
      setError(err && typeof err === "object" && "message" in err && typeof err.message === "string" ? err.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={click}
        disabled={busy || signedIn === undefined}
        aria-pressed={following}
        aria-label={`Follow ${name}`}
        className={`inline-flex ${compact ? "h-9 px-4" : "h-11 px-5"} shrink-0 items-center justify-center rounded-full text-sm font-bold transition-colors disabled:opacity-60 ${focusRing}
          ${following ? "border border-border bg-card text-foreground hover:bg-secondary" : "bg-primary text-primary-foreground hover:opacity-90"}`}
      >
        {busy ? "Saving…" : following ? "Following" : "Follow"}
      </button>
      {guestNote && !signedIn && <p className="text-xs text-muted-foreground" role="status">Sign in to follow creators.</p>}
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
    </div>
  );
}
