import { RainbowIcon } from "./RainbowIcon";

// Upside-down variant of RainbowIcon for the "Reverse Rainbow" stat row —
// same arcs/palette, flipped vertically within the same viewBox so it still
// sits flush in a 24x24 icon slot.
export function ReverseRainbowIcon({ className }: { className?: string }) {
  return (
    <div className={className} style={{ transform: "scaleY(-1)", display: "inline-flex" }}>
      <RainbowIcon className="w-full h-full" />
    </div>
  );
}
