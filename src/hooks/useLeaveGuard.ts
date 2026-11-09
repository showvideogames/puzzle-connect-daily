import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { UNSAFE_NavigationContext, useLocation, type To } from "react-router-dom";

/**
 * Holds in-app navigation while `active`, so a page with unsaved work can ask
 * first. The app uses BrowserRouter, which has no blocker, and the header
 * reaches pages from many places (its links, the menu drawer, Settings, the
 * profile menu), so this holds the router's own push and replace instead of
 * guarding each one. While active, leaving the tab or a full-page redirect
 * (signing in) gets the browser's own "Leave site?" question.
 *
 * `asking` says a navigation is waiting; `stay` drops it and `leave` carries it out.
 */
export function useLeaveGuard(active: boolean) {
  const { navigator } = useContext(UNSAFE_NavigationContext);
  const [waiting, setWaiting] = useState<(() => void) | null>(null);
  /** What had focus when the navigation was held, to go back to on Stay. */
  const from = useRef<HTMLElement | null>(null);
  // A link to the page already open (the menu's own Create a puzzle) keeps the
  // page and its work, so it goes ahead without asking.
  const { pathname } = useLocation();
  const here = useRef(pathname);
  here.current = pathname;

  useEffect(() => {
    if (!active) return;
    const { push, replace } = navigator;
    const hold = (to: To, go: () => void) => {
      const path = typeof to === "string" ? to.split(/[?#]/)[0] : to.pathname;
      if (!path || path === here.current) return go();
      from.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setWaiting(() => go);
    };
    navigator.push = (...args: Parameters<typeof push>) => hold(args[0], () => push(...args));
    navigator.replace = (...args: Parameters<typeof replace>) => hold(args[0], () => replace(...args));
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    addEventListener("beforeunload", beforeUnload);
    return () => {
      navigator.push = push;
      navigator.replace = replace;
      removeEventListener("beforeunload", beforeUnload);
      setWaiting(null);
    };
  }, [active, navigator]);

  const stay = useCallback(() => setWaiting(null), []);
  const leave = useCallback(() => {
    const go = waiting;
    setWaiting(null);
    go?.();
  }, [waiting]);

  return { asking: waiting !== null, stay, leave, from };
}
