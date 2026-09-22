import { useCallback, useEffect, useRef, useState } from "react";

export interface GridTile {
  id: string;
  text: string;
  /** 1-4, drives the tile's Yellow/Green/Blue/Red fill — same palette as the real board/solved bars. */
  colorIndex: 1 | 2 | 3 | 4;
}

const COLOR_CLASSES: Record<1 | 2 | 3 | 4, string> = {
  1: "bg-group-1 text-group-1-fg",
  2: "bg-group-2 text-group-2-fg",
  3: "bg-group-3 text-group-3-fg",
  4: "bg-group-4 text-group-4-fg",
};

interface DraggableTileGridProps {
  tiles: GridTile[];
  onReorder: (newOrderIds: string[]) => void;
  columns?: number;
  emptyLabel?: string;
}

/**
 * A grid of whole-tile-draggable answers, reorderable by mouse drag or
 * touch drag — the entire tile is the drag handle, deliberately no grip
 * dots (see the builder's "do not add" list). Shared by the starting-board
 * arranger and the Rainbow display-order arranger.
 *
 * Reordering itself (drag-over swap logic) mirrors the same pattern the
 * live game board already uses for its own drag-to-reorder mode
 * (useGame.ts's handleDragOver/handleTouchDragMove) — same technique, new
 * component, because this one orders admin-authored TILES rather than a
 * live game's shuffledWords.
 */
export function DraggableTileGrid({ tiles, onReorder, columns = 4, emptyLabel }: DraggableTileGridProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggedIdRef = useRef<string | null>(null);
  draggedIdRef.current = draggedId;

  const reorderTo = useCallback(
    (targetId: string) => {
      const dragged = draggedIdRef.current;
      if (!dragged || dragged === targetId) return;
      const ids = tiles.map((t) => t.id);
      const fromIdx = ids.indexOf(dragged);
      const toIdx = ids.indexOf(targetId);
      if (fromIdx === -1 || toIdx === -1) return;
      ids.splice(fromIdx, 1);
      ids.splice(toIdx, 0, dragged);
      onReorder(ids);
    },
    [tiles, onReorder]
  );

  // Touch drag: the entire tile is draggable via touch, mirroring the
  // desktop HTML5 drag-and-drop below but working on mobile, where native
  // HTML5 DnD generally does not fire.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !draggedId) return;

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const touch = e.touches[0];
      const target = document.elementFromPoint(touch.clientX, touch.clientY);
      const tileEl = target?.closest("[data-tile-id]") as HTMLElement | null;
      const targetId = tileEl?.dataset.tileId;
      if (targetId) reorderTo(targetId);
    };
    const handleTouchEnd = () => setDraggedId(null);

    el.addEventListener("touchmove", handleTouchMove, { passive: false });
    el.addEventListener("touchend", handleTouchEnd, { passive: true });
    el.addEventListener("touchcancel", handleTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
      el.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [draggedId, reorderTo]);

  if (tiles.length === 0) {
    return emptyLabel ? <p className="text-xs text-muted-foreground">{emptyLabel}</p> : null;
  }

  return (
    <div
      ref={containerRef}
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {tiles.map((tile) => {
        // A blank tile is a real, positioned board slot with nothing typed
        // into it yet (or an answer deleted with nothing to replace it) —
        // shown as an empty placeholder rather than colored/filled, so the
        // preview reads as "16 open positions" rather than looking broken.
        const isBlank = tile.text.trim() === "";
        return (
          <div
            key={tile.id}
            data-tile-id={tile.id}
            draggable
            onDragStart={() => setDraggedId(tile.id)}
            onDragOver={(e) => {
              e.preventDefault();
              reorderTo(tile.id);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDraggedId(null);
            }}
            onDragEnd={() => setDraggedId(null)}
            onTouchStart={() => setDraggedId(tile.id)}
            className={`${isBlank ? "border-2 border-dashed border-tile-border bg-transparent" : COLOR_CLASSES[tile.colorIndex]}
              select-none cursor-grab active:cursor-grabbing
              rounded-lg px-2 py-3 min-h-[44px] flex items-center justify-center text-center font-tile font-[700] text-xs uppercase tracking-wide
              transition-transform duration-100
              ${draggedId === tile.id ? "opacity-60 scale-95" : ""}`}
            style={{ touchAction: "none" }}
          >
            {isBlank ? "" : tile.text}
          </div>
        );
      })}
    </div>
  );
}
