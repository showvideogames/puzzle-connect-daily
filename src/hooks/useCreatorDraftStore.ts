import { useEffect, useState } from "react";
import { CreatorDraftStore, draftKeyFor, draftLockFor } from "@/lib/builder/creatorDraft";

/** Hold a single writer for the editor's lifetime. No lease expiry can let a
 * suspended tab overwrite another tab. Unsupported browsers fail honestly. */
export function useCreatorDraftStore(slot: string | null = null) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ store?: CreatorDraftStore; busy?: boolean; unavailable?: boolean }>({});
  useEffect(() => {
    let cancelled = false;
    let release: (() => void) | undefined;
    setState({});
    if (!navigator.locks) {
      setState({ unavailable: true });
      return;
    }
    void navigator.locks.request(draftLockFor(slot), { ifAvailable: true }, async lock => {
      if (cancelled) return;
      if (!lock) { setState({ busy: true }); return; }
      const held = new Promise<void>(resolve => { release = resolve; });
      setState({ store: new CreatorDraftStore(() => localStorage, draftKeyFor(slot)) });
      await held;
    }).catch(() => { if (!cancelled) setState({ unavailable: true }); });
    return () => { cancelled = true; release?.(); };
  }, [attempt, slot]);
  return { ...state, retry: () => setAttempt(n => n + 1) };
}
