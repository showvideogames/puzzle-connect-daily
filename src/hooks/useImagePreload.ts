import { useEffect, useState } from "react";

const TIMEOUT_MS = 3000;

/**
 * Preload a list of image URLs. Returns true once all images have loaded
 * (or errored), or after a hard timeout. If urls is empty, returns true
 * immediately so callers don't need a special case.
 */
export function useImagePreload(urls: string[]): boolean {
  // Stringify for stable dependency — urls array identity may change per render
  const key = urls.join("|");
  const [ready, setReady] = useState(urls.length === 0);

  useEffect(() => {
    if (urls.length === 0) {
      setReady(true);
      return;
    }
    setReady(false);

    let cancelled = false;
    const timeout = setTimeout(() => {
      if (!cancelled) setReady(true);
    }, TIMEOUT_MS);

    const promises = urls.map(
      (src) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.src = src;
        }),
    );

    void Promise.all(promises).then(() => {
      if (!cancelled) {
        clearTimeout(timeout);
        setReady(true);
      }
    });

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return ready;
}
