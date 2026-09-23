import { useEffect, useState } from "react";
import { BarChart3, BookOpen, Archive, Settings } from "lucide-react";
import { Link } from "react-router-dom";
import { PlayerAuth } from "./PlayerAuth";
import { StatsModal } from "./StatsModal";
import { SettingsModal } from "./SettingsModal";
import { FeedbackModal } from "./FeedbackModal";
import { supabase } from "@/integrations/supabase/client";
import { loadSettings, saveSettings, GameSettings } from "@/lib/settings";
import { todaysLogo } from "@/lib/themes";
import type { User as AuthUser } from "@supabase/supabase-js";

/** The compact wordmark phones get — the same asset GameHeader uses. */
const STACKED_LOGO = "/rainbow-connect-logo-stacked.png";

type ModalName = "stats" | "settings" | "feedback" | null;

export function MinimalHeader() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [settings, setSettings] = useState<GameSettings>(loadSettings);
  const [activeModal, setActiveModal] = useState<ModalName>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const closeModal = () => setActiveModal(null);

  function handleSettingsChange(newSettings: GameSettings) {
    setSettings(newSettings);
    saveSettings(newSettings);
    document.documentElement.classList.toggle("dark", newSettings.darkMode);
  }

  return (
    <>
      <header className="flex items-center w-full max-w-lg mx-auto py-3 px-2 gap-2">
        {/* Logo sizing, same rule GameHeader already follows: the one-line
            wordmark is ~8.4:1, so at any legible height it is wider than a
            phone header can spare once the five utility controls to its right
            are counted. It was ~235px next to ~196px of icons in a 375px
            viewport, which pushed every page using this header (How to Play,
            Privacy, Terms) into scrolling sideways on a phone. Below md the
            compact stacked wordmark (~2.4:1) is used instead; md and up keeps
            the one-line mark exactly as before. */}
        <Link to="/" className="active:scale-95 transition-transform shrink-0" aria-label="Home">
          <img
            src={STACKED_LOGO}
            alt="Rainbow Categories"
            className="block md:hidden w-[96px] max-w-none h-auto"
          />
          <img
            src={todaysLogo()}
            alt="Rainbow Categories"
            className="hidden md:block"
            style={{ maxHeight: "28px", width: "auto" }}
          />
        </Link>

        <div className="ml-auto flex items-center gap-1 shrink-0">
          <button
            onClick={() => setActiveModal("stats")}
            className="p-2 rounded-lg hover:bg-secondary transition-colors active:scale-95"
            aria-label="My stats"
          >
            <BarChart3 className="w-5 h-5 text-muted-foreground" />
          </button>
          <Link
            to="/how-to-play"
            className="p-2 rounded-lg hover:bg-secondary transition-colors active:scale-95"
            aria-label="How to play"
          >
            <BookOpen className="w-5 h-5 text-muted-foreground" />
          </Link>
          <Link
            to="/archive"
            className="p-2 rounded-lg hover:bg-secondary transition-colors active:scale-95"
            aria-label="Puzzle archive"
          >
            <Archive className="w-5 h-5 text-muted-foreground" />
          </Link>
          <button
            onClick={() => setActiveModal("settings")}
            className="p-2 rounded-lg hover:bg-secondary transition-colors active:scale-95"
            aria-label="Settings"
          >
            <Settings className="w-5 h-5 text-muted-foreground" />
          </button>
          <PlayerAuth user={user} onSignOut={() => supabase.auth.signOut()} />
        </div>
      </header>

      <StatsModal open={activeModal === "stats"} onClose={closeModal} />
      <SettingsModal
        open={activeModal === "settings"}
        onClose={closeModal}
        settings={settings}
        onSettingsChange={handleSettingsChange}
        onOpenFeedback={() => setActiveModal("feedback")}
      />
      <FeedbackModal open={activeModal === "feedback"} onClose={closeModal} user={user} />
    </>
  );
}
