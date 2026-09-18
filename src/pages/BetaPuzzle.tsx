import { useState, useEffect, useCallback } from "react";
import { FlaskConical, ChevronLeft, MessageSquarePlus, RotateCcw } from "lucide-react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { GameBoard } from "@/components/GameBoard";
import { GameHeader } from "@/components/GameHeader";
import { TutorialModal } from "@/components/TutorialModal";
import { SettingsModal } from "@/components/SettingsModal";
import { FeedbackModal } from "@/components/FeedbackModal";
import { BetaFeedbackModal } from "@/components/BetaFeedbackModal";
import { SiteFooter } from "@/components/SiteFooter";
import { SEO } from "@/components/SEO";
import { HintModal } from "@/components/HintModal";
import { getBetaPuzzleById } from "@/lib/puzzles";
import { resolvePlayablePuzzle } from "@/lib/puzzleVersion";
import { loadProgress, clearProgress } from "@/lib/gameProgress";
import { resetBetaPlaytest } from "@/lib/betaPlaytest";
import { Puzzle } from "@/lib/types";
import { loadSettings, saveSettings, GameSettings } from "@/lib/settings";
import { trackEvent } from "@/lib/analytics";
import type { User } from "@supabase/supabase-js";

type ModalName = "help" | "settings" | "feedback" | "betaFeedback" | null;

/** Beta progress lives under this namespace — see useGame's storageId doc. */
function betaStorageKey(puzzleId: string) {
  return `beta:${puzzleId}`;
}

