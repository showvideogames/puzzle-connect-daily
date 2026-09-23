import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type AnswerSlot,
  generateSlotId,
  reconcileCategory,
  shuffle,
  splitAnswerField,
} from "@/lib/builder/answerIdentity";
import { normalizeWord } from "@/lib/builder/wordNormalization";
import {
  getFormat,
  type Difficulty,
  type PuzzleFormat,
  type PuzzleFormatId,
} from "@/lib/puzzleFormat";

/**
 * The reusable core of the puzzle builder: category/answer editing with
 * stable per-answer identity (see lib/builder/answerIdentity.ts), Rainbow
 * selection that survives a word being edited, and starting-board order.
 *
 * Shared by the Admin builder shell and the public creator shell — this hook
 * owns no admin-only or public-only concepts (no date/status/designer, no
 * ownership/visibility). Those stay in each shell.
 *
 * FORMAT-DRIVEN. The hook holds the current format (see lib/puzzleFormat.ts)
 * and every size decision — how many category cards, how many answers each,
 * which difficulties/colours they take, how many board positions, whether a
 * Rainbow is offered at all — reads from it. Admin and /create share this one
 * implementation for both Full and Mini; there is no Mini builder.
 *
 * Defaults to Full, so a caller that never mentions a format behaves exactly
 * as this hook always has.
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
  /**
   * Hint Only: keep the Category Emoji in the Full Hint but off the solved
   * colour bar — see PuzzleGroup.categoryEmojiHintOnly. Never affects the
   * Category Name, which is always saved and shown exactly as typed.
   */
  categoryEmojiHintOnly: boolean;
  difficulty: Difficulty;
  /**
   * This category's board-position ids: exactly the ids that appear in
   * wordOrderIds for it (4 on Full, 3 on Mini), fixed when the group is
   * created/loaded and never changed by editing. An answer whose id is NOT in
   * here has no tile on the Starting Board — see the "stray id" healing
   * effect in useBuilderForm.
   */
  poolIds: string[];
}

function emptyGroup(difficulty: Difficulty, answersPerCategory: number): BuilderGroupForm {
  const answers = Array.from({ length: answersPerCategory }, () => ({ id: generateSlotId(), text: "" }));
  return { category: "", answersRaw: "", answers, tombstones: [], hintWord: "", categoryEmoji: "", categoryEmojiHintOnly: false, difficulty, poolIds: answers.map((a) => a.id) };
}

function defaultGroups(format: PuzzleFormat): BuilderGroupForm[] {
  return format.difficultyOrder.map((d) => emptyGroup(d, format.answersPerCategory));
}

/** A group's own non-blank slots, in comma order. */
function nonBlank(answers: AnswerSlot[]): AnswerSlot[] {
  return answers.filter((a) => a.text.trim() !== "");
}

export type BuilderStyle = "rainbow" | "classic";

export interface BuilderState {
  format: PuzzleFormat;
  groups: BuilderGroupForm[];
  rainbowHerringIds: (string | null)[];
  rainbowWordOrderIds: string[];
  rainbowCategoryName: string;
  rainbowHintWord: string;
  rainbowCategoryEmoji: string;
  rainbowCategoryEmojiHintOnly: boolean;
  theme: string;
  alphabetizeCompleted: boolean;
  wordOrderIds: string[];
  style: BuilderStyle;
}

export interface LoadBuilderInput {
  groups: {
    category: string;
    words: string[];
    difficulty: Difficulty;
    hintWord: string | null;
    categoryEmoji?: string | null;
    /** Absent for older sources; treated as false, so they display as they always have. */
    categoryEmojiHintOnly?: boolean | null;
  }[];
  wordOrder: string[] | null;
  rainbowHerring: string[] | null;
  rainbowCategoryName: string;
  rainbowHintWord: string;
  /** Absent for older sources; treated as none. */
  rainbowCategoryEmoji?: string;
  /** Absent for older sources; treated as false. */
  rainbowCategoryEmojiHintOnly?: boolean | null;
  theme: string;
  alphabetizeCompleted: boolean;
  /**
   * The stored style when the source knows it (an existing puzzle, a saved
   * draft). Left undefined, the CURRENT style is kept: loading must never
   * silently overwrite it with the new-puzzle default.
   */
  style?: BuilderStyle;
  /**
   * The stored FORMAT of the thing being loaded.
   *
   * Absent means Full — every puzzle and every draft that predates formats is
   * a Full 4×4 one, which is why loading one can never silently change its
   * format. A Mini row carries "mini" explicitly.
   */
  format?: PuzzleFormatId;
}

