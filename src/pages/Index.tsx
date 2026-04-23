import { useState, useEffect, useCallback } from "react";
import { GameHeader } from "@/components/GameHeader";
import { GameBoard } from "@/components/GameBoard";
import { StatsModal } from "@/components/StatsModal";
import { TutorialModal } from "@/components/TutorialModal";
import { SettingsModal } from "@/components/SettingsModal";
import { HintModal } from "@/components/HintModal";
import { getTodaysPuzzle } from "@/lib/puzzles";
import { Puzzle } from "@/lib/types";
import { loadSettings, saveSettings, GameSettings } from "@/lib/settings";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

const TUTORIAL_SEEN_KEY = "tutorial-seen";

type ModalName = "stats" | "help" | "settings" | null;

export default function Index() {
  const [activeModal, setActiveModal] = useState<ModalName>(null);
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [settings, setSettings] = useState<GameSettings>(loadSettings);
  const [clearColorsTrigger, setClearColorsTrigger] = useState(0);
  const [showHintModal, setShowHintModal] = useState(false);
  const [hintsUsed, setHintsUsed] = useState(false);
  const [isPuzzleComplete, setIsPuzzleComplete] = useState(() => {
    try {
      return Object.keys(localStorage).filter(k => k.startsWith("connections-progress-")).some(k => JSON.parse(localStorage.getItem(k) || "{}").isComplete === true);
    } catch { return false; }
  });
  const [showSillyGoose, setShowSillyGoose] = useState(false);

  const openModal = useCallback((name: ModalName) => setActiveModal(name), []);
  const closeModal = useCallback(() => setActiveModal(null), []);

  const handleSettingsChange = useCallback((newSettings: GameSettings) => {
    setSettings(newSettings);
    saveSettings(newSettings);
    document.documentElement.classList.toggle("dark", newSettings.darkMode);
    if (!newSettings.colorCodeTiles) {
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

  const handleHintConfirm = useCallback(() => {
    setHintsUsed(true);
    setShowHintModal(false);
  }, []);

  // Header hint button — routes to silly goose if puzzle is complete
  const handleHeaderHintClick = useCallback(() => {
    if (isPuzzleComplete) {
      setShowSillyGoose(true);
      setTimeout(() => setShowSillyGoose(false), 3000);
    } else {
      setShowHintModal(true);
    }
  }, [isPuzzleComplete]);

  return (
    <div className="min-h-screen flex flex-col items-center pt-2 pb-12">
      <GameHeader
        onStatsClick={() => openModal("stats")}
        onHowToPlayClick={() => openModal("help")}
        onSettingsClick={() => openModal("settings")}
        onHintClick={handleHeaderHintClick}
        user={user}
        onSignOut={handleSignOut}
      />
      <div className="w-full max-w-lg border-b border-border mb-4" />

      {/* Silly goose toast — shown when hint tapped after puzzle complete */}
      {showSillyGoose && (
        <div className="w-full max-w-lg px-2 mb-2 animate-fade-up">
          <div className="bg-foreground text-background px-5 py-2.5 rounded-full text-sm font-semibold shadow-md text-center">
            You don't need hints! You already beat the puzzle silly goose 🦆
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
          hintsUsed={hintsUsed}
          onHintClick={() => setShowHintModal(true)}
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
      />
      <HintModal
        open={showHintModal}
        onClose={() => setShowHintModal(false)}
        onConfirm={handleHintConfirm}
      />
    </div>
  );
}
