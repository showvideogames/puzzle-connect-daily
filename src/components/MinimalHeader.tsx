import { useEffect, useRef, useState } from "react";
import { AppHeader } from "./AppHeader";
import { StatsModal } from "./StatsModal";
import { SettingsModal } from "./SettingsModal";
import { FeedbackModal } from "./FeedbackModal";
import { supabase } from "@/integrations/supabase/client";
import { signOutOfRainbow } from "@/lib/platformSignIn";
import { loadSettings, saveSettings, GameSettings } from "@/lib/settings";
import type { User as AuthUser } from "@supabase/supabase-js";

type ModalName = "stats" | "settings" | "feedback" | null;

/**
 * The header for Rainbow's secondary pages (Friends, Join, How to Play, Privacy,
 * Terms). It owns the session and the three modals; AppHeader is the bar itself.
 * The game pages keep GameHeader.
 */
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

  // The three modals have no Radix trigger, so on close Radix hands focus to
  // nothing and it falls to <body>. Remember what opened one (a header button,
  // or the hamburger for Give feedback) and put focus back there. A modal that
  // opens another (Settings → feedback) keeps the first opener.
  const opener = useRef<HTMLElement | null>(null);
  function openModal(name: Exclude<ModalName, null>) {
    if (activeModal === null) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setActiveModal(name);
  }
  const closeModal = () => {
    setActiveModal(null);
    const back = opener.current;
    opener.current = null;
    // Next frame: the dialog has let go of focus by then (Radix stops trapping as soon as it closes).
    if (back) requestAnimationFrame(() => { if (back.isConnected) back.focus(); });
  };

  function handleSettingsChange(newSettings: GameSettings) {
    setSettings(newSettings);
    saveSettings(newSettings);
    document.documentElement.classList.toggle("dark", newSettings.darkMode);
  }

  return (
    <>
      <AppHeader
        user={user}
        onSignOut={() => signOutOfRainbow()}
        onStats={() => openModal("stats")}
        onSettings={() => openModal("settings")}
        onFeedback={() => openModal("feedback")}
      />

      <StatsModal open={activeModal === "stats"} onClose={closeModal} />
      <SettingsModal
        open={activeModal === "settings"}
        onClose={closeModal}
        settings={settings}
        onSettingsChange={handleSettingsChange}
        onOpenFeedback={() => openModal("feedback")}
      />
      <FeedbackModal open={activeModal === "feedback"} onClose={closeModal} user={user} />
    </>
  );
}
