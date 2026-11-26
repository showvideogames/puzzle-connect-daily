import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { CreatorPublicNameEditor } from "@/components/account/CreatorPublicNameEditor";
import { CommunityHeader } from "@/components/community/CommunityHeader";
import { CreatorCoverArt } from "@/components/community/CreatorCoverArt";
import { CoverPicker, coverToDraft, draftToCover, type CoverDraft } from "@/components/community/CoverPicker";
import { SiteFooter } from "@/components/SiteFooter";
import { SEO } from "@/components/SEO";
import { supabase } from "@/integrations/supabase/client";
import { useGamePageTheme } from "@/hooks/useGamePageTheme";
import { communityPuzzlesOn } from "@/lib/communityFlag";
import { cv } from "@/lib/communityStyle";
import { MAX_PUZZLE_TITLE, ensureMyCreatorProfile, getMyPuzzleSource, listMyPuzzles, renameMyPuzzle, setCommunityListing, setCustomPuzzleCover, type MyPuzzle } from "@/lib/customPuzzles";
import { draftKeyFor, draftLockFor, listCopyDrafts, saveNewCopyDraft } from "@/lib/builder/creatorDraft";
import { draftFromSource } from "@/lib/builder/copyDraft";
import { signInWithPlatform } from "@/lib/platformSignIn";
import { loadSettings } from "@/lib/settings";
import type { User } from "@supabase/supabase-js";

const pill = `inline-flex h-11 shrink-0 items-center justify-center rounded-full px-4 text-sm font-extrabold disabled:opacity-60 ${cv.focus}`;
const quiet = `${pill} border border-border bg-card text-foreground hover:bg-secondary`;

function errorText(err: unknown, fallback: string): string {
  const m = err && typeof err === "object" && "message" in err && typeof err.message === "string" ? err.message.trim() : "";
  if (!m) return fallback;
  // The server's own wording, as a sentence.
  return `${m[0].toUpperCase()}${m.slice(1)}${/[.!?]$/.test(m) ? "" : "."}`;
}

function messageFor(p: MyPuzzle, community: boolean): string {
  if (p.hidden) return "Hidden by Rainbow Categories. Its link doesn't open, and it can't be listed in Community.";
  if (p.visibility === "private") return "Private: only people with the link can play. Private puzzles can't be listed in Community.";
  if (!community) return "Public: anyone with the link can play.";
  return p.listed ? "Listed in Community Puzzles. Anyone can find it there." : "Not listed: only people with the link can play.";
}

function statusOf(p: MyPuzzle): { label: string; tone: string } {
  if (p.hidden) return { label: "Hidden", tone: "bg-red-100 text-red-900 dark:bg-red-500/20 dark:text-red-100" };
  if (p.visibility === "private") return { label: "Private", tone: "bg-zinc-200 text-zinc-900 ring-1 ring-inset ring-zinc-300 dark:bg-white/15 dark:ring-white/20 dark:text-white" };
  if (p.listed) return { label: "In Community", tone: "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-100" };
  return { label: "Link only", tone: "bg-violet-100 text-violet-900 dark:bg-violet-500/20 dark:text-violet-100" };
}

const dateFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

