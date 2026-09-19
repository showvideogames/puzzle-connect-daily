import { Label } from "@/components/ui/label";
import { THEME_OPTIONS } from "@/lib/themes";
import { DraggableTileGrid, type GridTile } from "./DraggableTileGrid";
import type { AnswerSlot } from "@/lib/builder/answerIdentity";

export interface RainbowGroupOption {
  colorIndex: 1 | 2 | 3 | 4;
  label: string;
  answers: AnswerSlot[];
  selectedId: string | null;
}

interface RainbowPanelProps {
  groups: RainbowGroupOption[];
  onSelect: (groupIdx: number, slotId: string | null) => void;
  categoryName: string;
  onCategoryNameChange: (v: string) => void;
  categoryEmoji: string;
  onCategoryEmojiChange: (v: string) => void;
  hintWord: string;
  onHintWordChange: (v: string) => void;
  theme: string;
  onThemeChange: (v: string) => void;
  displayOrderTiles: GridTile[];
  onReorderDisplay: (ids: string[]) => void;
  onFieldBlur?: () => void;
  /** Hides the Bonus Theme picker — the public creator doesn't expose holiday themes in this MVP. Admin-only feature, unaffected. */
  hideTheme?: boolean;
}

/**
 * The Rainbow bonus category: one answer picked from each of the four main
 * categories, plus its own title/hint/theme and a display-order arranger for
 * the picked answers. Shown once all 16 answers exist, same gate as the
 * starting board.
 */
export function RainbowPanel({
  groups,
  onSelect,
  categoryName,
  onCategoryNameChange,
  categoryEmoji,
  onCategoryEmojiChange,
  hintWord,
  onHintWordChange,
  theme,
  onThemeChange,
  displayOrderTiles,
  onReorderDisplay,
  onFieldBlur,
  hideTheme = false,
}: RainbowPanelProps) {
  const allSelected = groups.every((g) => !!g.selectedId);

  return (
    <div className="rounded-xl border-2 border-transparent bg-tile-bg overflow-hidden" style={{ borderImage: "linear-gradient(90deg, hsl(var(--group-1)), hsl(var(--group-2)), hsl(var(--group-3)), hsl(var(--group-4))) 1" }}>
      <div className="px-4 py-2 bg-gradient-to-r from-[hsl(var(--group-1))] via-[hsl(var(--group-3))] to-[hsl(var(--group-4))]">
        <span className="text-xs font-bold uppercase tracking-wider text-white drop-shadow">
          🌈 Rainbow Category
        </span>
      </div>
      <div className="p-4 space-y-3">
        <div>
          <Label className="text-xs">Category Name</Label>
          <input
            type="text"
            value={categoryName}
            onChange={(e) => onCategoryNameChange(e.target.value)}
            onBlur={onFieldBlur}
            placeholder="e.g. Mixed Bag 🌈"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm mt-1"
          />
        </div>

        <p className="text-xs text-muted-foreground">Choose one answer from each category.</p>
        <div className="grid grid-cols-2 gap-3">
          {groups.map((g, i) => (
            <div key={i}>
              <Label className="text-xs">{g.label}</Label>
              <select
                value={g.selectedId ?? ""}
                onChange={(e) => onSelect(i, e.target.value || null)}
                onBlur={onFieldBlur}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="">— none —</option>
                {g.answers
                  .filter((a) => a.text.trim() !== "")
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.text}
                    </option>
                  ))}
              </select>
            </div>
          ))}
        </div>

        {allSelected && (
          <div className="flex gap-2 flex-wrap">
            {groups.map((g, i) => {
              const selected = g.answers.find((a) => a.id === g.selectedId);
              return (
                <span key={i} className="rainbow-tile text-white text-xs font-semibold px-2 py-0.5 rounded">
                  {selected?.text}
                </span>
              );
            })}
          </div>
        )}

        {allSelected && (
          <div className="space-y-2 pt-2 border-t border-divider">
            <h4 className="text-xs font-semibold text-ink">Display Order</h4>
            <p className="text-xs text-muted-foreground">Drag to reorder how these appear once solved.</p>
            <DraggableTileGrid tiles={displayOrderTiles} onReorder={onReorderDisplay} />
          </div>
        )}

        <div>
          <Label className="text-xs">Category Emoji (optional)</Label>
          <input
            type="text"
            value={categoryEmoji}
            onChange={(e) => onCategoryEmojiChange(e.target.value)}
            onBlur={onFieldBlur}
            placeholder="🌈"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm mt-1"
          />
          <p className="text-xs text-muted-foreground mt-1">Add an emoji or short visual, such as 🎵 or ___ 💬.</p>
        </div>

        <div>
          <Label className="text-xs">Small Hint word (optional)</Label>
          <input
            type="text"
            value={hintWord}
            onChange={(e) => onHintWordChange(e.target.value)}
            onBlur={onFieldBlur}
            placeholder="Extra example word shown as a Small Hint"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm mt-1"
          />
        </div>

        {!hideTheme && (
          <div>
            <Label className="text-xs">Bonus Theme</Label>
            <select
              value={theme}
              onChange={(e) => onThemeChange(e.target.value)}
              onBlur={onFieldBlur}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm mt-1"
            >
              {THEME_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground mt-1">Swaps the bonus gradient, emoji, and copy for a holiday look. Default keeps the rainbow.</p>
          </div>
        )}
      </div>
    </div>
  );
}
