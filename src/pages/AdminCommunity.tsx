import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, Search, Star, X } from "lucide-react";
import { SEO } from "@/components/SEO";
import { MinimalHeader } from "@/components/MinimalHeader";
import { AdminLogin, AdminNoAccess } from "@/components/admin/AdminLogin";
import { useAuth } from "@/hooks/useAuth";
import { adminGetCuration, adminSetCuration, listCommunityPuzzles, type CommunityPuzzleListing, type CurationEntry } from "@/lib/customPuzzles";

interface Slot {
  shortCode: string;
  title: string;
  creatorName: string;
  /** Present for rows loaded from the server: whether Explore shows it now, and why not. */
  shown?: boolean;
  hiddenReason?: string | null;
}

const MAX_PICKS = 6;
const btn = "inline-flex h-10 items-center justify-center gap-1 rounded-full border border-border bg-card px-3 text-sm font-bold hover:bg-secondary disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const primary = "inline-flex h-11 items-center justify-center rounded-full bg-violet-700 px-6 text-sm font-extrabold text-white hover:bg-violet-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

function SlotRow({ slot, label, actions }: { slot: Slot; label: string; actions: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-center" data-testid="curation-row">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="font-bold break-words">{slot.title}</p>
        <p className="text-sm text-muted-foreground">by {slot.creatorName} · /p/{slot.shortCode}</p>
        {slot.shown === false && (
          <p className="mt-1 text-sm font-semibold text-destructive">Not shown on Explore: {slot.hiddenReason ?? "not eligible"}. It can stay saved and returns here if it's listed again, or you can remove or replace it.</p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">{actions}</div>
    </li>
  );
}

/**
 * Private, admin-only Community curation (preview): one Featured Puzzle and a
 * few ordered Editor's Picks, chosen by hand. The server checks the admin role
 * and that every choice is in Community right now, and Explore re-checks
 * eligibility on every read. No ranking, no automatic selection.
 */
export default function AdminCommunity() {
  const { user, loading, isAdmin } = useAuth();
  const [featured, setFeatured] = useState<Slot | null>(null);
  const [picks, setPicks] = useState<Slot[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CommunityPuzzleListing[]>([]);

  const apply = (rows: CurationEntry[]) => {
    const toSlot = (r: CurationEntry): Slot => ({ shortCode: r.shortCode, title: r.title, creatorName: r.creatorName, shown: r.shown, hiddenReason: r.hiddenReason });
    const f = rows.find((r) => r.slot === "featured");
    setFeatured(f ? toSlot(f) : null);
    setPicks(rows.filter((r) => r.slot === "pick").sort((a, b) => a.position - b.position).map(toSlot));
    setDirty(false);
  };

  useEffect(() => {
    if (!isAdmin) return;
    adminGetCuration().then((rows) => { apply(rows); setLoaded(true); }, (e: Error) => { setMessage({ kind: "error", text: e.message }); setLoaded(true); });
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    const t = setTimeout(() => {
      listCommunityPuzzles({ query, sort: "newest", limit: 12 }).then((p) => { if (!cancelled) setResults(p.items); }, () => { if (!cancelled) setResults([]); });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [query, isAdmin]);

  if (loading) return <div className="min-h-screen flex items-center justify-center"><p className="animate-pulse text-muted-foreground">Loading…</p></div>;
  if (!user) return <AdminLogin />;
  if (!isAdmin) return <AdminNoAccess />;

  const change = (f: Slot | null, p: Slot[]) => { setFeatured(f); setPicks(p); setDirty(true); setMessage(null); };
  const asSlot = (p: CommunityPuzzleListing): Slot => ({ shortCode: p.shortCode, title: p.title, creatorName: p.creatorName, shown: true });
  const move = (i: number, d: -1 | 1) => { const next = [...picks]; [next[i], next[i + d]] = [next[i + d], next[i]]; change(featured, next); };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      apply(await adminSetCuration(featured?.shortCode ?? null, picks.map((p) => p.shortCode)));
      setMessage({ kind: "ok", text: "Saved. Explore shows this now." });
    } catch (e: unknown) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : (e as { message?: string })?.message ?? "Couldn't save." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen pb-16">
      <SEO title="Community curation — Admin" description="Admin only." path="/admin/community" noIndex />
      <MinimalHeader />
      <main className="mx-auto max-w-3xl px-4">
        <h1 className="mt-6 text-2xl font-black">Community curation</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Admin only. Choose one Featured Puzzle and up to {MAX_PICKS} Editor's Picks by hand. Only puzzles their creators listed in Community can be added. Explore hides any that stop being listed; those can stay saved while you edit the rest.{" "}
          <Link to="/community" className="font-semibold text-violet-700 underline underline-offset-2 dark:text-violet-300">View Explore</Link>
        </p>

        {!loaded ? (
          <p className="mt-6 animate-pulse text-muted-foreground">Loading curation…</p>
        ) : (
          <>
            <h2 className="mt-6 text-lg font-extrabold">Featured Puzzle</h2>
            {featured ? (
              <ul className="mt-2"><SlotRow slot={featured} label="Featured" actions={
                <button type="button" className={btn} onClick={() => change(null, picks)}><X aria-hidden="true" className="h-4 w-4" />Remove<span className="sr-only"> {featured.title} from Featured</span></button>
              } /></ul>
            ) : <p className="mt-2 text-sm text-muted-foreground">None. Explore shows no Featured Puzzle.</p>}

            <h2 className="mt-6 text-lg font-extrabold">Editor's Picks ({picks.length}/{MAX_PICKS})</h2>
            {picks.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">None. Explore shows no Editor's Picks shelf.</p> : (
              <ol className="mt-2 space-y-2" data-testid="curation-picks">
                {picks.map((p, i) => (
                  <SlotRow key={p.shortCode} slot={p} label={`Pick ${i + 1}`} actions={<>
                    <button type="button" className={btn} disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${p.title} up`}><ArrowUp aria-hidden="true" className="h-4 w-4" /></button>
                    <button type="button" className={btn} disabled={i === picks.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${p.title} down`}><ArrowDown aria-hidden="true" className="h-4 w-4" /></button>
                    <button type="button" className={btn} onClick={() => change(featured, picks.filter((x) => x.shortCode !== p.shortCode))}><X aria-hidden="true" className="h-4 w-4" />Remove<span className="sr-only"> {p.title} from Picks</span></button>
                  </>} />
                ))}
              </ol>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button type="button" className={primary} disabled={!dirty || saving} onClick={save}>{saving ? "Saving…" : "Save curation"}</button>
              {message && <p role={message.kind === "error" ? "alert" : "status"} className={`text-sm font-semibold ${message.kind === "error" ? "text-destructive" : "text-foreground"}`}>{message.text}</p>}
            </div>

            <h2 className="mt-8 text-lg font-extrabold">Add from Community</h2>
            <div className="relative mt-2">
              <label htmlFor="curation-search" className="sr-only">Search listed puzzles</label>
              <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input id="curation-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search listed puzzles"
                className="h-11 w-full rounded-full border border-input bg-card pl-10 pr-4 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            </div>
            <ul className="mt-3 space-y-2" data-testid="curation-results">
              {results.map((r) => {
                const isFeatured = featured?.shortCode === r.shortCode;
                const isPick = picks.some((p) => p.shortCode === r.shortCode);
                return (
                  <SlotRow key={r.shortCode} slot={asSlot(r)} label="Listed in Community" actions={<>
                    <button type="button" className={btn} disabled={isFeatured} onClick={() => change(asSlot(r), picks.filter((p) => p.shortCode !== r.shortCode))}>
                      <Star aria-hidden="true" className="h-4 w-4" />{isFeatured ? "Featured" : "Feature"}<span className="sr-only"> {r.title}</span>
                    </button>
                    <button type="button" className={btn} disabled={isPick || picks.length >= MAX_PICKS} onClick={() => change(isFeatured ? null : featured, [...picks, asSlot(r)])}>
                      {isPick ? "Picked" : "Add to Picks"}<span className="sr-only"> {r.title}</span>
                    </button>
                  </>} />
                );
              })}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}
