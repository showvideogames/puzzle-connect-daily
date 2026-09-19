import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type AnswerSlot,
  generateSlotId,
  reconcileCategory,
  shuffle,
  splitAnswerField,
} from "@/lib/builder/answerIdentity";
import { normalizeWord } from "@/lib/builder/wordNormalization";

/**
 * The reusable core of the puzzle builder: category/answer editing with
 * stable per-answer identity (see lib/builder/answerIdentity.ts), Rainbow
 * selection that survives a word being edited, and starting-board order.
 *
 * Shared by the Admin builder shell today and, later, the public creator
 * shell — this hook owns no admin-only or public-only concepts (no
 * date/status/designer, no ownership/visibility). Those stay in each shell.
 *
 * Locked to the Full 4x4 / up-to-Rainbow format this session supports; a
 * Mini (3x3) variant is a separate future change to this hook, not a reason
 * to touch its callers.
 */

export interface BuilderGroupForm {
  category: string;
  /** The raw comma-separated text exactly as typed/displayed in the field. */
  answersRaw: string;
  /** Reconciled stable-id slots derived from answersRaw — see answerIdentity.ts. */
  answers: AnswerSlot[];
  /**
   * Ids removed by an earlier edit with nothing to replace them, kept so a
   * later edit that adds a new answer can inherit the vacated id (and with
   * it, the board position and Rainbow selection that id held) instead of
   * getting a fresh one. Never rendered — purely internal bookkeeping. See
   * lib/builder/answerIdentity.ts's reconcileCategory.
   */
  tombstones: AnswerSlot[];
  hintWord: string;
  /** Optional Category Emoji, kept exactly as typed (independent of the name and the hint). */
  categoryEmoji: string;
  difficulty: 1 | 2 | 3 | 4;
  /**
   * This category's 4 board-position ids: exactly the ids that appear in
   * wordOrderIds for it, fixed when the group is created/loaded and never
   * changed by editing. An answer whose id is NOT in here has no tile on the
   * Starting Board — see the "stray id" healing effect in useBuilderForm.
   */
  poolIds: string[];
}

const DIFFICULTY_ORDER: (1 | 2 | 3 | 4)[] = [1, 2, 3, 4];

function emptyGroup(difficulty: 1 | 2 | 3 | 4): BuilderGroupForm {
  const answers = Array.from({ length: 4 }, () => ({ id: generateSlotId(), text: "" }));
  return { category: "", answersRaw: "", answers, tombstones: [], hintWord: "", categoryEmoji: "", difficulty, poolIds: answers.map((a) => a.id) };
}

function defaultGroups(): BuilderGroupForm[] {
  return DIFFICULTY_ORDER.map(emptyGroup);
}

/** A group's own non-blank slots, in comma order. */
function nonBlank(answers: AnswerSlot[]): AnswerSlot[] {
  return answers.filter((a) => a.text.trim() !== "");
}

export type BuilderStyle = "rainbow" | "classic";

export interface BuilderState {
  groups: BuilderGroupForm[];
  rainbowHerringIds: (string | null)[];
  rainbowWordOrderIds: string[];
  rainbowCategoryName: string;
  rainbowHintWord: string;
  rainbowCategoryEmoji: string;
  theme: string;
  alphabetizeCompleted: boolean;
  wordOrderIds: string[];
  style: BuilderStyle;
}

export interface LoadBuilderInput {
  groups: { category: string; words: string[]; difficulty: 1 | 2 | 3 | 4; hintWord: string | null; categoryEmoji?: string | null }[];
  wordOrder: string[] | null;
  rainbowHerring: string[] | null;
  rainbowCategoryName: string;
  rainbowHintWord: string;
  /** Absent for older sources; treated as none. */
  rainbowCategoryEmoji?: string;
  theme: string;
  alphabetizeCompleted: boolean;
  /**
   * The stored style when the source knows it (an existing puzzle, a saved
   * draft). Left undefined, the CURRENT style is kept: loading must never
   * silently overwrite it with the new-puzzle default.
   */
  style?: BuilderStyle;
}

