import { useState, useRef, useCallback, useEffect, useLayoutEffect, forwardRef, type PointerEvent as ReactPointerEvent } from "react";
import { isCustomEmoji, customEmojiUrl, customEmojiName } from "@/lib/customEmoji";
import { categorySwatches } from "@/lib/categoryPalette";
import { FULL_FORMAT, type PuzzleFormat } from "@/lib/puzzleFormat";

const DOUBLE_TAP_DELAY_MS = 250;

// Arrange Tiles: how far a press has to travel before it becomes a drag
// rather than a tap.
const DRAG_THRESHOLD_PX = 8;

// The lifted look of a tile being dragged: a little larger than its
// neighbours, with a soft shadow beneath it.
const LIFT_SCALE = 1.06;
// A short drag can still count as a tap to the browser (it stayed within the
// browser's own tap tolerance), so it fires a click on release — aimed at
// where the finger first went down. By then the drag has moved another tile
// into that spot, so the click must be ignored whichever tile it lands on,
// not just on the dragged one. Shared by every tile for that reason; a new
// press clears it, so a real tap right after a drag still selects at once.
let ignoreClicksUntil = 0;
const IGNORE_CLICKS_AFTER_DRAG_MS = 600;

const LIFT_SHADOW ="0 14px 28px -8px rgb(0 0 0 / 0.30), 0 6px 12px -4px rgb(0 0 0 / 0.18)";

// Rainbow annotations stay outside the gradient; ordinary tiles use a themed tint.
const COLOR_RING_BORDER_CLASS: Record<string, string> = {
  yellow: "border-group-1", green: "border-group-2",
  blue: "border-group-3", red: "border-group-4",
};

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
//
// Returns the shrink as a fraction of the normal size (applied as `em`
// against the button's own font-size), never an absolute px value, and
// measures at the size the button ACTUALLY renders (`button` is its
// computed style). Every tile's normal size comes from the CSS
// text-[clamp(9px,15.5cqw,33px)] on the button; this function used to
// re-derive that size from a JS copy of the formula and return px, so any
// time the two disagreed — the CSS container size lagging the JS-measured
// width, a transform (the drag lift's scale) inflating
// getBoundingClientRect, a browser resolving cqw differently — a "shrunk"
// long word could land LARGER than the short words around it. As an `em`
// fraction below 1 it can only ever be smaller.
function computeFitScale(longestWord: string, availableWidthPx: number, button: CSSStyleDeclaration): number | undefined {
  const basePx = parseFloat(button.fontSize);
  if (!longestWord || availableWidthPx <= 0 || !(basePx > 0)) return undefined;
  const ctx = getMeasureCtx();
  ctx.font = `${button.fontWeight} ${basePx}px ${button.fontFamily}`;
  const upper = longestWord.toUpperCase();
  const letterSpacingPx = parseFloat(button.letterSpacing) || 0; // tracking-wide, resolved to px
  const rawWidth = ctx.measureText(upper).width + letterSpacingPx * Math.max(countVisibleChars(upper) - 1, 0);
  // Leave a comfort margin inside the tile so a borderline word (e.g.
  // "CONDITIONING") shrinks slightly rather than rendering edge-to-edge
  // against the border. Also absorbs sub-pixel canvas-vs-layout differences.
  const target = availableWidthPx * 0.92;
  if (rawWidth <= target) return undefined;
  const scale = Math.max(target / rawWidth, 8 / basePx);
  return scale < 1 ? Math.round(scale * 1000) / 1000 : undefined;
}

// Split long words (the refreshed Full Daily only — see splitLongWords). The
// tile's normal side padding (tile-base px-2), and the smaller padding a split
// word gets so its two halves can stay at a readable size.
const TILE_PAD_X = 8;
const SPLIT_PAD_X = 3;
const MIN_TILE_FONT_PX = 8;
// A single word that would have to shrink below this share of the normal
// tile size to fit on one line is split instead, when that reads larger.
const SPLIT_BELOW_SCALE = 0.7;

