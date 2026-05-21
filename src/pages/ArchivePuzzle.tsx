import { useState, useEffect, useCallback } from "react";
import { X } from "lucide-react";
import { useParams, useNavigate } from "react-router-dom";
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
    getPuzzleById(puzzleId)
      .then((p) => {
        if (!p) { setError(true); setLoading(false); return; }
        setPuzzle(p);
        setLoading(false);
      })
      .catch(() => { setError(true); setLoading(false); });
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
      />
      <div className="w-full max-w-lg border-b border-border mb-4" />

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

      <div className="w-full max-w-lg px-4 mb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => navigate("/")}
              className="bg-foreground text-background text-xs font-semibold rounded-full px-3 py-1.5
                hover:opacity-90 transition-opacity active:scale-95"
            >
              Today's Puzzle
            </button>
            <button
              onClick={() => navigate("/archive")}
              className="border border-border text-foreground text-xs font-semibold rounded-full px-3 py-1.5
                hover:bg-secondary transition-colors active:scale-95"
            >
              ← All Puzzles
            </button>
          </div>
          <span className="text-xs text-muted-foreground inline-flex items-center gap-1 pt-1.5">
            <span>🗄️</span> Archive
          </span>
        </div>

        {puzzle && (() => {
          const d = new Date(puzzle.date + "T12:00:00");
          const formattedDate = d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
          const titleText = puzzle.title?.trim()
            ? `Puzzle ${puzzle.title.trim()}`
            : formattedDate;
          const showDateSubtitle = !!puzzle.title?.trim();
          return (
            <div className="mt-4 text-center">
              <h1 className="text-2xl font-bold tracking-tight">{titleText}</h1>
              {showDateSubtitle && (
                <p className="text-sm text-muted-foreground mt-0.5">{formattedDate}</p>
              )}
            </div>
          );
        })()}
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
