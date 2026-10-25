import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { applyAppIcons, iconsForPath } from "@/lib/appIcons";

/** Keeps the favicon / home-screen icon tags on the current game's set. See lib/appIcons.ts. */
export function AppIconSync() {
  const { pathname } = useLocation();
  useEffect(() => {
    applyAppIcons(iconsForPath(pathname));
  }, [pathname]);
  return null;
}
