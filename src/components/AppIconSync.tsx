import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { applyAppIcons, applyHomeTitle, homeTitleForPath, iconsForPath } from "@/lib/appIcons";

/** Keeps the favicon / home-screen icon and name tags on the current game's set. See lib/appIcons.ts. */
export function AppIconSync() {
  const { pathname } = useLocation();
  useEffect(() => {
    applyAppIcons(iconsForPath(pathname));
    applyHomeTitle(homeTitleForPath(pathname));
  }, [pathname]);
  return null;
}
