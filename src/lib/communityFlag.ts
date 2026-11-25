/**
 * Community Puzzles (the /community Explore, Following and Favorites pages,
 * its menu row, the builder's "List in Community" and cover steps, the
 * creator's list/unlist and cover controls, and the admin curation page).
 *
 * ON by default: shipping it is merging it, after migrations 0004-0008 are
 * applied (docs/COMMUNITY-PUZZLES-RELEASE.md). VITE_COMMUNITY_PUZZLES=off is
 * the emergency switch: set it and redeploy, and the route, menu row and every
 * control above disappear again, with no data touched.
 */
export function communityPuzzlesOn(flag: unknown = import.meta.env.VITE_COMMUNITY_PUZZLES): boolean {
  return flag !== "off";
}
