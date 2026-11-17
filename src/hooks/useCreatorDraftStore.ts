import { useEffect, useState } from "react";
import { CREATOR_DRAFT_LOCK, CreatorDraftStore } from "@/lib/builder/creatorDraft";

/** Hold a single writer for the editor's lifetime. No lease expiry can let a
 * suspended tab overwrite another tab. Unsupported browsers fail honestly. */
export function useCreatorDraftStore() {
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
    void navigator.locks.request(CREATOR_DRAFT_LOCK, { ifAvailable: true }, async lock => {
      if (cancelled) return;
      if (!lock) { setState({ busy: true }); return; }
      const held = new Promise<void>(resolve => { release = resolve; });
      setState({ store: new CreatorDraftStore(() => localStorage) });
      await held;
    }).catch(() => { if (!cancelled) setState({ unavailable: true }); });
    return () => { cancelled = true; release?.(); };
  }, [attempt]);
  return { ...state, retry: () => setAttempt(n => n + 1) };
}