function PuzzleRow({ puzzle, community, onChange }: { puzzle: MyPuzzle; community: boolean; onChange: (next: MyPuzzle) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CoverDraft>(coverToDraft(puzzle.cover));
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState(puzzle.title);
  const [renameBusy, setRenameBusy] = useState(false);
  const [copying, setCopying] = useState(false);
  const navigate = useNavigate();
  const titleInput = useRef<HTMLInputElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const path = `/p/${puzzle.shortCode}`;
  const status = statusOf(puzzle);
  const playable = !puzzle.hidden;
  const titleId = `my-puzzle-${puzzle.shortCode}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}`);
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setNote({ kind: "error", text: `Couldn't copy. The link is ${window.location.origin}${path}` });
    }
  };

  const changeListing = async (listed: boolean) => {
    setBusy(true);
    setNote(null);
    try {
      const now = await setCommunityListing(puzzle.shareId, listed);
      onChange({ ...puzzle, listed: now });
      setNote({ kind: "ok", text: now ? "Listed in Community Puzzles." : "Unlisted. Its link still works." });
    } catch (err) {
      setNote({ kind: "error", text: errorText(err, "Couldn't change the listing. Try again.") });
    } finally {
      setBusy(false);
    }
  };

  const rename = async (e: React.FormEvent) => {
    e.preventDefault();
    const next = titleDraft.trim();
    if (!next) { setNote({ kind: "error", text: "A puzzle needs a title." }); titleInput.current?.focus(); return; }
    if (next === puzzle.title) { setRenaming(false); return; }
    setRenameBusy(true);
    setNote(null);
    try {
      const saved = await renameMyPuzzle(puzzle.shareId, next);
      onChange({ ...puzzle, title: saved });
      setRenaming(false);
      setNote({ kind: "ok", text: "Renamed. Its link, results and listing stay the same." });
    } catch (err) {
      setNote({ kind: "error", text: errorText(err, "Couldn't rename it. Try again.") });
    } finally {
      setRenameBusy(false);
    }
  };

  // Duplicate & Edit: the owner's own content, through the builder's loader,
  // into a new draft slot of its own (saved at once), then Create opens it.
  // The source puzzle isn't changed, and nothing is published.
  const duplicate = async () => {
    setCopying(true);
    setNote(null);
    try {
      const source = await getMyPuzzleSource(puzzle.shareId);
      const slot = saveNewCopyDraft(localStorage, draftFromSource(source));
      navigate(`/create?draft=${slot}`);
    } catch (err) {
      setNote({ kind: "error", text: errorText(err, "Couldn't copy it. Try again.") });
      setCopying(false);
    }
  };

  const saveCover = async () => {
    setSaving(true);
    setNote(null);
    try {
      const saved = await setCustomPuzzleCover(puzzle.shareId, draftToCover(draft));
      onChange({ ...puzzle, cover: saved });
      setNote({ kind: "ok", text: saved ? "Cover saved." : "Cover removed. It uses the standard cover." });
      setEditing(false);
    } catch (err) {
      setNote({ kind: "error", text: errorText(err, "Couldn't save the cover. Try again.") });
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className="border-b border-border py-4 last:border-b-0" data-testid="my-puzzle" data-short-code={puzzle.shortCode}>
      <article aria-labelledby={titleId} className="flex min-w-0 gap-3">
        <CreatorCoverArt cover={puzzle.cover} className="h-[64px] w-[92px] shrink-0 rounded-xl sm:h-[84px] sm:w-[150px]" />
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className={`text-base font-black leading-tight [overflow-wrap:anywhere] sm:text-[17px] ${cv.ink}`}>{puzzle.title}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span className={`rounded-full px-2 py-0.5 text-xs font-extrabold ${status.tone}`} data-testid="my-puzzle-status">{status.label}</span>
            <span className="whitespace-nowrap">{puzzle.mode === "rainbow" ? "Rainbow" : "Classic"} · Made {dateFmt.format(new Date(puzzle.createdAt))}</span>
          </p>
          <p className="mt-1 text-sm text-muted-foreground" data-testid="my-puzzle-note">{messageFor(puzzle, community)}</p>
        </div>
      </article>

      <div className="mt-3 flex flex-wrap gap-2 sm:pl-[162px]">
        {playable && (
          <>
            <Link to={path} className={`${pill} ${cv.play}`} aria-label={`Open ${puzzle.title}`}>Open</Link>
            <button type="button" onClick={() => void copy()} className={quiet} aria-label={`Copy link to ${puzzle.title}`}>
              {copied ? "Link copied" : "Copy Link"}
            </button>
            <button
              type="button"
              onClick={() => { setTitleDraft(puzzle.title); setNote(null); setRenaming((v) => !v); }}
              aria-expanded={renaming}
              className={quiet}
              aria-label={`Rename ${puzzle.title}`}
            >
              Rename
            </button>
            {community && (
              <button
                type="button"
                onClick={() => { setDraft(coverToDraft(puzzle.cover)); setNote(null); setEditing((v) => !v); }}
                aria-expanded={editing}
                className={quiet}
                aria-label={`${puzzle.cover ? "Edit cover" : "Add a cover"} for ${puzzle.title}`}
              >
                {puzzle.cover ? "Edit cover" : "Add a cover"}
              </button>
            )}
            <button
              type="button"
              disabled={copying}
              onClick={() => void duplicate()}
              className={quiet}
              aria-label={`Duplicate and edit ${puzzle.title}`}
            >
              {copying ? "Copying…" : "Duplicate & Edit"}
            </button>
            {community && puzzle.canList && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void changeListing(!puzzle.listed)}
                className={puzzle.listed ? quiet : `${pill} ${cv.play}`}
                aria-label={`${puzzle.listed ? "Unlist" : "List"} ${puzzle.title} ${puzzle.listed ? "from" : "in"} Community`}
              >
                {busy ? "Saving…" : puzzle.listed ? "Unlist from Community" : "List in Community"}
              </button>
            )}
          </>
        )}
      </div>
      {renaming && (
        <form onSubmit={(e) => void rename(e)} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:pl-[162px]" data-testid="my-puzzle-rename">
          <label className="min-w-0 flex-1 text-sm font-bold text-foreground">
            New title
            <input
              ref={titleInput}
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              maxLength={MAX_PUZZLE_TITLE}
              disabled={renameBusy}
              className={`mt-1 block h-11 w-full rounded-xl border border-border bg-background px-3 text-base font-normal ${cv.focus}`}
            />
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={renameBusy} className={`${pill} ${cv.play}`}>{renameBusy ? "Saving…" : "Save title"}</button>
            <button type="button" disabled={renameBusy} onClick={() => setRenaming(false)} className={quiet}>Cancel</button>
          </div>
        </form>
      )}
      <p className={`mt-2 text-sm font-semibold empty:mt-0 sm:pl-[162px] ${note?.kind === "error" ? "text-destructive" : "text-foreground"}`} role={note?.kind === "error" ? "alert" : "status"} data-testid="my-puzzle-result">
        {note?.text ?? ""}
      </p>
      {editing && (
        <div className="mt-2">
          <CoverPicker value={draft} onChange={setDraft} title={puzzle.title} creatorName={puzzle.creatorName} saving={saving} onSave={() => void saveCover()} />
        </div>
      )}
    </li>
  );
}

