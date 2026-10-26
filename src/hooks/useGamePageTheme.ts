import { useEffect } from "react";

/**
 * The game pages' light theme: a white page with neutral greys in place of
 * the site's warm cream (html.layout-refresh in index.css; dark mode is
 * unaffected). Called by every page that shows a game board — the Full and
 * Mini Dailies, Archive puzzles, Beta playtests and custom puzzles — from its
 * first render, so the page never flashes cream while its puzzle loads. Other
 * pages (lists, admin, legal) keep the site theme.
 */
export function useGamePageTheme() {
  useEffect(() => {
    document.documentElement.classList.add("layout-refresh");
    return () => document.documentElement.classList.remove("layout-refresh");
  }, []);
}
