import { useCallback, useEffect, useRef, useState } from "react";
import {
  getCustomPuzzleByShareId,
  isLocalFavorite,
  setCustomPuzzleFavorite,
  setLocalFavorite,
} from "@/lib/customPuzzles";

interface Options {
  /** The puzzle's long share id — the identity favorites are stored against. */
  shareId: string | null;
  /** What the server said when the puzzle loaded (already reflects the signed-in account, if any). */
  serverFavorited: boolean;
  serverCount: number;
  /** undefined = auth still resolving, null = guest, string = signed-in account. */
  userId: string | null | undefined;
}

/**
 * Favorite state for one custom puzzle.
 *
 * Signed in: the account's favorite lives in the database (one per account per
 * puzzle, set — never toggled — so a double click can't flip it) and counts
 * publicly. Guest: a namespaced localStorage flag, never counted. Importing a
 * guest's local favorites into an account on sign-in is deliberately deferred.
 */
export function useCustomFavorite({ shareId, serverFavorited, serverCount, userId }: Options) {
  const [favorited, setFavorited] = useState(serverFavorited);
  const [count, setCount] = useState(serverCount);
  const [note, setNote] = useState<string | null>(null);
  const busyRef = useRef(false);
  const noteTimer = useRef<ReturnType<typeof setTimeout>>();
  const previousUserId = useRef<string | null | undefined>(undefined);

  const flashNote = useCallback((text: string) => {
    setNote(text);
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(null), 2500);
  }, []);
  useEffect(() => () => clearTimeout(noteTimer.current), []);

  // Adopt the loaded puzzle's state; for a guest the device-local flag wins.
  useEffect(() => {
    if (!shareId || userId === undefined) return;
    setCount(serverCount);
    setFavorited(userId ? serverFavorited : isLocalFavorite(shareId));
  }, [shareId, serverFavorited, serverCount, userId]);

  // Signing in (or out) while the page is open: re-read the account's state.
  useEffect(() => {
    const before = previousUserId.current;
    previousUserId.current = userId;
    if (!shareId || !userId || before === undefined || before === userId) return;
    void getCustomPuzzleByShareId(shareId).then((fresh) => {
      if (!fresh) return;
      setFavorited(fresh.favoritedByMe);
      setCount(fresh.favoriteCount);
    });
  }, [shareId, userId]);

  const toggle = useCallback(async () => {
    if (!shareId || busyRef.current) return;
    busyRef.current = true;
    const next = !favorited;
    try {
      if (userId) {
        setFavorited(next);
        setCount((c) => Math.max(0, c + (next ? 1 : -1)));
        const result = await setCustomPuzzleFavorite(shareId, next);
        if (result) {
          setFavorited(result.favorited);
          setCount(result.favoriteCount);
        } else {
          setFavorited(!next);
          setCount((c) => Math.max(0, c + (next ? -1 : 1)));
          flashNote("Couldn't save. Try again.");
        }
      } else {
        setLocalFavorite(shareId, next);
        setFavorited(next);
        flashNote(next ? "Saved on this device" : "Removed from this device");
      }
    } finally {
      busyRef.current = false;
    }
  }, [shareId, favorited, userId, flashNote]);

  return { favorited, count, note, toggle };
}
