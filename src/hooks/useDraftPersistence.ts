import { useCallback, useEffect, useState } from "react";
import type { Difficulty, PuzzleFormatId } from "@/lib/puzzleFormat";

const DRAFT_KEY = "admin-puzzle-draft";

export interface GroupForm {
  category: string;
  words: string;
  difficulty: Difficulty;
  hintWord: string;
  /** Absent in drafts saved before Category Emoji existed. */
  categoryEmoji?: string;
  /** Absent in drafts saved before Hint Only existed; restores as unchecked. */
  categoryEmojiHintOnly?: boolean;
}

export interface DraftData {
  puzzleDate: string;
  puzzleTitle: string;
  designerName: string;
  groups: GroupForm[];
  isPublished: boolean;
  isBeta: boolean;
  wordOrder: string[];
  rainbowHerring: (string | null)[];
  rainbowCategoryName: string;
  rainbowHintWord: string;
  rainbowCategoryEmoji?: string;
  /** Absent in drafts saved before Hint Only existed; restores as unchecked. */
  rainbowCategoryEmojiHintOnly?: boolean;
  rainbowWordOrder: string[];
  theme: string;
  isEmojiPuzzle: boolean;
  emojiPuzzleIcon: string;
  isFreePuzzle: boolean;
  freePuzzleOrder: number | null;
  alphabetizeCompleted: boolean;
  /** Absent in drafts saved before style was stored; loading then keeps the current style. */
  style?: "rainbow" | "classic";
  /**
   * The format this draft was typed in.
   *
   * Absent in every draft saved before Mini existed — and those are all Full
   * 4×4 drafts, which is exactly what an absent value resolves to. So an
   * older draft restores as Full with its content intact, never reshaped.
   */
  format?: PuzzleFormatId;
  editingId: string | null;
}

function writeDraft(data: DraftData) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
  } catch {}
}

function readDraft(): DraftData | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as DraftData;
  } catch {
    return null;
  }
}

function removeDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {}
}

interface UseDraftPersistenceOptions {
  enabled: boolean;
  editingId: string | null;
  values: DraftData;
  applyDraft: (draft: DraftData) => void;
}

export function useDraftPersistence({ enabled, editingId, values, applyDraft }: UseDraftPersistenceOptions) {
  const [draftRestored, setDraftRestored] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const draft = readDraft();
    if (draft && !draft.editingId) {
      applyDraft(draft);
      setDraftRestored(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const saveDraft = useCallback((data: DraftData) => {
    writeDraft(data);
  }, []);

  const clearDraft = useCallback(() => {
    removeDraft();
  }, []);

  const getCurrentDraft = useCallback((): DraftData => values, [values]);

  const handleBlurSave = useCallback(() => {
    if (!editingId) {
      writeDraft(values);
    }
  }, [editingId, values]);

  return { draftRestored, setDraftRestored, saveDraft, clearDraft, getCurrentDraft, handleBlurSave };
}
