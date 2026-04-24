import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { GameBoard } from "@/components/GameBoard";
import { GameHeader } from "@/components/GameHeader";
import { TutorialModal } from "@/components/TutorialModal";
import { StatsModal } from "@/components/StatsModal";
import { SettingsModal } from "@/components/SettingsModal";
import { HintModal } from "@/components/HintModal";
import { getPuzzleById } from "@/lib/puzzles";
import { Puzzle } from "@/lib/types";
import { loadSettings, saveSettings, GameSettings } from "@/lib/settings";
import type { User } from "@supabase/supabase-js";

type ModalName = "stats" | "help" | "settings" | null;

export default function ArchivePuzzle() {
  const { puzzleId } = useParams<{ puzzleId: string }>();
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [activeModal, setActiveModal] = useState<ModalName>(null);
  const [settings, setSettings] = useState<GameSettings>(loadSettings);
  const [showHintModal, setShowHintModal] = useState(false);
  const [hintsUsed, setHintsUsed] = useState(false);
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
    getPuzzleById(puzzleId)
      .then((p) => {
        if (!p) { setError(true); setLoading(false); return; }
        setPuzzle(p);
        setLoading(false);
      })
      .catch(() => { setError(true); setLoading(false); });
  }, [puzzleId]);

  const handleHintConfirm = useCallback(() => {
    setHintsUsed(true);
    setShowHintModal(false);
  }, []);

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
        onStatsClick={() => setActiveModal("stats")}
        onHowToPlayClick={() => setActiveModal("help")}
        onSettingsClick={() => setActiveModal("settings")}
        onHintClick={handleHeaderHintClick}
        user={user ?? null}
        onSignOut={() => supabase.auth.signOut()}
      />
      <div className="w-full max-w-lg border-b border-border mb-4" />

      {showSillyGoose && (
        <div className="w-full max-w-lg px-2 mb-2 animate-fade-up">
          <div className="bg-foreground text-background px-5 py-2.5 rounded-full text-sm font-semibold shadow-md text-center">
            You don't need hints! You already beat the puzzle, ya silly goose 🦆
          </div>
        </div>
      )}

      <div className="w-full max-w-lg px-4 mb-3">
        <button
          onClick={() => navigate("/archive")}
          className="text-xs hover:opacity-70 transition-opacity inline-flex items-center gap-1"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          ← Back to archive
        </button>
        {puzzle && (
          <p className="text-xs mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
            {puzzle.date}
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
          hintsUsed={hintsUsed}
          onHintClick={() => setShowHintModal(true)}
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
      />
      <HintModal
        open={showHintModal}
        onClose={() => setShowHintModal(false)}
        onConfirm={handleHintConfirm}
      />
    </div>
  );
}
