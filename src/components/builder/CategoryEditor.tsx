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
  /** Hint Only: the emoji stays in the Full Hint but is kept off the solved bar. */
  categoryEmojiHintOnly: boolean;
  onCategoryEmojiHintOnlyChange: (value: boolean) => void;
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
  categoryEmojiHintOnly,
  onCategoryEmojiHintOnlyChange,
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
  // Each field is programmatically associated with its own label. The cards
  // repeat (three or four per page), so the ids are namespaced by the card's
  // colour, which is unique within a board. Before this, the <Label>s here
  // were decorative text: a screen reader read the inputs as unnamed, and
  // nothing could address "this card's Category Name" by its visible name.
  const fieldId = (name: string) => `category-${colorIndex}-${name}`;
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
          {/* Name gets the lion's share of the row (70/30 on narrow phones,
              80/20 from md up) so the Emoji input stays usable without
              crushing the Name field, which is edited far more often. */}
          <div className="grid grid-cols-[minmax(0,7fr)_minmax(88px,3fr)] md:grid-cols-[minmax(0,4fr)_minmax(96px,1fr)] gap-2 md:gap-3 items-end">
            <div>
              <Label htmlFor={fieldId("name")} className={`text-xs ${INK}`}>Category Name</Label>
              <Input
                id={fieldId("name")}
                value={category}
                onChange={(e) => onCategoryChange(e.target.value)}
                onBlur={onFieldBlur}
                placeholder={categoryPlaceholder}
                className={INPUT_CLASSES}
              />
            </div>
            <div>
              <Label htmlFor={fieldId("emoji")} className={`text-xs ${INK}`}>Category Emoji (optional)</Label>
              <Input
                id={fieldId("emoji")}
                value={categoryEmoji}
                onChange={(e) => onCategoryEmojiChange(e.target.value)}
                onBlur={onFieldBlur}
                placeholder="🎵"
                className={INPUT_CLASSES}
              />
            </div>
          </div>
          {/* Helper and the Hint Only box share one line under the row, so
              the box sits with the Emoji field it belongs to without
              squeezing the (much narrower) Emoji column itself. */}
          <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <p className={`text-[11px] ${INK}`}>Add an emoji or short visual, such as 🎵 or ___ 💬.</p>
            <label
              htmlFor={fieldId("emoji-hint-only")}
              className="flex items-center gap-1.5 shrink-0 cursor-pointer"
              title="Show this visual in the hint only — the solved box keeps just the category name."
            >
              <input
                id={fieldId("emoji-hint-only")}
                type="checkbox"
                checked={categoryEmojiHintOnly}
                onChange={(e) => onCategoryEmojiHintOnlyChange(e.target.checked)}
                onBlur={onFieldBlur}
                className="rounded border-[#292825]/40"
              />
              <span className={`text-[11px] font-semibold ${INK}`}>Hint Only</span>
            </label>
          </div>
          {categoryEmojiHintOnly && (
            <p className={`text-[11px] mt-0.5 ${INK} opacity-80`}>
              The solved box will show the Category Name on its own.
            </p>
          )}
        </div>
        <div>
          <Label htmlFor={fieldId("answers")} className={`text-xs ${INK}`}>{answersLabel}</Label>
          <Input
            id={fieldId("answers")}
            value={answersRaw}
            onChange={(e) => onAnswersRawChange(e.target.value)}
            onBlur={onFieldBlur}
            placeholder={answersPlaceholder}
            className={INPUT_CLASSES}
          />
        </div>
        <div>
          <Label htmlFor={fieldId("hint")} className={`text-xs ${INK}`}>Small Hint word (optional)</Label>
          <Input
            id={fieldId("hint")}
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
