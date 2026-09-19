import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Copy } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { customEmojiUrl, customEmojiReference } from "@/lib/customEmoji";

interface EmojiCodesModalProps {
  open: boolean;
  onClose: () => void;
}

const BUCKET = "custom-emoji";

/**
 * A small, read-only public reference for the custom emoji codes an answer
 * can use (e.g. `:caveman:`) — deliberately secondary, per the /create
 * builder's own "Using a custom emoji?" link. Not an upload tool (that stays
 * admin-only, see components/admin/CustomEmojiManager.tsx) — just a list and
 * a copy button, same public bucket the game itself renders these images
 * from.
 */
export function EmojiCodesModal({ open, onClose }: EmojiCodesModalProps) {
  const [names, setNames] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    supabase.storage
      .from(BUCKET)
      .list("", { limit: 200, sortBy: { column: "name", order: "asc" } })
      .then(({ data, error }) => {
        if (error) {
          setNames(null);
        } else {
          setNames(
            (data ?? [])
              .filter((f) => f.name.toLowerCase().endsWith(".png"))
              .map((f) => f.name.replace(/\.png$/i, ""))
          );
        }
        setLoading(false);
      });
  }, [open]);

  if (!open) return null;

  const handleCopy = async (name: string) => {
    const ref = customEmojiReference(name);
    try {
      await navigator.clipboard.writeText(ref);
      toast.success(`Copied ${ref}`);
    } catch {
      toast.error("Copy failed");
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-foreground/20 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card rounded-xl shadow-2xl p-6 w-full max-w-md mx-4 max-h-[80vh] overflow-y-auto animate-pop">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-secondary transition-colors active:scale-95"
        >
          <X className="w-4 h-4" />
        </button>

        <h2 className="text-lg font-bold text-center mb-1">Available Emoji Codes</h2>
        <p className="text-xs text-muted-foreground text-center mb-4">
          Type a code like <code className="text-[11px]">:caveman:</code> as an answer to use that image instead of text.
        </p>

        {loading ? (
          <p className="text-center text-muted-foreground text-sm animate-pulse py-8">Loading…</p>
        ) : !names || names.length === 0 ? (
          <p className="text-center text-muted-foreground text-sm py-8">No custom emoji are available right now.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {names.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => handleCopy(name)}
                className="flex flex-col items-center gap-1 rounded-lg border border-border p-2 hover:bg-secondary transition-colors active:scale-95"
                title={`Copy :${name}:`}
              >
                <img
                  src={customEmojiUrl(name)}
                  alt={name}
                  draggable={false}
                  className="w-8 h-8 object-contain"
                />
                <span className="text-[10px] text-muted-foreground truncate w-full text-center flex items-center justify-center gap-0.5">
                  <Copy className="w-2.5 h-2.5 shrink-0" />
                  {name}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
