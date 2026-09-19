import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { GameBoard } from "@/components/GameBoard";
import { GameHeader } from "@/components/GameHeader";
import { TutorialModal } from "@/components/TutorialModal";
import { SettingsModal } from "@/components/SettingsModal";
import { FeedbackModal } from "@/components/FeedbackModal";
import { SiteFooter } from "@/components/SiteFooter";
import { SEO } from "@/components/SEO";
import { HintModal } from "@/components/HintModal";
import { getCustomPuzzleByShareId } from "@/lib/customPuzzles";
import { Puzzle } from "@/lib/types";
import { loadSettings, saveSettings, GameSettings } from "@/lib/settings";
import { trackEvent } from "@/lib/analytics";
import type { User } from "@supabase/supabase-js";

type ModalName = "help" | "settings" | "feedback" | null;

export default function CustomPuzzle() {
  const { shareId } = useParams<{ shareId: string }>();
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
    supabase.auth.getSession().then(({ data: { session } }) => setUser(session?.user ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!shareId) { setError(true); setLoading(false); return; }
    setLoading(true);
    setError(false);
    const timeout = setTimeout(() => { setError(true); setLoading(false); }, 8000);
    getCustomPuzzleByShareId(shareId)
      .then((result) => {
        clearTimeout(timeout);
        if (!result) { setError(true); setLoading(false); return; }
        setPuzzle(result.puzzle);
        setLoading(false);
        trackEvent("custom_puzzle_opened", { share_id: shareId });
      })
      .catch(() => {
        clearTimeout(timeout);
        setError(true);
        setLoading(false);
      });
    return () => clearTimeout(timeout);
  }, [shareId]);

  const handleSettingsChange = (s: GameSettings) => {
    setSettings(s);
    saveSettings(s);
    document.documentElement.classList.toggle("dark", s.darkMode);
  };

  const handleSmallHint = useCallback(() => setSmallHintUsed(true), []);
  const handleFullHint = useCallback(() => setFullHintUsed(true), []);

  return (
    <div className="min-h-screen flex flex-col items-center pt-2 pb-12">
      <SEO
        title={puzzle?.title?.trim() ? `${puzzle.title.trim()} — Rainbow Connect` : "Custom Puzzle — Rainbow Connect"}
        description="A custom Rainbow Connect puzzle shared by a player."
        path={`/custom/${shareId ?? ""}`}
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
            onClick={() => navigate("/create")}
            className="w-[68px] sm:w-[88px] shrink-0 inline-flex items-center justify-center gap-0.5 whitespace-nowrap h-8 sm:h-9 rounded-full border border-border bg-card
              text-foreground text-[11px] sm:text-sm font-semibold
              hover:bg-secondary transition-colors active:scale-95"
          >
            <ChevronLeft className="w-3 h-3 sm:w-4 sm:h-4 shrink-0" />
            Create
          </button>
          <h1 className="min-w-0 text-center overflow-hidden whitespace-nowrap text-ellipsis
            font-tile font-extrabold tracking-tight text-foreground text-[clamp(1.5rem,8vw,2rem)] sm:text-3xl">
            {puzzle?.title?.trim() || "Custom Puzzle"}
          </h1>
          <div className="w-[68px] sm:w-[88px] shrink-0" />
        </div>
        {puzzle && !error && (
          <p className="text-center text-xs sm:text-sm text-muted-foreground mt-1">
            by {puzzle.designerName}
          </p>
        )}
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="animate-pulse" style={{ color: "hsl(var(--muted-foreground))" }}>Loading puzzle…</p>
        </div>
      ) : error || !puzzle ? (
        <div className="flex-1 flex items-center justify-center text-center px-4">
          <div>
            <p className="text-lg font-medium">Puzzle not found.</p>
            <p className="text-sm text-muted-foreground mt-1">
              This link may be wrong, or the puzzle may no longer be available.
            </p>
            <button onClick={() => navigate("/create")} className="text-sm mt-3 underline underline-offset-2" style={{ color: "hsl(var(--muted-foreground))" }}>
              Create your own puzzle
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
          customMode
          smallHintUsed={smallHintUsed}
          fullHintUsed={fullHintUsed}
          onHintClick={() => setShowHintModal(true)}
          entryContext="daily_home"
        />
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
