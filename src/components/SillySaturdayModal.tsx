import { useEffect, useState } from "react";

const STORAGE_PREFIX = "silly-saturday-seen-";

interface SillySaturdayModalProps {
  isEmojiPuzzle: boolean;
  puzzleId: string;
}

export function SillySaturdayModal({ isEmojiPuzzle, puzzleId }: SillySaturdayModalProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!isEmojiPuzzle || !puzzleId) return;
    try {
      if (localStorage.getItem(`${STORAGE_PREFIX}${puzzleId}`)) return;
    } catch {
      // ignore — show the modal anyway
    }
    setOpen(true);
  }, [isEmojiPuzzle, puzzleId]);

  const handleConfirm = () => {
    try {
      localStorage.setItem(`${STORAGE_PREFIX}${puzzleId}`, "1");
    } catch {
      // ignore
    }
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
    >
      <div
        className="relative w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-pop"
        style={{
          background: "hsl(var(--card))",
        }}
      >
        <div className="px-6 py-7 text-center space-y-4">
          <h2 className="text-xl font-bold tracking-tight">🌈 Silly Saturday! 🤪</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Today's puzzle is an Emoji Puzzle — no words, just images! Every Saturday we mix things up
            with a visual twist. Some emojis might be custom illustrations you won't find on your keyboard.
          </p>
          <p className="text-sm font-semibold">Good luck have fun! 😄</p>
          <button
            onClick={handleConfirm}
            className="w-full py-3 rounded-full bg-primary text-primary-foreground font-semibold text-sm
              hover:opacity-90 transition-all active:scale-95"
          >
            Let's Play!
          </button>
        </div>
      </div>
    </div>
  );
}
