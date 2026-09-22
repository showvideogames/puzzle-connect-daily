import { useState, useRef, useCallback, useEffect, useLayoutEffect, forwardRef } from "react";
import { isCustomEmoji, customEmojiUrl, customEmojiName } from "@/lib/customEmoji";

const DOUBLE_TAP_DELAY_MS = 250;

// Reuses the exact same CSS custom properties as the SOLVED category bars
// (SolvedGroup.tsx's bg-group-N/text-group-N-fg, driven by index.css's
// --group-1..4 / --group-N-fg) instead of a separate hardcoded hex set.
//
// This used to be its own fixed hex per color at 35% opacity
// (bg-[#F6DA6A]/35, etc). That opacity was the actual bug the fixed hex
// alone didn't catch: at 35% alpha, most of what a player sees is the TILE'S
// OWN background showing through, not the paint color — so the same
// "yellow" rendered as a pale cream wash over light mode's near-white tile
// and a muddy olive-brown over dark mode's near-black tile. Painting a tile
// looked like two different colors depending on theme, and neither looked
// like the solved category's solid, saturated fill.
//
// Using bg-group-N directly (full opacity, same var SolvedGroup reads) means
// a hand-painted tile is now pixel-identical to what that group looks like
// once solved — and since --group-1..4 deliberately has no .dark override
// (see index.css), that identity holds in both themes automatically, with
// nothing here needing its own dark: variant.
const COLOR_STYLES: Record<string, { bg: string; text: string }> = {
  yellow: { bg: "bg-group-1", text: "text-group-1-fg" },
  green:  { bg: "bg-group-2", text: "text-group-2-fg" },
  blue:   { bg: "bg-group-3", text: "text-group-3-fg" },
  red:    { bg: "bg-group-4", text: "text-group-4-fg" },
};

