import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getMyCommunityListing, setCommunityListing, type CommunityListingState } from "@/lib/customPuzzles";

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/**
 * The creator's own Community control on their puzzle's page (preview). Renders
 * nothing for guests and for every account but the creator: the server answers
 * {owned:false} for them and refuses any change. Listing or unlisting never
 * touches the puzzle's links, visibility or content.
 */
export function CommunityListingControl({ shareId, userId }: { shareId: string; userId: string | null }) {
  const [state, setState] = useState<CommunityListingState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setState(null);
    setError(null);
    if (!userId) return;
    let cancelled = false;
    getMyCommunityListing(shareId).then((s) => { if (!cancelled) setState(s); });
    return () => { cancelled = true; };
  }, [shareId, userId]);

  if (!state?.owned) return null;

  const change = async (listed: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const now = await setCommunityListing(shareId, listed);
      setState({ ...state, listed: now });
    } catch (err: unknown) {
      setError(err && typeof err === "object" && "message" in err && typeof err.message === "string" ? err.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="community-listing-heading" className="w-full max-w-[840px] px-4 mt-4" data-testid="community-listing-control">
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 id="community-listing-heading" className="text-sm font-bold text-foreground">Your puzzle in Community</h2>
          <p className="mt-0.5 text-sm text-muted-foreground" role="status">
            {state.listed ? (
              <>Listed on <Link to="/community" className="font-semibold text-foreground underline underline-offset-2">Community Puzzles</Link>. Unlisting keeps this link working.</>
            ) : state.canList ? (
              "Not listed. Only people with the link can find it."
            ) : (
              "Private puzzles can't be listed in Community."
            )}
          </p>
          {error && <p className="mt-1 text-sm text-destructive" role="alert">{error}</p>}
        </div>
        {(state.listed || state.canList) && (
          <button
            type="button"
            disabled={busy}
            onClick={() => change(!state.listed)}
            className={`inline-flex h-11 shrink-0 items-center justify-center rounded-full px-5 text-sm font-bold disabled:opacity-60 ${focusRing}
              ${state.listed ? "border border-border bg-card text-foreground hover:bg-secondary" : "bg-primary text-primary-foreground hover:opacity-90"}`}
          >
            {busy ? "Saving…" : state.listed ? "Unlist from Community" : "List in Community"}
          </button>
        )}
      </div>
    </section>
  );
}
