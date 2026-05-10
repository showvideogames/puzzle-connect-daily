import { useCallback, useEffect, useState } from "react";

const DRAFT_KEY = "admin-puzzle-draft";

export interface GroupForm {
  category: string;
  words: string;
  difficulty: 1 | 2 | 3 | 4;
}

export interface DraftData {
  puzzleDate: string;
  puzzleTitle: string;
  groups: GroupForm[];
  isPublished: boolean;
  wordOrder: string[];
  rainbowHerring: (string | null)[];
  rainbowCategoryName: string;
  rainbowWordOrder: string[];
  isEmojiPuzzle: boolean;
  isFreePuzzle: boolean;
  freePuzzleOrder: number | null;
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
