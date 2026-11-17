import { z } from "zod";
import type { BuilderState } from "@/hooks/useBuilderForm";
import { getFormat } from "@/lib/puzzleFormat";

export const CREATOR_DRAFT_KEY = "rainbow-creator-draft-v1";
export const CREATOR_DRAFT_LOCK = "rainbow-creator-draft";
const slot = z.object({ id: z.string().min(1), text: z.string() });
const schema = z.object({
  version: z.literal(1),
  title: z.string(), designer: z.string(), visibility: z.enum(["public", "private"]),
  builder: z.object({
    format: z.literal("full"),
    groups: z.array(z.object({
      category: z.string(), answersRaw: z.string(), answers: z.array(slot), tombstones: z.array(slot),
      hintWord: z.string(), categoryEmoji: z.string(), categoryEmojiHintOnly: z.boolean(),
      difficulty: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
      poolIds: z.array(z.string().min(1)).length(4),
    })).length(4),
    rainbowHerringIds: z.array(z.string().nullable()).length(4),
    rainbowWordOrderIds: z.array(z.string()).max(4),
    rainbowCategoryName: z.string(), rainbowHintWord: z.string(), rainbowCategoryEmoji: z.string(),
    rainbowCategoryEmojiHintOnly: z.boolean(), theme: z.string(), alphabetizeCompleted: z.boolean(),
    wordOrderIds: z.array(z.string()).length(16), style: z.enum(["rainbow", "classic"]),
  }),
});
export interface CreatorDraft {
  title: string;
  designer: string;
  visibility: "public" | "private";
  builder: BuilderState;
}
export function encodeDraft(draft: CreatorDraft): string {
  return JSON.stringify({ ...draft, version: 1, builder: { ...draft.builder, format: draft.builder.format.id } });
}
export function decodeDraft(raw: string): CreatorDraft {
  const parsed = schema.parse(JSON.parse(raw));
  const b = parsed.builder;
  const pools = b.groups.flatMap(g => g.poolIds);
  const tracked = b.groups.flatMap(g => [...g.answers, ...g.tombstones].map(a => a.id));
  if (new Set(pools).size !== 16 || new Set(tracked).size !== tracked.length ||
      new Set(b.wordOrderIds).size !== 16 || b.wordOrderIds.some(id => !pools.includes(id)) ||
      b.groups.some((g, i) => g.difficulty !== i + 1 || g.poolIds.some(id => ![...g.answers, ...g.tombstones].some(a => a.id === id))) ||
      b.rainbowHerringIds.some((id, i) => id !== null && ![...b.groups[i].answers, ...b.groups[i].tombstones].some(a => a.id === id)) ||
      new Set(b.rainbowWordOrderIds).size !== b.rainbowWordOrderIds.length ||
      b.rainbowWordOrderIds.some(id => !tracked.includes(id))) throw new Error("Invalid draft identities");
  return { title: parsed.title, designer: parsed.designer, visibility: parsed.visibility,
    // Zod inference marks properties optional with this repo’s strictNullChecks=false.
    builder: { ...b, format: getFormat(b.format) } as BuilderState };
}

/** Used only while holding the origin's creator Web Lock. The raw comparison
 * also preserves a copy changed by an older app or external storage tooling. */
export class CreatorDraftStore {
  private expected: string | null = null;
  private readable = false;
  private malformed = false;
  error: string | null = null;
  draft: CreatorDraft | undefined;
  constructor(private storage: () => Storage) {
    try {
      this.expected = storage().getItem(CREATOR_DRAFT_KEY);
      this.readable = true;
      if (this.expected !== null) this.draft = decodeDraft(this.expected);
    } catch {
      this.malformed = this.readable;
      this.error = this.readable
        ? "The saved draft could not be read. It has been kept unchanged. Start fresh to discard it."
        : "Browser storage is unavailable. Changes cannot be recovered after you leave.";
    }
  }
  private change(next: string | null, explicitClear: boolean): boolean {
    try {
      if (!this.readable || (this.malformed && !explicitClear)) return false;
      const storage = this.storage();
      if (storage.getItem(CREATOR_DRAFT_KEY) !== this.expected) {
        this.error = "The saved draft changed elsewhere. Your edits are not saved. Return to Create in a new tab after closing this one to recover that copy.";
        return false;
      }
      if (next === null) storage.removeItem(CREATOR_DRAFT_KEY);
      else storage.setItem(CREATOR_DRAFT_KEY, next);
      this.expected = next;
      this.malformed = false;
      this.error = null;
      return true;
    } catch {
      this.error = "Browser storage could not be updated. Your latest changes may not be recovered after you leave.";
      return false;
    }
  }
  save(draft: CreatorDraft) { return this.change(encodeDraft(draft), false); }
  clear(explicit = true) { return this.change(null, explicit); }
}
