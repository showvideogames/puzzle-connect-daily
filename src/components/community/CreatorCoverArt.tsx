import { backgroundStyle } from "@/lib/coverBackgrounds";
import { resolveCover, type CreatorCover } from "@/lib/creatorCover";

/** System colour-emoji fonts only: nothing is fetched to draw a cover. */
export const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif';

/**
 * Each emoji's size relative to a single emoji, so two sit side by side and
 * three fit in a tight row without touching, down to the smallest thumbnail.
 */
const SCALE_BY_COUNT = [1, 0.7, 0.56];

/**
 * A puzzle's creator cover: its one to three emoji, centred, on its preset
 * background. One is large; two are balanced side by side; three sit in a
 * tight row. With no cover (older puzzles, or a creator who skipped it) it
 * draws the neutral default: Rainbow tiles on a soft ground. Never any text:
 * the title always sits outside the art. Decorative (aria-hidden).
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
  const n = resolved.chars.length;
  const factor = SCALE_BY_COUNT[n - 1];
  const size = emojiSize ? `calc(${emojiSize} * ${factor})` : `${Math.round(emojiScale * factor * 1000) / 10}cqw`;
  return (
    <div
      aria-hidden="true"
      data-cover-kind="creator"
      data-cover-emoji={cover!.emojis.join(" ")}
      data-cover-count={n}
      data-cover-background={cover!.background}
      className={`flex items-center justify-center [container-type:inline-size] ${className}`}
      style={backgroundStyle(resolved.bg)}
    >
      <span className="flex items-center justify-center" style={{ gap: `calc(${size} * 0.12)` }}>
        {resolved.chars.map((c, i) => (
          <span key={i} data-cover-glyph className="select-none leading-none drop-shadow-[0_2px_2px_rgba(0,0,0,0.18)]" style={{ fontFamily: EMOJI_FONT, fontSize: size }}>
            {c}
          </span>
        ))}
      </span>
    </div>
  );
}
