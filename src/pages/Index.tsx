import { useState, useEffect, useCallback, useMemo } from "react";
import { X } from "lucide-react";
import { GameHeader } from "@/components/GameHeader";
import { GameBoard } from "@/components/GameBoard";
import { LandingScreen } from "@/components/LandingScreen";
import { PlayerAuth } from "@/components/PlayerAuth";
import { useImagePreload } from "@/hooks/useImagePreload";
import { hasInProgressGame } from "@/hooks/useGame";
import { isCustomEmoji, customEmojiUrl } from "@/lib/customEmoji";
import { StatsModal } from "@/components/StatsModal";
import { TutorialModal } from "@/components/TutorialModal";
import { SettingsModal } from "@/components/SettingsModal";
import { FeedbackModal } from "@/components/FeedbackModal";
import { SEO } from "@/components/SEO";
import { SiteFooter } from "@/components/SiteFooter";
import { HintModal } from "@/components/HintModal";
import { getTodaysPuzzle } from "@/lib/puzzles";
import { Puzzle } from "@/lib/types";
import { loadSettings, saveSettings, GameSettings } from "@/lib/settings";
import { trackEvent } from "@/lib/analytics";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

const TUTORIAL_SEEN_KEY = "tutorial-seen";
const LANDING_KEY_PREFIX = "landing-seen-";

type ModalName = "stats" | "help" | "settings" | "feedback" | null;

