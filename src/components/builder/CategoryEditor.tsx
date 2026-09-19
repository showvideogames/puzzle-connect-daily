import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// The whole card wears its category colour (the same --group-N tokens the
// solved bars and tiles use). Text on it is always solid Ink, never faded via
// opacity, and the inputs stay off-white so they read as editable.
const CARD_CLASSES: Record<1 | 2 | 3 | 4, string> = {
  1: "bg-group-1",
  2: "bg-group-2",
  3: "bg-group-3",
  4: "bg-group-4",
};

const INK = "text-[#292825]";
const INPUT_CLASSES =
  "bg-[#FFFDF8] text-[#292825] border-[#292825]/15 placeholder:text-[#6B675F] focus-visible:ring-[#292825]";

export interface CategoryEditorProps {
  colorIndex: 1 | 2 | 3 | 4;
  label: string;
  difficultyLabel: string;
  category: string;
  onCategoryChange: (value: string) => void;
  categoryEmoji: string;
  onCategoryEmojiChange: (value: string) => void;
  categoryPlaceholder: string;
  answersRaw: string;
  onAnswersRawChange: (value: string) => void;
  answersPlaceholder: string;
  answersLabel: string;
  hintWord: string;
  onHintWordChange: (value: string) => void;
  hintPlaceholder: string;
  onFieldBlur?: () => void;
  /** The six-dot drag handle, rendered in the header. Only it starts a drag. */
  dragHandle?: ReactNode;
  isDragging?: boolean;
}

/**
 * One category's editor card: name, comma-separated answers, optional Small
 * Hint. Shared by the Admin builder and the public creator — no admin-only or
 * public-only concepts live here.
 */
export function CategoryEditor({
  colorIndex,
  label,
  difficultyLabel,
  category,
  onCategoryChange,
  categoryEmoji,
  onCategoryEmojiChange,
  categoryPlaceholder,
  answersRaw,
  onAnswersRawChange,
  answersPlaceholder,
  answersLabel,
  hintWord,
  onHintWordChange,
  hintPlaceholder,
  onFieldBlur,
  dragHandle,
  isDragging,
}: CategoryEditorProps) {
  return (
    <div
      data-testid={`category-card-${colorIndex}`}
      className={`rounded-xl shadow-sm ${CARD_CLASSES[colorIndex]} ${INK} transition-shadow
        ${isDragging ? "shadow-lg scale-[1.01]" : ""}`}
    >
      <div className="flex items-center gap-2 px-3 pt-3 pb-1">
        {dragHandle}
        <span className="text-xs font-bold uppercase tracking-wider">
          {label} · {difficultyLabel}
        </span>
      </div>
      <div className="px-4 pb-4 pt-1 space-y-3">
        <div>
          <Label className={`text-xs ${INK}`}>Category Name</Label>
          <Input
            value={category}
            onChange={(e) => onCategoryChange(e.target.value)}
            onBlur={onFieldBlur}
            placeholder={categoryPlaceholder}
            className={INPUT_CLASSES}
          />
        </div>
        <div>
          <Label className={`text-xs ${INK}`}>Category Emoji (optional)</Label>
          <Input
            value={categoryEmoji}
            onChange={(e) => onCategoryEmojiChange(e.target.value)}
            onBlur={onFieldBlur}
            placeholder="🎵"
            className={INPUT_CLASSES}
          />
          <p className={`text-[11px] mt-1 ${INK}`}>Add an emoji or short visual, such as 🎵 or ___ 💬.</p>
        </div>
        <div>
          <Label className={`text-xs ${INK}`}>{answersLabel}</Label>
          <Input
            value={answersRaw}
            onChange={(e) => onAnswersRawChange(e.target.value)}
            onBlur={onFieldBlur}
            placeholder={answersPlaceholder}
            className={INPUT_CLASSES}
          />
        </div>
        <div>
          <Label className={`text-xs ${INK}`}>Small Hint word (optional)</Label>
          <Input
            value={hintWord}
            onChange={(e) => onHintWordChange(e.target.value)}
            onBlur={onFieldBlur}
            placeholder={hintPlaceholder}
            className={INPUT_CLASSES}
          />
          <p className={`text-[11px] mt-1 ${INK}`}>
            An extra answer that fits this category but does not appear on the board.
          </p>
        </div>
      </div>
    </div>
  );
}
