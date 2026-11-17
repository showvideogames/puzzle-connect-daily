import { useCallback, useEffect, useRef } from "react";
import { useBlocker } from "react-router-dom";

/** Router-owned blocking covers PUSH, REPLACE and browser POP without adding history entries. */
export function useLeaveGuard(active: boolean) {
  const from = useRef<HTMLElement | null>(null);
  const blocker = useBlocker(useCallback(({ currentLocation, nextLocation }) => {
    if (!active || currentLocation.pathname === nextLocation.pathname) return false;
    from.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return true;
  }, [active]));

  useEffect(() => {
    if (!active) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    addEventListener("beforeunload", beforeUnload);
    return () => removeEventListener("beforeunload", beforeUnload);
  }, [active]);

  useEffect(() => {
    if (!active && blocker.state === "blocked") blocker.reset();
  }, [active, blocker]);

  const stay = () => { if (blocker.state === "blocked") blocker.reset(); };
  const leave = () => { if (blocker.state === "blocked") blocker.proceed(); };
  return { asking: blocker.state === "blocked", stay, leave, from };
}
