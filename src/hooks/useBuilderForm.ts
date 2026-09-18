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
  difficulty: 1 | 2 | 3 | 4;
}

const DIFFICULTY_ORDER: (1 | 2 | 3 | 4)[] = [1, 2, 3, 4];

function emptyGroup(difficulty: 1 | 2 | 3 | 4): BuilderGroupForm {
  const answers = Array.from({ length: 4 }, () => ({ id: generateSlotId(), text: "" }));
  return { category: "", answersRaw: "", answers, tombstones: [], hintWord: "", difficulty };
}

function defaultGroups(): BuilderGroupForm[] {
  return DIFFICULTY_ORDER.map(emptyGroup);
}

/** A group's own non-blank slots, in comma order. */
function nonBlank(answers: AnswerSlot[]): AnswerSlot[] {
  return answers.filter((a) => a.text.trim() !== "");
}

export interface BuilderState {
  groups: BuilderGroupForm[];
  rainbowHerringIds: (string | null)[];
  rainbowWordOrderIds: string[];
  rainbowCategoryName: string;
  rainbowHintWord: string;
  theme: string;
  alphabetizeCompleted: boolean;
  wordOrderIds: string[];
}

export interface LoadBuilderInput {
  groups: { category: string; words: string[]; difficulty: 1 | 2 | 3 | 4; hintWord: string | null }[];
  wordOrder: string[] | null;
  rainbowHerring: string[] | null;
  rainbowCategoryName: string;
  rainbowHintWord: string;
  theme: string;
  alphabetizeCompleted: boolean;
}

function buildStateFromLoad(input: LoadBuilderInput): BuilderState {
  const groups: BuilderGroupForm[] = input.groups.map((g) => {
    const answers = g.words.map((text) => ({ id: generateSlotId(), text }));
    return {
      category: g.category,
      answersRaw: g.words.join(", "),
      answers,
      tombstones: [],
      hintWord: g.hintWord ?? "",
      difficulty: g.difficulty,
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

  const wordOrderIds = (input.wordOrder ?? [])
    .map((w) => idByNormalizedText.get(normalizeWord(w)))
    .filter((id): id is string => !!id);

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
    theme: input.theme,
    alphabetizeCompleted: input.alphabetizeCompleted,
    wordOrderIds,
  };
}

function blankState(): BuilderState {
  return {
    groups: defaultGroups(),
    rainbowHerringIds: [null, null, null, null],
    rainbowWordOrderIds: [],
    rainbowCategoryName: "",
    rainbowHintWord: "",
    theme: "",
    alphabetizeCompleted: true,
    wordOrderIds: [],
  };
}

export function useBuilderForm() {
  const [groups, setGroups] = useState<BuilderGroupForm[]>(defaultGroups);
  const [rainbowHerringIds, setRainbowHerringIds] = useState<(string | null)[]>([null, null, null, null]);
  const [rainbowWordOrderIds, setRainbowWordOrderIds] = useState<string[]>([]);
  const [rainbowCategoryName, setRainbowCategoryName] = useState("");
  const [rainbowHintWord, setRainbowHintWord] = useState("");
  const [theme, setTheme] = useState("");
  const [alphabetizeCompleted, setAlphabetizeCompleted] = useState(true);
  const [wordOrderIds, setWordOrderIds] = useState<string[]>([]);

  const load = useCallback((input: LoadBuilderInput) => {
    const s = buildStateFromLoad(input);
    setGroups(s.groups);
    setRainbowHerringIds(s.rainbowHerringIds);
    setRainbowWordOrderIds(s.rainbowWordOrderIds);
    setRainbowCategoryName(s.rainbowCategoryName);
    setRainbowHintWord(s.rainbowHintWord);
    setTheme(s.theme);
    setAlphabetizeCompleted(s.alphabetizeCompleted);
    setWordOrderIds(s.wordOrderIds);
  }, []);

  const reset = useCallback(() => {
    const s = blankState();
    setGroups(s.groups);
    setRainbowHerringIds(s.rainbowHerringIds);
    setRainbowWordOrderIds(s.rainbowWordOrderIds);
    setRainbowCategoryName(s.rainbowCategoryName);
    setRainbowHintWord(s.rainbowHintWord);
    setTheme(s.theme);
    setAlphabetizeCompleted(s.alphabetizeCompleted);
    setWordOrderIds(s.wordOrderIds);
  }, []);

  const updateCategoryName = useCallback((idx: number, category: string) => {
    setGroups((prev) => prev.map((g, i) => (i === idx ? { ...g, category } : g)));
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

  // A stable key that changes only when the SET of populated slot ids
  // changes — not on ordinary text edits, which keep the same ids. Drives
  // the "randomize once, then stay stable" effects below.
  const idsKey = useMemo(
    () => [...nonBlankSlots.map((s) => s.id)].sort().join("|"),
    [nonBlankSlots]
  );

  // Initial randomization: generate once when the full 16-answer set first
  // becomes available, then hold stable through rerenders and ordinary
  // edits (idsKey does not change for those). Reconciles rather than
  // replaces when the id set genuinely changes (an answer was added or
  // removed), keeping every still-present id's position.
  useEffect(() => {
    if (!hasAll16) return;
    setWordOrderIds((prev) => {
      const currentIds = nonBlankSlots.map((s) => s.id);
      const currentSet = new Set(currentIds);
      const alreadyValid =
        prev.length === 16 && prev.every((id) => currentSet.has(id));
      if (alreadyValid) return prev;
      if (prev.length === 0) return shuffle(currentIds);
      const kept = prev.filter((id) => currentSet.has(id));
      const missing = currentIds.filter((id) => !kept.includes(id));
      return [...kept, ...missing];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, hasAll16]);

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
    setWordOrderIds((prev) => shuffle(prev.length ? prev : nonBlankSlots.map((s) => s.id)));
  }, [nonBlankSlots]);

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
    theme,
    alphabetizeCompleted,
    wordOrderIds,
    // setters (simple fields)
    setRainbowCategoryName,
    setRainbowHintWord,
    setTheme,
    setAlphabetizeCompleted,
    setRainbowWordOrderIds,
    setWordOrderIds,
    // actions
    load,
    reset,
    updateCategoryName,
    updateHintWord,
    updateAnswersRaw,
    swapGroups,
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
