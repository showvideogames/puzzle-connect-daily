/**
 * Entry context — HOW a player reached a game, not what kind of puzzle it is.
 *
 * This is deliberately not a proxy for puzzle attributes. `isEmojiPuzzle`,
 * `isFreePuzzle` and "has a Rainbow" are properties of the puzzle row and are
 * already stored there; two players can reach the SAME puzzle by different
 * routes, and that difference is the only thing this records.
 *
 * Every value below is one the live routing can actually distinguish. Nothing
 * here is inferred from a puzzle's own flags — where the route genuinely
 * cannot tell us (a deep link straight to /archive/:id), the honest
 * `archive_direct` is recorded rather than a plausible-looking guess.
 *
 * Future values (`beta`, `shared_link`, `custom_link`, Mini, Mega) drop into
 * the union below and need no database migration: game_sessions.entry_context
 * is a bare text column with no CHECK constraint or enum type, specifically so
 * this list can evolve in TypeScript alone.
 */
export type EntryContext =
  /** "/" — today's Daily puzzle. */
  | "daily_home"
  /** A day cell on the Archive calendar. */
  | "archive_calendar"
  /** A Free Puzzles card on /archive. */
  | "free_collection"
  /** An Emoji Puzzles card on /archive. */
  | "emoji_collection"
  /**
   * /archive/:id reached without in-app navigation context — a deep link,
   * bookmark, shared URL, or a reload in a fresh tab. Means "we genuinely
   * cannot tell which collection this came from", never "probably the
   * calendar".
   */
  | "archive_direct"
  /** The legacy /free/:id route (old shared or bookmarked free-puzzle URLs). */
  | "free_legacy_link";

/**
 * The router-state key the Archive page's navigate() calls carry. Router state
 * is the only thing that can distinguish the three /archive/:id entry points
 * from each other, since they all resolve to the same path.
 */
export interface EntryContextRouterState {
  entrySource?: EntryContext;
}

const SESSION_KEY_PREFIX = "rc-entry-context-";

/**
 * Router state is lost on reload, but the puzzle stays open and a player may
 * well refresh before their first guess — at which point the session has not
 * been created yet and the context would degrade to `archive_direct` for a
 * game we actually did know the origin of. Mirroring it into sessionStorage
 * keeps it accurate across reloads within the same tab.
 *
 * sessionStorage rather than localStorage on purpose: the context belongs to
 * this visit, not to the puzzle forever. A genuinely new tab opened on a
 * bookmarked URL later SHOULD read as `archive_direct`, and localStorage would
 * wrongly keep claiming the original route indefinitely.
 */
function rememberEntryContext(puzzleId: string, context: EntryContext): void {
  try {
    sessionStorage.setItem(SESSION_KEY_PREFIX + puzzleId, context);
  } catch {
    // Storage unavailable (private browsing, blocked by policy). The caller
    // still gets the correct value this mount; only refresh-survival is lost.
  }
}

function recallEntryContext(puzzleId: string): EntryContext | null {
  try {
    return (sessionStorage.getItem(SESSION_KEY_PREFIX + puzzleId) as EntryContext | null) ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolves the entry context for a shared archived-puzzle page
 * (/archive/:id and the legacy /free/:id, which render the same component).
 *
 * Precedence, most to least trustworthy:
 *   1. router state from THIS navigation — the player just clicked a specific
 *      card or calendar cell, so we know exactly where from;
 *   2. the value remembered for this tab — same visit, just reloaded;
 *   3. the route itself — /free/:id is unambiguously the legacy link, and
 *      /archive/:id with nothing else known is `archive_direct`.
 */
export function resolveArchiveEntryContext(
  puzzleId: string | undefined,
  routerState: unknown,
  pathname: string
): EntryContext {
  const fromRouter = (routerState as EntryContextRouterState | null)?.entrySource;
  if (fromRouter) {
    if (puzzleId) rememberEntryContext(puzzleId, fromRouter);
    return fromRouter;
  }

  if (puzzleId) {
    const remembered = recallEntryContext(puzzleId);
    if (remembered) return remembered;
  }

  return pathname.startsWith("/free/") ? "free_legacy_link" : "archive_direct";
}