export default function Index() {
  const [activeModal, setActiveModal] = useState<ModalName>(null);
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [settings, setSettings] = useState<GameSettings>(loadSettings);
  const [clearColorsTrigger, setClearColorsTrigger] = useState(0);
  const [showHintModal, setShowHintModal] = useState(false);
  const [smallHintUsed, setSmallHintUsed] = useState(false);
  const [fullHintUsed, setFullHintUsed] = useState(false);
  const [isPuzzleComplete, setIsPuzzleComplete] = useState(false);
  const [showSillyGoose, setShowSillyGoose] = useState(false);
  // Default to true so returning players don't see a board flash before the
  // landing renders. If we determine the user should skip the landing (already
  // seen today, or mid-game), we flip it off. If the puzzle never loads, the
  // gate below (`puzzle && showLanding`) keeps anything from rendering.
  const [showLanding, setShowLanding] = useState(true);
  const [landingAuthOpen, setLandingAuthOpen] = useState(false);

  // Skip the landing once the puzzle has loaded if we already showed it today
  // or there's an in-progress local game session for this puzzle.
  useEffect(() => {
    if (!puzzle) return;
    const seen = (() => {
      try {
        return !!localStorage.getItem(LANDING_KEY_PREFIX + puzzle.date);
      } catch {
        return false;
      }
    })();
    const inProgress = hasInProgressGame(puzzle.id);
    if (seen || inProgress) setShowLanding(false);
  }, [puzzle]);

  // Warm the browser cache for custom emoji while the landing is visible.
  const preloadUrls = useMemo(() => {
    if (!puzzle) return [] as string[];
    return [
      ...puzzle.groups.flatMap((g) => g.words),
      ...(puzzle.rainbowHerring ?? []),
    ]
      .filter(isCustomEmoji)
      .map((w) => customEmojiUrl(w));
  }, [puzzle]);
  useImagePreload(preloadUrls);

  const handleLandingPlay = useCallback(() => {
    if (!puzzle) return;
    try {
      localStorage.setItem(LANDING_KEY_PREFIX + puzzle.date, "1");
    } catch {
      // ignore
    }
    setShowLanding(false);
  }, [puzzle]);

  const openModal = useCallback((name: ModalName) => setActiveModal(name), []);
  const closeModal = useCallback(() => setActiveModal(null), []);

  const handleSettingsChange = useCallback((newSettings: GameSettings) => {
    setSettings(newSettings);
    saveSettings(newSettings);
    document.documentElement.classList.toggle("dark", newSettings.darkMode);
    if (!newSettings.colorCodeTiles && !newSettings.colorPaletteMode) {
      setClearColorsTrigger((n) => n + 1);
    }
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", settings.darkMode);
  }, [settings.darkMode]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setError(true);
      setLoading(false);
    }, 8000);

    getTodaysPuzzle()
      .then((p) => {
        clearTimeout(timeout);
        setPuzzle(p);
        setLoading(false);
      })
      .catch(() => {
        clearTimeout(timeout);
        setError(true);
        setLoading(false);
      });

    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    try {
      const seen = localStorage.getItem(TUTORIAL_SEEN_KEY);
      if (!seen) {
        setTimeout(() => setActiveModal("help"), 800);
      }
    } catch {}
  }, []);

  const handleTutorialClose = useCallback(() => {
    try {
      localStorage.setItem(TUTORIAL_SEEN_KEY, "true");
    } catch {}
    closeModal();
  }, [closeModal]);

  const handleSignOut = useCallback(() => {
    supabase.auth.signOut();
  }, []);

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

  // Header hint button — routes to silly goose if puzzle is complete
  const handleHeaderHintClick = useCallback(() => {
    if (isPuzzleComplete) {
      setShowSillyGoose(true);
    } else {
      setShowHintModal(true);
    }
  }, [isPuzzleComplete]);

  if (puzzle && showLanding) {
    return (
      <>
        <SEO
          title="Rainbow Categories — A Daily Word Puzzle Game with a Hidden Twist"
          description="Free daily word puzzle game. Sort 16 words into 4 categories and find the hidden rainbow within. A creative twist on word categorization games."
          path="/"
        />
        <LandingScreen
          puzzle={puzzle}
          user={user}
          onPlay={handleLandingPlay}
          onSignInClick={() => setLandingAuthOpen(true)}
        />
        <PlayerAuth
          user={user}
          onSignOut={handleSignOut}
          hideTrigger
          forceOpen={landingAuthOpen}
          onForceClose={() => setLandingAuthOpen(false)}
        />
      </>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center pt-2 pb-12">
      <SEO
        title="Rainbow Categories — A Daily Word Puzzle Game with a Hidden Twist"
        description="Free daily word puzzle game. Sort 16 words into 4 categories and find the hidden rainbow within. A creative twist on word categorization games."
        path="/"
      />
      <GameHeader
        onStatsClick={() => openModal("stats")}
        onHowToPlayClick={() => openModal("help")}
        onSettingsClick={() => openModal("settings")}
        onHintClick={handleHeaderHintClick}
        showHint={true}
        user={user}
        onSignOut={handleSignOut}
      />
      <div className="w-full max-w-lg border-b border-border mb-4" />

      {/* Silly goose toast — shown when hint tapped after puzzle complete */}
      {showSillyGoose && (
        <div className="w-full max-w-lg px-2 mb-2 animate-fade-up">
          <div className="bg-foreground text-background pl-5 pr-2 py-2.5 rounded-full text-sm font-semibold shadow-md flex items-center justify-between gap-3">
            <span className="flex-1 text-center">You don't need hints! You already beat the puzzle silly goose 🦆</span>
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

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground animate-pulse">Loading puzzle…</p>
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center text-center px-4">
          <div>
            <p className="text-lg font-medium">Something went wrong.</p>
            <p className="text-sm text-muted-foreground mt-1">Couldn't load today's puzzle. Please refresh and try again.</p>
          </div>
        </div>
      ) : puzzle ? (
        <GameBoard
          puzzle={puzzle}
          settings={settings}
          user={user}
          clearColorsTrigger={clearColorsTrigger}
          smallHintUsed={smallHintUsed}
          fullHintUsed={fullHintUsed}
          onHintClick={handleHeaderHintClick}
          onComplete={() => setIsPuzzleComplete(true)}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-center px-4">
          <div>
            <p className="text-lg font-medium">No puzzle available today.</p>
            <p className="text-sm text-muted-foreground mt-1">Check back soon!</p>
          </div>
        </div>
      )}

      <StatsModal open={activeModal === "stats"} onClose={closeModal} />
      <TutorialModal
        open={activeModal === "help"}
        onClose={handleTutorialClose}
      />
      <SettingsModal
        open={activeModal === "settings"}
        onClose={closeModal}
        settings={settings}
        onSettingsChange={handleSettingsChange}
        onOpenFeedback={() => setActiveModal("feedback")}
      />
      <FeedbackModal
        open={activeModal === "feedback"}
        onClose={closeModal}
        user={user}
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