function buildStateFromLoad(input: LoadBuilderInput, currentStyle: BuilderStyle): BuilderState {
  const groups: BuilderGroupForm[] = input.groups.map((g) => {
    const answers = g.words.map((text) => ({ id: generateSlotId(), text }));
    return {
      category: g.category,
      answersRaw: g.words.join(", "),
      answers,
      tombstones: [],
      hintWord: g.hintWord ?? "",
      categoryEmoji: g.categoryEmoji ?? "",
      difficulty: g.difficulty,
      poolIds: answers.map((a) => a.id),
    };
  });

  // Text -> id lookup across every slot. Safe to be global (not per-group)
  // because a valid puzzle's 16 words are already guaranteed unique.
  const idByNormalizedText = new Map<string, string>();
  for (const g of groups) {
    for (const a of g.answers) {
      if (a.text.trim() !== "") idByNormalizedText.set(normalizeWord(a.text), a.id);
    }
  }

  let wordOrderIds = (input.wordOrder ?? [])
    .map((w) => idByNormalizedText.get(normalizeWord(w)))
    .filter((id): id is string => !!id);
  // A saved order should name all 16 words exactly once. Anything short of
  // that — a legacy puzzle saved before word_order existed, or a corrupt/
  // partial list — falls back to a fresh random arrangement of this
  // puzzle's real pool ids rather than loading a half-empty board.
  if (wordOrderIds.length !== 16 || new Set(wordOrderIds).size !== 16) {
    wordOrderIds = shuffle(groups.flatMap((g) => g.answers.map((a) => a.id)));
  }

  // Rainbow: previously assumed rainbow_herring[i] always belongs to
  // groups[i]. That assumption breaks the moment a custom Rainbow display
  // order was saved (see buildStateFromLoad's caller / admin_save_puzzle),
  // because the saved array is in DISPLAY order, not group order. Instead,
  // each saved herring word is matched to the group that actually contains
  // it, which is always unambiguous (16 unique words).
  const rainbowHerringIds: (string | null)[] = groups.map(() => null);
  const herringWords = input.rainbowHerring ?? [];
  for (const word of herringWords) {
    const id = idByNormalizedText.get(normalizeWord(word));
    if (!id) continue;
    const ownerIdx = groups.findIndex((g) => g.answers.some((a) => a.id === id));
    if (ownerIdx !== -1) rainbowHerringIds[ownerIdx] = id;
  }
  const rainbowWordOrderIds = herringWords
    .map((w) => idByNormalizedText.get(normalizeWord(w)))
    .filter((id): id is string => !!id);

  return {
    groups,
    rainbowHerringIds,
    rainbowWordOrderIds,
    rainbowCategoryName: input.rainbowCategoryName,
    rainbowHintWord: input.rainbowHintWord,
    rainbowCategoryEmoji: input.rainbowCategoryEmoji ?? "",
    theme: input.theme,
    alphabetizeCompleted: input.alphabetizeCompleted,
    wordOrderIds,
    style: input.style ?? currentStyle,
  };
}

function blankState(): BuilderState {
  const groups = defaultGroups();
  return {
    groups,
    rainbowHerringIds: [null, null, null, null],
    rainbowWordOrderIds: [],
    rainbowCategoryName: "",
    rainbowHintWord: "",
    rainbowCategoryEmoji: "",
    theme: "",
    alphabetizeCompleted: true,
    // Brand-new puzzles default to Rainbow. Only blankState() sets this;
    // load() never does, so an existing puzzle keeps its stored style.
    style: "rainbow",
    // All 16 board positions already exist the instant a blank form is
    // created (emptyGroup gives each of the 4 categories 4 real, stable
    // ids up front, even blank) — so the random opening arrangement is
    // generated right here, immediately, rather than waiting for anything
    // to be typed. See the (removed) completeness-gated effect this
    // replaces, and DraggableTileGrid for how a still-blank id renders.
    wordOrderIds: shuffle(groups.flatMap((g) => g.answers.map((a) => a.id))),
  };
}

