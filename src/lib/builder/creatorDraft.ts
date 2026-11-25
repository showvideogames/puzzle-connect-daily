import { z } from "zod";
import type { BuilderState } from "@/hooks/useBuilderForm";
import { getFormat } from "@/lib/puzzleFormat";

export const CREATOR_DRAFT_KEY = "rainbow-creator-draft-v1";
export const CREATOR_DRAFT_LOCK = "rainbow-creator-draft";
/**
 * Duplicate & Edit copies each get their own slot (key and Web Lock) beside
 * the one main draft, so opening a copy never overwrites an unrelated draft
 * and each stays recoverable on its own (/create?draft=<slot>).
 */
export const COPY_DRAFT_PREFIX = `${CREATOR_DRAFT_KEY}:copy:`;
const COPY_SLOT = /^[a-z0-9]{8,32}$/;
export const isCopySlot = (slot: unknown): slot is string => typeof slot === "string" && COPY_SLOT.test(slot);
export const draftKeyFor = (slot?: string | null) => (slot ? `${COPY_DRAFT_PREFIX}${slot}` : CREATOR_DRAFT_KEY);
export const draftLockFor = (slot?: string | null) => (slot ? `${CREATOR_DRAFT_LOCK}:copy:${slot}` : CREATOR_DRAFT_LOCK);
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
  constructor(private storage: () => Storage, private key: string = CREATOR_DRAFT_KEY) {
    try {
      this.expected = storage().getItem(key);
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
      if (storage.getItem(this.key) !== this.expected) {
        this.error = "The saved draft changed elsewhere. Your edits are not saved. Return to Create in a new tab after closing this one to recover that copy.";
        return false;
      }
      if (next === null) storage.removeItem(this.key);
      else storage.setItem(this.key, next);
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

/**
 * Saves a Duplicate & Edit copy into a brand-new slot of its own, at once, so
 * the copy is recoverable even if the page is reloaded before any edit. Never
 * touches the main draft or another copy. Returns the slot.
 */
export function saveNewCopyDraft(storage: Storage, draft: CreatorDraft): string {
  for (let i = 0; i < 5; i++) {
    const slot = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`.replace(/[^a-z0-9]/g, "").slice(0, 32);
    if (!isCopySlot(slot) || storage.getItem(draftKeyFor(slot)) !== null) continue;
    storage.setItem(draftKeyFor(slot), encodeDraft(draft));
    return slot;
  }
  throw new Error("Couldn't save the copy in this browser.");
}

/** Every Duplicate & Edit copy saved in this browser (newest first). Unreadable ones are left alone. */
export function listCopyDrafts(storage: Storage): { slot: string; title: string }[] {
  const out: { slot: string; title: string }[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(COPY_DRAFT_PREFIX)) continue;
    const slot = key.slice(COPY_DRAFT_PREFIX.length);
    if (!isCopySlot(slot)) continue;
    try {
      out.push({ slot, title: decodeDraft(storage.getItem(key) ?? "").title });
    } catch {
      // kept unchanged, as the main draft's reader does
    }
  }
  return out.sort((a, b) => b.slot.localeCompare(a.slot));
}
