import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Switch } from "@/components/ui/switch";
import { GameSettings } from "@/lib/settings";
import { Link } from "react-router-dom";
import { BookOpen, Archive as ArchiveIcon, X } from "lucide-react";
import { PlayerAuth } from "./PlayerAuth";
import type { User as AuthUser } from "@supabase/supabase-js";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  settings: GameSettings;
  onSettingsChange: (settings: GameSettings) => void;
  onOpenFeedback?: () => void;
  // Daily-homepage-only: shows a "Menu" section (How to Play / Puzzle Archive
  // / Account) since the homepage header drops those icons down to just 3.
  // Left undefined/false everywhere else so archive's Settings modal is
  // unchanged.
  showMenuLinks?: boolean;
  onHowToPlayClick?: () => void;
  user?: AuthUser | null;
  onSignOut?: () => void;
}

export function SettingsModal({ open, onClose, settings, onSettingsChange, onOpenFeedback, showMenuLinks = false, onHowToPlayClick, user = null, onSignOut }: SettingsModalProps) {
  const items = [
    {
      label: "Dark Mode",
      description: "Switch to a darker color scheme",
      key: "darkMode" as const,
    },
    {
      label: "Rainbow Colors",
      description: "Show rainbow animation on spotted tiles",
      key: "showRainbowColors" as const,
    },
    {
      label: "Sound Effects",
      description: "Play celebration sounds on win",
      key: "soundEnabled" as const,
    },
    {
      label: "Haptic Feedback",
      description: "Vibrate on actions (mobile devices)",
      key: "hapticEnabled" as const,
    },
  ];

  const handleColorCodeToggle = (checked: boolean) => {
    onSettingsChange({
      ...settings,
      colorCodeTiles: checked,
      colorPaletteMode: checked ? false : settings.colorPaletteMode,
    });
  };

  const handleColorPaletteToggle = (checked: boolean) => {
    onSettingsChange({
      ...settings,
      colorPaletteMode: checked,
      colorCodeTiles: checked ? false : settings.colorCodeTiles,
    });
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out
            data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        />
        {/* Positioning wrapper handles centering; the panel itself is capped
            to the visible viewport height (dvh, with a vh fallback for
            browsers that don't support it — see max-h below) so on a short
            phone screen it never extends above or below the viewport the
            way the old translate(-50%,-50%) + no-max-height dialog did.
            When the panel is short enough to fit, this still centers it
            normally; when it isn't, the panel fills the safe-area budget
            and effectively top-aligns itself with breathing room at both
            edges instead of spilling off-screen. */}
        <div
          className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none
            pt-[max(12px,env(safe-area-inset-top))] pb-[max(12px,env(safe-area-inset-bottom))]"
        >
          <DialogPrimitive.Content
            className="pointer-events-auto w-full max-w-sm
              max-h-[calc(100vh-24px)] max-h-[calc(100dvh-24px)]
              flex flex-col
              bg-background border shadow-lg rounded-none sm:rounded-lg
              data-[state=open]:animate-in data-[state=closed]:animate-out
              data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0
              data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95
              focus:outline-none"
          >
            {/* Sticky header — stays on screen while the body below scrolls
                independently, so the title and close button are never lost
                even when the settings list is taller than the viewport. */}
            <div className="shrink-0 flex items-center justify-between gap-2 px-6 pt-6 pb-4">
              <DialogPrimitive.Title className="text-lg font-bold">Settings</DialogPrimitive.Title>
              <DialogPrimitive.Close
                aria-label="Close"
                className="shrink-0 -mr-2 -mt-2 w-9 h-9 flex items-center justify-center rounded-full
                  text-muted-foreground hover:bg-secondary transition-colors active:scale-95
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="w-4 h-4" />
              </DialogPrimitive.Close>
            </div>

            {/* min-h-0 lets this shrink inside the flex column instead of
                forcing the panel taller than max-h above; overflow-y-auto
                gives the settings list its own scroll independent of the
                header, with extra bottom padding to clear iOS Safari's
                home-indicator / safe area. */}
            <div className="min-h-0 overflow-y-auto px-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
              <div className="space-y-4">
                {showMenuLinks && (
                  <div className="space-y-1 pb-4 border-b border-border">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate px-1 pb-1">Menu</p>
                    <button
                      onClick={() => { onClose(); onHowToPlayClick?.(); }}
                      className="w-full flex items-center gap-3 px-2 py-2.5 rounded-lg text-sm font-medium
                        hover:bg-secondary transition-colors active:scale-95"
                    >
                      <BookOpen className="w-4 h-4 text-slate" />
                      How to Play
                    </button>
                    <Link
                      to="/archive"
                      onClick={onClose}
                      className="w-full flex items-center gap-3 px-2 py-2.5 rounded-lg text-sm font-medium
                        hover:bg-secondary transition-colors active:scale-95"
                    >
                      <ArchiveIcon className="w-4 h-4 text-slate" />
                      Puzzle Archive
                    </Link>
                    <div className="flex items-center gap-3 px-2 py-1.5">
                      <PlayerAuth user={user} onSignOut={onSignOut ?? (() => {})} />
                      <span className="text-sm font-medium text-foreground">
                        {user ? "Account" : "Sign In"}
                      </span>
                    </div>
                  </div>
                )}
                {items.map((item) => (
                  <label key={item.key} className="flex items-center justify-between gap-3 cursor-pointer">
                    <div>
                      <p className="text-sm font-medium">{item.label}</p>
                      <p className="text-xs text-muted-foreground">{item.description}</p>
                    </div>
                    <Switch
                      checked={settings[item.key]}
                      onCheckedChange={(checked) =>
                        onSettingsChange({ ...settings, [item.key]: checked })
                      }
                    />
                  </label>
                ))}
                {/* Divider */}
                <div className="border-t border-border pt-4 space-y-4">
                  <p className="text-lg font-bold flex items-center gap-2">
                    Advanced Features
                    <span className="text-[10px] font-semibold uppercase tracking-wide bg-muted text-muted-foreground px-2 py-0 rounded-full">
                      Beta
                    </span>
                  </p>
                  <label className="flex items-center justify-between gap-3 cursor-pointer">
                    <div>
                      <p className="text-sm font-medium">Arrange Tiles</p>
                      <p className="text-xs text-muted-foreground">
                        Drag & drop tiles to organize your thinking
                      </p>
                    </div>
                    <Switch
                      checked={settings.arrangeTiles}
                      onCheckedChange={(checked) =>
                        onSettingsChange({ ...settings, arrangeTiles: checked })
                      }
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3 cursor-pointer">
                    <div>
                      <p className="text-sm font-medium">Color-Code Tiles</p>
                      <p className="text-xs text-muted-foreground">
                        Double-tap tiles to color-tag them
                      </p>
                    </div>
                    <Switch
                      checked={settings.colorCodeTiles}
                      onCheckedChange={handleColorCodeToggle}
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3 cursor-pointer">
                    <div>
                      <p className="text-sm font-medium">Color Palette Mode</p>
                      <p className="text-xs text-muted-foreground">
                        Tap colors to paint tiles instantly
                      </p>
                    </div>
                    <Switch
                      checked={settings.colorPaletteMode}
                      onCheckedChange={handleColorPaletteToggle}
                    />
                  </label>
                  <label className="flex items-center justify-between gap-3 cursor-pointer">
                    <div>
                      <p className="text-sm font-medium">Guess History</p>
                      <p className="text-xs text-muted-foreground">
                        See your previous incorrect guesses below the board.
                      </p>
                    </div>
                    <Switch
                      checked={settings.guessHistory}
                      onCheckedChange={(checked) =>
                        onSettingsChange({ ...settings, guessHistory: checked })
                      }
                    />
                  </label>
                </div>

                {/* Feedback */}
                <div className="border-t border-border pt-4">
                  <button
                    onClick={() => { onClose(); onOpenFeedback?.(); }}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg
                      border border-border text-sm font-medium text-muted-foreground
                      hover:bg-secondary hover:text-foreground transition-colors active:scale-95"
                  >
                    Send Feedback
                  </button>
                </div>
              </div>
            </div>
          </DialogPrimitive.Content>
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