function measureTextWidth(text: string, button: CSSStyleDeclaration): number {
  const ctx = getMeasureCtx();
  ctx.font = `${button.fontWeight} ${parseFloat(button.fontSize)}px ${button.fontFamily}`;
  const upper = text.toUpperCase();
  const letterSpacingPx = parseFloat(button.letterSpacing) || 0;
  return ctx.measureText(upper).width + letterSpacingPx * Math.max(countVisibleChars(upper) - 1, 0);
}

// Consonant clusters English words commonly start with — a split that leaves
// one of these at the start of the second line reads naturally (SNOW-FLAKES,
// GRAPE-FRUIT); one that leaves "NDB" or "HC" does not.
const WORD_ONSETS = new Set([
  "BL", "BR", "CH", "CL", "CR", "DR", "FL", "FR", "GL", "GR", "KN", "PH", "PL", "PR", "QU",
  "SC", "SCH", "SCR", "SH", "SK", "SL", "SM", "SN", "SP", "SPL", "SPR", "ST", "STR", "SW",
  "TH", "THR", "TR", "TW", "WH", "WR",
]);
const isVowel = (c: string) => /[AEIOUY]/i.test(c);

/** Whether breaking before chars[i] looks like a syllable or compound boundary. */
function isNaturalBreak(chars: string[], i: number): boolean {
  // The second line starts with a consonant (cluster) followed by a vowel...
  let j = i;
  while (j < chars.length && !isVowel(chars[j])) j++;
  if (j === i || j === chars.length) return false;
  const onset = chars.slice(i, j).join("").toUpperCase();
  if (onset.length > 1 && !WORD_ONSETS.has(onset)) return false;
  // ...that the split does not tear out of a cluster the first line ends
  // with (SNOWF-LAKES breaks "FL").
  const last = chars[i - 1].toUpperCase();
  if (!isVowel(last) && WORD_ONSETS.has(last + onset)) return false;
  return true;
}

/**
 * For a single word that would otherwise shrink to a much smaller size than
 * its neighbours, or not fit at all (e.g. IDENTIFICATION on a phone): the
 * most even two-line hyphenated split, and the size both halves fit at.
 * Returns undefined when the word fits on one line at a comfortable size, or
 * when splitting would not read larger — those tiles render as before.
 */
function computeSplitFit(
  word: string,
  tileInnerWidthPx: number,
  button: CSSStyleDeclaration
): { parts: [string, string]; scale: number | undefined } | undefined {
  const basePx = parseFloat(button.fontSize);
  const chars = Array.from(word);
  if (/s/.test(word.trim()) || chars.length < 8 || !(basePx > 0) || tileInnerWidthPx <= 0) return undefined;
  const floor = MIN_TILE_FONT_PX / basePx;
  const oneLineScale = ((tileInnerWidthPx - 2 * TILE_PAD_X) * 0.92) / measureTextWidth(word, button);
  if (oneLineScale >= SPLIT_BELOW_SCALE) return undefined;
  let best: { parts: [string, string]; score: number; width: number } | undefined;
  for (let i = 3; i <= chars.length - 3; i++) {
    const parts: [string, string] = [chars.slice(0, i).join(""), chars.slice(i).join("")];
    const width = Math.max(measureTextWidth(parts[0] + "-", button), measureTextWidth(parts[1], button));
    // A natural break (DIAMOND-BACK, SNOW-FLAKES) wins over a slightly more
    // even one (DIAMO-NDBACK); an even split is the fallback.
    // Between two consonants (the usual compound seam: DIAMOND-BACK) edges
    // out an equally even vowel-consonant break (DIA-MONDBACK).
    const seam = !isVowel(chars[i - 1]) && !isVowel(chars[i]) ? 0.97 : 1;
    const score = width * seam * (isNaturalBreak(chars, i) ? 1 : 1.5);
    if (!best || score < best.score) best = { parts, score, width };
  }
  if (!best) return undefined;
  const target = (tileInnerWidthPx - 2 * SPLIT_PAD_X) * 0.92;
  const scale = Math.max(Math.min(1, target / best.width), floor);
  if (scale <= Math.max(oneLineScale, floor)) return undefined;
  return { parts: best.parts, scale: scale < 1 ? Math.round(scale * 1000) / 1000 : undefined };
}