function buildStateFromLoad(input: LoadBuilderInput, currentStyle: BuilderStyle): BuilderState {
  // The loaded puzzle's OWN format, never the one the form happened to be on.
  // Undefined resolves to Full, so an existing Full puzzle (or a draft saved
  // before formats existed) always loads back as Full.
  const format = getFormat(input.format);

  const groups: BuilderGroupForm[] = input.groups.map((g) => {
    const answers = g.words.map((text) => ({ id: generateSlotId(), text }));
    return {
      category: g.category,
      answersRaw: g.words.join(", "),
      answers,
      tombstones: [],
      hintWord: g.hintWord ?? "",
      categoryEmoji: g.categoryEmoji ?? "",
      categoryEmojiHintOnly: g.categoryEmojiHintOnly ?? false,
      difficulty: g.difficulty,
      poolIds: answers.map((a) => a.id),
    };
  });

  // Text -> id lookup across every slot. Safe to be global (not per-group)
  // because a valid puzzle's answers are already guaranteed unique.
  const idByNormalizedText = new Map<string, string>();
  for (const g of groups) {
    for (const a of g.answers) {
      if (a.text.trim() !== "") idByNormalizedText.set(normalizeWord(a.text), a.id);
    }
  }

  let wordOrderIds = (input.wordOrder ?? [])
    .map((w) => idByNormalizedText.get(normalizeWord(w)))
    .filter((id): id is string => !!id);
  // A saved order should name every answer exactly once. Anything short of
  // that — a legacy puzzle saved before word_order existed, or a corrupt/
  // partial list — falls back to a fresh random arrangement of this
  // puzzle's real pool ids rather than loading a half-empty board.
  if (wordOrderIds.length !== format.tileCount || new Set(wordOrderIds).size !== format.tileCount) {
    wordOrderIds = shuffle(groups.flatMap((g) => g.answers.map((a) => a.id)));
  }

  // Rainbow: previously assumed rainbow_herring[i] always belongs to
  // groups[i]. That assumption breaks the moment a custom Rainbow display
  // order was saved (see buildStateFromLoad's caller / admin_save_puzzle),
  // because the saved array is in DISPLAY order, not group order. Instead,
  // each saved herring word is matched to the group that actually contains
  // it, which is always unambiguous (answers are unique).
  const rainbowHerringIds: (string | null)[] = groups.map(() => null);
  // A format with no bonus category can never carry one, whatever the source
  // row happens to hold.
  const herringWords = format.hasRainbow ? (input.rainbowHerring ?? []) : [];
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
    format,
    groups,
    rainbowHerringIds,
    rainbowWordOrderIds,
    rainbowCategoryName: format.hasRainbow ? input.rainbowCategoryName : "",
    rainbowHintWord: format.hasRainbow ? input.rainbowHintWord : "",
    rainbowCategoryEmoji: format.hasRainbow ? input.rainbowCategoryEmoji ?? "" : "",
    rainbowCategoryEmojiHintOnly: format.hasRainbow ? input.rainbowCategoryEmojiHintOnly ?? false : false,
    theme: input.theme,
    alphabetizeCompleted: input.alphabetizeCompleted,
    wordOrderIds,
    // A format with no Rainbow is always Classic; there is nothing else it
    // could be, and storing "rainbow" there would misdescribe the puzzle.
    style: !format.hasRainbow ? "classic" : input.style ?? currentStyle,
  };
}

