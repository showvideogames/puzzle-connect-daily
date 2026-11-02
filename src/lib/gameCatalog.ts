import { moreGames } from "@/components/moreGames";

/**
 * Every game in the portfolio, for the game picker. The menu's More Games list
 * stays the one source for the other sites' names, links and descriptions, so
 * the picker cannot drift from it. Rainbow is added because that list only
 * names the games you are not already playing.
 */
export interface CatalogGame {
  id: string;
  title: string;
  description: string;
  href: string;
  /** The small square icon, for menus. Covers are separate. */
  iconSrc: string;
}

const rainbow: CatalogGame = {
  id: "rainbow",
  title: "Rainbow Categories",
  description: "Find the connections, spot the hidden rainbow.",
  // The address the other sites already link to. The bare domain redirects here.
  href: "https://www.rainbowcategories.com/",
  iconSrc: "/icons/rainbow-icon-192-0e09e6d1.png",
};

/** The More Games list shortens this one; a cover needs the game's full name. */
const fullTitles: Record<string, string> = { "price-is-what": "Price Is What?!" };

export const gameCatalog: readonly CatalogGame[] = [
  rainbow,
  ...moreGames.map((game) => ({
    id: game.icon,
    title: fullTitles[game.icon] ?? game.title,
    description: game.description,
    href: game.href,
    iconSrc: `/game-icons/${game.icon}.png`,
  })),
];