interface WordTileProps {
  word: string;
  isSelected: boolean;
  onClick: () => void;
  disabled?: boolean;
  // Whether a disabled tile is also dimmed (default true). GameBoard turns
  // this off for the brief input lock while a guess is checked and a solved
  // category animates in: nothing is really "unavailable" then, and dimming
  // the board for that second — then brightening it again — read as a flash,
  // most visibly on the selected tiles themselves (dark → grey → dark).
  dimWhenDisabled?: boolean;
  isRainbow?: boolean;
  isMatched?: boolean;
  arrangeTiles?: boolean;
  colorCodeTiles?: boolean;
  colorPaletteMode?: boolean;
  isPaintMode?: boolean;
  tileColor?: string | null;
  onColorChange?: (word: string, color: string | null) => void;
  draggable?: boolean;
  // Arrange Tiles drag, for mouse and touch alike. The board owns where the
  // tile goes; the tile only reports the press. onDragStart fires once the
  // press has moved past DRAG_THRESHOLD_PX (a shorter press is a tap), then
  // onDragMove for every move, then exactly one of onDragEnd (released) or
  // onDragCancel (pointer cancelled, window lost focus, or Escape).
  onDragStart?: (word: string, x: number, y: number) => void;
  onDragMove?: (x: number, y: number) => void;
  onDragEnd?: () => void;
  onDragCancel?: () => void;
  // True while this tile is the one being dragged: it lifts (scale + shadow)
  // and lets the pointer through to the board beneath it.
  isLifted?: boolean;
  column?: number;
  /**
   * The format of the board this tile sits on. Single source of truth for
   * two things the picker needs:
   *   • WHICH colours it offers — Full: Yellow/Green/Blue/Red, Mini:
   *     Green/Blue/Red — via categorySwatches(), the exact same list Color
   *     Palette Mode renders, so the two interfaces cannot disagree about
   *     whether this board has a Yellow category.
   *   • how many columns the board has, so the popover's right-edge flip
   *     works on any grid width (4 on Full, 3 on Mini).
   * Defaults to Full, which is what a tile rendered outside a real board
   * (e.g. the tutorial) is.
   */
  format?: PuzzleFormat;
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
  // True once this tile's category has gathered into the top row and its
  // solved bar has swapped in over it: the tile is hidden that same frame —
  // no fade, so it never ghosts through the bar — while keeping its layout
  // space, so nothing reflows until the row is removed.
  fadingForReveal?: boolean;
  // True while this tile is part of a guess in the shared "checking" suspense
  // phase — plays a staggered bounce (checkingIndex sets the stagger order).
  isChecking?: boolean;
  checkingIndex?: number;
  // Mini's compact board wants square (not 11:10) tiles at every width,
  // including desktop — Mini's grid is capped at ~390px so it never reaches
  // the flat 110px height Full/wideBoard tiles get there. Defaults to false
  // so Full's existing aspect ratio is untouched.
  squareTiles?: boolean;
  /**
   * A single word too long to fit even at the smallest size is split over two
   * lines with a hyphen instead of being clipped (computeSplitFit). Off by
   * default: only the refreshed Full Daily turns it on for now.
   */
  splitLongWords?: boolean;
}

