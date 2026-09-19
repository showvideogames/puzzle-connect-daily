import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { GameBoard } from "@/components/GameBoard";
import { GameHeader } from "@/components/GameHeader";
import { CustomPuzzleHeader } from "@/components/CustomPuzzleHeader";
import { TutorialModal } from "@/components/TutorialModal";
import { SettingsModal } from "@/components/SettingsModal";
import { FeedbackModal } from "@/components/FeedbackModal";
import { SiteFooter } from "@/components/SiteFooter";
import { SEO } from "@/components/SEO";
import { HintModal } from "@/components/HintModal";
import {
  customPuzzlePath,
  getCustomPuzzleByShareId,
  getCustomPuzzleByShortCode,
  type CustomPlayablePuzzle,
} from "@/lib/customPuzzles";
import { useCustomFavorite } from "@/hooks/useCustomFavorite";
import { loadSettings, saveSettings, GameSettings } from "@/lib/settings";
import { trackEvent } from "@/lib/analytics";
import type { User } from "@supabase/supabase-js";

type ModalName = "help" | "settings" | "feedback" | null;

/**
 * Serves BOTH /p/:shortCode (the link new shares use) and the permanent
 * /custom/:shareId (every link shared before short codes existed). Either way
 * the puzzle resolves to the same Puzzle whose id is the long share id, so
 * local progress (`custom:<shareId>`), favorites and results are one identity
 * and moving between the two URLs never resets anything.
 */
export default function CustomPuzzle() {
  const { shareId, shortCode } = useParams<{ shareId?: string; shortCode?: string }>();
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [loaded, setLoaded] = useState<CustomPlayablePuzzle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [activeModal, setActiveModal] = useState<ModalName>(null);
  const [settings, setSettings] = useState<GameSettings>(loadSettings);
  const [showHintModal, setShowHintModal] = useState(false);
  const [smallHintUsed, setSmallHintUsed] = useState(false);
  const [fullHintUsed, setFullHintUsed] = useState(false);
  const puzzle = loaded?.puzzle ?? null;

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
    const key = shortCode ?? shareId;
    if (!key) { setError(true); setLoading(false); return; }
    setLoading(true);
    setError(false);
    const timeout = setTimeout(() => { setError(true); setLoading(false); }, 8000);
    (shortCode ? getCustomPuzzleByShortCode(shortCode) : getCustomPuzzleByShareId(shareId!))
      .then((result) => {
        clearTimeout(timeout);
        if (!result) { setError(true); setLoading(false); return; }
        setLoaded(result);
        setLoading(false);
        trackEvent("custom_puzzle_opened", { via: shortCode ? "short" : "long" });
      })
      .catch(() => {
        clearTimeout(timeout);
        setError(true);
        setLoading(false);
      });
    return () => clearTimeout(timeout);
  }, [shareId, shortCode]);

  const favorite = useCustomFavorite({
    shareId: puzzle?.id ?? null,
    serverFavorited: loaded?.favoritedByMe ?? false,
    serverCount: loaded?.favoriteCount ?? 0,
    userId: user === undefined ? undefined : user?.id ?? null,
  });

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
        path={puzzle ? customPuzzlePath(puzzle) : shortCode ? `/p/${shortCode}` : `/custom/${shareId ?? ""}`}
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

      {puzzle && !error ? (
        <CustomPuzzleHeader
          title={puzzle.title?.trim() || "Custom Puzzle"}
          designerName={puzzle.designerName}
          creatorSlug={loaded?.creatorSlug ?? null}
          isRainbow={!!puzzle.rainbowHerring}
          onBack={() => navigate("/create")}
          favorite={{ favorited: favorite.favorited, count: favorite.count, onToggle: favorite.toggle, note: favorite.note }}
        />
      ) : (
        <div className="w-full max-w-[840px] px-4 mb-2">
          <h1 className="text-center font-tile font-extrabold tracking-tight text-foreground text-[clamp(1.5rem,8vw,2rem)] sm:text-3xl mt-2">
            Custom Puzzle
          </h1>
        </div>
      )}

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
