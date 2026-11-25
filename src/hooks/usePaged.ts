import { useCallback, useEffect, useRef, useState } from "react";

type Status = "loading" | "ready" | "error";

/**
 * One paged list: first page whenever `key` changes, "Show more", Retry. Only
 * the newest request may write, so a slow earlier search never overwrites a later one.
 */
export function usePaged<T>(key: string, enabled: boolean, fetchPage: (offset: number) => Promise<{ items: T[]; hasMore: boolean }>, idOf: (t: T) => string) {
  const [status, setStatus] = useState<Status>("loading");
  const [items, setItems] = useState<T[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const request = useRef(0);
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;

  useEffect(() => {
    if (!enabled) return;
    const mine = ++request.current;
    setStatus("loading");
    setMoreError(false);
    fetchRef.current(0).then(
      (page) => { if (mine === request.current) { setItems(page.items); setHasMore(page.hasMore); setStatus("ready"); } },
      () => { if (mine === request.current) { setItems([]); setHasMore(false); setStatus("error"); } }
    );
  }, [key, enabled, attempt]);

  const more = useCallback(() => {
    const mine = request.current;
    setLoadingMore(true);
    setMoreError(false);
    fetchRef.current(items.length).then(
      (page) => {
        if (mine !== request.current) return;
        setItems((prev) => {
          const seen = new Set(prev.map(idOf));
          return [...prev, ...page.items.filter((p) => !seen.has(idOf(p)))];
        });
        setHasMore(page.hasMore);
        setLoadingMore(false);
      },
      () => { if (mine === request.current) { setMoreError(true); setLoadingMore(false); } }
    );
  }, [items.length, idOf]);

  return { status, items, setItems, hasMore, loadingMore, moreError, more, retry: () => setAttempt((n) => n + 1) };
}