export const WordTile = forwardRef<HTMLDivElement, WordTileProps>(function WordTile({
  word,
  isSelected,
  onClick,
  disabled,
  dimWhenDisabled = true,
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
  onDragMove,
  onDragEnd,
  onDragCancel,
  isLifted = false,
  column = 1,
  format = FULL_FORMAT,
  isEmojiPuzzle = false,
  rainbowGradient,
  rainbowTextShadow,
  rainbowAnimated = true,
  fadingForReveal = false,
  isChecking = false,
  checkingIndex = 0,
  squareTiles = false,
  splitLongWords = false,
}, forwardedRef) {
  const [showColorPicker, setShowColorPicker] = useState(false);
  // Timestamp of this tile's own last tap — each WordTile instance gets its
  // own ref, so "was the previous tap on this same tile" falls out for free
  // without tracking a target separately.
  const lastTapRef = useRef<number>(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Detaches the window listeners of the press in progress, if any.
  const endPressRef = useRef<(() => void) | null>(null);
  const dragHandlersRef = useRef({ onDragStart, onDragMove, onDragEnd, onDragCancel });
  dragHandlersRef.current = { onDragStart, onDragMove, onDragEnd, onDragCancel };

  const isImage = isCustomEmoji(word);
  const emojiFontSize = isEmojiPuzzle && !isImage
    ? getEmojiFontSize(countVisibleChars(word))
    : undefined;

  const textRef = useRef<HTMLSpanElement>(null);
  // Fraction of the tile's normal font-size the text needs to fit (see
  // computeFitScale); undefined when it already fits at normal size.
  const [fitScale, setFitScale] = useState<number | undefined>(undefined);
  const [splitParts, setSplitParts] = useState<[string, string] | undefined>(undefined);

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
      // clientWidth is a layout size, so transforms — the drag lift's scale,
      // the press-down shrink, entrance animations — never skew it: a
      // lifted tile measures exactly as it does at rest.
      const cs = getComputedStyle(btn);
      if (splitLongWords) {
        // Decided from the tile's full inner width and fixed paddings, never
        // the current padding, which a split itself changes.
        const split = computeSplitFit(word, btn.clientWidth, cs);
        setSplitParts(split?.parts);
        if (split) {
          setFitScale(split.scale);
          return;
        }
        setFitScale(computeFitScale(getLongestWord(word), btn.clientWidth - 2 * TILE_PAD_X, cs));
        return;
      }
      const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const available = btn.clientWidth - padX;
      setFitScale(computeFitScale(getLongestWord(word), available, cs));
    };

    measure();
    // Re-measure whenever the tile itself changes size — not just the
    // window — since the board can resize a tile without a window resize.
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => measure()) : null;
    if (resizeObserver) resizeObserver.observe(btn);
    else window.addEventListener("resize", measure);

    // The canvas ruler in computeFitScale measures with the tile's web font,
    // which loads asynchronously. If the first measure() runs before it
    // finishes downloading, the ruler falls back to a differently-
    // proportioned system font and can mis-estimate the real width.
    // Re-measure once fonts are ready so the shrink is computed against the
    // font that actually renders.
    let cancelled = false;
    if (typeof document !== "undefined" && document.fonts?.ready) {
      document.fonts.ready.then(() => {
        if (!cancelled) measure();
      });
    }
    // fonts.ready can settle before the tile face has started loading (a cold
    // first visit), leaving a long word measured against the fallback font and
    // drawn too wide. Any font finishing later re-measures.
    document.fonts?.addEventListener?.("loadingdone", measure);

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measure);
      document.fonts?.removeEventListener?.("loadingdone", measure);
    };
  }, [word, isEmojiPuzzle, isImage, splitLongWords]);

  // Arrange Tiles press tracking, via pointer events so mouse and touch take
  // the same path. The listeners go on the window, not the button: the lifted
  // tile ignores the pointer (so the board can see what's beneath it), and a
  // drag can wander outside the tile anyway.
  const handlePointerDown = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
    // A new press is a new gesture: any click from here on is a real tap.
    ignoreClicksUntil = 0;
    if (!arrangeTiles || !draggable || disabled || !e.isPrimary || e.button !== 0) return;
    endPressRef.current?.();
    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;

    const endPress = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleCancel);
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("blur", handleBlur);
      endPressRef.current = null;
      // Keep ignoring clicks briefly after the drag; after that, a keyboard
      // activation (which has no press) works normally again.
      if (dragging) ignoreClicksUntil = performance.now() + IGNORE_CLICKS_AFTER_DRAG_MS;
    };
    const cancel = () => {
      endPress();
      if (dragging) dragHandlersRef.current.onDragCancel?.();
    };
    function handleMove(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return;
      if (!dragging) {
        if (Math.abs(ev.clientX - startX) < DRAG_THRESHOLD_PX && Math.abs(ev.clientY - startY) < DRAG_THRESHOLD_PX) return;
        dragging = true;
        ignoreClicksUntil = Infinity;
        dragHandlersRef.current.onDragStart?.(word, ev.clientX, ev.clientY);
      }
      ev.preventDefault();
      dragHandlersRef.current.onDragMove?.(ev.clientX, ev.clientY);
    }
    function handleUp(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return;
      endPress();
      if (dragging) dragHandlersRef.current.onDragEnd?.();
    }
    function handleCancel(ev: PointerEvent) {
      if (ev.pointerId === pointerId) cancel();
    }
    function handleKey(ev: KeyboardEvent) {
      if (ev.key === "Escape" && dragging) cancel();
    }
    function handleBlur() {
      cancel();
    }

    window.addEventListener("pointermove", handleMove, { passive: false });
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleCancel);
    window.addEventListener("keydown", handleKey);
    window.addEventListener("blur", handleBlur);
    endPressRef.current = endPress;
  }, [arrangeTiles, draggable, disabled, word]);

  useEffect(() => () => endPressRef.current?.(), []);

  const handleClick = useCallback(() => {
    if (performance.now() < ignoreClicksUntil) {
      ignoreClicksUntil = 0;
      return;
    }

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

  const colorRing = tileColor ? COLOR_RING_BORDER_CLASS[tileColor] : null;

  // A themed bonus (e.g. flag) swaps the animated rainbow tile for a static gradient.
  const themedRainbow = !!isRainbow && !!rainbowGradient;

  // The colour-picker popover flips to the right edge on the LAST column,
  // whichever column that is for this board's width.
  const isRightEdge = column === format.columns;

  // Mobile height is DERIVED from width via aspect-ratio (5:4 below md, Mini
  // included, so the board, feedback and controls fit a phone screen; tiles
  // are 25% wider than tall) rather than an independently-tuned vw clamp —
  // width already comes from the board grid dividing up the available
  // board width, so deriving height from it guarantees the same tile
  // proportions at every mobile screen width instead of tiles getting
  // progressively taller/narrower-looking as the screen shrinks. Tablet/
  // desktop (md:768px+) keep the previously-approved flat 110px height,
  // unchanged from before this pass (md:aspect-auto hands sizing back to
  // that explicit height there).
  const baseClasses = `tile-base font-tile ${squareTiles ? "aspect-[5/4] md:aspect-square" : "aspect-[5/4] md:aspect-auto md:h-[110px]"} font-[700] transition-[background-color,border-color,box-shadow,transform,scale,opacity] duration-150 ease-out relative
    ${disabled ? (tileColor || isRainbow || !dimWhenDisabled ? "cursor-default" : "opacity-50 cursor-default") : ""}
  `;

  // Submission selection is independent of annotations: CSS combines the
  // ordinary tint with selection; Rainbow gradients remain untouched.
  // Border widths stay fixed, so toggling either state cannot reflow a tile.
  // Selection uses separate edge styling, never a scale or a fill overlay.
  const stateClasses = isMatched
    ? "tile-neutral bg-tile-selected text-tile-selected-fg shadow-md animate-tile-matched scale-[0.97]"
    : isRainbow
      ? themedRainbow
        ? `text-white shadow-md border-[3px] md:border-[4px] ${isSelected ? "border-foreground" : "border-transparent"}`
        : rainbowAnimated
          ? `rainbow-tile text-white shadow-md border-[3px] md:border-[4px] ${isSelected ? "border-foreground" : "border-transparent"}`
          // Static rainbow: the smooth blended gradient reads better with
          // dark ink text than white (much stronger contrast across its
          // lighter bands), and with the tile's normal hairline border
          // instead of the animated variant's reserved selection border —
          // that border read as its own thin multicolor edge against this
          // softer gradient, which this design intentionally avoids.
          : `rainbow-tile-static text-[#292825] shadow-md border ${isSelected ? "border-foreground" : "border-tile-border"}`
      : isSelected
        ? "tile-neutral bg-tile-selected text-tile-selected-fg border border-tile-selected"
        : "tile-neutral cloud-tile";

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
      data-tile-kind={isRainbow ? "rainbow" : "ordinary"}
      data-tile-selected={isSelected ? "true" : "false"}
      className={`tile-shell relative [container-type:inline-size] ${isChecking ? "animate-tile-checking" : ""}`}
      style={{
        touchAction: arrangeTiles ? "none" : "manipulation",
        // The board positions a lifted tile with an inline transform on
        // this wrapper; letting the pointer through lets it see the tile
        // slot beneath.
        ...(isLifted ? { pointerEvents: "none" as const, willChange: "transform" } : {}),
        ...(fadingForReveal ? { opacity: 0 } : {}),
        ...(isChecking ? { animationDelay: `${checkingIndex * 0.07}s` } : {}),
      }}
    >
      {colorRing && (
        <span aria-hidden="true" data-tile-mark={tileColor}
          className={`tile-color-outline pointer-events-none absolute ${colorRing}`} />
      )}
      {(colorRing || isRainbow) && isSelected && <span aria-hidden="true" data-tile-selection
        className="tile-selection-outline pointer-events-none absolute" />}
      <button
        ref={buttonRef}
        onClick={handleClick}
        // Stops a mouse/touch selection from leaving the button focused —
        // preventDefault on mousedown blocks the browser's default
        // focus-on-click (the click itself still fires normally), so the
        // focus-visible ring below can never double up with the tile's own
        // selection border on a pointer interaction. Keyboard users are
        // unaffected: Tab moves focus without a mousedown, and Enter/Space
        // activation doesn't dispatch one either, so the ring still shows
        // for keyboard navigation exactly as before. Skipped in arrangeTiles
        // mode, which keeps its long-standing mouse behaviour unchanged.
        onMouseDown={arrangeTiles ? undefined : (e) => e.preventDefault()}
        onPointerDown={handlePointerDown}
        disabled={disabled}
        aria-pressed={isSelected}
        data-tile-color={colorRing ? tileColor : undefined}
        className={`${baseClasses} ${stateClasses} w-full ${isEmojiPuzzle ? "!p-2" : "text-[clamp(9px,15.5cqw,33px)]"}
          tile-keyboard-focus`}
        style={{
          ...(emojiFontSize ? { fontSize: emojiFontSize } : {}),
          // Two lines need the vertical room the single-line padding takes, or a
          // split word in a thick-bordered (Rainbow, painted) tile on a narrow
          // phone makes its row taller than a tile row.
          ...(splitParts ? { paddingLeft: SPLIT_PAD_X, paddingRight: SPLIT_PAD_X, paddingTop: 4, paddingBottom: 4 } : {}),
          ...(themedRainbow ? { background: rainbowGradient, textShadow: rainbowTextShadow } : {}),
          // Deliberate drag lift only; selecting a tile never scales it.
          ...(isLifted ? { scale: String(LIFT_SCALE), boxShadow: LIFT_SHADOW } : {}),
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
          // fitScale only kicks in when the longest word measures wider than
          // the tile itself, as a last-resort shrink — in em, so it is always
          // a fraction of the normal size every other tile uses.
          <span
            ref={textRef}
            data-tile-text
            className="w-full"
            style={{
              wordBreak: "normal",
              overflowWrap: "normal",
              lineHeight: 1.2,
              ...(fitScale ? { fontSize: `${fitScale}em` } : {}),
            }}
          >
            {splitParts ? (
              // The only break opportunity is the <wbr>, and the whole word is
              // too wide for one line at this size, so it wraps exactly there.
              // The hyphen is drawn by CSS (.tile-split-head), so the tile's
              // text is still the plain word for copying and screen readers.
              <>
                <span className="tile-split-head">{splitParts[0]}</span>
                <wbr />
                {splitParts[1]}
              </>
            ) : (
              word
            )}
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
            {/* One circle per colour THIS FORMAT uses, in difficulty order.
                Shares categorySwatches() with Color Palette Mode's swatch row
                (GameBoard.tsx) — that shared list is why a Mini, whose
                categories are difficulties 2-4, offers Green/Blue/Red here
                and never a Yellow it has no category for. */}
            {categorySwatches(format).map(({ color, label, swatchClass }) => (
              <button
                key={color}
                onClick={(e) => { e.stopPropagation(); handleColorSelect(color); }}
                aria-label={`${label} tile color`}
                className={`w-5 h-5 rounded-full ${swatchClass} hover:scale-125 transition-transform
                  ${tileColor === color ? "ring-2 ring-offset-1 ring-foreground" : ""}
                `}
              />
            ))}
            {tileColor && (
              <button
                onClick={(e) => { e.stopPropagation(); handleColorSelect(null); }}
                aria-label="Remove tile color"
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