/** Duplicate & Edit copies saved in this browser, each in its own draft slot. */
function UnsavedCopies() {
  const [copies, setCopies] = useState(() => { try { return listCopyDrafts(localStorage); } catch { return []; } });
  const [asking, setAsking] = useState<string | null>(null);
  const [note, setNote] = useState("");
  if (copies.length === 0 && !note) return null;
  const discard = async (slot: string) => {
    setNote("");
    // Only while no tab is editing it (the same lock Create holds).
    const done = navigator.locks
      ? await navigator.locks.request(draftLockFor(slot), { ifAvailable: true }, (lock) => {
          if (!lock) return false;
          localStorage.removeItem(draftKeyFor(slot));
          return true;
        }).catch(() => false)
      : false;
    setAsking(null);
    if (!done) { setNote("That copy is open in another tab, so it was kept."); return; }
    setCopies(listCopyDrafts(localStorage));
    setNote("Copy discarded.");
  };
  return (
    <section aria-labelledby="unsaved-copies-heading" className="mt-5 rounded-2xl border border-border bg-card px-4 py-3" data-testid="unsaved-copies">
      <h2 id="unsaved-copies-heading" className={`text-base font-black ${cv.ink}`}>Unsaved copies in this browser</h2>
      <p className="text-sm text-muted-foreground">Drafts from Duplicate & Edit. They aren't published and have no link until you create them.</p>
      <ul className="mt-2">
        {copies.map((c) => (
          <li key={c.slot} className="flex flex-wrap items-center gap-2 py-1.5" data-testid="unsaved-copy">
            <span className="min-w-0 flex-1 font-semibold [overflow-wrap:anywhere]">{c.title.trim() || "Untitled copy"}</span>
            {asking === c.slot ? (
              <>
                <span className="text-sm">Discard this copy?</span>
                <button type="button" onClick={() => void discard(c.slot)} className={quiet}>Discard</button>
                <button type="button" onClick={() => setAsking(null)} className={quiet}>Keep</button>
              </>
            ) : (
              <>
                <Link to={`/create?draft=${c.slot}`} className={`${pill} ${cv.play}`} aria-label={`Resume ${c.title}`}>Resume</Link>
                <button type="button" onClick={() => setAsking(c.slot)} className={quiet} aria-label={`Discard ${c.title}`}>Discard</button>
              </>
            )}
          </li>
        ))}
      </ul>
      {note && <p className="mt-1 text-sm font-semibold" role="status">{note}</p>}
    </section>
  );
}

