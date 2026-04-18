import { useState, useEffect, useCallback } from "react";
import { GameHeader } from "@/components/GameHeader";
import { GameBoard } from "@/components/GameBoard";
import { StatsModal } from "@/components/StatsModal";
import { TutorialModal } from "@/components/TutorialModal";
import { SettingsModal } from "@/components/SettingsModal";
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

  const openModal = useCallback((name: ModalName) => setActiveModal(name), []);
  const closeModal = useCallback(() => setActiveModal(null), []);

  const handleSettingsChange = useCallback((newSettings: GameSettings) => {
    setSettings(newSettings);
    saveSettings(newSettings);
    document.documentElement.classList.toggle("dark", newSettings.darkMode);
    // If Color-Code Tiles just got turned off, tell GameBoard to clear all colors
    if (!newSettings.colorCodeTiles) {
      setClearColorsTrigger((n) => n + 1);
    }
  }, []);

  // Apply dark mode once on mount
  useEffect(() => {
    document.documentElement.classList.toggle("dark", settings.darkMode);
  }, [settings.darkMode]);

  // Auth state
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Load puzzle
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

  // Auto-show tutorial on first visit
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

  return (
    <div className="min-h-screen flex flex-col items-center pt-2 pb-12">
      <GameHeader
        onStatsClick={() => openModal("stats")}
        onHowToPlayClick={() => openModal("help")}
        onSettingsClick={() => openModal("settings")}
        user={user}
        onSignOut={handleSignOut}
      />
      <div className="w-full max-w-lg border-b border-border mb-4" />

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
        <GameBoard puzzle={puzzle} settings={settings} user={user} clearColorsTrigger={clearColorsTrigger} />
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
    </div>
  );
}
