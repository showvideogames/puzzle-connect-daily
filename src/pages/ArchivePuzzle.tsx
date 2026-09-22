import { useState, useEffect, useCallback } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { GameBoard } from "@/components/GameBoard";
import { GameHeader } from "@/components/GameHeader";
import { PuzzleModeBadge } from "@/components/PuzzleModeBadge";
import { TutorialModal } from "@/components/TutorialModal";
import { StatsModal } from "@/components/StatsModal";
import { SettingsModal } from "@/components/SettingsModal";
import { FeedbackModal } from "@/components/FeedbackModal";
import { SiteFooter } from "@/components/SiteFooter";
import { SEO } from "@/components/SEO";
import { HintModal } from "@/components/HintModal";
import { getPuzzleById } from "@/lib/puzzles";
import { resolvePlayablePuzzle } from "@/lib/puzzleVersion";
import { Puzzle } from "@/lib/types";
import { loadSettings, saveSettings, GameSettings } from "@/lib/settings";
import { trackEvent } from "@/lib/analytics";
import { resolveArchiveEntryContext } from "@/lib/entryContext";
import { FULL_FORMAT, progressStorageId, rainbowHerringFor, type PuzzleFormat } from "@/lib/puzzleFormat";
import type { User } from "@supabase/supabase-js";

type ModalName = "stats" | "help" | "settings" | "feedback" | null;

interface ArchivePuzzlePageProps {
  /**
   * Which format's archive this page is serving. The only difference between
   * /archive/:id and /mini/archive/:id — the puzzle it will load, the
   * progress namespace it resumes from, the statistics it shows and where
   * its two nav buttons go. Defaults to Full, so /archive/:id and the legacy
   * /free/:id are untouched.
   */
  format?: PuzzleFormat;
}

