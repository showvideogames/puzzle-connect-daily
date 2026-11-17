import { useCallback, useEffect, useRef } from "react";
import { useBlocker, useLocation } from "react-router-dom";

/** Router-owned blocking covers PUSH, REPLACE and browser POP without adding history entries. */
export function useLeaveGuard(active: boolean) {
  const from = useRef<HTMLElement | null>(null);
  const location = useLocation();
  const entryIndex = useRef<number | undefined>(window.history.state?.idx);
  const documentDeparture = useRef(false);
  useEffect(() => {
    entryIndex.current = window.history.state?.idx;
  }, [location.key]);
  const blocker = useBlocker(useCallback(({ currentLocation, nextLocation }) => {
    if (!active || currentLocation.pathname === nextLocation.pathname) return false;
    from.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return true;
  }, [active]));

  useEffect(() => {
    if (!active) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      documentDeparture.current = true;
      event.preventDefault(); event.returnValue = "";
    };
    addEventListener("beforeunload", beforeUnload);
    return () => removeEventListener("beforeunload", beforeUnload);
  }, [active]);

  useEffect(() => {
    if (!active && blocker.state === "blocked") blocker.reset();
  }, [active, blocker]);

  const restoreCanceledPop = () => {
    // A second rapid Back can attempt to leave the document while the router
    // is restoring a blocked POP. Canceling the native beforeunload prompt
    // cancels that queued restoration in Chromium. Resume it before either
    // decision: reset consumes the restoration event, while proceed waits for
    // that event before replaying the requested navigation.
    const currentIndex = window.history.state?.idx;
    if (documentDeparture.current && typeof entryIndex.current === "number" &&
        typeof currentIndex === "number" && currentIndex !== entryIndex.current) {
      window.history.go(entryIndex.current - currentIndex);
    }
    documentDeparture.current = false;
  };
  const stay = () => {
    if (blocker.state !== "blocked") return;
    restoreCanceledPop();
    blocker.reset();
  };
  const leave = () => {
    if (blocker.state !== "blocked") return;
    restoreCanceledPop();
    blocker.proceed();
  };
  return { asking: blocker.state === "blocked", stay, leave, from };
}
