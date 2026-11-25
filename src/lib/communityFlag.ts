/**
 * Community Puzzles (the /community browse feed, its menu row, the builder's
 * "List in Community" control and the owner's list/unlist control) is a
 * PREVIEW. It needs migration 0004_community_listing.sql, which is not applied
 * to any hosted database, and a player report flow that does not exist yet
 * (only the admin hide exists), so it stays off unless a build sets
 * VITE_COMMUNITY_PUZZLES=preview. Off, the route does not exist and nothing
 * new renders: every existing page behaves exactly as before.
 */
export function communityPuzzlesOn(flag: unknown = import.meta.env.VITE_COMMUNITY_PUZZLES): boolean {
  return flag === "preview";
}
