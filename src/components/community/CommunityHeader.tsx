import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import { AppMenuDrawer, HEADER_STROKE, headerGlyph, headerIconButton } from "@/components/AppMenuDrawer";
import { FeedbackModal } from "@/components/FeedbackModal";
import type { User } from "@supabase/supabase-js";

/** The real stacked Rainbow Categories wordmark (a 480px copy of /rainbow-categories-logo-stacked.webp). */
export const STACKED_WORDMARK = "/rainbow-categories-logo-stacked-480.webp";

/**
 * Community's compact header (preview): the app's own menu drawer, the real
 * stacked wordmark, and search. Kept deliberately light; the tabs sit under it.
 */
export function CommunityHeader({ user }: { user: User | null }) {
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  return (
    <header className="w-full max-w-[840px] mx-auto px-2 sm:px-4" data-testid="app-header">
      <div className="grid h-16 grid-cols-[48px_1fr_48px] items-center">
        <AppMenuDrawer onFeedback={() => { opener.current = document.activeElement as HTMLElement | null; setFeedbackOpen(true); }} />
        <Link
          to="/"
          aria-label="Rainbow Categories home"
          className="justify-self-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <img src={STACKED_WORDMARK} alt="" width={120} height={48} className="h-11 w-auto sm:h-12" data-testid="community-wordmark" />
        </Link>
        <Link to="/community?view=search" aria-label="Search Community puzzles and creators" className={`${headerIconButton} justify-self-end`}>
          <Search aria-hidden="true" className={headerGlyph} strokeWidth={HEADER_STROKE} />
        </Link>
      </div>
      <FeedbackModal open={feedbackOpen} onClose={() => { setFeedbackOpen(false); opener.current?.focus(); }} user={user} />
    </header>
  );
}
