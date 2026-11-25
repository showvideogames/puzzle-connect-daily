/**
 * Puzzle covers for Community (preview): a small, reusable set of flat
 * illustrations, each a little scene around a cluster of Rainbow tiles.
 *
 * Spoiler-free by construction: a puzzle's cover is picked from its public
 * short code alone (lib/puzzleCovers.ts), never from its title, categories or
 * answers, so a cover can't hint at a solution and nobody has to draw or upload
 * anything per puzzle. Decorative only (aria-hidden): the title and creator are
 * always shown as text beside it.
 *
 * Drawn in a 200×125 box (16:10). Kept to plain shapes so the whole set is a
 * few kilobytes of SVG.
 */
import { mixHex, type Cover, type CoverId, type CoverPalette } from "@/lib/puzzleCovers";

function Tiles({ x, y, s, fill, shade, gap = 0.12, rot = 0 }: { x: number; y: number; s: number; fill: string; shade: string; gap?: number; rot?: number }) {
  const g = s * gap;
  const t = (s - g) / 2;
  const r = t * 0.22;
  return (
    <g transform={`rotate(${rot} ${x + s / 2} ${y + s / 2})`}>
      <rect x={x - s * 0.06} y={y + s * 0.02} width={s * 1.12} height={s * 1.12} rx={r * 1.6} fill={shade} />
      <rect x={x - s * 0.06} y={y - s * 0.06} width={s * 1.12} height={s * 1.12} rx={r * 1.6} fill="#ffffff" opacity="0.9" />
      {[0, 1].flatMap((i) => [0, 1].map((j) => (
        <rect key={`${i}${j}`} x={x + i * (t + g)} y={y + j * (t + g)} width={t} height={t} rx={r} fill={fill} />
      )))}
      {[0, 1].flatMap((i) => [0, 1].map((j) => (
        <rect key={`h${i}${j}`} x={x + i * (t + g) + t * 0.14} y={y + j * (t + g) + t * 0.12} width={t * 0.42} height={t * 0.16} rx={t * 0.08} fill="#ffffff" opacity="0.45" />
      )))}
    </g>
  );
}

const Leaf = ({ d, fill = "#3f9a52" }: { d: string; fill?: string }) => <path d={d} fill={fill} />;

function Shelf({ p }: { p: CoverPalette }) {
  return (
    <>
      <rect width="200" height="125" fill={p.bg} />
      <circle cx="170" cy="18" r="26" fill="#ffe59a" />
      <Leaf d="M18 92 C8 64 16 40 30 26 C30 52 34 72 18 92Z" />
      <Leaf d="M30 96 C40 74 56 66 66 64 C56 80 46 92 30 96Z" fill="#2f8443" />
      <rect y="98" width="200" height="27" fill="#b8743c" />
      <rect y="98" width="200" height="6" fill="#d58f4f" />
      <rect x="44" y="40" width="58" height="60" rx="12" fill="#ff8b7f" />
      <rect x="40" y="32" width="66" height="12" rx="6" fill="#fff4e6" />
      <Tiles x={54} y={52} s={38} fill={p.tile} shade={p.shade} gap={0.14} />
      <rect x="112" y="56" width="36" height="44" rx="8" fill="#ffe08a" />
      <Tiles x={118} y={64} s={24} fill="#ffb400" shade="#e09100" />
      <rect x="152" y="36" width="34" height="64" rx="8" fill="#e8f6e3" />
      <rect x="150" y="30" width="38" height="9" rx="4" fill="#3d3d3d" />
      <Tiles x={156} y={50} s={26} fill="#44b54a" shade="#2e8e35" />
    </>
  );
}

function Wave({ p }: { p: CoverPalette }) {
  return (
    <>
      <rect width="200" height="125" fill={p.bg} />
      <path d="M0 70 C30 20 90 6 130 30 C160 48 150 80 120 76 C140 60 118 44 96 56 C70 70 70 104 110 112 L200 112 L200 125 L0 125Z" fill="#0f9fa8" />
      <path d="M0 92 C40 76 70 96 100 100 C140 106 170 86 200 92 L200 125 L0 125Z" fill="#0b7d86" />
      <path d="M120 76 C150 80 160 48 130 30 C150 36 168 60 152 80Z" fill="#e8fbfb" />
      <circle cx="176" cy="34" r="5" fill="#e8fbfb" />
      <circle cx="186" cy="48" r="3" fill="#e8fbfb" />
      <Tiles x={66} y={46} s={46} fill={p.tile} shade={p.shade} rot={-10} />
    </>
  );
}

function Sky({ p }: { p: CoverPalette }) {
  return (
    <>
      <rect width="200" height="125" fill={p.bg} />
      <ellipse cx="40" cy="30" rx="26" ry="10" fill="#ffffff" />
      <ellipse cx="160" cy="96" rx="34" ry="12" fill="#ffffff" />
      <ellipse cx="150" cy="22" rx="18" ry="7" fill="#ffffff" />
      <path d="M58 20 L96 8 L104 50 L66 58Z" fill="#ffd34d" />
      <path d="M58 20 L104 50" stroke="#f08a24" strokeWidth="2.5" />
      <path d="M96 8 L66 58" stroke="#f08a24" strokeWidth="2.5" />
      <path d="M66 58 C58 76 74 86 60 104 C52 114 40 112 34 118" fill="none" stroke="#ff6f91" strokeWidth="3" strokeLinecap="round" />
      <path d="M46 98 l10 -6 l2 10z M36 112 l10 -5 l1 9z" fill="#ff6f91" />
      <Tiles x={118} y={44} s={44} fill={p.tile} shade={p.shade} rot={8} />
    </>
  );
}

