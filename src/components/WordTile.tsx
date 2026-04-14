import { useState, useRef, useCallback } from "react";

// Pastel background colors for each tag color
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
  // Advanced features
  advancedFeatures?: boolean;
  tileColor?: string | null;
  onColorChange?: (word: string, color: string | null) => void;
  // Drag and drop
  draggable?: boolean;
  onDragStart?: (word: string) => void;
  onDragOver?: (word: string) => void;
  onDrop?: () => void;
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
}: WordTileProps) {
  const [showColorPicker, setShowColorPicker] = useState(false);
  const lastTapRef = useRef<number>(0);
  const singleTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Double-tap detection — waits 300ms before committing to a single tap,
  // so a double-tap cancels the selection and opens the color picker instead.
  const handleClick = useCallback(() => {
    if (!advancedFeatures) {
      onClick();
      return;
    }

    const now = Date.now();
    const timeSinceLastTap = now - lastTapRef.current;
    lastTapRef.current = now;

    if (timeSinceLastTap < 300) {
      // Double-tap — cancel pending single-tap and open color picker
      if (singleTapTimer.current) {
        clearTimeout(singleTapTimer.current);
        singleTapTimer.current = null;
      }
      setShowColorPicker(true);
    } else {
      // Wait to see if a second tap follows before selecting
      singleTapTimer.current = setTimeout(() => {
        singleTapTimer.current = null;
        onClick();
      }, 300);
    }
  }, [advancedFeatures, onClick]);

  const handleColorSelect = useCallback((color: string | null) => {
    onColorChange?.(word, color);
    setShowColorPicker(false);
  }, [word, onColorChange]);

  const colorStyle = tileColor ? COLOR_STYLES[tileColor] : null;

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
    <div className="relative" style={{ touchAction: "manipulation" }}>
      <button
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

      {/* Color picker popover */}
      {showColorPicker && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowColorPicker(false)}
          />
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50
            bg-background border border-border rounded-full shadow-lg px-2 py-1.5
            flex items-center gap-1.5 animate-fade-up"
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
