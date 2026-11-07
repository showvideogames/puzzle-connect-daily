import { useId } from "react";

type MedalRank = 1 | 2 | 3;

/** Light and dark stop of each metal, the ribbon's shade, the ring and the number. */
const METALS: Record<MedalRank, { name: string; light: string; dark: string; ribbon: string; ring: string; ink: string }> = {
  1: { name: "gold", light: "#F7C948", dark: "#E0A100", ribbon: "#C98A00", ring: "#A97400", ink: "#3b2a00" },
  2: { name: "silver", light: "#D9DDE3", dark: "#9AA3AE", ribbon: "#848D99", ring: "#6E7782", ink: "#2b2f36" },
  3: { name: "bronze", light: "#F0A35E", dark: "#C2671F", ribbon: "#A9561A", ring: "#8E4512", ink: "#3a1c05" },
};

/**
 * The rosette's scalloped edge: sixteen shallow arcs between valley points, each
 * bulging outward. Built once, in the 36 × 40 box the badge draws in.
 */
const ROSETTE = (() => {
  const points = 16, cx = 18, cy = 15, valley = 13, bump = 2.9;
  const at = (i: number) => {
    const angle = ((i + 0.5) / points) * Math.PI * 2 - Math.PI / 2;
    return `${(cx + valley * Math.cos(angle)).toFixed(2)} ${(cy + valley * Math.sin(angle)).toFixed(2)}`;
  };
  let path = `M${at(-1)}`;
  for (let i = 0; i < points; i++) path += ` A${bump} ${bump} 0 0 1 ${at(i)}`;
  return `${path} Z`;
})();

/**
 * A gold, silver or bronze rosette for the first three places, drawn in SVG so
 * it stays crisp at any size and in both themes. Tied players share a medal: it
 * shows the rank it is given, and the standings already rank ties together.
 */
export function MedalBadge({ rank, size = 36 }: { rank: MedalRank; size?: number }) {
  const metal = METALS[rank];
  const id = useId().replace(/:/g, "");
  const face = `${id}-face`, inner = `${id}-inner`;
  return (
    <span role="img" aria-label={`Rank ${rank}`} data-medal={metal.name} className="inline-grid shrink-0 place-items-center" style={{ width: size, height: size * (40 / 36) }}>
      <svg viewBox="0 0 36 40" width={size} height={size * (40 / 36)} aria-hidden="true" focusable="false" className="block overflow-visible">
        <defs>
          <linearGradient id={face} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={metal.light} />
            <stop offset="1" stopColor={metal.dark} />
          </linearGradient>
          <linearGradient id={inner} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={metal.dark} />
            <stop offset="1" stopColor={metal.light} />
          </linearGradient>
        </defs>
        <path d="M12.2 21 L17.4 24.4 L14.4 38.4 L12 35.6 L8.8 37.4 Z" fill={metal.ribbon} stroke={metal.ring} strokeWidth="0.6" strokeLinejoin="round" />
        <path d="M23.8 21 L18.6 24.4 L21.6 38.4 L24 35.6 L27.2 37.4 Z" fill={metal.ribbon} stroke={metal.ring} strokeWidth="0.6" strokeLinejoin="round" />
        <path d={ROSETTE} fill={`url(#${face})`} stroke={metal.ring} strokeWidth="0.9" strokeLinejoin="round" />
        <circle cx="18" cy="15" r="9.6" fill={`url(#${inner})`} stroke={metal.ring} strokeOpacity="0.55" strokeWidth="0.7" />
        <circle cx="18" cy="15" r="8.4" fill={`url(#${face})`} />
        <text x="18" y="15.4" textAnchor="middle" dominantBaseline="central" fontSize="12.5" fontWeight="900" fill={metal.ink} fontFamily="'Nunito Sans Variable', 'Nunito Sans', system-ui, sans-serif">
          {rank}
        </text>
      </svg>
    </span>
  );
}

/** A medal for the first three places, and the plain number in a neutral circle after that. */
export function RankBadge({ rank }: { rank: number }) {
  if (rank === 1 || rank === 2 || rank === 3) return <MedalBadge rank={rank} />;
  return (
    <span role="img" aria-label={`Rank ${rank}`} className="inline-grid h-9 w-9 shrink-0 place-items-center rounded-full bg-secondary text-base font-extrabold text-foreground ring-1 ring-border">
      {rank}
    </span>
  );
}
