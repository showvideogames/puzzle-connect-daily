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
import { ChevronDown, ChevronUp } from "lucide-react";

type ModalName = "stats" | "help" | "settings" | null;

const DIFFICULTY_EMOJI: Record<number, string> = {
  0: "🟧",
  1: "🟩",
  2: "🟦",
  3: "🟥",
};

interface PreviousSession {
  id: string;
  won: boolean;
  mistakes: number;
  found_rainbow: boolean;
  hints_used: boolean;
  created_at: string;
}

interface GuessEvent {
  guess_number: number;
  words: string[];
  correct: boolean;
  is_rainbow?: boolean;
}

function buildEmojiRow(words: string[], puzzle: Puzzle): string {
  return words
    .map((word) => {
      const group = puzzle.groups.find((g) => g.words.includes(word));
      if (!group) return "⬜";
      return DIFFICULTY_EMOJI[group.difficulty - 1] ?? "⬜";
    })
    .join("");
}

function PreviousResult({ puzzleId, puzzle, user }: { puzzleId: string; puzzle: Puzzle; user: User | null }) {
  const [expanded, setExpanded] = useState(false);
  const [session, setSession] = useState<PreviousSession | null | undefined>(undefined);
  const [guessEvents, setGuessEvents] = useState<GuessEvent[]>([]);

  useEffect(() => {
    if (!user) { setSession(null); return; }
    supabase
      .from("game_sessions")
      .select("id, won, mistakes, found_rainbow, hints_used, created_at")
      .eq("puzzle_id", puzzleId)
      .eq("user_id", user.id)
      .order("id", { ascending: true })
      .limit(1)
      .single()
      .then(({ data }) => {
        if (!data) { setSession(null); return; }
        setSession(data as PreviousSession);
        supabase
          .from("guess_events")
          .select("guess_number, words, correct")
          .eq("game_session_id", data.id)
          .order("guess_number", { ascending: true })
          .then(({ data: events }) => setGuessEvents((events ?? []) as GuessEvent[]));
      });
  }, [puzzleId, user]);

  if (session === undefined || session === null) return null;

  const formattedDate = new Date(session.created_at).toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  });

  // Build emoji lines — prepend 💡 on row 2 if hints were used
  const rawLines = guessEvents.map((e) => buildEmojiRow(e.words, puzzle));
  const emojiLines: string[] = [];
  if (session.hints_used && rawLines.length > 0) {
    emojiLines.push(rawLines[0]);
    emojiLines.push("💡");
    emojiLines.push(...rawLines.slice(1));
  } else {
    emojiLines.push(...rawLines);
  }

  return (
    <div className="w-full max-w-lg px-4 mt-6">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-border
          bg-card hover:bg-secondary transition-colors text-sm font-medium"
      >
        <span>Reveal your original result 🙈</span>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>
      {expanded && (
        <div className="mt-2 rounded-xl border border-border bg-card px-4 py-4 space-y-3 animate-fade-up">
          {emojiLines.length > 0 && (
            <div className="flex flex-col items-center gap-0.5">
              {emojiLines.map((line, i) => (
                <span key={i} className="text-2xl leading-tight tracking-wider">{line}</span>
              ))}
            </div>
          )}
          <div className="flex items-center justify-center gap-4 text-sm text-muted-foreground flex-wrap">
            <span>{session.mistakes === 0 ? "No mistakes" : `${session.mistakes} mistake${session.mistakes === 1 ? "" : "s"}`}</span>
            {session.found_rainbow && <span>🌈 Rainbow found</span>}
            {session.hints_used && <span>💡 Hints used</span>}
            <span>Played {formattedDate}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ArchivePuzzle() {
  const { puzzleId } = useParams<{ puzzleId: string }>();
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [activeModal, setActiveModal] = useState<ModalName>(null);
  const [settings, setSettings] = useState<GameSettings>(loadSettings);
  const [showHintModal, setShowHintModal] = useState(false);
  const [hintsUsed, setHintsUsed] = useState(false);
  const [isPuzzleComplete, setIsPuzzleComplete] = useState(false);
  const [showSillyGoose, setShowSillyGoose] = useState(false);

  // Clear localStorage only if puzzle was already completed — so it starts fresh for replay
useEffect(() => {
  if (!puzzleId) return;
  try {
    const key = `connections-progress-${puzzleId}`;
    const raw = localStorage.getItem(key);
    if (raw) {
      const data = JSON.parse(raw);
      if (data.isComplete === true) {
        localStorage.removeItem(key);
      }
    }
  } catch {}
}, [puzzleId]);

  const handleSettingsChange = (s: GameSettings) => {
    setSettings(s);
    saveSettings(s);
    document.documentElement.classList.toggle("dark", s.darkMode);
  };

  useEffect(() => {
    document.documentElement.classList.toggle("dark", settings.darkMode);
  }, [settings.darkMode]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!puzzleId) { setError(true); setLoading(false); return; }
    getPuzzleById(puzzleId)
      .then((p) => {
        if (!p) setError(true);
        else setPuzzle(p);
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
        user={user}
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
            user={user}
            isArchive
            hintsUsed={hintsUsed}
            onHintClick={() => setShowHintModal(true)}
            onComplete={() => setIsPuzzleComplete(true)}
          />
          {puzzleId && <PreviousResult puzzleId={puzzleId} puzzle={puzzle} user={user} />}
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