export default function ArchivePuzzle({ format = FULL_FORMAT }: ArchivePuzzlePageProps = {}) {
  const { puzzleId } = useParams<{ puzzleId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  // How the player reached this puzzle. /archive/:id and the legacy
  // /free/:id both render this page, and the three in-app entry points
  // (calendar cell, Free Puzzles card, Emoji Puzzles card) all resolve to
  // the same path — so router state is the only thing that can tell them
  // apart. When there is none (deep link, bookmark, fresh-tab reload),
  // this resolves to the honest "archive_direct" rather than guessing.
  const entryContext = resolveArchiveEntryContext(puzzleId, location.state, location.pathname);
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [activeModal, setActiveModal] = useState<ModalName>(null);
  const [settings, setSettings] = useState<GameSettings>(loadSettings);
  const [showHintModal, setShowHintModal] = useState(false);
  const [smallHintUsed, setSmallHintUsed] = useState(false);
  const [fullHintUsed, setFullHintUsed] = useState(false);
  const [isPuzzleComplete, setIsPuzzleComplete] = useState(false);
  const [hintsViewOnly, setHintsViewOnly] = useState(false);
  const [showSillyGoose, setShowSillyGoose] = useState(false);

  const handleSettingsChange = (s: GameSettings) => {
    setSettings(s);
    saveSettings(s);
    document.documentElement.classList.toggle("dark", s.darkMode);
  };

  useEffect(() => {
    document.documentElement.classList.toggle("dark", settings.darkMode);
  }, [settings.darkMode]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!puzzleId) { setError(true); setLoading(false); return; }
    const timeout = setTimeout(() => {
      setError(true);
      setLoading(false);
    }, 8000);
    getPuzzleById(puzzleId, format.id)
      .then((p) => {
        clearTimeout(timeout);
        if (!p) { setError(true); setLoading(false); return; }
        // Same resolution as the Daily route: an Archive game already in
        // progress against an earlier version resumes on THAT content, so a
        // mid-game edit can never leave this board with answers it is unable
        // to submit. A completed or never-started puzzle resolves to the
        // current version. See lib/puzzleVersion.ts.
        setPuzzle(resolvePlayablePuzzle(p, progressStorageId(p.id, format)));
        setLoading(false);
      })
      .catch(() => {
        clearTimeout(timeout);
        setError(true);
        setLoading(false);
      });
    return () => clearTimeout(timeout);
  }, [puzzleId, format]);

  const handleSmallHint = useCallback(() => {
    trackEvent("hint_small_used");
    trackEvent("hint_used");
    setSmallHintUsed(true);
  }, []);

  const handleFullHint = useCallback(() => {
    trackEvent("hint_full_used");
    trackEvent("hint_used");
    setFullHintUsed(true);
  }, []);

  const handleHeaderHintClick = useCallback(() => {
    // Fully resolved (Rainbow result included) = view-only hints, no goose.
    if (isPuzzleComplete && !hintsViewOnly) {
      setShowSillyGoose(true);
    } else {
      setShowHintModal(true);
    }
  }, [isPuzzleComplete, hintsViewOnly]);

  const puzzleLabel = puzzle?.title?.trim() || puzzleId || "";

  // Archive.tsx passes the exact archive URL (including its ?month=YYYY-MM)
  // it was on when the player opened this puzzle, as router state — so
  // "Back to Archive" restores the same month rather than resetting to
  // today's. document.referrer doesn't work for this: it reflects the
  // browser's original page-load referrer, not in-app client-side route
  // changes, so it never actually pointed at the live Archive view here.
  // Falls back to a plain /archive (today's month) when there's no state —
  // e.g. the puzzle was opened directly via a shared link.
  const archiveReturnPath = (location.state as { archiveReturnPath?: string } | null)?.archiveReturnPath;
  const handleBackToArchive = () => {
    navigate(archiveReturnPath ?? format.archivePath);
  };

  // Puzzle identifier for the center of the top row — shown exactly as the
  // admin typed it (e.g. "#50", "Emoji #5", "Monday Mashup" — see
  // Admin.tsx's free-text title field), with no "Puzzle" word prepended.
  // Admins already bake their own numbering convention into the title
  // itself ("#50", not bare "50"), and this page's own layout already
  // establishes the "puzzle" framing on its own (the "← Archive" and
  // "Today →" buttons either side of it, the puzzle-themed page itself),
  // so spelling "Puzzle" out again here would be redundant. The share-text
  // header (GameBoard's puzzleFullLabel) is a different context with none
  // of that surrounding framing — that one DOES prepend "Puzzle " in full,
  // since it has to stand alone once pasted somewhere else. With no title
  // at all, the date is the only identifier available, so it takes this
  // slot instead (and isn't repeated again below it).
  const trimmedTitle = puzzle?.title?.trim();
  const puzzleDateStr = puzzle
    ? new Date(puzzle.date + "T12:00:00").toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : "";
  const heroLabel = trimmedTitle || puzzleDateStr;

  return (
    <div className="min-h-screen flex flex-col items-center pt-2 pb-12">
      {puzzleLabel && (
        <SEO
          title={`Puzzle ${puzzleLabel} — Rainbow Categories${format.id === "full" ? "" : ` ${format.name}`} Archive`}
          description={`Play Puzzle ${puzzleLabel} from the Rainbow Categories${format.id === "full" ? "" : ` ${format.name}`} archive. A daily word puzzle with a hidden twist.`}
          path={format.archivePuzzlePath(puzzleId ?? "")}
        />
      )}
      <GameHeader
        format={format}
        onStatsClick={() => setActiveModal("stats")}
        onHowToPlayClick={() => setActiveModal("help")}
        onSettingsClick={() => setActiveModal("settings")}
        onHintClick={handleHeaderHintClick}
        showHint={true}
        user={user ?? null}
        onSignOut={() => supabase.auth.signOut()}
        simplifiedIcons
        // Matches the board's own wideBoard width below (840px) instead of
        // the narrower 512px default — simplifiedIcons alone only controls
        // which icons show, not how wide the header is; wideHeader is the
        // separate, width-only flag (see GameHeader.tsx's prop doc).
        wideHeader
      />
      <div className="w-full max-w-[840px] border-b border-border mb-3" />

      {showSillyGoose && (
        <div className="w-full max-w-lg px-2 mb-2 animate-fade-up">
          <div className="bg-foreground text-background pl-5 pr-2 py-2.5 rounded-full text-sm font-semibold shadow-md flex items-center justify-between gap-3">
            <span className="flex-1 text-center">You don't need hints! You already beat the puzzle, ya silly goose 🦆</span>
            <button
              onClick={() => setShowSillyGoose(false)}
              aria-label="Dismiss"
              className="flex-shrink-0 p-1 rounded-full hover:bg-background/10 active:scale-95 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* max-w-[840px]: matches the board's own wideBoard width below, so
          the Archive/Today buttons sit at the same left/right edges the
          category bars do, instead of a narrower 512px row floating inset
          from them. The buttons themselves stay their fixed compact-pill
          size (w-[68px]/[88px] below) — it's the row, not the buttons, that
          stretches; the title's minmax(0,1fr) middle column absorbs all of
          the extra width. */}
      <div className="w-full max-w-[840px] px-4 mb-2">
        {/* Top row: nav buttons + puzzle title share one row, using a
            fixed-width | flexible-center | fixed-width grid so the two
            buttons are pixel-identical regardless of label length and the
            title gets whatever horizontal space is left between them —
            never the other way around. Both buttons keep the exact same
            height/padding/radius/font-size; only the fill color differs. */}
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5 sm:gap-2 mt-2">
          <button
            onClick={handleBackToArchive}
            className="w-[68px] sm:w-[88px] shrink-0 inline-flex items-center justify-center gap-0.5 whitespace-nowrap h-8 sm:h-9 rounded-full border border-border bg-card
              text-foreground text-[11px] sm:text-sm font-semibold
              hover:bg-secondary transition-colors active:scale-95"
          >
            <ChevronLeft className="w-3 h-3 sm:w-4 sm:h-4 shrink-0" />
            Archive
          </button>

          {/* min-w-0 is required for a grid item to actually shrink below
              its content's intrinsic width — without it, overflow-hidden/
              text-ellipsis below would never kick in and this column would
              just push the row (and the right-hand button) wider instead. */}
          <h1 className="min-w-0 text-center overflow-hidden whitespace-nowrap text-ellipsis
            font-tile font-bold tracking-tight text-foreground text-[clamp(1.75rem,9vw,2.25rem)] sm:text-4xl md:text-5xl">
            {heroLabel}
          </h1>

          {/* Same brand-purple gradient token pair as Submit, so the two
              accent actions on the page read as one family. */}
          <button
            onClick={() => navigate(format.dailyPath)}
            className="w-[68px] sm:w-[88px] shrink-0 inline-flex items-center justify-center gap-0.5 whitespace-nowrap h-8 sm:h-9 rounded-full text-[11px] sm:text-sm font-semibold text-white
              bg-[linear-gradient(135deg,_hsl(var(--brand-purple-from)),_hsl(var(--brand-purple-to)))]
              shadow-[0_6px_16px_-8px_rgba(139,92,246,0.45)]
              hover:-translate-y-px active:scale-95 transition-all"
          >
            Today
            <ChevronRight className="w-3 h-3 sm:w-4 sm:h-4 shrink-0" />
          </button>
        </div>

        {/* Metadata row: designer byline, then date, then the puzzle-mode
            badge — replaces the badge GameBoard used to float on its own
            right-aligned row above the instructions (see showModeBadge={false}
            below) so all three read as one connected line under the title,
            matching the target mock-up. The date segment is only shown when
            the row above already shows an actual title, not the date itself
            (the no-title fallback puts the date in the hero slot instead, so
            it's never rendered twice) — preserving the page's existing rule.
            Each segment (its separator included) is one flex item, so a wrap
            on a very narrow screen or a long designer name moves a whole
            "| segment" to the next line rather than stranding a bare
            separator. */}
        {puzzle && (
          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 mt-1.5 sm:mt-2 text-center text-sm sm:text-base font-medium text-slate">
            <span className="whitespace-nowrap">by {puzzle.designerName}</span>
            {trimmedTitle && (
              <span className="whitespace-nowrap border-l border-border pl-2">{puzzleDateStr}</span>
            )}
            <span className="border-l border-border pl-2 inline-flex items-center">
              <PuzzleModeBadge isRainbow={!!rainbowHerringFor(puzzle)} groupCount={format.categoryCount} />
            </span>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="animate-pulse" style={{ color: "hsl(var(--muted-foreground))" }}>Loading puzzle…</p>
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center text-center px-4">
          <div>
            <p className="text-lg font-medium">Puzzle not found.</p>
            <button onClick={() => navigate(format.archivePath)} className="text-sm mt-2 underline underline-offset-2" style={{ color: "hsl(var(--muted-foreground))" }}>
              Back to archive
            </button>
          </div>
        </div>
      ) : puzzle ? (
        <GameBoard
          puzzle={puzzle}
          settings={settings}
          user={user ?? null}
          isArchive
          // Matches the Daily homepage's desktop board width/tile geometry
          // (see GameBoard's wideBoard prop doc) — the Archive-specific
          // header above (Back to Archive / title / date / Today) now
          // matches this same 840px width too (wideHeader on GameHeader,
          // and this page's own max-w-[840px] wrappers), so the whole page
          // reads as one consistent width instead of a narrower header
          // sitting above a wider board.
          wideBoard
          // The Rainbow/4-Groups badge now lives in the metadata row above
          // (next to the designer byline and date) instead of floating on
          // its own right-aligned row over the instructions.
          showModeBadge={false}
          smallHintUsed={smallHintUsed}
          onHintsViewOnlyChange={setHintsViewOnly}
          fullHintUsed={fullHintUsed}
          onHintClick={handleHeaderHintClick}
          onComplete={() => setIsPuzzleComplete(true)}
          entryContext={entryContext}
        />
      ) : null}

      <StatsModal open={activeModal === "stats"} onClose={() => setActiveModal(null)} format={format} />
      <TutorialModal open={activeModal === "help"} onClose={() => setActiveModal(null)} />
      <SettingsModal
        format={format}
        open={activeModal === "settings"}
        onClose={() => setActiveModal(null)}
        settings={settings}
        onSettingsChange={handleSettingsChange}
        onOpenFeedback={() => setActiveModal("feedback")}
        showMenuLinks
        onHowToPlayClick={() => setActiveModal("help")}
        user={user ?? null}
        onSignOut={() => supabase.auth.signOut()}
      />
      <FeedbackModal
        open={activeModal === "feedback"}
        onClose={() => setActiveModal(null)}
        user={user ?? null}
      />
      <HintModal
        open={showHintModal}
        onClose={() => setShowHintModal(false)}
        viewOnly={hintsViewOnly}
        onSmallHint={handleSmallHint}
        onFullHint={handleFullHint}
        puzzle={puzzle}
      />
      <SiteFooter />
    </div>
  );
}
