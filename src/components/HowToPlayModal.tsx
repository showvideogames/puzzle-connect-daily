import { X } from "lucide-react";

interface HowToPlayModalProps {
  open: boolean;
  onClose: () => void;
}

export function HowToPlayModal({ open, onClose }: HowToPlayModalProps) {
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

        <h2 className="text-lg font-bold text-center mb-4">How to Play</h2>

        <div className="space-y-3 text-sm text-muted-foreground">
          <p>Find groups of four words that share something in common.</p>
          <ul className="space-y-2 list-disc pl-4">
            <li>Select four words and tap <strong className="text-foreground">Submit</strong> to check if they form a group.</li>
            <li>Find all four groups without making 4 mistakes!</li>
            <li>Categories get trickier as you go — from straightforward to tricky.</li>
          </ul>

          <div className="pt-2 space-y-1.5">
            <p className="text-xs font-semibold text-foreground">Difficulty</p>
            <div className="flex gap-2">
              {[
                { color: "bg-group-1", label: "Easy" },
                { color: "bg-group-2", label: "Medium" },
                { color: "bg-group-3", label: "Hard" },
                { color: "bg-group-4", label: "Tricky" },
              ].map((d) => (
                <div key={d.label} className="flex items-center gap-1">
                  <div className={`w-3 h-3 rounded ${d.color}`} />
                  <span className="text-xs">{d.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