const COLOR_CIRCLES: { key: string; circle: string }[] = [
  { key: "yellow", circle: "bg-group-1" },
  { key: "green",  circle: "bg-group-2" },
  { key: "blue",   circle: "bg-group-3" },
  { key: "red",    circle: "bg-group-4" },
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

// Fluid base font-size for normal (non-emoji) tile text — mirrors the CSS
// container-query clamp() applied in the button's className below
// (text-[clamp(9px,15.5cqw,33px)], with [container-type:inline-size] on the
// tile's own wrapper) so this JS-side measurement always starts from the
// same size that's actually rendered. Deriving it from the TILE'S OWN
// rendered width (not the viewport) is what keeps text-to-tile proportion
// constant everywhere, including desktop — where the board's width
// plateaus at a max-width independent of the viewport, so a viewport-based
// formula would have kept text capped far below where it should be.
function getBaseFontSizePx(tileOuterWidthPx: number): number {
  return Math.min(33, Math.max(9, 0.155 * tileOuterWidthPx));
}

// Regular text tiles render at normal size and simply wrap to extra lines —
// font-size only shrinks as a last resort, when the single longest word in
// the phrase can't fit on its own line at normal size within the tile's
// actual measured width. Words/phrases that already fit are left untouched.
function computeShrunkFontSize(longestWord: string, availableWidthPx: number, defaultPx: number): string | undefined {
  if (!longestWord || availableWidthPx <= 0) return undefined;
  const ctx = getMeasureCtx();
  ctx.font = `700 ${defaultPx}px "Inter Variable", "Inter", sans-serif`;
  const upper = longestWord.toUpperCase();
  const letterSpacingPx = defaultPx * 0.025; // matches tracking-wide
  const rawWidth = ctx.measureText(upper).width + letterSpacingPx * Math.max(countVisibleChars(upper) - 1, 0);
  // Leave a comfort margin inside the tile so a borderline word (e.g.
  // "CONDITIONING") shrinks slightly rather than rendering edge-to-edge
  // against the border. Also absorbs sub-pixel canvas-vs-layout differences.
  const target = availableWidthPx * 0.92;
  if (rawWidth <= target) return undefined;
  const shrunkPx = Math.max((target / rawWidth) * defaultPx, 8);
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
  /**
   * How many columns the board has, so the colour-picker popover's
   * right-edge flip works on any grid width (4 on Full, 3 on Mini).
   */
  columnCount?: number;
  isEmojiPuzzle?: boolean;
  // When set, "rainbow" tiles use this themed gradient (e.g. flag colors) instead
  // of the animated rainbow. rainbowTextShadow keeps the word legible over it.
  rainbowGradient?: string;
  rainbowTextShadow?: string;
  // Controls motion only, not whether the tile IS rainbow-colored — a
  // spotted/bonus rainbow tile always gets the rainbow treatment (isRainbow
  // decides that); this just chooses the animated .rainbow-tile gradient
  // (true, default) or the unrelated, purpose-built .rainbow-tile-static
  // gradient (false — not the animated one frozen in place), matching the
  // "Rainbow Animation" setting. Has no effect on themed (non-default)
  // rainbow gradients, which are already static images regardless of this
  // setting.
  rainbowAnimated?: boolean;
  // True while this tile's group is mid-reveal-animation: a clone is standing
  // in for it in a document.body overlay, so the real tile is hidden (but
  // keeps its layout space — visibility, not display — so the grid doesn't
  // reflow until the animation finishes and the word is actually removed).
  hiddenForReveal?: boolean;
  // True while this tile is part of a guess in the shared "checking" suspense
  // phase — plays a staggered bounce (checkingIndex sets the stagger order).
  isChecking?: boolean;
  checkingIndex?: number;
}

export const WordTile = forwardRef<HTMLDivElement, WordTileProps>(function WordTile({
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
  columnCount = 4,
  isEmojiPuzzle = false,
  rainbowGradient,
  rainbowTextShadow,
  rainbowAnimated = true,
  hiddenForReveal = false,
  isChecking = false,
  checkingIndex = 0,
}, forwardedRef) {
  const [showColorPicker, setShowColorPicker] = useState(false);
  // Timestamp of this tile's own last tap — each WordTile instance gets its
  // own ref, so "was the previous tap on this same tile" falls out for free
  // without tracking a target separately.
  const lastTapRef = useRef<number>(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
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
    const btn = buttonRef.current;
    if (!btn) return;

    const measure = () => {
      // Measure the tile's inner width from the BUTTON, not the text span. A
      // long single word (e.g. "TELEVISION") can't wrap and stretches the
      // w-full span to its own width; measuring the span would then hide the
      // overflow, leave the word unshrunk, and let it render off-center. The
      // button's content box is stable, so the overflow is detected reliably.
      const cs = getComputedStyle(btn);
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const available = btn.clientWidth - padX;
      // Outer (border-box) width — matches what the CSS container query on
      // the wrapper actually sizes against, since the wrapper has no
      // padding/border of its own.
      const outerWidth = btn.getBoundingClientRect().width;
      const longest = getLongestWord(word);
      setAutoFontSize(computeShrunkFontSize(longest, available, getBaseFontSizePx(outerWidth)));
    };

    measure();
    window.addEventListener("resize", measure);

    // The canvas ruler in computeShrunkFontSize measures with "Inter
    // Tight", which is a web font that loads asynchronously. If the first
    // measure() runs before it finishes downloading, the ruler falls back
    // to a differently-proportioned system font and can mis-estimate the
    // real width. Re-measure once fonts are ready so the shrink is
    // computed against the font that actually renders.
    let cancelled = false;
    if (typeof document !== "undefined" && document.fonts?.ready) {
      document.fonts.ready.then(() => {
        if (!cancelled) measure();
      });
    }

    return () => {
      cancelled = true;
      window.removeEventListener("resize", measure);
    };
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

    // Color Palette Mode or not using color features at all — plain
    // selection, no double-tap tracking needed.
    if (!colorCodeTiles || colorPaletteMode) {
      onClick();
      return;
    }

    // Color-Code Tiles mode: the first tap selects INSTANTLY (no waiting to
    // see if a second tap follows — that's what made ordinary selection feel
    // delayed). Only when a second tap lands on this same tile within the
    // double-tap window do we treat it as the color action instead of a
    // second select/deselect toggle.
    const now = Date.now();
    const timeSinceLastTap = now - lastTapRef.current;

    if (timeSinceLastTap < DOUBLE_TAP_DELAY_MS) {
      // Reset rather than stamping `now`, so a third rapid tap is treated as
      // a fresh first tap instead of chaining into another double-tap.
      lastTapRef.current = 0;
      // Double-tap coloring is selection-neutral: the first tap already
      // toggled selection, so undo that toggle here (onClick is a pure
      // select/deselect toggle — see toggleWord in useGame.ts) to restore
      // whatever selection state the tile had before this gesture started,
      // then open the picker.
      onClick();
      setShowColorPicker(true);
    } else {
      lastTapRef.current = now;
      onClick();
    }
  }, [colorCodeTiles, colorPaletteMode, onClick]);

  const handleColorSelect = useCallback((color: string | null) => {
    onColorChange?.(word, color === tileColor ? null : color);
    setShowColorPicker(false);
  }, [word, tileColor, onColorChange]);

  const colorStyle = tileColor ? COLOR_STYLES[tileColor] : null;

  // A themed bonus (e.g. flag) swaps the animated rainbow tile for a static gradient.
  const themedRainbow = !!isRainbow && !!rainbowGradient;

  // The colour-picker popover flips to the right edge on the LAST column,
  // whichever column that is for this board's width.
  const isRightEdge = column === columnCount;

  // Mobile height is DERIVED from width via aspect-ratio (11:10, i.e. tiles
  // are ~10% wider than tall) rather than an independently-tuned vw clamp —
  // width already comes from the board grid dividing up the available
  // board width, so deriving height from it guarantees the same tile
  // proportions at every mobile screen width instead of tiles getting
  // progressively taller/narrower-looking as the screen shrinks. Tablet/
  // desktop (md:768px+) keep the previously-approved flat 110px height,
  // unchanged from before this pass (md:aspect-auto hands sizing back to
  // that explicit height there).
  const baseClasses = `tile-base font-tile aspect-[11/10] md:aspect-auto md:h-[110px] font-[700] transition-all duration-150 ease-out relative
    ${disabled ? (tileColor || isRainbow ? "cursor-default" : "opacity-50 cursor-default") : ""}
  `;

  // Selection styling:
  // - Rainbow/colored tiles: solid foreground-color border when selected,
  //   keep their own background/gradient. This used to be a ring-[3px]
  //   ring-offset-2 (a box-shadow "halo" painted ~5px *outside* the tile's
  //   own box) with no equivalent reserved on the unselected tile — visually
  //   harmless to this element's own layout box, but the halo sits well
  //   outside the tile's border-box, inside the grid's own 6px gap, and can
  //   visually bleed onto/over a neighbouring tile (most often the one
  //   above) the moment it appears. Reserving the same border-[3px] on the
  //   unselected tile (transparent, so the paint color still shows straight
  //   through to the edge under border-box's default background-clip) and
  //   only ever changing its color removes that outside-the-box halo
  //   entirely — the border paints inside the box, so it can never overlap
  //   a neighbour regardless of gap size.
  // - Normal tiles: inverted charcoal/plum + white when selected, with a
  //   border that matches the selected background exactly — border-tile-
  //   selected resolves against the same --tile-selected variable as the
  //   fill in both themes, so it's always seamless/invisible without a
  //   dark:-specific override. This used to be dark:border-0 in dark mode
  //   (a real 0px border), while the unselected .cloud-tile class carries
  //   its own 1px border in both themes — so selecting a tile switched its
  //   border-box from 1px to 0px, visibly shifting it out of alignment with
  //   its grid neighbours for the duration of the transition. Keeping
  //   border-width constant at 1px in every state and only ever changing
  //   color removes that geometry change entirely.
  const stateClasses = isMatched
    ? "bg-tile-selected text-tile-selected-fg shadow-md animate-tile-matched scale-[0.97]"
    : isRainbow
      ? themedRainbow
        ? `text-white shadow-md border-[3px] ${isSelected ? "border-foreground scale-[0.97]" : "border-transparent"}`
        : rainbowAnimated
          ? `rainbow-tile text-white shadow-md border-[3px] ${isSelected ? "border-foreground scale-[0.97]" : "border-transparent"}`
          // Static rainbow: the smooth blended gradient reads better with
          // dark ink text than white (much stronger contrast across its
          // lighter bands), and with the tile's normal hairline border
          // instead of the animated variant's reserved 3px selection
          // border — that border read as its own thin multicolor edge
          // against this softer gradient, which this design intentionally
          // avoids.
          : `rainbow-tile-static text-[#292825] shadow-md border ${isSelected ? "border-foreground" : "border-tile-border"}`
      : colorStyle
        // text-group-N-fg (added alongside the bg fix above): the previous
        // 35%-opacity fill left this unset, relying on whatever ambient
        // text color happened to inherit — harmless for emoji tiles (an
        // <img>, not text) but not a real word/letters, which need the same
        // guaranteed-readable dark pairing SolvedGroup.tsx uses on the same
        // background.
        ? `${colorStyle.bg} ${colorStyle.text} hover:shadow-sm active:scale-95 border-[3px] ${isSelected ? "border-foreground scale-[0.97]" : "border-transparent"}`
        : isSelected
          ? "bg-tile-selected text-tile-selected-fg border border-tile-selected active:scale-95"
          : "cloud-tile active:scale-95";

  return (
    <div
      ref={forwardedRef}
      data-word={word}
      // The checking bounce lives on this wrapper (not the button) so its
      // transform doesn't fight the button's own scale/selection transforms.
      // [container-type:inline-size] makes this wrapper's own rendered
      // width available to the button's cqw-based font-size below, so text
      // scales directly off the tile's actual size (mobile through
      // desktop) rather than the viewport.
      className={`relative [container-type:inline-size] ${isChecking ? "animate-tile-checking" : ""}`}
      style={{
        touchAction: arrangeTiles ? "none" : "manipulation",
        ...(hiddenForReveal ? { visibility: "hidden" as const } : {}),
        ...(isChecking ? { animationDelay: `${checkingIndex * 0.07}s` } : {}),
      }}
    >
      <button
        ref={buttonRef}
        onClick={handleClick}
        disabled={disabled}
        aria-pressed={isSelected}
        draggable={arrangeTiles && draggable}
        onDragStart={() => onDragStart?.(word)}
        onDragOver={(e) => { e.preventDefault(); onDragOver?.(word); }}
        onDrop={onDrop}
        className={`${baseClasses} ${stateClasses} w-full ${isEmojiPuzzle ? "!p-2" : "text-[clamp(9px,15.5cqw,33px)]"}
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
          focus-visible:ring-offset-2 focus-visible:ring-offset-background`}
        style={{
          ...(emojiFontSize ? { fontSize: emojiFontSize } : {}),
          ...(themedRainbow ? { background: rainbowGradient, textShadow: rainbowTextShadow } : {}),
        }}
      >
        {isImage ? (
          <img
            src={customEmojiUrl(word)}
            alt={customEmojiName(word) ?? ""}
            draggable={false}
            style={{
              // Fill the square tile uniformly: any image — large or small —
              // is scaled to the same bounding box (contain preserves aspect
              // ratio), so a tiny image scales UP to match the rest rather
              // than rendering smaller than its neighbours. Sized below 100%
              // so custom emoji/icon tiles read a bit less toy-like/oversized
              // next to the word tiles. Assets are now trimmed tight to their
              // visible content (scripts/trim-image-assets.mjs), so this
              // percentage needs to be smaller than it was when assets still
              // carried their own transparent padding.
              width: "73%",
              height: "73%",
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
});
