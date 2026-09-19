import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { GripVertical } from "lucide-react";

export interface CategoryDnd {
  handle: ReactNode;
  isDragging: boolean;
}

interface CategoryListProps {
  /** Stable key per card (survives reordering). */
  keys: string[];
  /** Colour/difficulty labels are positional, so they are passed in by slot. */
  labels: string[];
  onMove: (from: number, to: number) => void;
  renderCard: (index: number, dnd: CategoryDnd) => ReactNode;
}

/**
 * Vertically reorderable category cards. Only the six-dot handle starts a
 * drag, so typing/selecting inside an input never drags the card. Same
 * hand-rolled approach the tile grids use (HTML5 drag for mouse, touch events
 * with elementFromPoint for touch) plus arrow keys on the focused handle.
 */
export function CategoryList({ keys, labels, onMove, renderCard }: CategoryListProps) {
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const dragKeyRef = useRef<string | null>(null);
  dragKeyRef.current = dragKey;
  const keysRef = useRef(keys);
  keysRef.current = keys;
  const focusKeyRef = useRef<string | null>(null);

  const moveTo = useCallback(
    (targetKey: string) => {
      const dragged = dragKeyRef.current;
      if (!dragged || dragged === targetKey) return;
      const from = keysRef.current.indexOf(dragged);
      const to = keysRef.current.indexOf(targetKey);
      if (from === -1 || to === -1) return;
      onMove(from, to);
    },
    [onMove]
  );

  useEffect(() => {
    const el = listRef.current;
    if (!el || !dragKey) return;
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const t = e.touches[0];
      const card = document.elementFromPoint(t.clientX, t.clientY)?.closest("[data-cat-key]") as HTMLElement | null;
      if (card?.dataset.catKey) moveTo(card.dataset.catKey);
    };
    const end = () => setDragKey(null);
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", end, { passive: true });
    el.addEventListener("touchcancel", end, { passive: true });
    return () => {
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
    };
  }, [dragKey, moveTo]);

  // Keep keyboard focus on the moved card's handle after a keyboard move.
  useEffect(() => {
    if (!focusKeyRef.current) return;
    const btn = listRef.current?.querySelector<HTMLElement>(`[data-cat-key="${focusKeyRef.current}"] [data-cat-handle]`);
    btn?.focus();
    focusKeyRef.current = null;
  });

  return (
    <div ref={listRef} className="space-y-3">
      {keys.map((key, i) => {
        const isDragging = dragKey === key;
        const handle = (
          <button
            type="button"
            data-cat-handle
            draggable
            aria-label={`Reorder ${labels[i]} category. Drag, or use the up and down arrow keys.`}
            title="Drag to reorder"
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              try {
                e.dataTransfer.setData("text/plain", key);
                const card = (e.currentTarget as HTMLElement).closest("[data-cat-key]");
                if (card) e.dataTransfer.setDragImage(card, 24, 24);
              } catch {
                // some environments lack a full DataTransfer
              }
              setDragKey(key);
            }}
            onDragEnd={() => setDragKey(null)}
            onTouchStart={() => setDragKey(key)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
              e.preventDefault();
              const to = e.key === "ArrowUp" ? i - 1 : i + 1;
              if (to < 0 || to >= keys.length) return;
              focusKeyRef.current = key;
              onMove(i, to);
              setAnnounce(`${labels[i]} category moved to position ${to + 1} of ${keys.length}.`);
            }}
            className="w-11 h-11 -ml-2 -my-1 shrink-0 flex items-center justify-center rounded-lg text-[#292825]
              cursor-grab active:cursor-grabbing select-none hover:bg-black/10
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#292825]"
            style={{ touchAction: "none" }}
          >
            <GripVertical className="w-5 h-5" aria-hidden="true" />
          </button>
        );
        return (
          <div
            key={key}
            data-cat-key={key}
            onDragOver={(e) => {
              if (!dragKeyRef.current) return;
              e.preventDefault();
              moveTo(key);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragKey(null);
            }}
          >
            {renderCard(i, { handle, isDragging })}
          </div>
        );
      })}
      <div className="sr-only" role="status" aria-live="polite">
        {announce}
      </div>
    </div>
  );
}
