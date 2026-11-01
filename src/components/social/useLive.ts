import { useEffect, useRef } from "react";

/** False once this person's screens are gone, so an answer that comes back after that does nothing. */
export function useLive() {
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  return live;
}
