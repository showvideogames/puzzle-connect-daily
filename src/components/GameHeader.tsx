import { useRef, useState } from "react";
import { socialBetaOn } from "@/components/social/socialFlag";
import { AppHeader } from "./AppHeader";
import { FeedbackModal } from "./FeedbackModal";
import { FULL_FORMAT, type PuzzleFormat } from "@/lib/puzzleFormat";
import type { User as AuthUser } from "@supabase/supabase-js";

interface GameHeaderProps {
  /** Omit on pages with no stats to show, and the stats icon is not rendered. */
  onStatsClick?: () => void;
  /**
   * Kept for the pages that pass it. How to Play has no header icon: it is in
   * Settings' menu (showMenuLinks) and in the header's menu drawer.
   */
  onHowToPlayClick?: () => void;
  /** Omit on pages with no settings to open, and the settings icon is not rendered. */
  onSettingsClick?: () => void;
  onHintClick?: () => void;
  showHint?: boolean;
  user: AuthUser | null;
  onSignOut: () => void;
  /** "minimal" is the Daily's header: the board-matching width. */
  variant?: "default" | "minimal";
  /** Kept for the pages that pass it; every game page now has the same icon set. */
  simplifiedIcons?: boolean;
  /** The board-matching 840px width, for pages whose board is that wide. */
  wideHeader?: boolean;
  /**
   * Which game this header belongs to. Its only effect is WHERE the calendar
   * icon points — a header on a Mini page must lead to the Mini archive, not
   * the Full one. Defaults to Full.
   */
  format?: PuzzleFormat;
}

/**
 * The game pages' header: the same AppHeader bar as every other page, with the
 * game's own extras. A hint button when a puzzle is in play, "Settings and
 * menu" (the game pages' Settings also carries their menu links), and the
 * profile picture only for a signed-in player while Friends and Groups is on,
 * as before — a signed-out player gets no sign-in button here; Settings has it.
 * The page keeps its own stats, settings and help dialogs.
 */
export function GameHeader({
  onStatsClick,
  onSettingsClick,
  onHintClick,
  showHint = false,
  user,
  onSignOut,
  variant = "default",
  wideHeader = false,
  format = FULL_FORMAT,
}: GameHeaderProps) {
  // The menu drawer's Give feedback. Not every game page has a feedback dialog
  // of its own, so the header brings one, and gives focus back to whatever
  // opened it (the hamburger) when it closes.
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const openFeedback = () => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setFeedbackOpen(true);
  };
  const closeFeedback = () => {
    setFeedbackOpen(false);
    const back = opener.current;
    opener.current = null;
    if (back) requestAnimationFrame(() => { if (back.isConnected) back.focus(); });
  };

  return (
    <>
      <AppHeader
        user={user}
        onSignOut={onSignOut}
        onStats={onStatsClick}
        onSettings={onSettingsClick}
        onFeedback={openFeedback}
        onHint={showHint ? onHintClick ?? (() => {}) : undefined}
        archivePath={format.archivePath}
        archiveLabel={format.id === "full" ? "Puzzle archive" : `${format.name} puzzle archive`}
        settingsLabel="Settings and menu"
        showProfile={!!user && socialBetaOn()}
        game={variant === "minimal" || wideHeader}
      />
      <FeedbackModal open={feedbackOpen} onClose={closeFeedback} user={user} />
    </>
  );
}
