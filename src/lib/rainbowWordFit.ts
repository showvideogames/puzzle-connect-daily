/**
 * The bottom of a fixed-height rainbow tile kept free for its color bar: the
 * bar's bottom offset and height, plus the 2px gap above it. Mirrors index.css:
 * --tile-bar-bottom and --tile-bar-height on .tile-shell, and the + 2px in the
 * md grid rule's last row. A cqw there is 1% of the shell's width, which is the
 * button's offsetWidth.
 */
export function rainbowBarReserve(tileWidthPx: number): number {
  const cqw = tileWidthPx / 100;
  const clamp = (min: number, share: number, max: number) => Math.min(max, Math.max(min, share * cqw));
  return clamp(3, 3, 5) + clamp(7, 9, 13) + 2;
}

/**
 * The largest font scale from `start` down to `floor` at which the text's
 * height fits `available`; `heightAt(scale)` lays the text out at that scale
 * and returns its height. Returns `start` when it already fits, and never
 * more. Lines can rewrap as the size drops, so height is not proportional to
 * scale: this searches, to 0.001, instead of dividing.
 */
export function fitScaleToHeight(heightAt: (scale: number) => number, available: number, start: number, floor: number): number {
  if (floor >= start || heightAt(start) <= available) return start;
  if (heightAt(floor) > available) return floor;
  let fits = floor;
  let tooBig = start;
  while (tooBig - fits > 0.001) {
    const mid = (fits + tooBig) / 2;
    if (heightAt(mid) <= available) fits = mid;
    else tooBig = mid;
  }
  return Math.max(floor, Math.floor(fits * 1000) / 1000);
}