function Burst({ p }: { p: CoverPalette }) {
  return (
    <>
      <rect width="200" height="125" fill={p.bg} />
      <path d="M0 84 C50 60 90 110 140 84 C170 68 186 70 200 76 L200 96 C180 88 168 90 140 104 C90 128 50 82 0 104Z" fill="#ff8fb1" />
      <path d="M120 10 C150 0 190 20 200 30 L200 44 C186 30 150 16 120 24Z" fill="#ff8fb1" />
      {[[52, 22, 62, 36], [40, 52, 56, 56], [150, 98, 164, 108], [160, 70, 176, 66], [74, 104, 82, 116]].map(([x1, y1, x2, y2], i) => (
        <path key={i} d={`M${x1} ${y1} L${x2} ${y2}`} stroke="#2b0a5e" strokeWidth="5" strokeLinecap="round" />
      ))}
      <Tiles x={74} y={30} s={56} fill={p.tile} shade={p.shade} rot={-14} />
    </>
  );
}

function Garden({ p }: { p: CoverPalette }) {
  return (
    <>
      <rect width="200" height="125" fill={p.bg} />
      <circle cx="30" cy="22" r="14" fill="#fff6b8" />
      <Leaf d="M10 125 C0 90 20 60 44 50 C40 80 34 104 10 125Z" fill="#46a35a" />
      <Leaf d="M190 125 C200 92 180 62 156 52 C160 82 166 106 190 125Z" fill="#46a35a" />
      <Leaf d="M150 125 C144 100 152 86 170 78 C168 98 166 112 150 125Z" fill="#2f8443" />
      <circle cx="58" cy="100" r="6" fill="#ff7aa8" />
      <circle cx="142" cy="40" r="5" fill="#ffd34d" />
      <circle cx="160" cy="30" r="4" fill="#ff7aa8" />
      <Tiles x={76} y={36} s={50} fill={p.tile} shade={p.shade} rot={6} />
    </>
  );
}

function Night({ p }: { p: CoverPalette }) {
  return (
    <>
      <rect width="200" height="125" fill={p.bg} />
      <circle cx="160" cy="30" r="16" fill="#fff1b5" />
      <circle cx="168" cy="24" r="14" fill={p.bg} />
      {[[24, 20], [50, 44], [100, 14], [130, 52], [186, 70], [20, 80], [70, 98]].map(([x, y], i) => (
        <path key={i} d={`M${x} ${y - 4} L${x + 1.5} ${y - 1} L${x + 4.5} ${y} L${x + 1.5} ${y + 1} L${x} ${y + 4} L${x - 1.5} ${y + 1} L${x - 4.5} ${y} L${x - 1.5} ${y - 1}Z`} fill="#ffe27a" />
      ))}
      <path d="M0 110 C40 96 80 116 120 104 C150 96 176 104 200 100 L200 125 L0 125Z" fill={mixHex(p.bg, "#000000", 0.3)} />
      <Tiles x={78} y={38} s={46} fill={p.tile} shade={p.shade} rot={-6} />
    </>
  );
}

function Hills({ p }: { p: CoverPalette }) {
  return (
    <>
      <rect width="200" height="125" fill={p.bg} />
      <circle cx="158" cy="30" r="18" fill="#ffb347" />
      <path d="M0 86 C40 56 80 62 110 84 C140 64 170 60 200 78 L200 125 L0 125Z" fill="#7cc97a" />
      <path d="M0 104 C50 84 100 92 140 108 C160 100 182 98 200 102 L200 125 L0 125Z" fill="#4fae5c" />
      <path d="M24 70 l6 -14 l6 14z M40 74 l5 -11 l5 11z" fill="#2f8443" />
      <Tiles x={84} y={32} s={44} fill={p.tile} shade={p.shade} rot={4} />
    </>
  );
}

function Confetti({ p }: { p: CoverPalette }) {
  const dots: [number, number, string][] = [[20, 20, "#ff5a5f"], [44, 96, "#ffb400"], [172, 24, "#2f80ed"], [186, 92, "#44b54a"], [140, 110, "#ff5a5f"], [30, 62, "#2f80ed"], [160, 60, "#ffb400"], [112, 14, "#44b54a"]];
  return (
    <>
      <rect width="200" height="125" fill={p.bg} />
      {dots.map(([x, y, c], i) => <rect key={i} x={x} y={y} width="9" height="5" rx="2" fill={c} transform={`rotate(${(i * 37) % 90} ${x} ${y})`} />)}
      <g transform="rotate(-8 100 64)">
        <rect x="58" y="24" width="84" height="84" rx="16" fill={p.shade} />
        <rect x="58" y="18" width="84" height="84" rx="16" fill="#ffffff" />
        <rect x="66" y="26" width="32" height="32" rx="7" fill="#ffc21a" />
        <rect x="102" y="26" width="32" height="32" rx="7" fill="#44b54a" />
        <rect x="66" y="62" width="32" height="32" rx="7" fill="#2f80ed" />
        <rect x="102" y="62" width="32" height="32" rx="7" fill="#ff5a5f" />
      </g>
    </>
  );
}

const SCENES: Record<CoverId, (props: { p: CoverPalette }) => JSX.Element> = { shelf: Shelf, wave: Wave, sky: Sky, burst: Burst, garden: Garden, night: Night, hills: Hills, confetti: Confetti };

export function PuzzleCover({ cover, className = "" }: { cover: Cover; className?: string }) {
  const Scene = SCENES[cover.scene];
  return (
    <svg viewBox="0 0 200 125" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false" className={`block ${className}`} data-cover={cover.scene}>
      <Scene p={cover.palette} />
    </svg>
  );
}
