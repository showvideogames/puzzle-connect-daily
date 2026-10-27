import type { ResolvedTheme } from "@/lib/themes";

interface SpotRainbowPromptProps {
  theme: ResolvedTheme;
  onClick: () => void;
  className?: string;
}

/**
 * The post-game "Spot the Rainbow" invitation: the puzzle theme's gradient
 * card with its prompt, breathing and shimmering. One component for both
 * places it appears — the finished board and the results popup — so the
 * two can never drift apart. Clicking it is what opens the challenge
 * (SpotTheRainbowModal); this component only asks.
 */
export function SpotRainbowPrompt({ theme, onClick, className = "" }: SpotRainbowPromptProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-lg py-1 px-4 text-center text-white
        hover:opacity-90 transition-opacity active:scale-[0.99]
        animate-rainbow-breathe animate-rainbow-shimmer
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background
        ${className}`}
      style={{ background: theme.gradient, textShadow: theme.textShadow }}
      data-testid="spot-rainbow-prompt"
    >
      <div className="solved-bar-title font-tile font-bold text-[16px] md:text-[19px] leading-tight uppercase tracking-wide">{theme.spotPrompt}</div>
      <div className="solved-bar-answers text-[13px] md:text-[15px] font-[575] leading-tight mt-0.5">Find one word from each group</div>
    </button>
  );
}
