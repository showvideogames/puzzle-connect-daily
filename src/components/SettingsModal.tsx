import { moreGames } from "./moreGames";
import { useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Switch } from "@/components/ui/switch";
import { GameSettings } from "@/lib/settings";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { MenuRowArt, menuRowClass } from "./AppMenuDrawer";
import { PlayerAuth } from "./PlayerAuth";
import { socialBetaOn } from "@/components/social/socialFlag";
import { ACCOUNTS_ENABLED } from "@/lib/platformSignIn";
import type { User as AuthUser } from "@supabase/supabase-js";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  settings: GameSettings;
  onSettingsChange: (settings: GameSettings) => void;
  onOpenFeedback?: () => void;
  /** Show gameplay help and account shortcuts, not the global navigation. */
  showMenuLinks?: boolean;
  onHowToPlayClick?: () => void;
  user?: AuthUser | null;
  onSignOut?: () => void;
  /** Passed to the account menu, which then offers "Edit profile". */
  onEditProfile?: () => void;
  /** Adds "All games" to the Menu section, for the game picker. */
  onOpenGames?: () => void;
  /** Adds "Friends & Groups" to the Menu section. In the beta it is there without this, and opens /friends. */
  onOpenSocial?: () => void;
}

function SocialRow({ onClose, onOpen }: { onClose: () => void; onOpen: () => void }) {
  return (
    <button
      onClick={() => { onClose(); onOpen(); }}
      className={`${menuRowClass} bg-[#ebefff] dark:bg-[#303955]`}
    >
      <MenuRowArt icon="friends" />
      Friends &amp; Groups
    </button>
  );
}

/** Its own component so the router is only reached for inside the Menu section, where a router is already needed. */
function BetaSocialRow({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  return <SocialRow onClose={onClose} onOpen={() => navigate("/friends", { state: { friendsHome: true } })} />;
}

/** The signed-in creator's own puzzles (/my-puzzles), beside the profile. */
function MyPuzzlesRow({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => { onClose(); navigate("/my-puzzles"); }}
      className={`${menuRowClass} bg-[#dceefc] dark:bg-[#263f55]`}
    >
      <MenuRowArt icon="puzzles" />
      My Puzzles
    </button>
  );
}

/** The profile editor that Friends & Groups uses, opened straight away. */
function BetaEditProfileRow({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => { onClose(); navigate("/friends", { state: { editProfile: true } }); }}
      className={`${menuRowClass} bg-[#ebefff] dark:bg-[#303955]`}
    >
      <MenuRowArt icon="profile" />
      Edit Profile
    </button>
  );
}

export function SettingsModal({ open, onClose, settings, onSettingsChange, onOpenFeedback, showMenuLinks = false, onHowToPlayClick, user = null, onSignOut, onEditProfile, onOpenGames, onOpenSocial }: SettingsModalProps) {
  // Drives PlayerAuth's forceOpen below, so the "Sign In"/"Account" TEXT
  // (not just PlayerAuth's icon) opens its sign-in modal or dropdown. forceOpen already knows how
  // to open the right one for either auth state (see PlayerAuth.tsx).
  const [authOpen, setAuthOpen] = useState(false);
  const items = [
    {
      label: "Dark Mode",
      description: "Switch to a darker color scheme",
      key: "darkMode" as const,
    },
    {
      label: "Guess History",
      description: "See your previous incorrect guesses below the board.",
      key: "guessHistory" as const,
    },
    {
      label: "Rainbow Animation",
      description: "Animate the rainbow on spotted tiles",
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
                  <div className="space-y-1.5 pb-4 border-b border-border">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate px-1 pb-1">Shortcuts</p>
                    {onHowToPlayClick && <button
                      type="button"
                      onClick={() => { onClose(); onHowToPlayClick(); }}
                      className={`${menuRowClass} bg-[#fff6d7] dark:bg-[#493727]`}
                    >
                      <MenuRowArt icon="book" />
                      How To Play
                    </button>}
                    {onOpenGames && (
                      <button
                        onClick={() => { onClose(); onOpenGames(); }}
                        className={`${menuRowClass} bg-[#d7f3e7] dark:bg-[#2b493a]`}
                      >
                        <MenuRowArt icon="games" />
                        All Games
                      </button>
                    )}
                    {onOpenSocial ? (
                      <SocialRow onClose={onClose} onOpen={onOpenSocial} />
                    ) : socialBetaOn() && (
                      <BetaSocialRow onClose={onClose} />
                    )}
                    {user && !onEditProfile && socialBetaOn() && <BetaEditProfileRow onClose={onClose} />}
                    {user && <MyPuzzlesRow onClose={onClose} />}
                    {(user || ACCOUNTS_ENABLED) && (
                    <div className="flex items-center gap-3 px-2 py-1.5">
                      {/* PlayerAuth's own icon button keeps working exactly
                          as before (unchanged click target) — forceOpen only
                          adds a SECOND way in, for the text button below,
                          rather than replacing or nesting inside it.
                          dropdownAlign="left": this icon sits near the LEFT
                          of the row (icon-then-label), unlike PlayerAuth's
                          usual header placement at the far right of the
                          screen — the default right-anchored dropdown grew
                          leftward off the edge of this narrower, centered
                          modal panel instead of staying inside it. */}
                      <PlayerAuth
                        user={user}
                        onSignOut={onSignOut ?? (() => {})}
                        forceOpen={authOpen}
                        onForceClose={() => setAuthOpen(false)}
                        dropdownAlign="left"
                        onEditProfile={onEditProfile}
                      />
                      {/* A real, separate <button> — not text nested inside
                          PlayerAuth's own <button> above, which would be
                          invalid HTML. Previously only the icon opened
                          anything; this was the actual reported gap ("Sign
                          In" text does nothing when clicked), unlike How to
                          Play/Puzzle Archive above, which are clickable
                          across their whole row. */}
                      <button
                        type="button"
                        onClick={() => setAuthOpen(true)}
                        className="text-sm font-medium text-foreground text-left
                          hover:opacity-75 transition-opacity active:scale-95"
                      >
                        {user ? "Account" : "Sign In"}
                      </button>
                    </div>
                    )}
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
                </div>

                <section aria-labelledby="more-games-title" className="border-t border-border pt-4 space-y-1">
                  <h2 id="more-games-title" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-2 pb-1">More Games</h2>
                  {moreGames.map((game) => (
                    <a key={game.href} href={game.href} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <img src={`/game-icons/${game.icon}.png`} alt="" width={40} height={40} className="w-10 h-10 shrink-0 rounded-lg object-contain" />
                      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{game.title}</span><span className="block text-xs text-muted-foreground">{game.description}</span></span>
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  ))}
                </section>

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
