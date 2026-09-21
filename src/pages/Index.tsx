import { useState, useEffect, useCallback, useMemo } from "react";
import { X } from "lucide-react";
import { useVersionCheck } from "@/hooks/useVersionCheck";
import { UpdateBanner } from "@/components/UpdateBanner";
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
import { resolvePlayablePuzzle } from "@/lib/puzzleVersion";
import { Puzzle } from "@/lib/types";
import { FULL_FORMAT, progressStorageId, rainbowHerringFor, type PuzzleFormat } from "@/lib/puzzleFormat";
import { loadSettings, saveSettings, GameSettings } from "@/lib/settings";
import { trackEvent } from "@/lib/analytics";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

const TUTORIAL_SEEN_KEY = "tutorial-seen";
const LANDING_KEY_PREFIX = "landing-seen-";

type ModalName = "stats" | "help" | "settings" | "feedback" | null;

interface IndexProps {
  /**
   * Which Daily this page IS. Full and Mini are sibling games — separate
   * published puzzle per date, separate progress, separate statistics and
   * streak — and this one prop is the whole difference between the two
   * routes. Defaults to Full, so "/" is untouched.
   */
  format?: PuzzleFormat;
}

export default function Index({ format = FULL_FORMAT }: IndexProps = {}) {
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
  const [hintsViewOnly, setHintsViewOnly] = useState(false);
  const [showSillyGoose, setShowSillyGoose] = useState(false);
  // Tracks whether the user has dismissed the landing via the Play button.
  const [landingDismissed, setLandingDismissed] = useState(false);
  const [landingAuthOpen, setLandingAuthOpen] = useState(false);

  // The "already saw the landing for this date" flag is per format as well as
  // per date, so seeing the Full landing today does not silently skip the
  // Mini one. Full keeps its original un-suffixed key, so nobody who has
  // already dismissed today's landing sees it again.
  const landingKey = useCallback(
    (date: string) => LANDING_KEY_PREFIX + date + (format.id === "full" ? "" : `-${format.id}`),
    [format.id]
  );

  // Compute eligibility synchronously on every render so there's no flash
  // in either direction. While the puzzle is still loading we *optimistically*
  // show the landing (rainbow background already paints from the static
  // index.html, so users see continuous color rather than a white screen).
  // Once the puzzle data arrives we recheck — if the user should skip the
  // landing (already seen it today or has an in-progress session), we flip
  // straight to the board.
  const isLandingEligible = useMemo(() => {
    if (error) return false;
    // Still loading: optimistically show the landing (the rainbow background
    // is already painted by index.html, so this reads as continuous colour
    // rather than a white screen).
    if (loading) return true;
    // Loading FINISHED and there is no puzzle for this format today. The
    // landing's Play button would lead nowhere, so the page shows its
    // unavailable state instead of a door with nothing behind it. This is
    // what makes /mini honest before any Mini has been published.
    if (!puzzle) return false;
    try {
      if (localStorage.getItem(landingKey(puzzle.date))) return false;
    } catch {
      // localStorage unavailable — fall through and show landing
    }
    // The FORMAT-NAMESPACED progress key, not the bare puzzle id: today's
    // Full game and today's Mini game are separate boards a player may have
    // in progress at the same time.
    if (hasInProgressGame(progressStorageId(puzzle.id, format))) return false;
    return true;
  }, [puzzle, error, loading, format, landingKey]);

  const showLanding = isLandingEligible && !landingDismissed;

  // Warm the browser cache for custom emoji while the landing is visible.
  const preloadUrls = useMemo(() => {
    if (!puzzle) return [] as string[];
    return [
      ...puzzle.groups.flatMap((g) => g.words),
      ...(rainbowHerringFor(puzzle) ?? []),
    ]
      .filter(isCustomEmoji)
      .map((w) => customEmojiUrl(w));
  }, [puzzle]);
  useImagePreload(preloadUrls);

  const handleLandingPlay = useCallback(() => {
    if (!puzzle) return;
    try {
      localStorage.setItem(landingKey(puzzle.date), "1");
    } catch {
      // ignore
    }
    setLandingDismissed(true);
  }, [puzzle, landingKey]);

  // Per-format page copy. Full keeps its exact existing title and
  // description — those are its live search-result text and are not being
  // rewritten here.
  const seo =
    format.id === "full"
      ? {
          title: "Rainbow Categories — A Daily Word Puzzle Game with a Hidden Twist",
          description:
            "Free daily word puzzle game. Sort 16 words into 4 categories and find the hidden rainbow within. A creative twist on word categorization games.",
        }
      : {
          title: `Rainbow Categories ${format.name} — A Quick ${format.sizeLabel} Daily Word Puzzle`,
          description: `A quicker daily word puzzle. Sort ${format.tileCount} words into ${format.categoryCount} hidden categories.`,
        };

  const updateAvailable = useVersionCheck();

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
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const newUser = session?.user ?? null;
      setUser(newUser);
      // The one-time import decision is owned by OnboardingGate, which asks
      // the server on every authenticated load rather than trying to infer a
      // signup from the auth event type.
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadPuzzle = useCallback(() => {
    setError(false);
    setLoading(true);
    const timeout = setTimeout(() => {
      setError(true);
      setLoading(false);
    }, 8000);

    getTodaysPuzzle(format.id)
      .then((p) => {
        clearTimeout(timeout);
        // Resolve the version to actually play BEFORE the board is built, so
        // a game already in progress against an earlier version resumes on
        // that content rather than flickering through the newer one. For a
        // new player, a completed game, or a puzzle that was never edited,
        // this returns exactly what was loaded. See lib/puzzleVersion.ts.
        // The progress key is format-namespaced for the same reason the
        // landing check above is.
        setPuzzle(p ? resolvePlayablePuzzle(p, progressStorageId(p.id, format)) : null);
        setLoading(false);
      })
      .catch(() => {
        clearTimeout(timeout);
        setError(true);
        setLoading(false);
      });

    return () => clearTimeout(timeout);
  }, [format]);

  useEffect(() => loadPuzzle(), [loadPuzzle]);

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
    // Fully resolved (Rainbow result included) = view-only hints, no goose.
    if (isPuzzleComplete && !hintsViewOnly) {
      setShowSillyGoose(true);
    } else {
      setShowHintModal(true);
    }
  }, [isPuzzleComplete, hintsViewOnly]);

  if (showLanding) {
    return (
      <>
        <SEO title={seo.title} description={seo.description} path={format.dailyPath} />
        <LandingScreen
          puzzle={puzzle}
          user={user}
          format={format}
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
      {updateAvailable && (
        <UpdateBanner onUpdate={() => window.location.reload()} />
      )}
      <SEO title={seo.title} description={seo.description} path={format.dailyPath} />
      <GameHeader
        onStatsClick={() => openModal("stats")}
        onHowToPlayClick={() => openModal("help")}
        onSettingsClick={() => openModal("settings")}
        onHintClick={handleHeaderHintClick}
        showHint={true}
        user={user}
        onSignOut={handleSignOut}
        variant="minimal"
      />
      <div className="w-full max-w-[840px] border-b border-divider mb-2" />

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

      {error ? (
        /* The one genuinely blocking failure: no puzzle content means there
           is nothing to play. A failure to SAVE is handled very differently —
           the game stays playable and only gets a notice. */
        <div className="flex-1 flex items-center justify-center text-center px-4">
          <div>
            <p className="text-lg font-medium">Something went wrong.</p>
            <p className="text-sm text-muted-foreground mt-1">
              Couldn't load today's puzzle.
            </p>
            <button
              onClick={loadPuzzle}
              className="mt-4 px-5 py-2.5 rounded-full text-sm font-semibold transition-opacity hover:opacity-90 active:scale-95"
              style={{ background: "hsl(var(--foreground))", color: "hsl(var(--background))" }}
            >
              Retry
            </button>
          </div>
        </div>
      ) : puzzle ? (
        <GameBoard
          puzzle={puzzle}
          settings={settings}
          user={user}
          clearColorsTrigger={clearColorsTrigger}
          smallHintUsed={smallHintUsed}
          onHintsViewOnlyChange={setHintsViewOnly}
          fullHintUsed={fullHintUsed}
          onHintClick={handleHeaderHintClick}
          onComplete={() => setIsPuzzleComplete(true)}
          variant="dailyHomepage"
          key={format.id}
          // Removed per feedback: the Rainbow/4-Groups badge read as
          // needless clutter floating over the Daily homepage board.
          showModeBadge={false}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-center px-4">
          <div>
            <p className="text-lg font-medium">No {format.name} {format.sizeLabel} puzzle available today.</p>
            <p className="text-sm text-muted-foreground mt-1">Check back soon!</p>
            {format.id !== "full" && (
              <a href="/" className="inline-block mt-4 text-sm font-semibold underline underline-offset-2">
                Play today's Full 4×4 puzzle
              </a>
            )}
          </div>
        </div>
      )}

      <StatsModal open={activeModal === "stats"} onClose={closeModal} format={format} />
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
        showMenuLinks
        onHowToPlayClick={() => openModal("help")}
        user={user}
        onSignOut={handleSignOut}
      />
      <FeedbackModal
        open={activeModal === "feedback"}
        onClose={closeModal}
        user={user}
      />
      <HintModal
        open={showHintModal}
        onClose={() => setShowHintModal(false)}
        viewOnly={hintsViewOnly}
        onSmallHint={handleSmallHint}
        onFullHint={handleFullHint}
        puzzle={puzzle}
      />
      <SiteFooter />
    </div>
  );
}
