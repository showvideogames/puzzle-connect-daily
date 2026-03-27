import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { GameSettings } from "@/lib/settings";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  settings: GameSettings;
  onSettingsChange: (settings: GameSettings) => void;
}

export function SettingsModal({ open, onClose, settings, onSettingsChange }: SettingsModalProps) {
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
  ];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">Settings</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
