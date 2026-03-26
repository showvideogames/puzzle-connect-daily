import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GameSettings } from "@/lib/settings";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  settings: GameSettings;
  onSettingsChange: (settings: GameSettings) => void;
}

export function SettingsModal({ open, onClose, settings, onSettingsChange }: SettingsModalProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold">Settings</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <div>
              <p className="text-sm font-medium">Rainbow Colors</p>
              <p className="text-xs text-muted-foreground">
                Show rainbow animation on spotted tiles
              </p>
            </div>
            <input
              type="checkbox"
              checked={settings.showRainbowColors}
              onChange={(e) =>
                onSettingsChange({ ...settings, showRainbowColors: e.target.checked })
              }
              className="w-5 h-5 rounded border-border accent-primary cursor-pointer"
            />
          </label>
        </div>
      </DialogContent>
    </Dialog>
  );
}
