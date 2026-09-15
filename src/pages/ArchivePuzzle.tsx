import { useState, useEffect, useCallback } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { GameBoard } from "@/components/GameBoard";
import { GameHeader } from "@/components/GameHeader";
import { TutorialModal } from "@/components/TutorialModal";
import { StatsModal } from "@/components/StatsModal";
import { SettingsModal } from "@/components/SettingsModal";
import { FeedbackModal } from "@/components/FeedbackModal";
import { SiteFooter } from "@/components/SiteFooter";
import { SEO } from "@/components/SEO";
import { HintModal } from "@/components/HintModal";
import { getPuzzleById } from "@/lib/puzzles";
import { Puzzle } from "@/lib/types";
import { loadSettings, saveSettings, GameSettings } from "@/lib/settings";
import { trackEvent } from "@/lib/analytics";
import type { User } from "@supabase/supabase-js";

type ModalName = "stats" | "help" | "settings" | "feedback" | null;

export default function ArchivePuzzle() {
  const { puzzleId } = useParams<{ puzzleId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
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
    getPuzzleById(puzzleId)
      .then((p) => {
        clearTimeout(timeout);
        if (!p) { setError(true); setLoading(false); return; }
        setPuzzle(p);
        setLoading(false);
      })
      .catch(() => {
        clearTimeout(timeout);
        setError(true);
        setLoading(false);
      });
    return () => clearTimeout(timeout);
  }, [puzzleId]);

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
    if (isPuzzleComplete) {
      setShowSillyGoose(true);
    } else {
      setShowHintModal(true);
    }
  }, [isPuzzleComplete]);

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
    navigate(archiveReturnPath ?? "/archive");
  };

  // Puzzle identifier for the center of the top row — a free-text title
  // (e.g. "Monday Mashup" — see Admin.tsx) keeps its existing
  // "Puzzle {title}" phrasing; a purely numeric title (e.g. "101") gets a
  // "#" so it reads as a number. With no title at all, the date is the only
  // identifier available, so it takes this slot instead (and isn't
  // repeated again below it).
  const trimmedTitle = puzzle?.title?.trim();
  const isNumericTitle = !!trimmedTitle && /^\d+$/.test(trimmedTitle);
  const puzzleDateStr = puzzle
    ? new Date(puzzle.date + "T12:00:00").toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : "";
  const heroLabel = trimmedTitle
    ? isNumericTitle ? `Puzzle #${trimmedTitle}` : `Puzzle ${trimmedTitle}`
    : puzzleDateStr;

  return (
    <div className="min-h-screen flex flex-col items-center pt-2 pb-12">
      {puzzleLabel && (
        <SEO
          title={`Puzzle ${puzzleLabel} — Rainbow Categories Archive`}
          description={`Play Puzzle ${puzzleLabel} from the Rainbow Categories archive. A daily word puzzle with a hidden twist.`}
          path={`/archive/${puzzleId}`}
        />
      )}
      <GameHeader
        onStatsClick={() => setActiveModal("stats")}
        onHowToPlayClick={() => setActiveModal("help")}
        onSettingsClick={() => setActiveModal("settings")}
        onHintClick={handleHeaderHintClick}
        showHint={true}
        user={user ?? null}
        onSignOut={() => supabase.auth.signOut()}
        simplifiedIcons
      />
      <div className="w-full max-w-lg border-b border-border mb-3" />

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

      <div className="w-full max-w-lg px-4 mb-2">
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
            font-tile font-extrabold tracking-tight text-foreground text-[clamp(1.75rem,9vw,2.25rem)] sm:text-4xl md:text-5xl">
            {heroLabel}
          </h1>

          {/* Same brand-purple gradient token pair as Submit, so the two
              accent actions on the page read as one family. */}
          <button
            onClick={() => navigate("/")}
            className="w-[68px] sm:w-[88px] shrink-0 inline-flex items-center justify-center gap-0.5 whitespace-nowrap h-8 sm:h-9 rounded-full text-[11px] sm:text-sm font-semibold text-white
              bg-[linear-gradient(135deg,_hsl(var(--brand-purple-from)),_hsl(var(--brand-purple-to)))]
              shadow-[0_6px_16px_-8px_rgba(139,92,246,0.45)]
              hover:-translate-y-px active:scale-95 transition-all"
          >
            Today
            <ChevronRight className="w-3 h-3 sm:w-4 sm:h-4 shrink-0" />
          </button>
        </div>

        {/* Date sits on its own line beneath the row — only shown when the
            row above already shows an actual title, not the date itself
            (the no-title fallback puts the date in the hero slot instead,
            so it's never rendered twice). */}
        {trimmedTitle && (
          <p className="text-center text-sm sm:text-base font-medium text-slate mt-1.5 sm:mt-2">
            {puzzleDateStr}
          </p>
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
            <button onClick={() => navigate("/archive")} className="text-sm mt-2 underline underline-offset-2" style={{ color: "hsl(var(--muted-foreground))" }}>
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
          smallHintUsed={smallHintUsed}
          fullHintUsed={fullHintUsed}
          onHintClick={handleHeaderHintClick}
          onComplete={() => setIsPuzzleComplete(true)}
        />
      ) : null}

      <StatsModal open={activeModal === "stats"} onClose={() => setActiveModal(null)} />
      <TutorialModal open={activeModal === "help"} onClose={() => setActiveModal(null)} />
      <SettingsModal
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
        onSmallHint={handleSmallHint}
        onFullHint={handleFullHint}
        puzzle={puzzle}
      />
      <SiteFooter />
    </div>
  );
}
