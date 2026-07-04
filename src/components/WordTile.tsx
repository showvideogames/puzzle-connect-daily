import { useState, useRef, useCallback, useEffect, useLayoutEffect } from "react";
import { isCustomEmoji, customEmojiUrl, customEmojiName } from "@/lib/customEmoji";

const DOUBLE_TAP_DELAY_MS = 250;

const COLOR_STYLES: Record<string, { bg: string; ring: string }> = {
  yellow: { bg: "bg-yellow-400/35 dark:bg-yellow-600/35", ring: "ring-yellow-400" },
  green:  { bg: "bg-green-500/35 dark:bg-green-600/35",  ring: "ring-green-400"  },
  blue:   { bg: "bg-blue-500/35 dark:bg-blue-600/35",   ring: "ring-blue-400"   },
  red:    { bg: "bg-red-500/35 dark:bg-red-600/35",    ring: "ring-red-400"    },
};

const COLOR_CIRCLES: { key: string; circle: string }[] = [
  { key: "yellow", circle: "bg-yellow-400" },
  { key: "green",  circle: "bg-green-500"  },
  { key: "blue",   circle: "bg-blue-500"   },
  { key: "red",    circle: "bg-red-500"    },
];

// Count visible characters/emojis using Intl.Segmenter
// Handles multi-codepoint emojis correctly (e.g. 👨‍👩‍👧‍👦 = 1)
function countVisibleChars(str: string): number {
  try {
    const segmenter = new Intl.Segmenter();
    return [...segmenter.segment(str)].length;
  } catch {
    return str.length;
  }
}

// Dynamic font size for emoji puzzle mode — scales down so content always fits the tile
function getEmojiFontSize(charCount: number): string {
  if (charCount <= 2) return "3rem";
  if (charCount === 3) return "2.2rem";
  if (charCount === 4) return "1.8rem";
  if (charCount === 5) return "1.4rem";
  if (charCount === 6) return "1.1rem";
  return "0.9rem";
}

// Shared offscreen canvas for text-width measurement — created lazily once.
let measureCtx: CanvasRenderingContext2D | null = null;
function getMeasureCtx(): CanvasRenderingContext2D {
  if (!measureCtx) {
    measureCtx = document.createElement("canvas").getContext("2d")!;
  }
  return measureCtx;
}

// Picks out the longest individual word in a phrase — the one that can't be
// helped by wrapping, since wrapping only happens at word boundaries.
function getLongestWord(word: string): string {
  const parts = word.split(" ");
  return parts.reduce((a, b) => (countVisibleChars(b) > countVisibleChars(a) ? b : a), parts[0] ?? "");
}

// Regular text tiles render at normal size and simply wrap to extra lines —
// font-size only shrinks as a last resort, when the single longest word in
// the phrase can't fit on its own line at normal size within the tile's
// actual measured width. Words/phrases that already fit are left untouched.
function computeShrunkFontSize(longestWord: string, availableWidthPx: number): string | undefined {
  if (!longestWord || availableWidthPx <= 0) return undefined;
  // Matches the text-xs / sm:text-sm classes applied by default.
  const defaultPx = window.innerWidth >= 640 ? 14 : 12;
  const ctx = getMeasureCtx();
  ctx.font = `600 ${defaultPx}px "DM Sans", system-ui, sans-serif`;
  const upper = longestWord.toUpperCase();
  const letterSpacingPx = defaultPx * 0.025; // matches tracking-wide
  const rawWidth = ctx.measureText(upper).width + letterSpacingPx * Math.max(countVisibleChars(upper) - 1, 0);
  if (rawWidth <= availableWidthPx) return undefined;
  const shrunkPx = Math.max((availableWidthPx / rawWidth) * defaultPx * 0.96, 8);
  return `${shrunkPx}px`;
}

interface WordTileProps {
  word: string;
  isSelected: boolean;
  onClick: () => void;
  disabled?: boolean;
  isRainbow?: boolean;
  isMatched?: boolean;
  arrangeTiles?: boolean;
  colorCodeTiles?: boolean;
  colorPaletteMode?: boolean;
  isPaintMode?: boolean;
  tileColor?: string | null;
  onColorChange?: (word: string, color: string | null) => void;
  draggable?: boolean;
  onDragStart?: (word: string) => void;
  onDragOver?: (word: string) => void;
  onDrop?: () => void;
  onTouchDragMove?: (x: number, y: number) => void;
  onTouchDragEnd?: () => void;
  column?: number;
  isEmojiPuzzle?: boolean;
}

