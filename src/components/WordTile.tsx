import { useState, useRef, useCallback, useEffect } from "react";

const COLOR_STYLES: Record<string, { bg: string; ring: string }> = {
  orange: { bg: "bg-orange-200 dark:bg-orange-900/50", ring: "ring-orange-400" },
  green:  { bg: "bg-green-200 dark:bg-green-900/50",  ring: "ring-green-400"  },
  blue:   { bg: "bg-blue-200 dark:bg-blue-900/50",    ring: "ring-blue-400"   },
  red:    { bg: "bg-red-200 dark:bg-red-900/50",      ring: "ring-red-400"    },
};

const COLOR_CIRCLES: { key: string; circle: string }[] = [
  { key: "orange", circle: "bg-orange-400" },
  { key: "green",  circle: "bg-green-500"  },
  { key: "blue",   circle: "bg-blue-500"   },
  { key: "red",    circle: "bg-red-500"    },
];

interface WordTileProps {
  word: string;
  isSelected: boolean;
  onClick: () => void;
  disabled?: boolean;
  isRainbow?: boolean;
  isMatched?: boolean;
  advancedFeatures?: boolean;
  tileColor?: string | null;
  onColorChange?: (word: string, color: string | null) => void;
  draggable?: boolean;
  onDragStart?: (word: string) => void;
  onDragOver?: (word: string) => void;
  onDrop?: () => void;
  onTouchDragMove?: (x: number, y: number) => void;
  onTouchDragEnd?: () => void;
  // Which column this tile is in (1-indexed). Used to anchor color picker correctly.
  column?: number;
}

export function WordTile({
  word,
  isSelected,
  onClick,
  disabled,
  isRainbow,
  isMatched,
  advancedFeatures = false,
  tileColor = null,
  onColorChange,
  draggable = false,
  onDragStart,
  onDragOver,
  onDrop,
  onTouchDragMove,
  onTouchDragEnd,
  column = 1,
}: WordTileProps) {
  const [showColorPicker, setShowColorPicker] = useState(false);
  const lastTapRef = useRef<number>(0);
  const singleTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const isTouchDragging = useRef(false);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);

  // Attach non-passive touch listeners directly to DOM so preventDefault works
  useEffect(() => {
    const el = buttonRef.current;
    if (!el || !advancedFeatures) return;

    const handleTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      touchStartPos.current = { x: touch.clientX, y: touch.clientY };
      isTouchDragging.current = false;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!touchStartPos.current) return;
      const touch = e.touches[0];
      const dx = Math.abs(touch.clientX - touchStartPos.current.x);
      const dy = Math.abs(touch.clientY - touchStartPos.current.y);

      if (!isTouchDragging.current && dx < 8 && dy < 8) return;

      isTouchDragging.current = true;
      e.preventDefault();
      onDragStart?.(word);
      onTouchDragMove?.(touch.clientX, touch.clientY);
    };

    const handleTouchEnd = () => {
      if (isTouchDragging.current) {
        onTouchDragEnd?.();
      }
      isTouchDragging.current = false;
      touchStartPos.current = null;
    };

    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchmove", handleTouchMove, { passive: false });
    el.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
    };
  }, [advancedFeatures, word, onDragStart, onTouchDragMove, onTouchDragEnd]);

  const handleClick = useCallback(() => {
    if (isTouchDragging.current) return;

    // No Advanced Features — fire instantly, zero delay
    if (!advancedFeatures) {
      onClick();
      return;
    }

    const now = Date.now();
    const timeSinceLastTap = now - lastTapRef.current;
    lastTapRef.current = now;

    if (timeSinceLastTap < 250) {
      // Double-tap — cancel pending single-tap and open color picker
      if (singleTapTimer.current) {
        clearTimeout(singleTapTimer.current);
        singleTapTimer.current = null;
      }
      setShowColorPicker(true);
    } else {
      // Wait briefly to see if a second tap follows
      singleTapTimer.current = setTimeout(() => {
        singleTapTimer.current = null;
        onClick();
      }, 250);
    }
  }, [advancedFeatures, onClick]);

  const handleColorSelect = useCallback((color: string | null) => {
    onColorChange?.(word, color);
    setShowColorPicker(false);
  }, [word, onColorChange]);

  const colorStyle = tileColor ? COLOR_STYLES[tileColor] : null;

  // Column 4 = right edge: anchor popover to the right side of the tile.
  // All others: anchor to the left side. This prevents the popover from
  // ever extending beyond the right edge of the screen.
  const isRightEdge = column === 4;

  const baseClasses = `tile-base h-16 text-xs sm:text-sm font-semibold rounded-lg transition-all duration-150 ease-out relative
    ${disabled ? "opacity-50 cursor-default" : ""}
  `;

  const stateClasses = isMatched
    ? "bg-tile-selected text-tile-selected-fg shadow-md animate-tile-matched scale-[0.97]"
    : isRainbow
      ? `rainbow-tile text-white shadow-md ${isSelected ? "ring-[3px] ring-foreground ring-offset-2 ring-offset-background scale-[0.97]" : ""}`
      : isSelected
        ? "bg-tile-selected text-tile-selected-fg shadow-md scale-[0.97]"
        : colorStyle
          ? `${colorStyle.bg} hover:shadow-sm active:scale-95`
          : "bg-tile hover:shadow-sm active:scale-95";

  return (
    <div
      ref={wrapperRef}
      data-word={word}
      className="relative"
      style={{ touchAction: advancedFeatures ? "none" : "manipulation" }}
    >
      <button
        ref={buttonRef}
        onClick={handleClick}
        disabled={disabled}
        draggable={advancedFeatures && draggable}
        onDragStart={() => onDragStart?.(word)}
        onDragOver={(e) => { e.preventDefault(); onDragOver?.(word); }}
        onDrop={onDrop}
        className={`${baseClasses} ${stateClasses} w-full`}
      >
        {word}
      </button>

      {showColorPicker && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowColorPicker(false)}
          />
          <div
            className={`absolute bottom-full mb-2 z-50
              bg-background border border-border rounded-full shadow-lg px-2 py-1.5
              flex items-center gap-1.5 animate-fade-up
              ${isRightEdge ? "right-0" : "left-0"}`}
          >
            {COLOR_CIRCLES.map(({ key, circle }) => (
              <button
                key={key}
                onClick={(e) => { e.stopPropagation(); handleColorSelect(key); }}
                className={`w-5 h-5 rounded-full ${circle} hover:scale-125 transition-transform
                  ${tileColor === key ? "ring-2 ring-offset-1 ring-foreground" : ""}
                `}
              />
            ))}
            {tileColor && (
              <button
                onClick={(e) => { e.stopPropagation(); handleColorSelect(null); }}
                className="w-5 h-5 rounded-full bg-muted border border-border text-muted-foreground
                  text-[10px] flex items-center justify-center hover:scale-125 transition-transform"
              >
                ✕
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
