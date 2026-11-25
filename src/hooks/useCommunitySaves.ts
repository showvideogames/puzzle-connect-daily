import { useCallback, useEffect, useRef, useState } from "react";
import {
  getCustomPuzzleCards,
  getMyFavorites,
  listLocalFavorites,
  resolveShareId,
  setCustomPuzzleFavorite,
  setLocalFavorite,
  type CommunityPuzzleListing,
} from "@/lib/customPuzzles";

/** A saved puzzle's card. Account Favorites carry no play count (get_my_favorites never returned one). */
export type SavedCard = Omit<CommunityPuzzleListing, "finishedPlays"> & { finishedPlays?: number };

/**
 * Bookmarks in Community are the EXISTING Favorites, not a new store:
 *   signed in → the account's custom_puzzle_favorites rows (set_custom_puzzle_favorite / get_my_favorites);
 *   guest     → this browser's `custom-favorite:<shareId>` flags, never counted publicly.
 * A save made here shows on the puzzle page's Favorite button and on /favorites, and the other way round.
 * Like the puzzle page, a guest's device saves are not merged into an account on sign-in.
 *
 * userId: undefined while auth resolves, null for a guest.
 */
export function useCommunitySaves(userId: string | null | undefined) {
  const [items, setItems] = useState<SavedCard[]>([]);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [note, setNote] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const busy = useRef(new Set<string>());
  const noteTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(noteTimer.current), []);
  const flash = useCallback((text: string) => {
    setNote(text);
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(null), 2500);
  }, []);

  useEffect(() => {
    if (userId === undefined) return;
    let cancelled = false;
    setStatus("loading");
    const load: Promise<SavedCard[]> = userId
      ? getMyFavorites().then((rows) => rows.map((f) => ({
          title: f.title, creatorName: f.creatorName, creatorSlug: f.creatorSlug, mode: f.mode,
          shortCode: f.shortCode, favoriteCount: f.favoriteCount,
        })))
      : getCustomPuzzleCards(listLocalFavorites());
    load.then(
      (cards) => {
        if (cancelled) return;
        setItems(cards);
        setSaved(new Set(cards.map((c) => c.shortCode)));
        setStatus("ready");
      },
      () => { if (!cancelled) setStatus("error"); }
    );
    return () => { cancelled = true; };
  }, [userId, attempt]);

  /** Save or unsave a card. Returns the card's favorite count afterwards (unchanged for a guest). */
  const toggle = useCallback(async (card: SavedCard): Promise<number | null> => {
    if (userId === undefined || busy.current.has(card.shortCode)) return null;
    busy.current.add(card.shortCode);
    const next = !saved.has(card.shortCode);
    const apply = (on: boolean, count = card.favoriteCount) => {
      setSaved((s) => { const n = new Set(s); if (on) n.add(card.shortCode); else n.delete(card.shortCode); return n; });
      setItems((list) => on
        ? (list.some((c) => c.shortCode === card.shortCode) ? list : [{ ...card, favoriteCount: count }, ...list])
        : list.filter((c) => c.shortCode !== card.shortCode));
    };
    try {
      const shareId = await resolveShareId(card.shortCode);
      if (!shareId) { flash("Couldn't save. Try again."); return null; }
      if (userId) {
        apply(next);
        const result = await setCustomPuzzleFavorite(shareId, next);
        if (!result) { apply(!next); flash("Couldn't save. Try again."); return null; }
        apply(result.favorited, result.favoriteCount);
        flash(result.favorited ? "Saved to Favorites" : "Removed from Favorites");
        return result.favoriteCount;
      }
      setLocalFavorite(shareId, next);
      apply(next);
      flash(next ? "Saved on this device" : "Removed from this device");
      return card.favoriteCount;
    } finally {
      busy.current.delete(card.shortCode);
    }
  }, [userId, saved, flash]);

  return { items, saved, status, note, toggle, retry: () => setAttempt((n) => n + 1) };
}
