import { X } from "lucide-react";

interface HintModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function HintModal({ open, onClose, onConfirm }: HintModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-foreground/20 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card rounded-xl shadow-2xl p-6 w-full max-w-sm mx-4 animate-pop">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-secondary transition-colors active:scale-95"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="text-center mb-5">
          <div className="text-4xl mb-3">💡</div>
          <h2 className="text-lg font-bold mb-2">Want a hint?</h2>
          <p className="text-sm text-muted-foreground">
            You'll be shown one emoji for each category — enough to point you in the right direction, not give it away.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <button
            onClick={onConfirm}
            className="w-full py-2.5 rounded-full bg-primary text-primary-foreground text-sm font-semibold
              hover:opacity-90 transition-all duration-150 active:scale-95"
          >
            Give me a hint
          </button>
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-full border border-border text-sm font-semibold
              hover:bg-secondary transition-all duration-150 active:scale-95"
          >
            No thanks
          </button>
        </div>
      </div>
    </div>
  );
}
