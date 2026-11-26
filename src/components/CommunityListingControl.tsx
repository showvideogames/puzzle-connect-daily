import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getMyCommunityListing, setCommunityListing, setCustomPuzzleCover, type CommunityListingState } from "@/lib/customPuzzles";
import { CoverPicker, coverToDraft, draftToCover, type CoverDraft } from "@/components/community/CoverPicker";
import type { CreatorCover } from "@/lib/creatorCover";

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/**
 * The creator's own Community control on their puzzle's page (preview). Renders
 * nothing for guests and for every account but the creator: the server answers
 * {owned:false} for them and refuses any change. Listing or unlisting never
 * touches the puzzle's links, visibility or content.
 */
export function CommunityListingControl({ shareId, userId, title, creatorName, cover, onCoverChange }: {
  shareId: string;
  userId: string | null;
  title?: string;
  creatorName?: string;
  cover?: CreatorCover | null;
  onCoverChange?: (cover: CreatorCover | null) => void;
}) {
  const [state, setState] = useState<CommunityListingState | null>(null);
  const [editingCover, setEditingCover] = useState(false);
  const [draft, setDraft] = useState<CoverDraft>(coverToDraft(cover));
  const [coverSaving, setCoverSaving] = useState(false);
  const [coverMessage, setCoverMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
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
        <div className="flex flex-wrap gap-2">
        {onCoverChange && (
          <button
            type="button"
            onClick={() => { setDraft(coverToDraft(cover)); setCoverMessage(null); setEditingCover((v) => !v); }}
            aria-expanded={editingCover}
            className={`inline-flex h-11 shrink-0 items-center justify-center rounded-full border border-border bg-card px-5 text-sm font-bold text-foreground hover:bg-secondary ${focusRing}`}
          >
            {cover ? "Edit cover" : "Add a cover"}
          </button>
        )}
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
      </div>
      {coverMessage && <p className={`mt-2 text-sm font-semibold ${coverMessage.kind === "error" ? "text-destructive" : "text-foreground"}`} role={coverMessage.kind === "error" ? "alert" : "status"}>{coverMessage.text}</p>}
      {editingCover && onCoverChange && (
        <div className="mt-3">
          <CoverPicker
            value={draft}
            onChange={setDraft}
            title={title ?? ""}
            creatorName={creatorName ?? ""}
            saving={coverSaving}
            onSave={async () => {
              setCoverSaving(true);
              setCoverMessage(null);
              try {
                const saved = await setCustomPuzzleCover(shareId, draftToCover(draft));
                onCoverChange(saved);
                setCoverMessage({ kind: "ok", text: saved ? "Cover saved. It shows on your Community card." : "Cover removed. Your puzzle uses the standard cover." });
                setEditingCover(false);
              } catch (err: unknown) {
                setCoverMessage({ kind: "error", text: err && typeof err === "object" && "message" in err && typeof err.message === "string" ? err.message : "Couldn't save. Try again." });
              } finally {
                setCoverSaving(false);
              }
            }}
          />
        </div>
      )}
    </section>
  );
}