export function WordTile({
  word,
  isSelected,
  onClick,
  disabled,
  isRainbow,
  isMatched,
  arrangeTiles = false,
  colorCodeTiles = false,
  colorPaletteMode = false,
  isPaintMode = false,
  tileColor = null,
  onColorChange,
  draggable = false,
  onDragStart,
  onDragOver,
  onDrop,
  onTouchDragMove,
  onTouchDragEnd,
  column = 1,
  isEmojiPuzzle = false,
}: WordTileProps) {
  const [showColorPicker, setShowColorPicker] = useState(false);
  const lastTapRef = useRef<number>(0);
  const singleTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const isTouchDragging = useRef(false);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);

  const isImage = isCustomEmoji(word);
  const emojiFontSize = isEmojiPuzzle && !isImage
    ? getEmojiFontSize(countVisibleChars(word))
    : undefined;

  const textRef = useRef<HTMLSpanElement>(null);
  const [autoFontSize, setAutoFontSize] = useState<string | undefined>(undefined);

  useLayoutEffect(() => {
    if (isEmojiPuzzle || isImage) return;
    const el = textRef.current;
    if (!el) return;

    const measure = () => {
      const longest = getLongestWord(word);
      setAutoFontSize(computeShrunkFontSize(longest, el.clientWidth));
    };

    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [word, isEmojiPuzzle, isImage]);

  useEffect(() => {
    const el = buttonRef.current;
    if (!el || !arrangeTiles) return;

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
  }, [arrangeTiles, word, onDragStart, onTouchDragMove, onTouchDragEnd]);

  const handleClick = useCallback(() => {
    if (isTouchDragging.current) return;

    // Color Palette Mode or not using color features at all
    if (!colorCodeTiles || colorPaletteMode) {
      onClick();
      return;
    }

    // Color-Code Tiles mode: double-tap logic
    const now = Date.now();
    const timeSinceLastTap = now - lastTapRef.current;
    lastTapRef.current = now;

    if (timeSinceLastTap < DOUBLE_TAP_DELAY_MS) {
      if (singleTapTimer.current) {
        clearTimeout(singleTapTimer.current);
        singleTapTimer.current = null;
      }
      setShowColorPicker(true);
    } else {
      singleTapTimer.current = setTimeout(() => {
        singleTapTimer.current = null;
        onClick();
      }, DOUBLE_TAP_DELAY_MS);
    }
  }, [colorCodeTiles, colorPaletteMode, onClick]);

  const handleColorSelect = useCallback((color: string | null) => {
    onColorChange?.(word, color === tileColor ? null : color);
    setShowColorPicker(false);
  }, [word, tileColor, onColorChange]);

  const colorStyle = tileColor ? COLOR_STYLES[tileColor] : null;

  const isRightEdge = column === 4;

  const baseClasses = `tile-base min-h-16 font-semibold rounded-lg transition-all duration-150 ease-out relative
    ${disabled ? "opacity-50 cursor-default" : ""}
  `;

  // Selection styling:
  // - Rainbow/colored tiles: black border when selected, keep their color
  // - Normal tiles: gray background only when selected (no border)
  const stateClasses = isMatched
    ? "bg-tile-selected text-tile-selected-fg shadow-md animate-tile-matched scale-[0.97]"
    : isRainbow
      ? `rainbow-tile text-white shadow-md ${isSelected ? "ring-[3px] ring-foreground ring-offset-2 ring-offset-background scale-[0.97]" : ""}`
      : colorStyle
        ? `${colorStyle.bg} hover:shadow-sm active:scale-95 ${isSelected ? "ring-[3px] ring-foreground ring-offset-2 ring-offset-background scale-[0.97]" : ""}`
        : isSelected
          ? "bg-tile-selected text-tile-selected-fg shadow-md scale-[0.97]"
          : "bg-tile hover:shadow-sm active:scale-95";

  return (
    <div
      ref={wrapperRef}
      data-word={word}
      className="relative"
      style={{ touchAction: arrangeTiles ? "none" : "manipulation" }}
    >
      <button
        ref={buttonRef}
        onClick={handleClick}
        disabled={disabled}
        draggable={arrangeTiles && draggable}
        onDragStart={() => onDragStart?.(word)}
        onDragOver={(e) => { e.preventDefault(); onDragOver?.(word); }}
        onDrop={onDrop}
        className={`${baseClasses} ${stateClasses} w-full ${isEmojiPuzzle ? "" : "text-xs sm:text-sm"}`}
        style={{
          ...(emojiFontSize ? { fontSize: emojiFontSize } : {}),
        }}
      >
        {isImage ? (
          <img
            src={customEmojiUrl(word)}
            alt={customEmojiName(word) ?? ""}
            draggable={false}
            style={{
              maxHeight: "48px",
              maxWidth: "100%",
              width: "auto",
              height: "auto",
              objectFit: "contain",
              display: "block",
              margin: "0 auto",
              pointerEvents: "none",
            }}
          />
        ) : (
          // Wraps only at word boundaries (no mid-word hyphenation) — phrases
          // are free to wrap to as many lines as they need at normal size.
          // autoFontSize only kicks in when the longest word measures wider
          // than the tile itself, as a last-resort shrink.
          <span
            ref={textRef}
            className="w-full"
            style={{
              wordBreak: "normal",
              overflowWrap: "normal",
              lineHeight: 1.2,
              ...(autoFontSize ? { fontSize: autoFontSize } : {}),
            }}
          >
            {word}
          </span>
        )}
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
