import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBuilderForm } from "@/hooks/useBuilderForm";
import { CREATOR_DRAFT_KEY, CreatorDraftStore, decodeDraft, encodeDraft, type CreatorDraft } from "@/lib/builder/creatorDraft";

beforeEach(() => localStorage.clear());
function fixture(): CreatorDraft {
  const { result, unmount } = renderHook(() => useBuilderForm());
  act(() => {
    for (let i = 0; i < 4; i++) {
      result.current.updateCategoryName(i, `Category ${i}`);
      result.current.updateAnswersRaw(i, `a${i}, b${i}, c${i}, d${i}`);
      result.current.updateCategoryEmoji(i, `emoji${i}`);
      result.current.updateCategoryEmojiHintOnly(i, true);
      result.current.updateHintWord(i, `hint${i}`);
    }
    result.current.setAlphabetizeCompleted(false);
    result.current.setRainbowCategoryName("Rainbow");
    result.current.setRainbowHintWord("Hint");
    result.current.setRainbowCategoryEmoji("🌈");
    result.current.setRainbowCategoryEmojiHintOnly(true);
    result.current.setTheme("theme");
  });
  act(() => result.current.groups.forEach((g, i) => result.current.selectRainbowAnswer(i, g.answers[0].id)));
  act(() => {
    result.current.setRainbowWordOrderIds([...result.current.rainbowWordOrderIds].reverse());
    result.current.setWordOrderIds([...result.current.wordOrderIds].reverse());
    result.current.moveGroup(0, 2);
  });
  const draft: CreatorDraft = { title: "Disposable", designer: "Tester", visibility: "private", builder: result.current.snapshot };
  unmount();
  return draft;
}
describe("creator recovery storage", () => {
  it("round trips every field and stable identity, including category/board/Rainbow ordering", () => {
    const draft = fixture();
    expect(new CreatorDraftStore(() => localStorage).save(draft)).toBe(true);
    const recovered = new CreatorDraftStore(() => localStorage).draft;
    expect(recovered).toEqual(draft);
    const { result } = renderHook(() => useBuilderForm("full", recovered.builder));
    expect(result.current.snapshot).toEqual(draft.builder);
  });
  it("round trips partial raw input, empty slots and tombstones without regenerating IDs", () => {
    const draft = fixture();
    const hook = renderHook(() => useBuilderForm("full", draft.builder));
    act(() => hook.result.current.updateAnswersRaw(0, "a1, "));
    draft.builder = hook.result.current.snapshot;
    expect(decodeDraft(encodeDraft(draft))).toEqual(draft);
    const recovered = renderHook(() => useBuilderForm("full", decodeDraft(encodeDraft(draft)).builder));
    expect(recovered.result.current.snapshot).toEqual(draft.builder);
  });
  it.each(['{broken', '{"version":99}', '{"version":1}'])("preserves malformed/unknown data %s until explicit clear", raw => {
    localStorage.setItem(CREATOR_DRAFT_KEY, raw);
    const store = new CreatorDraftStore(() => localStorage);
    expect(store.draft).toBeUndefined();
    expect(store.error).toMatch(/kept unchanged/);
    expect(store.save(fixture())).toBe(false);
    expect(localStorage.getItem(CREATOR_DRAFT_KEY)).toBe(raw);
    expect(store.clear(false)).toBe(false); // unrelated successful creation cannot discard an unreadable copy
    expect(localStorage.getItem(CREATOR_DRAFT_KEY)).toBe(raw);
    expect(store.clear()).toBe(true);
    expect(localStorage.getItem(CREATOR_DRAFT_KEY)).toBeNull();
    expect(store.save(fixture())).toBe(true);
  });
  it("rejects dangling/duplicate IDs rather than quietly rearranging a saved puzzle", () => {
    const draft = fixture();
    draft.builder.wordOrderIds.fill("unknown");
    expect(() => decodeDraft(encodeDraft(draft))).toThrow();
  });
  it("reports unavailable storage and quota failure while preserving the previous copy", () => {
    const unavailable = new CreatorDraftStore(() => { throw new Error("SecurityError"); });
    expect(unavailable.error).toMatch(/unavailable/);
    expect(unavailable.save(fixture())).toBe(false);
    const draft = fixture();
    localStorage.setItem(CREATOR_DRAFT_KEY, encodeDraft(draft));
    const store = new CreatorDraftStore(() => localStorage);
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QuotaExceededError"); });
    expect(store.save({ ...draft, title: "Changed" })).toBe(false);
    expect(store.error).toMatch(/could not be updated/);
    expect(localStorage.getItem(CREATOR_DRAFT_KEY)).toBe(encodeDraft(draft));
    spy.mockRestore();
  });
  it("refuses to save or clear another writer's copy", () => {
    const first = new CreatorDraftStore(() => localStorage);
    const stale = new CreatorDraftStore(() => localStorage);
    const draft = fixture();
    first.save(draft);
    expect(stale.save({ ...draft, title: "Stale tab" })).toBe(false);
    expect(stale.clear()).toBe(false);
    expect(stale.error).toMatch(/changed elsewhere/);
    expect(localStorage.getItem(CREATOR_DRAFT_KEY)).toBe(encodeDraft(draft));
  });
});
