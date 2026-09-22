import { splitCategoryVisual } from "@/lib/categoryVisual";
import { customEmojiUrl } from "@/lib/customEmoji";

/**
 * Renders an explicit Category Emoji value inline after a category title:
 * custom emoji codes (":caveman:") draw as images, everything else prints as
 * literal text. Same split GameBoard's Full Hint pill already uses, so the
 * two stay visually consistent.
 */
export function CategoryEmojiInline({ value }: { value: string }) {
  return (
    <>
      {splitCategoryVisual(value).map((part, i) =>
        part.type === "text" ? (
          <span key={i}>{part.value}</span>
        ) : (
          <img
            key={i}
            src={customEmojiUrl(part.name)}
            alt={part.name}
            draggable={false}
            className="inline-block align-middle"
            style={{ height: "1em", width: "auto" }}
          />
        )
      )}
    </>
  );
}