type Load = { status: "loading" } | { status: "error" } | { status: "ready"; items: MyPuzzle[]; hasMore: boolean; total: number };

/**
 * My Puzzles: the signed-in creator's own puzzles, newest first, with Open,
 * Copy Link, the existing cover picker and the existing List/Unlist call. The
 * list comes from list_my_custom_puzzles, which finds the owner on the server.
 * Reading it never lists, publishes or changes anything. Favorites stay on
 * their own page. Editing a puzzle's words isn't part of this page.
 */
export default function MyPuzzles() {
  useGamePageTheme();
  const community = communityPuzzlesOn();
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [signInNote, setSignInNote] = useState("");
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", loadSettings().darkMode);
  }, []);
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setUser(session?.user ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null));
    return () => subscription.unsubscribe();
  }, []);

  const fetchFirst = useCallback(() => {
    let cancelled = false;
    setLoad({ status: "loading" });
    // An owner with a listed puzzle but no creator page (an older puzzle
    // reassigned to them) gets one, so its Community byline can link.
    void ensureMyCreatorProfile();
    listMyPuzzles().then(
      (r) => { if (!cancelled) setLoad({ status: "ready", ...r }); },
      () => { if (!cancelled) setLoad({ status: "error" }); },
    );
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!user) return;
    return fetchFirst();
  }, [user?.id, fetchFirst]); // eslint-disable-line react-hooks/exhaustive-deps

  const more = async () => {
    if (load.status !== "ready") return;
    setLoadingMore(true);
    setMoreError(false);
    try {
      const r = await listMyPuzzles({ offset: load.items.length });
      const seen = new Set(load.items.map((p) => p.shortCode));
      setLoad({ status: "ready", items: [...load.items, ...r.items.filter((p) => !seen.has(p.shortCode))], hasMore: r.hasMore, total: r.total });
    } catch {
      setMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  };

  const update = (next: MyPuzzle) => {
    setLoad((l) => (l.status === "ready" ? { ...l, items: l.items.map((p) => (p.shortCode === next.shortCode ? next : p)) } : l));
  };

  const signIn = async () => {
    setSignInNote("");
    setSigningIn(true);
    const problem = await signInWithPlatform();
    if (problem) {
      setSignInNote(problem);
      setSigningIn(false);
    }
  };

  const createLink = (
    <Link to="/create" className={`${pill} ${cv.play} gap-1`}>
      <Plus aria-hidden="true" className="h-4 w-4" /> Create A Puzzle
    </Link>
  );

  return (
    <div className="min-h-screen flex flex-col items-center bg-background pt-1 pb-12">
      <SEO title="My Puzzles — Rainbow Connect" description="The puzzles you've made." path="/my-puzzles" noIndex />
      <CommunityHeader user={user ?? null} />
      <main className="w-full max-w-[840px] flex-1 px-4" aria-busy={user === undefined || (!!user && load.status === "loading")} data-testid="my-puzzles">
        <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className={`text-[32px] font-black leading-[1.05] tracking-tight sm:text-[40px] ${cv.ink}`}>My Puzzles</h1>
            <p className="mt-1 text-base text-muted-foreground">
              {user && load.status === "ready" && load.total > 0
                ? `${load.total} ${load.total === 1 ? "puzzle" : "puzzles"} you've made. Only you can see this list.`
                : "The puzzles you've made while signed in. Only you can see this list."}
            </p>
          </div>
          {user && load.status === "ready" && load.total > 0 && createLink}
        </div>

        {user && <CreatorPublicNameEditor key={user.id} />}
        {user && <UnsavedCopies />}

        {user === undefined ? (
          <p className="py-12 text-center text-muted-foreground" role="status">Loading…</p>
        ) : !user ? (
          <div className="mt-6 rounded-2xl bg-violet-50 px-5 py-6 text-center dark:bg-white/5" data-testid="my-puzzles-guest">
            <p className={`text-base font-extrabold ${cv.ink}`}>Sign in to see your puzzles.</p>
            <p className="mt-1 text-sm text-muted-foreground">Puzzles you make while signed in are kept here, so you never need to save their links. Puzzles made while signed out aren't linked to an account.</p>
            <button type="button" onClick={() => void signIn()} disabled={signingIn} className={`mt-4 ${pill} ${cv.play}`}>
              {signingIn ? "Opening sign-in…" : "Sign in"}
            </button>
            {signInNote && <p className="mt-2 text-sm text-muted-foreground" role="status">{signInNote}</p>}
          </div>
        ) : load.status === "loading" ? (
          <ul className="mt-4" aria-hidden="true" data-testid="my-puzzles-loading">
            {Array.from({ length: 3 }, (_, i) => <li key={i} className="my-3 h-[84px] animate-pulse rounded-xl bg-muted" />)}
          </ul>
        ) : load.status === "error" ? (
          <div className="mt-6 rounded-2xl bg-violet-50 px-5 py-6 text-center dark:bg-white/5" role="alert">
            <p className={`text-base font-extrabold ${cv.ink}`}>Couldn't load your puzzles.</p>
            <button type="button" onClick={fetchFirst} className={`mt-4 ${quiet}`}>Retry</button>
          </div>
        ) : load.items.length === 0 ? (
          <div className="mt-6 rounded-2xl bg-violet-50 px-5 py-8 text-center dark:bg-white/5" data-testid="my-puzzles-empty">
            <p className={`text-base font-extrabold ${cv.ink}`}>You haven't made a puzzle yet.</p>
            <p className="mt-1 text-sm text-muted-foreground">Make one and it shows up here, ready to share.</p>
            <div className="mt-4 flex justify-center">{createLink}</div>
          </div>
        ) : (
          <>
            <ul className="mt-3" data-testid="my-puzzles-list">
              {load.items.map((p) => <PuzzleRow key={p.shortCode} puzzle={p} community={community} onChange={update} />)}
            </ul>
            {(load.hasMore || moreError) && (
              <div className="mt-4 flex flex-col items-center gap-2">
                {moreError && <p className="text-sm text-destructive" role="alert">Couldn't load more. Try again.</p>}
                <button type="button" onClick={() => void more()} disabled={loadingMore} className={quiet}>
                  {loadingMore ? "Loading…" : "Show more"}
                </button>
              </div>
            )}
            <p className="mt-6 text-center text-sm text-muted-foreground">
              Looking for puzzles you saved? They're in <Link to={community ? "/community?tab=favorites" : "/favorites"} className={cv.link}>Favorites</Link>.
            </p>
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
