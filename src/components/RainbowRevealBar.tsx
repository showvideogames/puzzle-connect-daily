import type { ResolvedTheme } from "@/lib/themes";
import { isCustomEmoji, customEmojiUrl, customEmojiName } from "@/lib/customEmoji";
import { CategoryEmojiInline } from "./CategoryEmojiInline";

interface RainbowRevealBarProps {
  categoryName: string | null | undefined;
  categoryEmoji: string | null | undefined;
  theme: ResolvedTheme;
  words: string[];
  // Puzzle-level setting — see Puzzle.alphabetizeCompleted. Same default as
  // SolvedGroup, and applies to the Rainbow's own answers the same way.
  alphabetizeCompleted?: boolean;
  textClass: string;
  background: string;
  textShadow?: string;
  curtain: boolean;
}

/**
 * The Rainbow's own solved bar — shown both when it's revealed as part of the
 * normal board sequence and in the post-game "spot the Rainbow" reveal.
 * Mirrors SolvedGroup's title+emoji rendering so the bonus category and the
 * four standard ones stay visually consistent.
 */
export function RainbowRevealBar({
  categoryName,
  categoryEmoji,
  theme,
  words,
  alphabetizeCompleted = true,
  textClass,
  background,
  textShadow,
  curtain,
}: RainbowRevealBarProps) {
  const customName = (categoryName ?? "").trim();
  const title = customName || theme.label;
  const explicitEmoji = (categoryEmoji ?? "").trim();
  // No explicit emoji and no custom name: fall back to the theme's own
  // default (e.g. "Rainbow 🌈"). A custom name with an emoji typed into it
  // (legacy authoring) is shown exactly as typed, with nothing appended, so
  // it's never duplicated.
  const emoji = explicitEmoji || (customName ? "" : theme.emoji);
  const displayWords = alphabetizeCompleted ? [...words].sort((a, b) => a.localeCompare(b)) : words;
  return (
    <div
      className={`w-full rounded-lg py-3 px-4 text-center ${textClass} ${curtain ? "animate-rainbow-curtain" : ""}`}
      style={{ background, textShadow, clipPath: curtain ? undefined : "inset(0 100% 0 0)" }}
    >
      <div className="font-tile font-bold text-[16px] md:text-[19px] leading-tight uppercase tracking-wide">
        {title}
        {emoji && (
          <>
            {" "}
            <CategoryEmojiInline value={emoji} />
          </>
        )}
      </div>
      <div className="text-[13px] md:text-[15px] font-[575] leading-tight mt-1 flex items-center justify-center flex-wrap gap-x-1 gap-y-0.5">
        {displayWords.map((w, i) => (
          <span key={`${w}-${i}`} className="inline-flex items-center gap-x-1">
            {i > 0 && <span aria-hidden="true">·</span>}
            {isCustomEmoji(w) ? (
              <img
                src={customEmojiUrl(w)}
                alt={customEmojiName(w) ?? ""}
                draggable={false}
                style={{ height: "28px", width: "auto", objectFit: "contain" }}
              />
            ) : (
              <span>{w}</span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