export default function BetaPuzzle() {
  const { puzzleId } = useParams<{ puzzleId: string }>();
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [activeModal, setActiveModal] = useState<ModalName>(null);
  const [settings, setSettings] = useState<GameSettings>(loadSettings);
  const [showHintModal, setShowHintModal] = useState(false);
  const [smallHintUsed, setSmallHintUsed] = useState(false);
  const [fullHintUsed, setFullHintUsed] = useState(false);

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
    setLoading(true);
    setError(false);
    const timeout = setTimeout(() => {
      setError(true);
      setLoading(false);
    }, 8000);
    getBetaPuzzleById(puzzleId)
      .then((p) => {
        clearTimeout(timeout);
        if (!p) { setError(true); setLoading(false); return; }
        // Same version-pin resolution the Daily/Archive pages use, but keyed
        // to the beta-only progress namespace so this never reads (or
        // collides with) the puzzle's official progress blob.
        setPuzzle(resolvePlayablePuzzle(p, betaStorageKey(p.id)));
        setLoading(false);
        trackEvent("beta_puzzle_opened", { puzzle_id: p.id });
      })
      .catch(() => {
        clearTimeout(timeout);
        setError(true);
        setLoading(false);
      });
    return () => clearTimeout(timeout);
  }, [puzzleId]);

  const handleSettingsChange = (s: GameSettings) => {
    setSettings(s);
    saveSettings(s);
    document.documentElement.classList.toggle("dark", s.darkMode);
  };

  const handleSmallHint = useCallback(() => setSmallHintUsed(true), []);
  const handleFullHint = useCallback(() => setFullHintUsed(true), []);

  const handleReset = useCallback(async () => {
    if (!puzzle) return;
    if (!confirm("Reset this playtest? Your progress on this puzzle will be cleared and you'll start fresh.")) {
      return;
    }
    await resetBetaPlaytest(puzzle.id);
    clearProgress(betaStorageKey(puzzle.id));
    trackEvent("beta_puzzle_reset", { puzzle_id: puzzle.id });
    // Simplest correct way to give every piece of GameBoard/useGame state a
    // genuinely fresh start (selections, shuffled board, tile colors, guess
    // history, completion) is to reload: the page's own load effect above
    // then re-fetches the CURRENT version, exactly matching "reload the
    // newest current version as a completely fresh playtest."
    window.location.reload();
  }, [puzzle]);

  const currentPlaytestId = puzzle ? loadProgress(betaStorageKey(puzzle.id))?.gameSessionId ?? null : null;

  return (
    <div className="min-h-screen flex flex-col items-center pt-2 pb-12">
      <SEO
        title="Playtest — Rainbow Categories Beta"
        description="An unlisted playtesting area for upcoming Rainbow Categories puzzles."
        path={`/beta/${puzzleId ?? ""}`}
        noIndex
      />

      <GameHeader
        onStatsClick={() => {}}
        onHowToPlayClick={() => setActiveModal("help")}
        onSettingsClick={() => setActiveModal("settings")}
        onHintClick={() => setShowHintModal(true)}
        showHint={true}
        user={user ?? null}
        onSignOut={() => supabase.auth.signOut()}
        simplifiedIcons
        wideHeader
      />
      <div className="w-full max-w-[840px] border-b border-border mb-3" />

      <div className="w-full max-w-[840px] px-4 mb-2">
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5 sm:gap-2 mt-2">
          <button
            onClick={() => navigate("/beta")}
            className="w-[68px] sm:w-[88px] shrink-0 inline-flex items-center justify-center gap-0.5 whitespace-nowrap h-8 sm:h-9 rounded-full border border-border bg-card
              text-foreground text-[11px] sm:text-sm font-semibold
              hover:bg-secondary transition-colors active:scale-95"
          >
            <ChevronLeft className="w-3 h-3 sm:w-4 sm:h-4 shrink-0" />
            Beta
          </button>
          <h1 className="min-w-0 text-center overflow-hidden whitespace-nowrap text-ellipsis
            font-tile font-extrabold tracking-tight text-foreground text-[clamp(1.5rem,8vw,2rem)] sm:text-3xl">
            {puzzle?.title?.trim() || "Playtest"}
          </h1>
          <div className="w-[68px] sm:w-[88px] shrink-0" />
        </div>

        {/* Non-blocking playtest banner — shown whenever there's an actual
            playtest on screen, so nobody mistakes a result for an official
            one. Not shown on the not-found state, which has no game to
            disclaim anything about. */}
        {puzzle && !error && (
          <div className="mt-2 flex items-center justify-center gap-1.5 text-center text-xs sm:text-sm font-medium
            text-amber-800 dark:text-amber-200 bg-amber-100/80 dark:bg-amber-900/30 border border-amber-300/60 dark:border-amber-800/60
            rounded-full px-3 py-1.5 mx-auto w-fit">
            <FlaskConical className="w-3.5 h-3.5 shrink-0" />
            Playtest Puzzle — Results won't affect your official stats or streak.
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="animate-pulse" style={{ color: "hsl(var(--muted-foreground))" }}>Loading puzzle…</p>
        </div>
      ) : error || !puzzle ? (
        <div className="flex-1 flex items-center justify-center text-center px-4">
          <div>
            <p className="text-lg font-medium">Playtest not found.</p>
            <p className="text-sm text-muted-foreground mt-1">
              This puzzle may have been published or is no longer in Beta.
            </p>
            <button onClick={() => navigate("/beta")} className="text-sm mt-3 underline underline-offset-2" style={{ color: "hsl(var(--muted-foreground))" }}>
              Back to Beta puzzles
            </button>
          </div>
        </div>
      ) : (
        <GameBoard
          puzzle={puzzle}
          settings={settings}
          user={user ?? null}
          wideBoard
          showModeBadge={false}
          betaMode
          smallHintUsed={smallHintUsed}
          fullHintUsed={fullHintUsed}
          onHintClick={() => setShowHintModal(true)}
          entryContext="daily_home"
        />
      )}

      {/* Always available — before, during and after completion. */}
      {puzzle && !error && (
        <div className="w-full max-w-[840px] px-4 mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={() => setActiveModal("betaFeedback")}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-primary text-primary-foreground text-sm font-semibold
              hover:opacity-90 transition-all duration-150 active:scale-95 shadow-md"
          >
            <MessageSquarePlus className="w-4 h-4" /> Send Feedback
          </button>
          <button
            onClick={handleReset}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-border text-sm font-semibold
              hover:bg-secondary transition-all duration-150 active:scale-95 shadow-md"
          >
            <RotateCcw className="w-4 h-4" /> Reset Puzzle
          </button>
        </div>
      )}

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
      {puzzle && (
        <BetaFeedbackModal
          open={activeModal === "betaFeedback"}
          onClose={() => setActiveModal(null)}
          puzzleId={puzzle.id}
          puzzleVersionId={puzzle.versionId ?? null}
          playtestId={currentPlaytestId}
          hasRainbow={!!puzzle.rainbowHerring}
        />
      )}
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
