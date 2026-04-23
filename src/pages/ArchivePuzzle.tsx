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

interface PreviousSession {
  id: string;
  won: boolean;
  mistakes: number;
  found_rainbow: boolean;
  hints_used: boolean;
  share_grid: string | null;
}

function PreviousResult({ puzzleId, user }: {
  puzzleId: string;
  user: User | null | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const [session, setSession] = useState<PreviousSession | null | undefined>(undefined);

  useEffect(() => {
    if (user === undefined) return;
    if (user === null) { setSession(null); return; }

    supabase
      .from("game_sessions")
      .select("id, won, mistakes, found_rainbow, hints_used, share_grid")
      .eq("puzzle_id", puzzleId)
      .eq("user_id", user.id)
      .order("id", { ascending: true })
      .limit(1)
      .single()
      .then(({ data }) => {
        if (!data) { setSession(null); return; }
        setSession(data as PreviousSession);
      });
  }, [puzzleId, user]);

  if (session === undefined || session === null) return null;

  const gridLines = session.share_grid ? session.share_grid.split("\n") : [];

  return (
    <div className="w-full max-w-lg px-4 mt-6 flex flex-col items-center">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-border
          bg-card hover:bg-secondary transition-colors text-sm font-semibold shadow-sm"
      >
        {expanded ? "Hide original result 🙈" : "Reveal your original result 🙈"}
      </button>

      {expanded && (
        <div className="mt-3 rounded-xl border border-border bg-card px-6 py-4 space-y-3 animate-fade-up w-full">
          {gridLines.length > 0 ? (
            <div className="flex flex-col items-center gap-0.5">
              {gridLines.map((line, i) => (
                <span key={i} className="text-2xl leading-tight tracking-wider">{line}</span>
              ))}
            </div>
          ) : (
            <p className="text-center text-sm text-muted-foreground">No grid available for this result.</p>
          )}
          <div className="flex items-center justify-center gap-4 text-sm text-muted-foreground flex-wrap">
            <span>{session.mistakes === 0 ? "No mistakes" : `${session.mistakes} mistake${session.mistakes === 1 ? "" : "s"}`}</span>
            {session.found_rainbow && <span>🌈 Rainbow found</span>}
            {session.hints_used && <span>💡 Hints used</span>}
          </div>
        </div>
      )}
    </div>
  );
}

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
        // Clear completed progress before GameBoard mounts so it always starts fresh
        try {
          const key = `connections-progress-${puzzleId}`;
          const raw = localStorage.getItem(key);
          if (raw) {
            const data = JSON.parse(raw);
            if (data.isComplete === true) localStorage.removeItem(key);
          }
        } catch {}
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
        <>
          <GameBoard
            puzzle={puzzle}
            settings={settings}
            user={user ?? null}
            isArchive
            hintsUsed={hintsUsed}
            onHintClick={() => setShowHintModal(true)}
            onComplete={() => setIsPuzzleComplete(true)}
          />
          {puzzleId && <PreviousResult puzzleId={puzzleId} user={user} />}
        </>
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