export function useBuilderForm() {
  // Computed once, lazily, and shared across every field's initial value —
  // groups and wordOrderIds MUST come from the same blankState() call (not
  // two independent ones), or wordOrderIds would reference ids that don't
  // match the groups actually created for this mount.
  const [initial] = useState(blankState);
  const [groups, setGroups] = useState<BuilderGroupForm[]>(initial.groups);
  const [rainbowHerringIds, setRainbowHerringIds] = useState<(string | null)[]>(initial.rainbowHerringIds);
  const [rainbowWordOrderIds, setRainbowWordOrderIds] = useState<string[]>(initial.rainbowWordOrderIds);
  const [rainbowCategoryName, setRainbowCategoryName] = useState(initial.rainbowCategoryName);
  const [rainbowHintWord, setRainbowHintWord] = useState(initial.rainbowHintWord);
  const [rainbowCategoryEmoji, setRainbowCategoryEmoji] = useState(initial.rainbowCategoryEmoji);
  const [theme, setTheme] = useState(initial.theme);
  const [alphabetizeCompleted, setAlphabetizeCompleted] = useState(initial.alphabetizeCompleted);
  const [wordOrderIds, setWordOrderIds] = useState<string[]>(initial.wordOrderIds);
  const [style, setStyle] = useState<BuilderStyle>(initial.style);

  const load = useCallback((input: LoadBuilderInput) => {
    const s = buildStateFromLoad(input, style);
    setStyle(s.style);
    setGroups(s.groups);
    setRainbowHerringIds(s.rainbowHerringIds);
    setRainbowWordOrderIds(s.rainbowWordOrderIds);
    setRainbowCategoryName(s.rainbowCategoryName);
    setRainbowHintWord(s.rainbowHintWord);
    setRainbowCategoryEmoji(s.rainbowCategoryEmoji);
    setTheme(s.theme);
    setAlphabetizeCompleted(s.alphabetizeCompleted);
    setWordOrderIds(s.wordOrderIds);
  }, [style]);

  const reset = useCallback(() => {
    const s = blankState();
    setStyle(s.style);
    setGroups(s.groups);
    setRainbowHerringIds(s.rainbowHerringIds);
    setRainbowWordOrderIds(s.rainbowWordOrderIds);
    setRainbowCategoryName(s.rainbowCategoryName);
    setRainbowHintWord(s.rainbowHintWord);
    setRainbowCategoryEmoji(s.rainbowCategoryEmoji);
    setTheme(s.theme);
    setAlphabetizeCompleted(s.alphabetizeCompleted);
    setWordOrderIds(s.wordOrderIds);
  }, []);

  const updateCategoryName = useCallback((idx: number, category: string) => {
    setGroups((prev) => prev.map((g, i) => (i === idx ? { ...g, category } : g)));
  }, []);

  const updateCategoryEmoji = useCallback((idx: number, categoryEmoji: string) => {
    setGroups((prev) => prev.map((g, i) => (i === idx ? { ...g, categoryEmoji } : g)));
  }, []);

  const updateHintWord = useCallback((idx: number, hintWord: string) => {
    setGroups((prev) => prev.map((g, i) => (i === idx ? { ...g, hintWord } : g)));
  }, []);

  // The one write path for a category's comma-separated answers field —
  // reconciles ids against the previous slots AND any earlier tombstones
  // (see answerIdentity.ts's reconcileCategory) so editing, reordering,
  // deleting or later re-adding an answer never disturbs an unrelated
  // slot's board position or Rainbow selection.
  const updateAnswersRaw = useCallback((idx: number, raw: string) => {
    setGroups((prev) =>
      prev.map((g, i) => {
        if (i !== idx) return g;
        const texts = splitAnswerField(raw);
        const { answers, tombstones } = reconcileCategory(g.answers, g.tombstones, texts);
        return { ...g, answersRaw: raw, answers, tombstones };
      })
    );
  }, []);

  const swapGroups = useCallback((a: number, b: number) => {
    if (a === b) return;
    setGroups((prev) => {
      const next = [...prev];
      [next[a], next[b]] = [next[b], next[a]];
      return next.map((g, i) => ({ ...g, difficulty: DIFFICULTY_ORDER[i] }));
    });
    setRainbowHerringIds((prev) => {
      const next = [...prev];
      [next[a], next[b]] = [next[b], next[a]];
      return next;
    });
  }, []);

  // Drag-and-drop category ordering: moves the card at `from` to `to`. A
  // group's content (answers, ids, tombstones, poolIds, hint) travels intact
  // and its Rainbow selection travels with it; only its difficulty/colour is
  // reassigned from the destination slot. Board order is keyed by answer id
  // and is untouched.
  const moveGroup = useCallback((from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= 4 || to >= 4) return;
    const reorder = <T,>(list: T[]): T[] => {
      const next = [...list];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    };
    setGroups((prev) => reorder(prev).map((g, i) => ({ ...g, difficulty: DIFFICULTY_ORDER[i] })));
    setRainbowHerringIds((prev) => reorder(prev));
  }, []);

  const selectRainbowAnswer = useCallback((groupIdx: number, slotId: string | null) => {
    setRainbowHerringIds((prev) => {
      const next = [...prev];
      next[groupIdx] = slotId;
      return next;
    });
  }, []);

  const resetRainbowOrder = useCallback(() => {
    setRainbowWordOrderIds(rainbowHerringIds.filter((id): id is string => !!id));
  }, [rainbowHerringIds]);

  // ── Derived state ─────────────────────────────────────────────────────

  /** All 16 slots (blank or not) across the 4 categories, in group order. */
  const allSlots = useMemo(() => groups.flatMap((g) => g.answers), [groups]);

  const nonBlankSlots = useMemo(() => groups.flatMap((g) => nonBlank(g.answers)), [groups]);

  /** Every category has exactly 4 non-blank answers and all 16 are unique. */
  const hasAll16 = useMemo(() => {
    if (!groups.every((g) => nonBlank(g.answers).length === 4)) return false;
    const normalized = nonBlankSlots.map((s) => normalizeWord(s.text));
    return new Set(normalized).size === 16;
  }, [groups, nonBlankSlots]);

  const slotById = useMemo(() => {
    const map = new Map<string, AnswerSlot>();
    for (const s of allSlots) map.set(s.id, s);
    return map;
  }, [allSlots]);

  // wordOrderIds needs NO effect to (re)generate it. blankState()/load()
  // already set it, eagerly, to a permutation of every id this puzzle's 4
  // categories will ever use — including still-blank ones (each category's
  // 4 pool ids are created up front by emptyGroup/buildStateFromLoad and
  // never disappear; a deleted-without-replacement answer merely leaves its
  // id in g.tombstones, still part of the same 16, resolving to a blank
  // tile via slotById until something inherits it — see reconcileCategory).
  // The only things that ever change wordOrderIds after that are a manual
  // drag reorder, Randomize, or loading a different puzzle — never an
  // ordinary edit.

  // Stray-id healing. A category has exactly 4 board positions (its poolIds).
  // Ordinary editing can still hand an answer an id OUTSIDE that pool — e.g. a
  // trailing comma ("a, b, c, d,") makes a 5th blank slot with a fresh id, and
  // a later edit can hand that id to a real answer while the real board slot
  // sits tombstoned. That answer then exists in the fields, the Rainbow
  // dropdown and the display order, but has no tile on the Starting Board (the
  // board shows a blank), and word_order no longer describes the 16 answers.
  //
  // Whenever an answer holds a non-pool id and one of the category's own pool
  // ids is free (tombstoned), the answer is moved onto that pool id, and any
  // Rainbow selection/display-order entry pointing at the stray id follows it.
  // Non-pool tombstones are discarded so they can never be recycled later. A
  // genuine 5th answer (no free pool id) is left alone — that category is
  // invalid to save anyway.
  useEffect(() => {
    const remap = new Map<string, string>();
    let changed = false;
    const healed = groups.map((g) => {
      const pool = new Set(g.poolIds);
      const tombs = g.tombstones.filter((t) => pool.has(t.id));
      let moved = false;
      const answers = g.answers.map((a) => {
        if (pool.has(a.id)) return a;
        const free = tombs.shift();
        if (!free) return a;
        remap.set(a.id, free.id);
        moved = true;
        return { id: free.id, text: a.text };
      });
      if (!moved && tombs.length === g.tombstones.length) return g;
      changed = true;
      return { ...g, answers, tombstones: tombs };
    });
    if (!changed) return;
    setGroups((prev) => (prev === groups ? healed : prev));
    if (remap.size > 0) {
      const follow = (id: string | null) => (id ? remap.get(id) ?? id : id);
      setRainbowHerringIds((prev) => prev.map(follow));
      setRainbowWordOrderIds((prev) => prev.map((id) => follow(id) as string));
    }
  }, [groups]);

  // Rainbow selections: drop a selection only once its id is gone for good
  // — not in the group's current answers AND not held as a tombstone. A
  // tombstoned id (an answer that was deleted with nothing to replace it
  // yet) keeps its Rainbow selection, so a later edit that re-adds an
  // answer and inherits that id also inherits the selection.
  useEffect(() => {
    setRainbowHerringIds((prev) =>
      prev.map((id, i) => {
        if (!id) return null;
        const g = groups[i];
        if (!g) return null;
        const stillTracked = g.answers.some((a) => a.id === id) || g.tombstones.some((t) => t.id === id);
        return stillTracked ? id : null;
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    groups
      .map((g) => `${g.answers.map((a) => a.id).join(",")}~${g.tombstones.map((t) => t.id).join(",")}`)
      .join("|"),
  ]);

  const rainbowComplete = rainbowHerringIds.every((id) => !!id);

  // Rainbow display order: defaults to natural group order the moment all 4
  // are picked, then holds stable — mirrors wordOrderIds above but scoped
  // to the 4 Rainbow slots.
  useEffect(() => {
    if (!rainbowComplete) return;
    setRainbowWordOrderIds((prev) => {
      const currentIds = rainbowHerringIds.filter((id): id is string => !!id);
      const currentSet = new Set(currentIds);
      const alreadyValid = prev.length === 4 && prev.every((id) => currentSet.has(id));
      if (alreadyValid) return prev;
      if (prev.length === 0) return currentIds;
      const kept = prev.filter((id) => currentSet.has(id));
      const missing = currentIds.filter((id) => !kept.includes(id));
      return [...kept, ...missing];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rainbowHerringIds.join("|"), rainbowComplete]);

  const randomizeWordOrder = useCallback(() => {
    // wordOrderIds already covers all 16 ids from the moment this form
    // existed (see blankState/buildStateFromLoad) — reshuffling it in place
    // is always correct, populated or not.
    setWordOrderIds((prev) => shuffle(prev));
  }, []);

  /** Resolves an ordered id list to display/save text via slotById. */
  const textsFor = useCallback(
    (ids: string[]) => ids.map((id) => slotById.get(id)?.text ?? ""),
    [slotById]
  );

  return {
    // state
    groups,
    rainbowHerringIds,
    rainbowWordOrderIds,
    rainbowCategoryName,
    rainbowHintWord,
    rainbowCategoryEmoji,
    theme,
    alphabetizeCompleted,
    wordOrderIds,
    style,
    // setters (simple fields)
    setRainbowCategoryName,
    setRainbowHintWord,
    setRainbowCategoryEmoji,
    setStyle,
    setTheme,
    setAlphabetizeCompleted,
    setRainbowWordOrderIds,
    setWordOrderIds,
    // actions
    load,
    reset,
    updateCategoryName,
    updateHintWord,
    updateCategoryEmoji,
    updateAnswersRaw,
    swapGroups,
    moveGroup,
    selectRainbowAnswer,
    resetRainbowOrder,
    randomizeWordOrder,
    // derived
    allSlots,
    nonBlankSlots,
    slotById,
    hasAll16,
    rainbowComplete,
    textsFor,
  };
}

export type BuilderForm = ReturnType<typeof useBuilderForm>;
