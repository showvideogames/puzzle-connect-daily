import { useState, useEffect, useRef } from "react";

const CURRENT_VERSION = "0"; // increment this with each deploy

export function useVersionCheck() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const checking = useRef(false);

  const check = async () => {
    if (checking.current) return;
    checking.current = true;
    try {
      const res = await fetch(`/version.json?t=${Date.now()}`);
      const data = await res.json();
      if (data.version !== CURRENT_VERSION) {
        setUpdateAvailable(true);
      }
    } catch {
      // silently ignore network errors
    } finally {
      checking.current = false;
    }
  };

  useEffect(() => {
    check();
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  return updateAvailable;
}
