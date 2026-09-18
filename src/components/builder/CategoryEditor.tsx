import { ArrowLeftRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const HEADER_CLASSES: Record<1 | 2 | 3 | 4, string> = {
  1: "bg-[hsl(var(--group-1)/0.4)] text-group-1-fg",
  2: "bg-[hsl(var(--group-2)/0.4)] text-group-2-fg",
  3: "bg-[hsl(var(--group-3)/0.4)] text-group-3-fg",
  4: "bg-[hsl(var(--group-4)/0.4)] text-group-4-fg",
};

export interface CategoryEditorProps {
  colorIndex: 1 | 2 | 3 | 4;
  label: string;
  difficultyLabel: string;
  category: string;
  onCategoryChange: (value: string) => void;
  categoryPlaceholder: string;
  answersRaw: string;
  onAnswersRawChange: (value: string) => void;
  answersPlaceholder: string;
  answersLabel: string;
  hintWord: string;
  onHintWordChange: (value: string) => void;
  hintPlaceholder: string;
  onFieldBlur?: () => void;
  /** Admin-only: renders a small swap-order control in the header when provided. */
  onSwapClick?: () => void;
  isSwapSelected?: boolean;
}

/**
 * One category's editor card: name, comma-separated answers, optional Small
 * Hint. Shared by the Admin builder and (later) the public creator — no
 * admin-only or public-only concepts live here.
 */
export function CategoryEditor({
  colorIndex,
  label,
  difficultyLabel,
  category,
  onCategoryChange,
  categoryPlaceholder,
  answersRaw,
  onAnswersRawChange,
  answersPlaceholder,
  answersLabel,
  hintWord,
  onHintWordChange,
  hintPlaceholder,
  onFieldBlur,
  onSwapClick,
  isSwapSelected,
}: CategoryEditorProps) {
  return (
    <div
      className={`rounded-xl border border-tile-border bg-tile-bg overflow-hidden transition-shadow
        ${isSwapSelected ? "ring-2 ring-primary ring-offset-1" : ""}`}
    >
      <div className={`flex items-center justify-between px-4 py-2 ${HEADER_CLASSES[colorIndex]}`}>
        <span className="text-xs font-bold uppercase tracking-wider">
          {label} · {difficultyLabel}
        </span>
        {onSwapClick && (
          <button
            type="button"
            onClick={onSwapClick}
            aria-label={`Select ${label} to swap with another category`}
            className="p-1 -m-1 rounded hover:bg-black/10 transition-colors"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <div className="p-4 space-y-3">
        <div>
          <Label className="text-xs">Category Name</Label>
          <Input
            value={category}
            onChange={(e) => onCategoryChange(e.target.value)}
            onBlur={onFieldBlur}
            placeholder={categoryPlaceholder}
          />
        </div>
        <div>
          <Label className="text-xs">{answersLabel}</Label>
          <Input
            value={answersRaw}
            onChange={(e) => onAnswersRawChange(e.target.value)}
            onBlur={onFieldBlur}
            placeholder={answersPlaceholder}
          />
        </div>
        <div>
          <Label className="text-xs">Small Hint word (optional)</Label>
          <Input
            value={hintWord}
            onChange={(e) => onHintWordChange(e.target.value)}
            onBlur={onFieldBlur}
            placeholder={hintPlaceholder}
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            An extra answer that fits this category but does not appear on the board.
          </p>
        </div>
      </div>
    </div>
  );
}
