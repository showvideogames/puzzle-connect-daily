import { useLayoutEffect, useRef } from "react";

const MIN_SCALE = 0.6;
const STEP = 0.05;

/**
 * Keeps a solved category bar's text inside the bar instead of letting the
 * bar grow (the refreshed Full Daily layout).
 *
 * The bar is exactly one tile row tall (.solved-bar's min-height), and that
 * equal height is what lets the solve animation swap a tile row for its bar
 * without the board moving. Its title and answer sizes are set in index.css
 * as `base size × var(--bar-fit)`; this lowers --bar-fit in small steps only
 * when a long title or answer line would make the bar taller than its row or
 * wider than the board, so ordinary categories all keep the same full size.
 * Re-fits when the bar's width changes (rotation, resize) and once web fonts
 * have loaded.
 */
export function useFitBarText<T extends HTMLElement>(enabled: boolean, contentKey: string) {
  const ref = useRef<T | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;

    // Measures the text itself rather than the bar, which a parent may
    // stretch taller than its content.
    const overflows = () => {
      const style = getComputedStyle(el);
      const minHeight = parseFloat(style.minHeight) || 0;
      const children = Array.from(el.children) as HTMLElement[];
      if (minHeight > 0 && children.length > 0) {
        const top = children[0].getBoundingClientRect().top;
        const bottom = children[children.length - 1].getBoundingClientRect().bottom;
        const needed = bottom - top + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
        if (needed > minHeight + 0.5) return true;
      }
      return children.some((child) => child.scrollWidth > child.clientWidth + 0.5);
    };
    const fit = () => {
      let scale = 1;
      el.style.setProperty("--bar-fit", "1");
      while (scale > MIN_SCALE && overflows()) {
        scale = Math.max(MIN_SCALE, scale - STEP);
        el.style.setProperty("--bar-fit", scale.toFixed(2));
      }
    };

    fit();
    let lastWidth = el.offsetWidth;
    const observer = new ResizeObserver(() => {
      if (Math.abs(el.offsetWidth - lastWidth) < 0.5) return;
      lastWidth = el.offsetWidth;
      fit();
    });
    observer.observe(el);
    let alive = true;
    document.fonts?.ready.then(() => alive && fit());
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, [enabled, contentKey]);

  return ref;
}