function blankState(format: PuzzleFormat): BuilderState {
  const groups = defaultGroups(format);
  return {
    format,
    groups,
    rainbowHerringIds: groups.map(() => null),
    rainbowWordOrderIds: [],
    rainbowCategoryName: "",
    rainbowHintWord: "",
    rainbowCategoryEmoji: "",
    rainbowCategoryEmojiHintOnly: false,
    theme: "",
    alphabetizeCompleted: true,
    // The format's own new-puzzle default (Full: Rainbow, Mini: Classic) —
    // see PuzzleFormat.defaultBuilderStyle. Only blankState() sets this;
    // load() never does, so an existing puzzle keeps its stored style.
    style: format.hasRainbow ? format.defaultBuilderStyle : "classic",
    // Every board position already exists the instant a blank form is
    // created (emptyGroup gives each category its real, stable ids up front,
    // even blank) — so the random opening arrangement is generated right
    // here, immediately, rather than waiting for anything to be typed. See
    // the (removed) completeness-gated effect this replaces, and
    // DraggableTileGrid for how a still-blank id renders.
    wordOrderIds: shuffle(groups.flatMap((g) => g.answers.map((a) => a.id))),
  };
}

export function useBuilderForm(initialFormat: PuzzleFormatId = "full") {
  // Computed once, lazily, and shared across every field's initial value —
  // groups and wordOrderIds MUST come from the same blankState() call (not
  // two independent ones), or wordOrderIds would reference ids that don't
  // match the groups actually created for this mount.
  const [initial] = useState(() => blankState(getFormat(initialFormat)));
  const [format, setFormatState] = useState<PuzzleFormat>(initial.format);
  const [groups, setGroups] = useState<BuilderGroupForm[]>(initial.groups);
  const [rainbowHerringIds, setRainbowHerringIds] = useState<(string | null)[]>(initial.rainbowHerringIds);
  const [rainbowWordOrderIds, setRainbowWordOrderIds] = useState<string[]>(initial.rainbowWordOrderIds);
  const [rainbowCategoryName, setRainbowCategoryName] = useState(initial.rainbowCategoryName);
  const [rainbowHintWord, setRainbowHintWord] = useState(initial.rainbowHintWord);
  const [rainbowCategoryEmoji, setRainbowCategoryEmoji] = useState(initial.rainbowCategoryEmoji);
  const [rainbowCategoryEmojiHintOnly, setRainbowCategoryEmojiHintOnly] = useState(initial.rainbowCategoryEmojiHintOnly);
  const [theme, setTheme] = useState(initial.theme);
  const [alphabetizeCompleted, setAlphabetizeCompleted] = useState(initial.alphabetizeCompleted);
  const [wordOrderIds, setWordOrderIds] = useState<string[]>(initial.wordOrderIds);
  const [style, setStyle] = useState<BuilderStyle>(initial.style);

  const applyState = useCallback((s: BuilderState) => {
    setFormatState(s.format);
    setStyle(s.style);
    setGroups(s.groups);
    setRainbowHerringIds(s.rainbowHerringIds);
    setRainbowWordOrderIds(s.rainbowWordOrderIds);
    setRainbowCategoryName(s.rainbowCategoryName);
    setRainbowHintWord(s.rainbowHintWord);
    setRainbowCategoryEmoji(s.rainbowCategoryEmoji);
    setRainbowCategoryEmojiHintOnly(s.rainbowCategoryEmojiHintOnly);
    setTheme(s.theme);
    setAlphabetizeCompleted(s.alphabetizeCompleted);
    setWordOrderIds(s.wordOrderIds);
  }, []);

  const load = useCallback((input: LoadBuilderInput) => {
    applyState(buildStateFromLoad(input, style));
  }, [applyState, style]);

  /**
   * Start Over — a blank form in the CURRENTLY SELECTED format.
   *
   * Deliberately not "a blank Full form": someone building a Mini who presses
   * Start Over wants a blank Mini, not to be thrown back to 4×4.
   */
  const reset = useCallback(() => {
    applyState(blankState(format));
  }, [applyState, format]);

  /**
   * Switch the form to another format.
   *
   * DESTRUCTIVE by nature: the two formats have different numbers of
   * categories, different answer counts and different board positions, so
   * there is no honest way to carry content across. This function always
   * produces a blank form in the new format; asking the creator first, when
   * there is anything to lose, is the SHELL's job — see `isDirty` below,
   * which is exactly the signal that confirmation is needed.
   */
  const changeFormat = useCallback((next: PuzzleFormatId) => {
    const nextFormat = getFormat(next);
    if (nextFormat.id === format.id) return;
    applyState(blankState(nextFormat));
  }, [applyState, format.id]);

  const updateCategoryName = useCallback((idx: number, category: string) => {
    setGroups((prev) => prev.map((g, i) => (i === idx ? { ...g, category } : g)));
  }, []);

  const updateCategoryEmoji = useCallback((idx: number, categoryEmoji: string) => {
    setGroups((prev) => prev.map((g, i) => (i === idx ? { ...g, categoryEmoji } : g)));
  }, []);

  const updateCategoryEmojiHintOnly = useCallback((idx: number, categoryEmojiHintOnly: boolean) => {
    setGroups((prev) => prev.map((g, i) => (i === idx ? { ...g, categoryEmojiHintOnly } : g)));
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
      return next.map((g, i) => ({ ...g, difficulty: format.difficultyOrder[i] }));
    });
    setRainbowHerringIds((prev) => {
      const next = [...prev];
      [next[a], next[b]] = [next[b], next[a]];
      return next;
    });
  }, [format.difficultyOrder]);

  // Drag-and-drop category ordering: moves the card at `from` to `to`. A
  // group's content (answers, ids, tombstones, poolIds, hint) travels intact
  // and its Rainbow selection travels with it; only its difficulty/colour is
  // reassigned from the destination slot. Board order is keyed by answer id
  // and is untouched.
  const moveGroup = useCallback((from: number, to: number) => {
    const count = format.categoryCount;
    if (from === to || from < 0 || to < 0 || from >= count || to >= count) return;
    const reorder = <T,>(list: T[]): T[] => {
      const next = [...list];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    };
    setGroups((prev) => reorder(prev).map((g, i) => ({ ...g, difficulty: format.difficultyOrder[i] })));
    setRainbowHerringIds((prev) => reorder(prev));
  }, [format.categoryCount, format.difficultyOrder]);

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

  /** Every slot (blank or not) across the categories, in group order. */
  const allSlots = useMemo(() => groups.flatMap((g) => g.answers), [groups]);

  const nonBlankSlots = useMemo(() => groups.flatMap((g) => nonBlank(g.answers)), [groups]);

  /**
   * Every category has exactly its format's number of non-blank answers, and
   * all of them are unique.
   *
   * Still named `hasAll16` because that is what every call site and test
   * calls it and the meaning is unchanged — "the board is completely filled
   * in with unique answers". It is NOT hardcoded to 16: on a Mini it means
   * all 9. `hasAllAnswers` below is the same value under a size-neutral name.
   */
  const hasAll16 = useMemo(() => {
    if (!groups.every((g) => nonBlank(g.answers).length === format.answersPerCategory)) return false;
    const normalized = nonBlankSlots.map((s) => normalizeWord(s.text));
    return new Set(normalized).size === format.tileCount;
  }, [groups, nonBlankSlots, format.answersPerCategory, format.tileCount]);

  /**
   * Has the creator entered anything at all?
   *
   * The shells use this to decide whether switching format needs a "this will
   * discard what you have typed" confirmation. Deliberately generous: any
   * typed category name, answer, hint, emoji or Rainbow field counts, because
   * the cost of asking unnecessarily is one extra click and the cost of not
   * asking is losing work.
   */
  const isDirty = useMemo(() => {
    const typedInGroups = groups.some(
      (g) =>
        g.category.trim() !== "" ||
        g.answersRaw.trim() !== "" ||
        g.hintWord.trim() !== "" ||
        g.categoryEmoji.trim() !== "" ||
        g.categoryEmojiHintOnly
    );
    return (
      typedInGroups ||
      rainbowCategoryName.trim() !== "" ||
      rainbowHintWord.trim() !== "" ||
      rainbowCategoryEmoji.trim() !== "" ||
      rainbowCategoryEmojiHintOnly ||
      rainbowHerringIds.some((id) => !!id)
    );
  }, [groups, rainbowCategoryName, rainbowHintWord, rainbowCategoryEmoji, rainbowCategoryEmojiHintOnly, rainbowHerringIds]);

  const slotById = useMemo(() => {
    const map = new Map<string, AnswerSlot>();
    for (const s of allSlots) map.set(s.id, s);
    return map;
  }, [allSlots]);

  // wordOrderIds needs NO effect to (re)generate it. blankState()/load()
  // already set it, eagerly, to a permutation of every id this puzzle's
  // categories will ever use — including still-blank ones (each category's
  // pool ids are created up front by emptyGroup/buildStateFromLoad and
  // never disappear; a deleted-without-replacement answer merely leaves its
  // id in g.tombstones, still part of the same set, resolving to a blank
  // tile via slotById until something inherits it — see reconcileCategory).
  // The only things that ever change wordOrderIds after that are a manual
  // drag reorder, Randomize, or loading a different puzzle — never an
  // ordinary edit.

  // Stray-id healing. A category has exactly its format's number of board
  // positions (its poolIds). Ordinary editing can still hand an answer an id
  // OUTSIDE that pool — e.g. a trailing comma ("a, b, c,") makes an extra blank
  // slot with a fresh id, and a later edit can hand that id to a real answer
  // while the real board slot sits tombstoned. That answer then exists in the
  // fields, the Rainbow dropdown and the display order, but has no tile on the
  // Starting Board (the board shows a blank), and word_order no longer
  // describes the puzzle's answers.
  //
  // Whenever an answer holds a non-pool id and one of the category's own pool
  // ids is free (tombstoned), the answer is moved onto that pool id, and any
  // Rainbow selection/display-order entry pointing at the stray id follows it.
  // Non-pool tombstones are discarded so they can never be recycled later. A
  // genuine extra answer (no free pool id) is left alone — that category is
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

  // A format with no bonus category never has a complete Rainbow, whatever
  // is (or is not) selected — rainbowHerringIds is all-null there anyway, but
  // `[].every()` is vacuously true, so this must be stated.
  const rainbowComplete =
    format.hasRainbow && rainbowHerringIds.length > 0 && rainbowHerringIds.every((id) => !!id);

  // Rainbow display order: defaults to natural group order the moment every
  // category is picked, then holds stable — mirrors wordOrderIds above but
  // scoped to the Rainbow slots.
  useEffect(() => {
    if (!rainbowComplete) return;
    setRainbowWordOrderIds((prev) => {
      const currentIds = rainbowHerringIds.filter((id): id is string => !!id);
      const currentSet = new Set(currentIds);
      const alreadyValid = prev.length === format.categoryCount && prev.every((id) => currentSet.has(id));
      if (alreadyValid) return prev;
      if (prev.length === 0) return currentIds;
      const kept = prev.filter((id) => currentSet.has(id));
      const missing = currentIds.filter((id) => !kept.includes(id));
      return [...kept, ...missing];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rainbowHerringIds.join("|"), rainbowComplete, format.categoryCount]);

  const randomizeWordOrder = useCallback(() => {
    // wordOrderIds already covers every id from the moment this form
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
    format,
    groups,
    rainbowHerringIds,
    rainbowWordOrderIds,
    rainbowCategoryName,
    rainbowHintWord,
    rainbowCategoryEmoji,
    rainbowCategoryEmojiHintOnly,
    theme,
    alphabetizeCompleted,
    wordOrderIds,
    style,
    // setters (simple fields)
    setRainbowCategoryName,
    setRainbowHintWord,
    setRainbowCategoryEmoji,
    setRainbowCategoryEmojiHintOnly,
    setStyle,
    setTheme,
    setAlphabetizeCompleted,
    setRainbowWordOrderIds,
    setWordOrderIds,
    // actions
    load,
    reset,
    changeFormat,
    updateCategoryName,
    updateHintWord,
    updateCategoryEmoji,
    updateCategoryEmojiHintOnly,
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
    /** Size-neutral alias for {@link hasAll16}. */
    hasAllAnswers: hasAll16,
    isDirty,
    rainbowComplete,
    textsFor,
  };
}

export type BuilderForm = ReturnType<typeof useBuilderForm>;
