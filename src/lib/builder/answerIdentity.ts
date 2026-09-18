/**
 * Stable per-answer identity for the puzzle builder.
 *
 * THE BUG THIS FIXES
 *
 * The old Admin editor's "Grid Layout Order" and Rainbow selection both
 * tracked board position by the answer's WORD TEXT. Editing a word (fixing a
 * typo, swapping "Zombie" for "Monster") changed the text, so the old text
 * disappeared from wordOrder/rainbowHerring and the new text was never in
 * either — the custom layout and Rainbow selection silently broke on every
 * single-word edit.
 *
 * THE FIX
 *
 * Each of a category's (up to 4) comma-separated answers gets a stable id.
 * reconcileCategory below resolves a fresh comma-separated split against the
 * previous slots in priority order:
 *
 *   1. Exact normalized text match, WHEREVER it now sits — a pure reorder of
 *      unchanged words (comma position shuffled, no word added/removed)
 *      changes nothing about any id.
 *   2. A same-edit replacement: whatever old slots and new texts are left
 *      over after exact matching are paired off — this is what makes fixing
 *      one word's spelling (Zombie -> Monster) inherit that slot's board
 *      position and Rainbow selection.
 *   3. A leftover old slot with nothing to pair with becomes a TOMBSTONE —
 *      remembered (but hidden from the visible answers) so that a later
 *      edit adding a new answer can inherit it, rather than getting a fresh
 *      id and silently losing the board position/Rainbow selection the
 *      deleted answer held.
 *   4. A leftover new text with nothing to pair with consumes the oldest
 *      tombstone if one exists, or else gets a brand-new id.
 *
 * Board order and Rainbow selection are tracked by id, not text, so none of
 * this ever needs to touch them directly — an id simply keeps meaning
 * whatever it always meant. The visible UI is still a single comma-separated
 * text field per category; ids and tombstones are purely internal.
 */

export interface AnswerSlot {
  id: string;
  text: string;
}

let counter = 0;
export function generateSlotId(): string {
  counter += 1;
  return `slot-${Date.now().toString(36)}-${counter.toString(36)}`;
}

/**
 * Splits a raw comma-separated field into its individual (untrimmed-index,
 * trimmed-value) slots, preserving position — including blank trailing
 * slots from something like "Blue, Green, " — so reconciliation below can
 * align by index the same way the field's own comma positions do.
 */
export function splitAnswerField(raw: string): string[] {
  if (raw.trim() === "") return [];
  return raw.split(",").map((s) => s.trim());
}

function matchKey(text: string): string {
  return text.trim().toUpperCase();
}

export interface ReconcileResult {
  /** One slot per entry in newTexts, in order — including blank ones. */
  answers: AnswerSlot[];
  /** Ids of answers removed by this edit with nothing to replace them, kept for later reuse. */
  tombstones: AnswerSlot[];
}

/**
 * Reconciles one category's previous answer slots (plus any tombstones
 * carried over from earlier edits) against a freshly re-split text list. See
 * the priority order in the module comment above.
 */
export function reconcileCategory(
  prevAnswers: AnswerSlot[],
  prevTombstones: AnswerSlot[],
  newTexts: string[]
): ReconcileResult {
  const usedPrevIdx = new Set<number>();
  const prevKeys = prevAnswers.map((a) => matchKey(a.text));
  const result: (AnswerSlot | null)[] = new Array(newTexts.length).fill(null);

  // Priority 1: exact normalized text match, regardless of position — a
  // pure comma reorder of unchanged words touches no id at all.
  newTexts.forEach((text, i) => {
    if (text.trim() === "") return;
    const key = matchKey(text);
    const idx = prevKeys.findIndex((k, j) => k === key && !usedPrevIdx.has(j));
    if (idx !== -1) {
      usedPrevIdx.add(idx);
      result[i] = { id: prevAnswers[idx].id, text };
    }
  });

  const leftoverOldIdx = prevAnswers.map((_, j) => j).filter((j) => !usedPrevIdx.has(j));
  const leftoverNewIdx = newTexts
    .map((_, i) => i)
    .filter((i) => result[i] === null && newTexts[i].trim() !== "");

  // Priority 2: pair off this same edit's leftovers — a genuine replacement.
  const pairCount = Math.min(leftoverOldIdx.length, leftoverNewIdx.length);
  for (let k = 0; k < pairCount; k++) {
    const oldIdx = leftoverOldIdx[k];
    const newIdx = leftoverNewIdx[k];
    result[newIdx] = { id: prevAnswers[oldIdx].id, text: newTexts[newIdx] };
  }

  // Priority 3: any old slot still left over (removed with nothing to pair
  // with) becomes a tombstone instead of simply disappearing.
  const tombstones = [...prevTombstones];
  for (let k = pairCount; k < leftoverOldIdx.length; k++) {
    tombstones.push(prevAnswers[leftoverOldIdx[k]]);
  }

  // Priority 4: any new text still left over (added with nothing to pair
  // with) inherits the oldest tombstone if one is available, else is new.
  for (let k = pairCount; k < leftoverNewIdx.length; k++) {
    const newIdx = leftoverNewIdx[k];
    const tomb = tombstones.shift();
    result[newIdx] = { id: tomb ? tomb.id : generateSlotId(), text: newTexts[newIdx] };
  }

  // Blank entries (an empty comma slot mid-edit) never match, pair or
  // consume a tombstone — they just need a placeholder id for React keys.
  newTexts.forEach((text, i) => {
    if (result[i] === null) result[i] = { id: generateSlotId(), text };
  });

  return { answers: result as AnswerSlot[], tombstones };
}

/** Fisher-Yates shuffle — returns a new array, never mutates its input. */
export function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
