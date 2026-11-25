/**
 * Duplicate & Edit in the client: the owner's saved content becomes a valid
 * builder draft through the builder's own loader (board order and the Rainbow
 * order kept separately, a Private source stays Private), saved into its own
 * slot without touching the main draft or another copy.
 */
import { describe, expect, it } from "vitest";
import { draftFromSource, copyTitle } from "@/lib/builder/copyDraft";
import {
  CREATOR_DRAFT_KEY, CreatorDraftStore, decodeDraft, draftKeyFor, encodeDraft, isCopySlot, listCopyDrafts, saveNewCopyDraft,
} from "@/lib/builder/creatorDraft";
import type { MyPuzzleSource } from "@/lib/customPuzzles";

const BOARD = [["ALTO", "BASS", "SOPRANO", "TENOR"], ["BALLAD", "HYMN", "LULLABY", "SHANTY"], ["CASSETTE", "RECORD", "REEL", "VINYL"], ["ENCORE", "GIG", "SETLIST", "TOUR"]];
const ORDER = BOARD.flat().reverse();
const source = (over: Partial<MyPuzzleSource> = {}, content: Record<string, unknown> = {}): MyPuzzleSource => ({
  title: "Mixtape Memories",
  creatorName: "Wren Halloway",
  visibility: "public",
  content: {
    mode: "rainbow",
    groups: BOARD.map((words, i) => ({ category: `Group ${i + 1}`, words, hint_word: i === 0 ? "Choir" : null, ...(i === 1 ? { category_emoji: "🎵", category_emoji_hint_only: true } : {}) })),
    word_order: ORDER,
    rainbow_herring: ["REEL", "ALTO", "GIG", "HYMN"],
    rainbow_category_name: "Hidden mixtape",
    rainbow_hint_word: "Tape",
    alphabetize_completed: false,
    ...content,
  },
  ...over,
});

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
  };
}
const textOf = (draft: ReturnType<typeof draftFromSource>, id: string) => draft.builder.groups.flatMap((g) => g.answers).find((a) => a.id === id)?.text;

describe("draftFromSource", () => {
  it("keeps the board, both orders, hints, emoji and style, and is a valid draft", () => {
    const d = draftFromSource(source());
    expect(d.title).toBe("Copy of Mixtape Memories");
    expect(d.designer).toBe("Wren Halloway");
    expect(d.visibility).toBe("public");
    expect(d.builder.style).toBe("rainbow");
    expect(d.builder.groups.map((g) => g.category)).toEqual(["Group 1", "Group 2", "Group 3", "Group 4"]);
    expect(d.builder.groups.map((g) => g.difficulty)).toEqual([1, 2, 3, 4]);
    expect(d.builder.groups[0].hintWord).toBe("Choir");
    expect([d.builder.groups[1].categoryEmoji, d.builder.groups[1].categoryEmojiHintOnly]).toEqual(["🎵", true]);
    expect(d.builder.wordOrderIds.map((id) => textOf(d, id))).toEqual(ORDER);
    // The Rainbow words keep their own display order, independent of the board.
    expect(d.builder.rainbowWordOrderIds.map((id) => textOf(d, id))).toEqual(["REEL", "ALTO", "GIG", "HYMN"]);
    expect(d.builder.rainbowHerringIds.map((id) => id && textOf(d, id))).toEqual(["ALTO", "HYMN", "REEL", "GIG"]);
    expect([d.builder.rainbowCategoryName, d.builder.rainbowHintWord, d.builder.alphabetizeCompleted]).toEqual(["Hidden mixtape", "Tape", false]);
    expect(decodeDraft(encodeDraft(d))).toBeTruthy();
  });

  it("keeps a Private puzzle Private and a Classic one Classic", () => {
    const d = draftFromSource(source({ visibility: "private" }, { mode: "classic", rainbow_herring: null, rainbow_category_name: null }));
    expect(d.visibility).toBe("private");
    expect(d.builder.style).toBe("classic");
    expect(d.builder.rainbowWordOrderIds).toEqual([]);
  });

  it("keeps titles within 100 characters and refuses what Create can't edit", () => {
    expect(copyTitle("x".repeat(100))).toHaveLength(100);
    expect(() => draftFromSource(source({}, { format: "mini" }))).toThrow(/full-size/);
    expect(() => draftFromSource(source({}, { groups: [] }))).toThrow(/board/);
  });
});

describe("copy slots", () => {
  it("save each copy beside the main draft without touching it, and each is recoverable on its own", () => {
    const storage = memoryStorage();
    const main = new CreatorDraftStore(() => storage);
    const partial = { ...draftFromSource(source()), title: "Unrelated Partial Draft" };
    expect(main.save(partial)).toBe(true);
    const mainRaw = storage.getItem(CREATOR_DRAFT_KEY);

    const a = saveNewCopyDraft(storage, draftFromSource(source()));
    const b = saveNewCopyDraft(storage, draftFromSource(source({ title: "Private Parlour Games", visibility: "private" })));
    expect(isCopySlot(a) && isCopySlot(b) && a !== b).toBe(true);
    expect(storage.getItem(CREATOR_DRAFT_KEY)).toBe(mainRaw);

    // Reopened fresh, as after a reload with no edits.
    expect(new CreatorDraftStore(() => storage).draft?.title).toBe("Unrelated Partial Draft");
    expect(new CreatorDraftStore(() => storage, draftKeyFor(a)).draft?.title).toBe("Copy of Mixtape Memories");
    expect(new CreatorDraftStore(() => storage, draftKeyFor(b)).draft?.visibility).toBe("private");
    expect(listCopyDrafts(storage).map((c) => c.title).sort()).toEqual(["Copy of Mixtape Memories", "Copy of Private Parlour Games"]);

    // Creating (clearing) one copy leaves the main draft and the other copy.
    expect(new CreatorDraftStore(() => storage, draftKeyFor(a)).clear(false)).toBe(true);
    expect(storage.getItem(CREATOR_DRAFT_KEY)).toBe(mainRaw);
    expect(listCopyDrafts(storage).map((c) => c.slot)).toEqual([b]);
  });

  it("only accepts well-formed slot names", () => {
    for (const bad of [null, "", "../x", "ABCDEFGH", "short", "a".repeat(33), "abc-defgh"]) expect(isCopySlot(bad)).toBe(false);
    expect(isCopySlot("mabc1234xyz")).toBe(true);
  });
});
