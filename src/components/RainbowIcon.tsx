// Small colorful rainbow-arc icon for stat rows (e.g. "Rainbows Spotted")
// where a plain monochrome outline icon wouldn't read as "rainbow" at a
// glance. Reuses the exact brand rainbow palette already established for
// the static rainbow gradient and Share/Result grid cells (index.css's
// --rainbow-static-gradient / ResultGrid.tsx's RAINBOW_GRADIENT) — fixed
// hex colors, not theme-adaptive, matching how those other rainbow
// treatments are also fixed regardless of light/dark mode.
export function RainbowIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M2.6 20a9.4 9.4 0 0 1 18.8 0" stroke="#E9786D" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M4.4 20a7.6 7.6 0 0 1 15.2 0" stroke="#A98DDB" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M6.2 20a5.8 5.8 0 0 1 11.6 0" stroke="#7DB9DD" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M8 20a4 4 0 0 1 8 0" stroke="#8CCB91" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M9.8 20a2.2 2.2 0 0 1 4.4 0" stroke="#F6D968" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
