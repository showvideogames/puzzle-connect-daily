import { backgroundStyle } from "@/lib/coverBackgrounds";
import { resolveCover, type CreatorCover } from "@/lib/creatorCover";

/** System colour-emoji fonts only: nothing is fetched to draw a cover. */
export const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif';

/**
 * A puzzle's creator cover: its one emoji, centred and large, on its one
 * preset background. With no cover (every puzzle made before covers, or a
 * creator who skipped the step) it draws the neutral default: Rainbow tiles on
 * a soft ground. Never any text: the title always sits outside the art.
 * Decorative (aria-hidden); the title and credit beside it carry the meaning.
 */
export function CreatorCoverArt({ cover, className = "", emojiScale = 0.42, emojiSize }: { cover: CreatorCover | null | undefined; className?: string; emojiScale?: number; emojiSize?: string }) {
  const resolved = resolveCover(cover);
  if (!resolved) {
    return (
      <div aria-hidden="true" data-cover-kind="default" className={`flex items-center justify-center bg-violet-50 dark:bg-white/5 [container-type:inline-size] ${className}`}>
        <svg viewBox="0 0 40 40" className="h-[46%] w-auto max-h-[46cqw]" focusable="false">
          {[[0, 0, "#FFC21A"], [21, 0, "#44B54A"], [0, 21, "#2F80ED"], [21, 21, "#FF5A5F"]].map(([x, y, c]) => (
            <rect key={`${x}${y}`} x={x as number} y={y as number} width="19" height="19" rx="4.5" fill={c as string} opacity="0.85" />
          ))}
        </svg>
      </div>
    );
  }
  return (
    <div
      aria-hidden="true"
      data-cover-kind="creator"
      data-cover-emoji={cover!.emoji}
      data-cover-background={cover!.background}
      className={`flex items-center justify-center [container-type:inline-size] ${className}`}
      style={backgroundStyle(resolved.bg)}
    >
      <span className="select-none leading-none drop-shadow-[0_2px_2px_rgba(0,0,0,0.18)]" style={{ fontFamily: EMOJI_FONT, fontSize: emojiSize ?? `${Math.round(emojiScale * 100)}cqw` }}>
        {resolved.char}
      </span>
    </div>
  );
}
