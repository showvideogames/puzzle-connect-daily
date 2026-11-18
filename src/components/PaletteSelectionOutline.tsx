/** The palette buttons are 40px squares with a 12px corner radius.
 * Draw the fill and 2px selection stroke in the same coordinate system,
 * with a 1px gap. Mixing a CSS background with a separately rasterized
 * shadow or SVG ring can make that gap asymmetric at fractional scales.
 */
export function PaletteSelectionOutline({ fill = "hsl(var(--foreground))" }: { fill?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className="pointer-events-none absolute -inset-[3px] h-[46px] w-[46px] text-foreground"
      viewBox="0 0 46 46"
    >
      <rect x="3" y="3" width="40" height="40" rx="12" fill={fill} />
      <rect x="1" y="1" width="44" height="44" rx="14" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
