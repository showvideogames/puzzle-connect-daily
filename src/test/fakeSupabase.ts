/**
 * An in-memory stand-in for the Supabase client, used by the durable-session
 * tests.
 *
 * The point is to exercise the REAL application code paths — useGame,
 * useGameSession, lib/gameSession, lib/gameStats — against a database that
 * behaves like the migrated one, including the two unique constraints the
 * idempotency guarantees actually depend on. Production is never touched.
 *
 * Only the query surface this codebase uses is implemented; anything else
 * throws loudly rather than silently returning a plausible empty result,
 * which would make a broken test look like a passing one.
 */

export interface FakeRow {
  [key: string]: unknown;
}

/**
 * The counter row behind a custom puzzle's stats (20260921000000).
 *
 * Spelled out rather than left to FakeRow's `unknown` index signature,
 * because every column on it is arithmetic: the RPCs increment them and the
 * tests add them up. Under `unknown`, `wins + losses` is a type error, and
 * the only ways out are a cast at every use or an assertion that the sum is
 * a number — neither of which would catch the fake storing something that is
 * not a number here. Declaring the shape once does.
 *
 * It still extends FakeRow, so the generic query surface treats it like any
 * other row.
 */
export interface CustomPuzzleStatsRow extends FakeRow {
  custom_puzzle_id: string;
  wins: number;
  losses: number;
  guesses_4: number;
  guesses_5: number;
  guesses_6: number;
  guesses_7: number;
  guesses_8_plus: number;
  win_guess_total: number;
}

/** The winning-guess-count buckets a stats row counts into. */
type GuessBucket = "guesses_4" | "guesses_5" | "guesses_6" | "guesses_7" | "guesses_8_plus";

/** Every numeric column on a stats row. */
type StatsCounter = GuessBucket | "wins" | "losses" | "win_guess_total";

/**
 * Which bucket a winning game's guess count belongs to — 8 or more share the
 * top bucket, and anything below 4 counts as 4. Callers have already
 * validated `totalGuesses` as an integer in 0..60.
 */
function guessBucket(totalGuesses: number): GuessBucket {
  if (totalGuesses >= 8) return "guesses_8_plus";
  if (totalGuesses <= 4) return "guesses_4";
  if (totalGuesses === 5) return "guesses_5";
  if (totalGuesses === 6) return "guesses_6";
  return "guesses_7";
}

/**
 * Reads a row's id, proving it really is one.
 *
 * Most tables keep FakeRow's `unknown` index signature, so `row.id` is
 * `unknown` and cannot be passed where a string id is wanted. This checks
 * instead of asserting: a fake that ever stopped putting a string id on a
 * row would fail the test that relies on it, loudly and at the right line,
 * rather than carrying undefined into a foreign key.
 */
export function rowId(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error(`expected a row id string, got ${value === null ? "null" : typeof value}`);
  }
  return value;
}

/**
 * Every table the fake holds. The string index keeps the generic query
 * surface (and tests that clear tables by name) working, while a table whose
 * columns are read as numbers is declared with its real shape.
 */
export interface FakeTables {
  custom_puzzle_stats: CustomPuzzleStatsRow[];
  [table: string]: FakeRow[];
}

type Filter =
  | { kind: "eq"; column: string; value: unknown }
  | { kind: "cmp"; column: string; op: "lte" | "gte" | "lt" | "gt"; value: unknown }
  | { kind: "in"; column: string; values: unknown[] }
  | { kind: "is"; column: string; value: null }
  | { kind: "or"; clauses: { column: string; value: unknown }[] };

/** Mirrors the unique indexes created by the durable-session migration. */
const UNIQUE_KEYS: Record<string, string[]> = {
  guess_events: ["game_session_id", "guess_number"],
  hint_events: ["game_session_id", "hint_type"],
  // puzzle_versions (puzzle_id, version_number) -- what makes "Version 2"
  // mean one specific snapshot even when two admin saves race.
  puzzle_versions: ["puzzle_id", "version_number"],
};

/**
 * validate_puzzle_content(), mirrored.
 *
 * Every rule here is restated from the SQL rather than assumed, because the
 * versioning decision depends on canonical equality: if this canonicalised
 * differently from the database, a metadata-only save would look like a
 * gameplay change (or worse, the reverse) in tests only.
 *
 * Throws on invalid content, exactly as the SQL raises.
 */
/**
 * The size rules a format imposes, mirroring the CASE in
 * validate_puzzle_content. An absent format is Full — the single line that
 * keeps every pre-Mini payload valid.
 */
function formatRules(raw: unknown) {
  const format = typeof raw === "string" && raw.trim() !== "" ? raw.trim() : "full";
  if (format !== "full" && format !== "mini") throw new Error(`unknown puzzle format "${format}"`);
  // Both formats can carry a Rainbow. Only Mini requires it to take exactly
  // one answer per category — Full keeps its original looser rule, so an
  // existing Full puzzle can never be invalidated. See migration
  // 20260924000000.
  return format === "mini"
    ? { format, cats: 3, per: 3, tiles: 9, firstDiff: 2, hasRainbow: true, rainbowOnePerCategory: true }
    : { format, cats: 4, per: 4, tiles: 16, firstDiff: 1, hasRainbow: true, rainbowOnePerCategory: false };
}

export function canonicalizePuzzleContent(raw: unknown): FakeRow {
  const content = (raw ?? {}) as Record<string, unknown>;
  const blankToNull = (v: unknown): string | null => {
    const t = typeof v === "string" ? v.trim() : "";
    return t === "" ? null : t;
  };

  const f = formatRules(content.format);

  const groups = content.groups;
  if (!Array.isArray(groups) || groups.length !== f.cats) {
    throw new Error(`a ${f.format} puzzle must contain exactly ${f.cats} groups`);
  }

  const all: string[] = [];
  const diffs: number[] = [];
  const outGroups = groups.map((g, index) => {
    const group = (g ?? {}) as Record<string, unknown>;
    const category = typeof group.category === "string" ? group.category.trim() : "";
    if (category === "") throw new Error(`group ${index + 1} needs a category name`);
    const difficulty = Number(group.difficulty);
    if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 4) {
      throw new Error(`group ${index + 1} needs a difficulty between 1 and 4`);
    }
    // A format restricted to a SUBSET of the ladder must use only its own
    // colours (Mini is Green/Blue/Red = 2, 3, 4). Full keeps its original
    // rule -- any difficulty 1-4, in any group order -- unchanged.
    if (f.firstDiff > 1 && (difficulty < f.firstDiff || difficulty > f.firstDiff + f.cats - 1)) {
      throw new Error(`a ${f.format} puzzle needs difficulties between ${f.firstDiff} and ${f.firstDiff + f.cats - 1} (group ${index + 1} has ${difficulty})`);
    }
    diffs.push(difficulty);
    const words = group.words;
    if (!Array.isArray(words) || words.length !== f.per) {
      throw new Error(`group ${index + 1} needs exactly ${f.per} words`);
    }
    for (const w of words) {
      if (typeof w !== "string" || w.trim() === "") {
        throw new Error(`group ${index + 1} contains an empty word`);
      }
      all.push(w);
    }
    const emoji = blankToNull(group.category_emoji);
    if (emoji !== null && emoji.length > 40) throw new Error(`group ${index + 1} Category Emoji is too long`);
    return {
      category,
      words: [...(words as string[])],
      difficulty,
      hint_word: blankToNull(group.hint_word),
      // Positional, exactly as the SQL assigns it.
      sort_order: index,
      // Emitted ONLY when set, like validate_puzzle_content, so an older puzzle
      // canonicalises unchanged and never mints a spurious version.
      ...(emoji !== null ? { category_emoji: emoji } : {}),
    };
  });

  if (new Set(all).size !== f.tiles) throw new Error(`a ${f.format} puzzle needs ${f.tiles} unique words`);

  if (f.firstDiff > 1 && new Set(diffs).size !== f.cats) {
    throw new Error(`a ${f.format} puzzle needs one category per colour`);
  }

  const herringRaw = content.rainbow_herring;
  let herring: string[] | null = null;
  if (herringRaw !== null && herringRaw !== undefined) {
    if (!f.hasRainbow) throw new Error(`a ${f.format} puzzle cannot have a Rainbow category`);
    if (!Array.isArray(herringRaw) || herringRaw.length !== f.cats) {
      throw new Error(`rainbow_herring must have exactly ${f.cats} words`);
    }
    for (const w of herringRaw) {
      if (!all.includes(w as string)) {
        throw new Error(`rainbow_herring word "${w}" is not one of this puzzle's ${f.tiles} words`);
      }
    }
    // One answer per category, where the format requires it (Mini). The
    // length check above only proves the Rainbow is the right SIZE; without
    // this, three answers all from the Red category would pass.
    if (f.rainbowOnePerCategory) {
      for (let i = 0; i < f.cats; i++) {
        const groupWords = ((groups[i] as Record<string, unknown>).words ?? []) as string[];
        const hits = (herringRaw as string[]).filter((w) => groupWords.includes(w)).length;
        if (hits !== 1) {
          throw new Error(`group ${i + 1} must contribute exactly one Rainbow answer (got ${hits})`);
        }
      }
    }
    herring = [...(herringRaw as string[])];
  }

  if (!f.hasRainbow && (blankToNull(content.rainbow_category_name) !== null
      || blankToNull(content.rainbow_hint_word) !== null
      || blankToNull(content.rainbow_category_emoji) !== null)) {
    throw new Error(`a ${f.format} puzzle cannot have Rainbow category details`);
  }

  const orderRaw = content.word_order;
  let order: string[] | null = null;
  if (orderRaw !== null && orderRaw !== undefined) {
    if (!Array.isArray(orderRaw) || orderRaw.length !== f.tiles) {
      throw new Error(`word_order must list all ${f.tiles} words`);
    }
    for (const w of orderRaw) {
      if (!all.includes(w as string)) {
        throw new Error(`word_order word "${w}" is not one of this puzzle's ${f.tiles} words`);
      }
    }
    order = [...(orderRaw as string[])];
  }

  // Fixed key order, so JSON.stringify of two canonical forms is the same
  // exact-equality test jsonb comparison gives the real function. Full emits
  // NO format key, so an existing puzzle canonicalises byte-identically and
  // re-saving it unchanged still mints no new version.
  return {
    ...(f.format === "full" ? {} : { format: f.format }),
    groups: outGroups,
    word_order: order,
    rainbow_herring: herring,
    rainbow_category_name: blankToNull(content.rainbow_category_name),
    rainbow_hint_word: blankToNull(content.rainbow_hint_word),
    theme: blankToNull(content.theme),
    is_emoji_puzzle: content.is_emoji_puzzle === true,
    // Mirrors coalesce((_content ->> 'alphabetize_completed')::boolean, true)
    // in validate_puzzle_content: missing/non-boolean input defaults true.
    alphabetize_completed: content.alphabetize_completed !== false,
    ...(() => {
      const e = blankToNull(content.rainbow_category_emoji);
      if (e !== null && e.length > 40) throw new Error("Rainbow Category Emoji is too long");
      return e !== null ? { rainbow_category_emoji: e } : {};
    })(),
  };
}

/**
 * Column defaults, mirroring the migrated schema.
 *
 * These matter for correctness, not convenience: `bonus_rainbow_attempted`
 * and `is_official` are NOT NULL with a default of false, so a real row read
 * back always has a boolean there. Without modelling that, a test would see
 * `undefined` and could pass or fail for reasons the production database
 * would never reproduce.
 *
 * Applied only when the insert does not mention the column, exactly as a SQL
 * DEFAULT behaves — an explicit null stays null.
 */
/**
 * NOT NULL ... DEFAULT columns, as a READ sees them.
 *
 * Distinct from COLUMN_DEFAULTS below, which models what an INSERT stores. A
 * column added by a later migration with NOT NULL DEFAULT 'x' is never null
 * on an existing row — Postgres materialises the default for every row that
 * predates it. Modelling that lets a fixture represent a genuinely
 * pre-migration row by simply OMITTING the column, which is exactly what the
 * "existing Full rows have no explicit format" cases exercise.
 */
const NOT_NULL_DEFAULTS: Record<string, FakeRow> = {
  puzzles: { format: "full" },
  game_sessions: { format: "full" },
  user_streaks: { format: "full" },
};

const COLUMN_DEFAULTS: Record<string, FakeRow> = {
  game_sessions: {
    status: "in_progress",
    // Nullable with no default: "not pinned" is a real, truthful state for a
    // legacy session, and is never backfilled with a version nobody knows
    // was played.
    puzzle_version_id: null,
    is_official: false,
    bonus_rainbow_attempted: false,
    found_rainbow: false,
    hints_used: false,
    rainbow_source: null,
    won: null,
  },
};

/**
 * validate_custom_puzzle_content(), mirrored — see the 20260919000000
 * migration. Distinct from canonicalizePuzzleContent above: enforces
 * one-Rainbow-answer-PER-GROUP (not just 4-of-16 anywhere) and rejects any
 * Rainbow content on a classic puzzle. Throws on invalid content, exactly as
 * the SQL raises.
 */
export function canonicalizeCustomPuzzleContent(raw: unknown): FakeRow {
  const content = (raw ?? {}) as Record<string, unknown>;
  const blankToNull = (v: unknown): string | null => {
    const t = typeof v === "string" ? v.trim() : "";
    return t === "" ? null : t;
  };

  const f = formatRules(content.format);

  const mode = content.mode;
  if (mode !== "classic" && mode !== "rainbow") {
    throw new Error("mode must be classic or rainbow");
  }
  // CUSTOM puzzles keep their own rule, independent of the official one: a
  // custom Mini cannot be a Rainbow. validate_custom_puzzle_content computes
  // its OWN _has_rainbow (see 20260923000000) and migration 20260924000000
  // deliberately did not touch it, because Custom Mini creation is still
  // switched off. Mirroring f.hasRainbow here instead would make this fake
  // accept a payload the real database rejects.
  if (mode === "rainbow" && f.format === "mini") {
    throw new Error(`a ${f.format} puzzle cannot be a Rainbow puzzle`);
  }

  const groups = content.groups;
  if (!Array.isArray(groups) || groups.length !== f.cats) {
    throw new Error(`a ${f.format} puzzle must contain exactly ${f.cats} groups`);
  }

  const all: string[] = [];
  const groupWords: string[][] = [];
  const outGroups = groups.map((g, index) => {
    const group = (g ?? {}) as Record<string, unknown>;
    const category = typeof group.category === "string" ? group.category.trim() : "";
    if (category === "") throw new Error(`group ${index + 1} needs a category name`);
    if (category.length > 80) throw new Error(`group ${index + 1} category name is too long`);
    const words = group.words;
    if (!Array.isArray(words) || words.length !== f.per) {
      throw new Error(`group ${index + 1} needs exactly ${f.per} answers`);
    }
    const thisGroupWords: string[] = [];
    for (const w of words) {
      if (typeof w !== "string" || w.trim() === "") {
        throw new Error(`group ${index + 1} contains an empty answer`);
      }
      if (w.length > 40) throw new Error(`group ${index + 1} has an answer that is too long`);
      all.push(w);
      thisGroupWords.push(w);
    }
    groupWords.push(thisGroupWords);
    // Length-checked here, but NOT checked for duplication yet: `all` only
    // holds groups 0..index so far. Checking here was a real bug in the SQL
    // this mirrors (fixed in 20260919000000) -- it let group 0's hint
    // duplicate a word from group 2 or 3 undetected, since those words
    // weren't in `all` yet at this point. See the dedicated pass below.
    const hint = blankToNull(group.hint_word as string | undefined);
    if (hint !== null && hint.length > 40) throw new Error(`group ${index + 1} Small Hint is too long`);
    const emoji = blankToNull(group.category_emoji as string | undefined);
    if (emoji !== null && emoji.length > 40) throw new Error(`group ${index + 1} Category Emoji is too long`);
    return {
      category,
      words: [...(words as string[])],
      hint_word: hint,
      sort_order: index,
      ...(emoji !== null ? { category_emoji: emoji } : {}),
    };
  });

  if (new Set(all.map((w) => w.toUpperCase())).size !== f.tiles) {
    throw new Error(`a ${f.format} puzzle needs ${f.tiles} unique answers`);
  }

  // Now that `all` holds every board answer, check every group's hint
  // against the COMPLETE board -- not just the groups seen before it.
  outGroups.forEach((g, index) => {
    if (g.hint_word && all.some((w) => w.toUpperCase() === (g.hint_word as string).toUpperCase())) {
      throw new Error(`group ${index + 1} Small Hint cannot duplicate a board answer`);
    }
  });

  const herringRaw = content.rainbow_herring;
  let herring: string[] | null =
    herringRaw === null || herringRaw === undefined ? null : (herringRaw as string[]);

  if (mode === "classic") {
    if (herring !== null) throw new Error("classic puzzles cannot include a Rainbow selection");
  } else {
    if (!Array.isArray(herring) || herring.length !== f.cats) {
      throw new Error(`a Rainbow puzzle needs exactly one selected answer from each of the ${f.cats} groups`);
    }
    for (let i = 0; i < f.cats; i++) {
      const hits = herring.filter((hw) =>
        groupWords[i].some((gw) => gw.toUpperCase() === (hw as string).toUpperCase())
      ).length;
      if (hits !== 1) {
        throw new Error(`group ${i + 1} must contribute exactly one Rainbow answer (got ${hits})`);
      }
    }
  }

  const orderRaw = content.word_order;
  if (!Array.isArray(orderRaw) || orderRaw.length !== f.tiles) {
    throw new Error("a starting board order is required");
  }
  for (const w of orderRaw) {
    if (!all.some((x) => x.toUpperCase() === (w as string).toUpperCase())) {
      throw new Error(`starting board answer "${w}" is not one of this puzzle's ${f.tiles} answers`);
    }
  }

  return {
    // Full emits no format key — see canonicalizePuzzleContent.
    ...(f.format === "full" ? {} : { format: f.format }),
    mode,
    groups: outGroups,
    word_order: [...(orderRaw as string[])],
    rainbow_herring: herring ? [...herring] : null,
    rainbow_category_name: mode === "rainbow" ? blankToNull(content.rainbow_category_name) : null,
    rainbow_hint_word: mode === "rainbow" ? blankToNull(content.rainbow_hint_word) : null,
    alphabetize_completed: content.alphabetize_completed !== false,
    ...(() => {
      const e = blankToNull(content.rainbow_category_emoji);
      if (e !== null && e.length > 40) throw new Error("Rainbow Category Emoji is too long");
      return e !== null ? { rainbow_category_emoji: e } : {};
    })(),
  };
}

/**
 * The `format` a stored row declares — absent/null means "full", exactly as
 * the NOT NULL DEFAULT 'full' columns the Mini migration adds behave for
 * every row that predates them.
 */
function rowFormat(row: FakeRow | undefined | null): string {
  const v = row?.format;
  return v === "mini" || v === "full" ? v : "full";
}

/** The `_format` RPC argument, defaulting to "full" like the SQL default. */
function argFormat(args: Record<string, unknown>): string {
  const v = args._format;
  return v === "mini" || v === "full" ? v : "full";
}

export class FakeSupabase {
  tables: FakeTables = {
    game_sessions: [],
    guess_events: [],
    hint_events: [],
    game_results: [],
    user_streaks: [],
    puzzles: [],
    /** The live read path the game still loads a board from. */
    puzzle_groups: [],
    /** Immutable content snapshots; one of them is a puzzle's current version. */
    puzzle_versions: [],
    /** Private per-device credentials (device_id, token_hash, retired_at). */
    device_identities: [],
    /** The one-time onboarding decision, one row per account. */
    account_onboarding: [],
    /** Site-wide play counters — the "100 stays 100" invariant lives here. */
    puzzle_aggregates: [],
    /** Beta-only playtest summaries — never game_sessions. See 20260918020000. */
    beta_playtests: [],
    /** Beta-only feedback forms. */
    beta_feedback: [],
    /** Public player-created puzzles (20260919000000). Immutable after creation. */
    custom_puzzles: [],
    /** One row per (custom_puzzle, device) that finished a game. */
    custom_puzzle_results: [],
    /** One fixed-size aggregate counter row per custom puzzle — 20260921000000. */
    custom_puzzle_stats: [],
    /** One favorite per (account, custom puzzle) — 20260920000000. */
    custom_puzzle_favorites: [],
    /** Public creator slug for signed-in creators — 20260920000000. */
    creator_profiles: [],
  };

  /**
   * Short codes the next create_custom_puzzle draws will use, first to last,
   * before falling back to random ones. Lets a test force collisions to prove
   * the retry loop (the real loop is exercised on real Postgres separately).
   */
  shortCodeQueue: string[] = [];
  /** How many short codes create_custom_puzzle has drawn (retries included). */
  shortCodeDraws = 0;

  private _drawShortCode(): string {
    this.shortCodeDraws += 1;
    const queued = this.shortCodeQueue.shift();
    if (queued) return queued;
    const alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz";
    let out = "";
    for (let i = 0; i < 10; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
    return out;
  }

  /** The single safe public shape (custom_puzzle_public_json), shared by both lookups. */
  private _publicPuzzleJson(p: FakeRow, uid: string | null): FakeRow {
    const profile = this.tables.creator_profiles.find((c) => c.user_id === p.created_by);
    const favs = this.tables.custom_puzzle_favorites.filter((x) => x.custom_puzzle_id === p.id);
    return {
      id: p.id,
      share_id: p.share_id,
      short_code: p.short_code,
      title: p.title,
      creator_name: p.creator_name,
      visibility: p.visibility,
      content: p.content,
      creator_slug: profile ? profile.public_slug : null,
      favorite_count: favs.length,
      favorited_by_me: uid !== null && favs.some((x) => x.user_id === uid),
    };
  }

  /** Every write, in order — lets tests assert on write VOLUME, not just state. */
  writeLog: { table: string; op: "insert" | "update" | "upsert" | "rpc" }[] = [];

  private idCounter = 0;
  private authUser: { id: string } | null = null;

  auth = {
    getUser: async () => ({ data: { user: this.authUser } }),
  };

  /**
   * Tables whose direct SELECT is restricted by the durable-session
   * migration's RLS policies.
   *
   * Modelled so the tests can prove the CLIENT never depends on reads that
   * production will refuse. This is a model of the policies, not the policies
   * themselves — the SQL is verified separately, after it is applied.
   */
  private static readonly RLS_READ_PROTECTED = [
    "game_sessions",
    "guess_events",
    "hint_events",
    // user_streaks lost every direct policy in the cutover migration. It used
    // to be world-readable, which is what let anyone enumerate device ids.
    "user_streaks",
    "device_identities",
    "account_onboarding",
    // Admin-only direct SELECT (see the 20260918020000 migration's RLS
    // policies) — no policy at all for anon/authenticated non-admin, which
    // the generic fallback below happens to model correctly: neither table
    // has a game_session_id to match against ownSessionIds, so a non-admin
    // caller always gets [] regardless of identity.
    "beta_playtests",
    "beta_feedback",
    // Admin-only direct SELECT (20260919000000) — everyone else reads
    // exclusively through get_custom_puzzle.
    "custom_puzzles",
    // No SELECT policy at all, not even for admins — read only in
    // aggregate, via get_custom_puzzle_stats.
    "custom_puzzle_results",
    "custom_puzzle_stats",
    // No policies at all (20260920000000): reachable only through the RPCs.
    "custom_puzzle_favorites",
    "creator_profiles",
  ];

  /** True when the caller is an admin, which unlocks the admin SELECT policies. */
  isAdmin = false;

  /**
   * Fault injection for the required completion effects.
   *
   * Set to N to make the next N aggregate writes inside finalize_game_session
   * throw. Models a database-side failure so the tests can prove what the
   * real function now guarantees: the whole completion rolls back, rather
   * than leaving a finished session with no play counted.
   */
  failAggregateWrites = 0;

  /**
   * Makes EVERY rpc answer as though the function is not in the schema cache
   * (PostgREST's PGRST202), which is what the whole app sees during the
   * frontend-first deployment window, and what an unreachable database looks
   * like. Used to prove the puzzle stays playable and nothing is recorded.
   */
  rpcUnavailable = false;

  /** Who is signed in right now — lets a test restore the caller it replaced. */
  currentUserId(): string | null {
    return this.authUser?.id ?? null;
  }

  signIn(userId: string | null, opts?: { admin?: boolean }) {
    this.authUser = userId ? { id: userId } : null;
    this.isAdmin = !!opts?.admin;
    // Default a signed-in test user to an already-onboarded ("legacy")
    // account, which is what every pre-cutover account is. Gameplay tests are
    // not about onboarding and must not all trip the pending gate; the tests
    // that DO exercise onboarding set the status explicitly.
    if (userId) this._seedOnboarding(userId, "legacy");
  }

  /**
   * Applies the modelled SELECT policies to a direct table read.
   *
   * anon           -> no rows at all (no anonymous SELECT policy exists)
   * authenticated  -> only rows whose owning session is the caller's own
   * admin          -> everything
   */
  _visibleForRead(table: string, rows: FakeRow[]): FakeRow[] {
    // puzzle_versions is PUZZLE content, not player data: the same audience
    // as puzzle_groups may read the versions of a PUBLISHED puzzle, which is
    // exactly what a resuming player needs. Drafts stay admin-only.
    if (table === "puzzle_versions") {
      if (this.isAdmin) return rows;
      const published = new Set(
        this.tables.puzzles.filter((p) => p.is_published === true).map((p) => p.id)
      );
      return rows.filter((r) => published.has(r.puzzle_id));
    }
    if (!FakeSupabase.RLS_READ_PROTECTED.includes(table)) return rows;
    // These three are reachable ONLY through SECURITY DEFINER functions now;
    // no role has a SELECT policy on them, not even an admin.
    if (["user_streaks", "device_identities", "account_onboarding", "custom_puzzle_results", "custom_puzzle_stats", "custom_puzzle_favorites", "creator_profiles"].includes(table)) return [];
    if (this.isAdmin) return rows;
    const uid = this.authUser?.id;
    if (!uid) return [];
    if (table === "game_sessions") return rows.filter((r) => r.user_id === uid);
    const ownSessionIds = new Set(
      this.tables.game_sessions.filter((s) => s.user_id === uid).map((s) => s.id)
    );
    return rows.filter((r) => ownSessionIds.has(r.game_session_id));
  }

  /**
   * The SECURITY DEFINER functions from migration section 6.
   *
   * They bypass RLS by design, which is the whole point: each answers one
   * narrow question about the caller's own data, requiring the caller to
   * SUPPLY the device_id, and none of them can be used to browse the table.
   * The ownership predicate and the device_id <> 'unknown' exclusion are
   * mirrored exactly from the SQL.
   */
  /** Every RPC call, read-only ones included. */
  rpcLog: string[] = [];
  /**
   * The same calls WITH their arguments.
   *
   * Kept beside rpcLog rather than replacing it: many suites assert on
   * rpcLog as a plain list of names. This one exists so a test can check
   * what a call actually ASKED FOR — e.g. that the Mini archive requests
   * `_format: "mini"` sessions and the Full archive does not.
   */
  rpcCallLog: { name: string; args: Record<string, unknown> }[] = [];

  rpc = async (name: string, args: Record<string, unknown> = {}) => {
    this.rpcLog.push(name);
    this.rpcCallLog.push({ name, args });
    if (this.rpcUnavailable) {
      return {
        data: null,
        error: {
          code: "PGRST202",
          message: `Could not find the function public.${name} in the schema cache`,
        },
      };
    }
    // Only MUTATING functions count as writes. has_official_result and
    // friends are reads that merely happen to be delivered as functions,
    // and counting them here would make the write-volume assertions — and
    // the "a page view writes nothing" guarantee — quietly wrong.
    // create_game_session records itself as a game_sessions INSERT below,
    // since writeLog describes WHICH TABLE was written rather than how the
    // write was delivered.
    const uid = this.authUser?.id ?? null;
    const deviceId = args._device_id as string | undefined;
    const deviceToken = args._device_token as string | undefined;
    const deviceProven = this._verifyDevice(deviceId, deviceToken);
    // Ownership for own-data reads. The ACCOUNT branch is deliberately
    // independent of the device check: history imported into an account must
    // stay visible after its source device is retired.
    const ownsRow = (r: FakeRow) =>
      (uid !== null && r.user_id === uid) ||
      (deviceProven && r.user_id == null && r.device_id === deviceId);
    const completed = (r: FakeRow) => r.status === "won" || r.status === "lost";

    switch (name) {
      case "create_device_identity": {
        const newId = `device-${this._newId()}`;
        const token = `token-${this._newId()}`;
        this._seedDeviceIdentity(newId, token);
        return { data: [{ device_id: newId, device_token: token }], error: null };
      }
      case "resolve_onboarding": {
        if (uid === null) {
          return { data: [{ outcome: "unauthenticated", status: null, games_played: 0, current_streak: 0, longest_streak: 0 }], error: null };
        }
        let row = this.tables.account_onboarding.find((r) => r.user_id === uid);
        if (!row) {
          // No row means the account did not exist at cutover, so it is new.
          this._seedOnboarding(uid, "pending");
          row = this.tables.account_onboarding.find((r) => r.user_id === uid)!;
        }
        const resolved = (outcome: string, extra: Record<string, unknown> = {}) => ({
          data: [{ outcome, status: row!.status, games_played: 0, current_streak: 0, longest_streak: 0, ...extra }],
          error: null,
        });
        if (row.status !== "pending") return resolved("already_resolved");

        if (!deviceId || !deviceToken || deviceId === "unknown") {
          row.status = "no_guest_history";
          row.decided_at = new Date().toISOString();
          return resolved("no_guest_history");
        }
        if (!deviceProven) {
          // Fails closed: the one-time opportunity is NOT consumed, and the
          // answer says nothing about whether that history exists.
          return resolved("credential_invalid");
        }

        const hasHistory =
          this.tables.game_sessions.some(
            (r) =>
              r.device_id === deviceId &&
              r.user_id == null &&
              (completed(r) ||
                this.tables.guess_events.some((g) => g.game_session_id === r.id) ||
                this.tables.hint_events.some((h) => h.game_session_id === r.id) ||
                ((r.mistakes as number) ?? 0) > 0)
          ) ||
          this.tables.user_streaks.some(
            (s) =>
              s.device_id === deviceId &&
              s.user_id == null &&
              (((s.current_streak as number) ?? 0) > 0 ||
                ((s.longest_streak as number) ?? 0) > 0 ||
                s.last_played_date != null)
          );

        if (!hasHistory) {
          row.status = "no_guest_history";
          row.decided_at = new Date().toISOString();
          return resolved("no_guest_history");
        }

        const games = this.tables.game_sessions.filter(
          (r) => r.device_id === deviceId && r.user_id == null && completed(r)
        ).length;
        const streak = this.tables.user_streaks
          .filter((s) => s.device_id === deviceId && s.user_id == null)
          .sort((a, b) => ((b.longest_streak as number) ?? 0) - ((a.longest_streak as number) ?? 0))[0];
        return resolved("import_available", {
          games_played: games,
          current_streak: (streak?.current_streak as number) ?? 0,
          longest_streak: (streak?.longest_streak as number) ?? 0,
        });
      }
      case "import_guest_history": {
        if (uid === null) return { data: [{ outcome: "unauthenticated", sessions_claimed: 0 }], error: null };
        if (!deviceProven) return { data: [{ outcome: "credential_invalid", sessions_claimed: 0 }], error: null };

        const onboarding = this.tables.account_onboarding.find((r) => r.user_id === uid);
        // The one-time compare-and-swap. Anything other than pending — an
        // existing account, a second tab that already decided, a replay of
        // this call — is a no-op, not an error.
        if (!onboarding || onboarding.status !== "pending") {
          return { data: [{ outcome: "already_resolved", sessions_claimed: 0 }], error: null };
        }
        onboarding.status = "imported";
        onboarding.decided_at = new Date().toISOString();
        onboarding.source_device_id = deviceId;

        // Ownership transfer IN PLACE: same rows, same ids, nothing created.
        const preClaim = this.tables.game_sessions.map((r) => ({ ...r }));
        const accountHasOfficial = (puzzleId: unknown) =>
          preClaim.some(
            (o) => o.puzzle_id === puzzleId && o.user_id === uid && completed(o) && o.is_official === true
          );
        let claimed = 0;
        for (const r of this.tables.game_sessions) {
          if (r.user_id == null && r.device_id === deviceId) {
            if (r.is_official === true && accountHasOfficial(r.puzzle_id)) r.is_official = false;
            r.user_id = uid;
            claimed++;
          }
        }

        // The streak record changes owner; it is never summed or reset.
        if (!this.tables.user_streaks.some((s) => s.user_id === uid)) {
          const best = this.tables.user_streaks
            .filter((s) => s.device_id === deviceId && s.user_id == null)
            .sort((a, b) => ((b.longest_streak as number) ?? 0) - ((a.longest_streak as number) ?? 0))[0];
          if (best) best.user_id = uid;
        }

        const identity = this.tables.device_identities.find((d) => d.device_id === deviceId);
        if (identity) {
          identity.retired_at = new Date().toISOString();
          identity.retired_reason = "imported";
        }

        this._log("game_sessions", "update");
        return { data: [{ outcome: "imported", sessions_claimed: claimed }], error: null };
      }
      case "decline_guest_history": {
        if (uid === null) return { data: [{ outcome: "unauthenticated" }], error: null };
        const onboarding = this.tables.account_onboarding.find((r) => r.user_id === uid);
        if (!onboarding || onboarding.status !== "pending") {
          return { data: [{ outcome: "already_resolved" }], error: null };
        }
        onboarding.status = "started_fresh";
        onboarding.decided_at = new Date().toISOString();
        onboarding.source_device_id = deviceProven ? deviceId : null;
        // Declining imports nothing and deletes nothing: the gameplay rows
        // stay exactly where they are, still counted site-wide.
        if (deviceProven) {
          const identity = this.tables.device_identities.find((d) => d.device_id === deviceId);
          if (identity) {
            identity.retired_at = new Date().toISOString();
            identity.retired_reason = "started_fresh";
          }
        }
        return { data: [{ outcome: "started_fresh" }], error: null };
      }
      case "get_own_streak": {
        // Absent _format means full — the SQL default, and what every client
        // that predates Mini sends.
        const fmt = argFormat(args);
        const pick = (rows: FakeRow[]) =>
          rows.sort((a, b) => ((b.longest_streak as number) ?? 0) - ((a.longest_streak as number) ?? 0))[0];
        const inFormat = (r: FakeRow) => rowFormat(r) === fmt;
        const row =
          uid !== null
            ? pick(this.tables.user_streaks.filter((s) => s.user_id === uid && inFormat(s)))
            : deviceProven
              ? pick(this.tables.user_streaks.filter((s) => s.device_id === deviceId && s.user_id == null && inFormat(s)))
              : undefined;
        if (!row) return { data: [], error: null };
        return {
          data: [{
            current_streak: (row.current_streak as number) ?? 0,
            longest_streak: (row.longest_streak as number) ?? 0,
            last_played_date: row.last_played_date ?? null,
          }],
          error: null,
        };
      }
      case "get_streak_admin_summary": {
        if (!this.isAdmin) return { data: [], error: null };
        const rows = this.tables.user_streaks;
        return {
          data: [{
            accounts_with_streaks: rows.filter((r) => r.user_id != null).length,
            max_current_streak: Math.max(0, ...rows.map((r) => (r.current_streak as number) ?? 0)),
            max_longest_streak: Math.max(0, ...rows.map((r) => (r.longest_streak as number) ?? 0)),
          }],
          error: null,
        };
      }
      // ── The single, atomic admin write path ──
      //
      // Mirrors admin_save_puzzle(): one transaction that rewrites the live
      // puzzle_groups AND writes the immutable snapshot, so the current
      // puzzle can never be observed holding half-old and half-new groups.
      case "admin_save_puzzle": {
        // Authorization is checked INSIDE the function in the real thing
        // too, precisely so it does not depend on the Admin UI hiding a
        // button from anyone.
        if (uid === null || !this.isAdmin) {
          return {
            data: null,
            error: { code: "42501", message: "admin role required to save puzzles" },
          };
        }

        let canonical: FakeRow;
        try {
          canonical = canonicalizePuzzleContent(args._content);
        } catch (err) {
          return {
            data: null,
            error: { code: "22023", message: (err as Error).message },
          };
        }

        const metadata = (args._metadata ?? {}) as Record<string, unknown>;
        if (!metadata.date) {
          return { data: null, error: { code: "22023", message: "a puzzle needs a date" } };
        }

        // The format comes from the CANONICAL CONTENT, already validated —
        // one source, so a save cannot claim one format while submitting
        // another format's groups.
        const canonicalFormat = (canonical.format as string | undefined) ?? "full";
        const contentColumns = {
          format: canonicalFormat,
          word_order: canonical.word_order,
          rainbow_herring: canonical.rainbow_herring,
          rainbow_category_name: canonical.rainbow_category_name,
          rainbow_hint_word: canonical.rainbow_hint_word,
          theme: canonical.theme,
          is_emoji_puzzle: canonical.is_emoji_puzzle,
          alphabetize_completed: canonical.alphabetize_completed,
          rainbow_category_emoji: (canonical.rainbow_category_emoji as string | undefined) ?? null,
        };
        // Mirrors admin_save_puzzle's `coalesce(nullif(btrim(...), ''), 'Sam
        // West')`: trimmed, and never blank -- clearing the field in the
        // Admin form reverts to the official default rather than saving an
        // empty name.
        const rawDesignerName = typeof metadata.designer_name === "string" ? metadata.designer_name.trim() : "";
        const metadataColumns = {
          date: metadata.date,
          title: metadata.title ?? null,
          is_published: metadata.is_published === true,
          is_beta: metadata.is_beta === true,
          designer_name: rawDesignerName || "Sam West",
          emoji_puzzle_icon: metadata.emoji_puzzle_icon ?? null,
          is_free_puzzle: metadata.is_free_puzzle === true,
          free_puzzle_order: metadata.free_puzzle_order ?? null,
        };

        // Mirrors the puzzles_not_beta_and_published CHECK constraint.
        if (metadataColumns.is_published && metadataColumns.is_beta) {
          return {
            data: null,
            error: { code: "23514", message: "new row for relation \"puzzles\" violates check constraint \"puzzles_not_beta_and_published\"" },
          };
        }

        let pid = (args._puzzle_id as string | null) ?? null;
        // A puzzle's format is fixed for life: its stored groups, its
        // players' pinned boards and its statistics all assume one shape.
        if (pid !== null) {
          const existingRow = this.tables.puzzles.find((p) => p.id === pid);
          if (existingRow && rowFormat(existingRow) !== canonicalFormat) {
            return {
              data: null,
              error: { code: "22023", message: "a puzzle cannot change format after it is created" },
            };
          }
        }
        let puzzleRow: FakeRow;
        if (pid === null) {
          pid = this._newId();
          puzzleRow = {
            id: pid,
            created_by: uid,
            current_version_id: null,
            ...metadataColumns,
            ...contentColumns,
          };
          this.tables.puzzles.push(puzzleRow);
        } else {
          const existing = this.tables.puzzles.find((p) => p.id === pid);
          if (!existing) {
            return { data: null, error: { code: "P0002", message: `puzzle ${pid} does not exist` } };
          }
          puzzleRow = existing;
          Object.assign(puzzleRow, metadataColumns, contentColumns);
        }
        this._log("puzzles", "update");

        const currentVersion = this.tables.puzzle_versions.find(
          (v) => v.id === puzzleRow.current_version_id
        );

        // THE versioning decision, and the only one: canonical content
        // equality. A metadata-only edit and a re-save of untouched content
        // both land here unchanged and create nothing.
        let versionId = (currentVersion?.id as string | undefined) ?? null;
        let createdVersion = false;
        if (
          !currentVersion ||
          JSON.stringify(currentVersion.content) !== JSON.stringify(canonical)
        ) {
          const next =
            Math.max(
              0,
              ...this.tables.puzzle_versions
                .filter((v) => v.puzzle_id === pid)
                .map((v) => (v.version_number as number) ?? 0)
            ) + 1;
          // The (puzzle_id, version_number) unique index, which is what
          // stops a concurrent save or a retry from minting a second row
          // that also calls itself Version N.
          if (
            this.tables.puzzle_versions.some(
              (v) => v.puzzle_id === pid && v.version_number === next
            )
          ) {
            return {
              data: null,
              error: { code: "23505", message: "duplicate key value violates unique constraint" },
            };
          }
          versionId = this._newId();
          this.tables.puzzle_versions.push({
            id: versionId,
            puzzle_id: pid,
            version_number: next,
            content: canonical,
            created_by: uid,
            created_at: new Date().toISOString(),
          });
          puzzleRow.current_version_id = versionId;
          createdVersion = true;
          this._log("puzzle_versions", "insert");
        }

        // The live read path, rewritten in the SAME transaction. Still a
        // delete-and-reinsert, but now atomic: no reader can see the gap
        // that used to leave an edited puzzle briefly wordless.
        this.tables.puzzle_groups = this.tables.puzzle_groups.filter(
          (g) => g.puzzle_id !== pid
        );
        for (const g of canonical.groups as FakeRow[]) {
          this.tables.puzzle_groups.push({
            id: this._newId(),
            puzzle_id: pid,
            category: g.category,
            words: g.words,
            difficulty: g.difficulty,
            sort_order: g.sort_order,
            hint_word: g.hint_word,
            category_emoji: (g.category_emoji as string | undefined) ?? null,
          });
        }
        this._log("puzzle_groups", "upsert");

        const versionRow = this.tables.puzzle_versions.find((v) => v.id === versionId);
        return {
          data: {
            puzzle_id: pid,
            version_id: versionId,
            version_number: (versionRow?.version_number as number) ?? null,
            created_version: createdVersion,
            format: canonicalFormat,
          },
          error: null,
        };
      }
      case "create_game_session": {
        // Every gameplay write now comes from a proven device.
        if (!deviceProven) return { data: null, error: null };
        // Mirrors 20260918030000: the ONLY insert path into game_sessions
        // for anon/authenticated, so this is what actually keeps a Draft or
        // Beta puzzle (is_published = false either way) from ever getting an
        // official session — independent of which RPC the frontend happens
        // to call.
        const targetPuzzle = this.tables.puzzles.find((p) => p.id === args._puzzle_id);
        if (!targetPuzzle || targetPuzzle.is_published !== true) {
          return { data: null, error: null };
        }
        // The onboarding gate, server-side. A signed-in account whose
        // decision has not resolved cannot create a session, and therefore
        // cannot accumulate account-owned gameplay, stats or streak. Fails
        // CLOSED when no row exists at all.
        if (uid !== null) {
          const onboarding = this.tables.account_onboarding.find((r) => r.user_id === uid);
          if (!onboarding || onboarding.status === "pending") {
            return { data: null, error: null };
          }
        }
        // The version pin, supplied by the client because only the client
        // knows which board it actually rendered — the point of the whole
        // race this feature handles. Supplying it is not being trusted with
        // it: a snapshot belonging to a DIFFERENT puzzle is refused outright
        // rather than quietly stored or dropped to null. It is deliberately
        // NOT required to be the current version.
        const versionId = (args._puzzle_version_id as string | null) ?? null;
        if (versionId !== null) {
          const version = this.tables.puzzle_versions.find((v) => v.id === versionId);
          if (!version || String(version.puzzle_id) !== String(args._puzzle_id)) {
            return {
              data: null,
              error: {
                code: "23503",
                message: `puzzle version ${versionId} does not belong to puzzle ${String(args._puzzle_id)}`,
              },
            };
          }
        }
        const row = this._withDefaults("game_sessions", {
          id: this._newId(),
          puzzle_id: args._puzzle_id,
          // Copied from the PUZZLE, never asserted by the caller — the same
          // rule create_game_session enforces.
          format: rowFormat(targetPuzzle),
          puzzle_version_id: versionId,
          // user_id comes from auth inside the function; the caller has no say.
          user_id: uid,
          device_id: args._device_id,
          entry_context: args._entry_context,
          status: "in_progress",
          won: null,
          completed_at: null,
          started_at: new Date().toISOString(),
          last_activity_at: new Date().toISOString(),
          active_time_seconds: (args._active_time_seconds as number) ?? 0,
          mistakes: (args._mistakes as number) ?? 0,
          found_rainbow: false,
          hints_used: false,
        });
        this.tables.game_sessions.push(row);
        this._log("game_sessions", "insert");
        return { data: row.id as string, error: null };
      }
      case "has_official_result": {
        const found = this.tables.game_sessions.some(
          (r) =>
            r.puzzle_id === args._puzzle_id && completed(r) && r.is_official === true && ownsRow(r)
        );
        return { data: found, error: null };
      }
      // "Global Stats" — everybody who officially completed this puzzle,
      // not "own data" like the reads around it, so deliberately NOT run
      // through ownsRow. Mirrors get_puzzle_stats() reading game_sessions
      // instead of the signed-in-only game_results.
      case "get_puzzle_stats": {
        const rows = this.tables.game_sessions.filter(
          (r) => r.puzzle_id === args._puzzle_id && r.is_official === true && completed(r)
        );
        const mistakesOf = (m: number) =>
          rows.filter((r) => r.won === true && r.mistakes === m).length;
        return {
          data: {
            total_players: rows.length,
            wins: rows.filter((r) => r.won === true).length,
            losses: rows.filter((r) => r.won === false).length,
            guess_distribution: {
              "0": mistakesOf(0),
              "1": mistakesOf(1),
              "2": mistakesOf(2),
              "3": mistakesOf(3),
            },
          },
          error: null,
        };
      }
      case "get_own_completed_sessions": {
        const fmt = argFormat(args);
        const rows = this.tables.game_sessions
          .filter((r) => completed(r) && r.is_official === true && rowFormat(r) === fmt && ownsRow(r))
          .map((r) => ({
            puzzle_id: r.puzzle_id,
            won: r.won,
            mistakes: r.mistakes,
            found_rainbow: r.found_rainbow,
            solve_order: r.solve_order,
            hints_used: r.hints_used,
            rainbow_solve_index: r.rainbow_solve_index,
            rainbow_source: r.rainbow_source ?? null,
            bonus_rainbow_attempted: r.bonus_rainbow_attempted ?? false,
            status: r.status,
          }));
        return { data: rows, error: null };
      }
      case "count_own_anonymous_sessions": {
        if (!deviceProven) return { data: 0, error: null };
        const n = this.tables.game_sessions.filter(
          (r) => r.user_id === null && completed(r) && r.device_id === deviceId
        ).length;
        return { data: n, error: null };
      }
      // ── Beta playtesting RPCs (20260918020000) ──
      // Deliberately separate from every official gameplay case above: none
      // of these touch game_sessions/guess_events/hint_events/game_results/
      // user_streaks/puzzle_aggregates, which is the whole point being
      // proven by the "no official writes" test cases.
      case "start_beta_playtest": {
        if (!deviceProven) return { data: null, error: null };
        const puzzle = this.tables.puzzles.find((p) => p.id === args._puzzle_id);
        if (!puzzle || puzzle.is_beta !== true) return { data: null, error: null };
        const version = this.tables.puzzle_versions.find(
          (v) => v.id === args._puzzle_version_id && v.puzzle_id === args._puzzle_id
        );
        if (!version) return { data: null, error: null };
        const row = {
          id: this._newId(),
          puzzle_id: args._puzzle_id,
          puzzle_version_id: args._puzzle_version_id,
          device_id: args._device_id,
          status: "in_progress",
          won: null,
          mistakes: 0,
          hints_used: false,
          is_reset: false,
          started_at: new Date().toISOString(),
          completed_at: null,
          updated_at: new Date().toISOString(),
        };
        this.tables.beta_playtests.push(row);
        this._log("beta_playtests", "insert");
        return { data: row.id, error: null };
      }
      case "complete_beta_playtest": {
        if (!deviceProven) return { data: false, error: null };
        const row = this.tables.beta_playtests.find(
          (r) =>
            r.id === args._playtest_id &&
            r.device_id === args._device_id &&
            r.status === "in_progress"
        );
        if (!row) return { data: false, error: null };
        Object.assign(row, {
          status: "completed",
          won: args._won,
          mistakes: args._mistakes ?? row.mistakes,
          hints_used: args._hints_used ?? row.hints_used,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        this._log("beta_playtests", "update");
        return { data: true, error: null };
      }
      case "reset_beta_playtest": {
        if (!deviceProven) return { data: false, error: null };
        const candidates = this.tables.beta_playtests
          .filter((r) => r.puzzle_id === args._puzzle_id && r.device_id === args._device_id)
          .sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
        const row = candidates[0];
        if (!row) return { data: false, error: null };
        row.is_reset = true;
        if (row.status === "in_progress") row.status = "abandoned";
        row.completed_at = row.completed_at ?? new Date().toISOString();
        row.updated_at = new Date().toISOString();
        this._log("beta_playtests", "update");
        return { data: true, error: null };
      }
      case "submit_beta_feedback": {
        const puzzle = this.tables.puzzles.find((p) => p.id === args._puzzle_id);
        if (!puzzle || puzzle.is_beta !== true) return { data: null, error: null };
        const version = this.tables.puzzle_versions.find(
          (v) => v.id === args._puzzle_version_id && v.puzzle_id === args._puzzle_id
        );
        if (!version) return { data: null, error: null };
        const funRating = args._fun_rating as number;
        const difficultyRating = args._difficulty_rating as number;
        if (!Number.isInteger(funRating) || funRating < 1 || funRating > 5) {
          return { data: null, error: { code: "22023", message: "fun rating must be between 1 and 5" } };
        }
        if (!Number.isInteger(difficultyRating) || difficultyRating < 1 || difficultyRating > 5) {
          return { data: null, error: { code: "22023", message: "difficulty rating must be between 1 and 5" } };
        }
        let playtestId = (args._playtest_id as string | null) ?? null;
        if (playtestId && !this.tables.beta_playtests.some((r) => r.id === playtestId && r.puzzle_id === args._puzzle_id)) {
          playtestId = null;
        }
        const row = {
          id: this._newId(),
          puzzle_id: args._puzzle_id,
          puzzle_version_id: args._puzzle_version_id,
          playtest_id: playtestId,
          tester_name: (args._tester_name as string | null) ?? null,
          fun_rating: funRating,
          difficulty_rating: difficultyRating,
          rainbow_fairness_rating: (args._rainbow_fairness_rating as number | null) ?? null,
          confusing_or_incorrect: (args._confusing_or_incorrect as string | null) ?? null,
          additional_comments: (args._additional_comments as string | null) ?? null,
          would_play_again: args._would_play_again === true,
          created_at: new Date().toISOString(),
        };
        this.tables.beta_feedback.push(row);
        this._log("beta_feedback", "insert");
        return { data: row.id, error: null };
      }
      case "session_capability_ok": {
        return { data: this._capabilityOk(args._session_id as string, deviceId, deviceToken), error: null };
      }
      case "touch_game_session": {
        if (!this._capabilityOk(args._session_id as string, deviceId, deviceToken)) {
          return { data: false, error: null };
        }
        const row = this.tables.game_sessions.find(
          (r) => r.id === args._session_id && r.status === "in_progress"
        );
        if (!row) return { data: false, error: null };
        row.last_activity_at = new Date().toISOString();
        row.active_time_seconds = args._active_time_seconds ?? row.active_time_seconds;
        row.mistakes = args._mistakes ?? row.mistakes;
        this._log("game_sessions", "update");
        return { data: true, error: null };
      }
      case "finalize_game_session": {
        if (!this._capabilityOk(args._session_id as string, deviceId, deviceToken)) {
          return { data: null, error: null };
        }
        const row = this.tables.game_sessions.find(
          (r) => r.id === args._session_id && r.status === "in_progress"
        );
        // Already finished, or gone — nothing to overwrite.
        if (!row) return { data: null, error: null };

        const won = args._won as boolean;
        // is_official is decided HERE, from the session's own stored identity,
        // never from anything the caller supplied.
        const isOfficial = !this.tables.game_sessions.some(
          (o) =>
            o.puzzle_id === row.puzzle_id &&
            o.id !== row.id &&
            (o.status === "won" || o.status === "lost") &&
            o.is_official === true &&
            ((row.user_id !== null && o.user_id === row.user_id) ||
              (row.user_id === null &&
                !!row.device_id &&
                row.device_id !== "unknown" &&
                o.device_id === row.device_id))
        );
        // Everything from here to the end of this case happens in ONE
        // transaction in the real function, so the fake snapshots what it is
        // about to touch and restores it if a required effect fails.
        const txn = {
          session: { ...row },
          aggregates: this.tables.puzzle_aggregates.map((r) => ({ ...r })),
          results: this.tables.game_results.map((r) => ({ ...r })),
          streaks: this.tables.user_streaks.map((r) => ({ ...r })),
        };
        const rollback = () => {
          Object.assign(row, txn.session);
          this.tables.puzzle_aggregates = txn.aggregates;
          this.tables.game_results = txn.results;
          this.tables.user_streaks = txn.streaks;
        };

        const completedAt = new Date().toISOString();
        Object.assign(row, {
          status: won ? "won" : "lost",
          won,
          completed_at: completedAt,
          last_activity_at: completedAt,
          is_official: isOfficial,
          mistakes: args._mistakes ?? row.mistakes,
          active_time_seconds: args._active_time_seconds ?? row.active_time_seconds,
          found_rainbow: args._found_rainbow ?? row.found_rainbow,
          rainbow_solve_index: args._rainbow_solve_index ?? row.rainbow_solve_index,
          rainbow_source: args._found_rainbow ? "in_game" : row.rainbow_source,
          solve_order: args._solve_order ?? row.solve_order,
          hints_used: args._hints_used ?? row.hints_used,
          share_grid: args._share_grid ?? row.share_grid,
        });
        this._log("game_sessions", "update");

        if (!isOfficial) return { data: false, error: null };

        // The three REQUIRED effects that used to be separate client calls.
        // None is optional: if one fails the completion rolls back with it,
        // so a finished session can never be missing its statistics.
        const mistakes = (args._mistakes as number) ?? 0;
        const seconds = (args._active_time_seconds as number) ?? 0;
        const firstSolve = Array.isArray(args._solve_order)
          ? ((args._solve_order as unknown[])[0] as string | undefined) ?? null
          : null;

        // 1. Site-wide aggregates. +1 per OFFICIAL completion — the same
        //    definition as before, never re-incremented and never decremented
        //    by import, decline or retirement.
        if (this.failAggregateWrites > 0) {
          this.failAggregateWrites -= 1;
          rollback();
          return {
            data: null,
            error: { code: "XX000", message: "simulated aggregate write failure" },
          };
        }
        const agg = this.tables.puzzle_aggregates.find((a) => a.puzzle_id === row.puzzle_id);
        if (agg) {
          const total = ((agg.total_plays as number) ?? 0) + 1;
          agg.avg_mistakes = ((((agg.avg_mistakes as number) ?? 0) * (total - 1)) + mistakes) / total;
          agg.avg_time_seconds = ((((agg.avg_time_seconds as number) ?? 0) * (total - 1)) + seconds) / total;
          agg.total_plays = total;
          agg.total_wins = ((agg.total_wins as number) ?? 0) + (won ? 1 : 0);
          agg.most_common_first_solve = firstSolve ?? agg.most_common_first_solve;
        } else {
          this.tables.puzzle_aggregates.push({
            puzzle_id: row.puzzle_id,
            total_plays: 1,
            total_wins: won ? 1 : 0,
            avg_mistakes: mistakes,
            avg_time_seconds: seconds,
            most_common_first_solve: firstSolve,
          });
        }

        // 2. game_results: unchanged meaning — one row per (account, puzzle),
        //    only on an official completion by a signed-in player. Anonymous
        //    play has never written it.
        //
        //    Skipped when the puzzle no longer exists, mirroring the SQL
        //    precondition: game_results has an FK to puzzles, and the Admin
        //    screen can delete a puzzle. Without that check a mandatory write
        //    would let a deleted puzzle block a real completion.
        const puzzleExists = this.tables.puzzles.some((p) => p.id === row.puzzle_id);
        if (row.user_id != null && puzzleExists) {
          const existingResult = this.tables.game_results.find(
            (r) => r.user_id === row.user_id && r.puzzle_id === row.puzzle_id
          );
          if (existingResult) {
            existingResult.won = won;
            existingResult.mistakes = mistakes;
          } else {
            this.tables.game_results.push({
              id: this._newId(),
              user_id: row.user_id,
              puzzle_id: row.puzzle_id,
              won,
              mistakes,
              completed_at: completedAt,
            });
          }
        }

        // 3. Streak, on the player's own local date. Archive games skip it.
        if (!args._skip_streak) {
          this._recordStreak(
            (row.user_id as string | null) ?? null,
            (row.device_id as string | null) ?? null,
            won,
            (args._local_date as string | undefined) ?? null,
            // From the SESSION, so a Mini completion can only move the Mini
            // streak.
            rowFormat(row)
          );
        }

        return { data: true, error: null };
      }
      case "record_guess_events": {
        if (!this._capabilityOk(args._session_id as string, deviceId, deviceToken)) {
          return { data: null, error: null };
        }
        const events = (args._events as Record<string, unknown>[]) ?? [];
        let inserted = 0;
        for (const e of events) {
          const clash = this.tables.guess_events.some(
            (g) =>
              g.game_session_id === args._session_id && g.guess_number === e.guess_number
          );
          if (clash) continue;
          this.tables.guess_events.push({
            id: this._newId(),
            game_session_id: args._session_id,
            ...e,
            // Forced server-side: a client cannot claim 'bonus_rainbow' here.
            attempt_type: "normal",
          });
          inserted++;
        }
        this._log("guess_events", "upsert");
        return { data: inserted, error: null };
      }
      case "record_hint_event": {
        if (!this._capabilityOk(args._session_id as string, deviceId, deviceToken)) {
          return { data: false, error: null };
        }
        const clash = this.tables.hint_events.some(
          (h) =>
            h.game_session_id === args._session_id && h.hint_type === args._hint_type
        );
        if (!clash) {
          this.tables.hint_events.push({
            id: this._newId(),
            game_session_id: args._session_id,
            hint_type: args._hint_type,
            revealed_at: args._revealed_at ?? new Date().toISOString(),
            active_time_seconds: args._active_time_seconds,
            guess_count: args._guess_count,
            mistakes: args._mistakes,
            groups_solved: args._groups_solved,
            rainbow_found: args._rainbow_found,
          });
        }
        this._log("hint_events", "upsert");
        return { data: true, error: null };
      }
      case "record_bonus_rainbow": {
        if (!this._capabilityOk(args._session_id as string, deviceId, deviceToken)) {
          return { data: false, error: null };
        }
        const row = this.tables.game_sessions.find(
          (r) =>
            r.id === args._session_id && (r.status === "won" || r.status === "lost")
        );
        // The prompt only exists after the board is finished.
        if (!row) return { data: false, error: null };

        const clash = this.tables.guess_events.some(
          (g) =>
            g.game_session_id === args._session_id && g.guess_number === args._guess_number
        );
        if (!clash) {
          this.tables.guess_events.push({
            id: this._newId(),
            game_session_id: args._session_id,
            guess_number: args._guess_number,
            words: args._words,
            correct: args._correct,
            group_name: null,
            is_rainbow_attempt: true,
            // The ONLY producer of this value anywhere.
            attempt_type: "bonus_rainbow",
            guessed_at: args._guessed_at ?? new Date().toISOString(),
            active_time_seconds: args._active_time_seconds,
            groups_solved: args._groups_solved,
          });
        }
        // A Rainbow already found in normal play keeps its in_game source.
        if (!row.found_rainbow) {
          row.bonus_rainbow_attempted = true;
          if (args._correct) {
            row.found_rainbow = true;
            row.rainbow_source = "post_game";
            row.rainbow_solve_index = 4;
          }
        }
        this._log("game_sessions", "update");
        return { data: true, error: null };
      }
      // ── Public custom puzzles (20260919000000) ──
      // Deliberately separate from every official/Beta case above: none of
      // these touch puzzles/puzzle_groups/puzzle_versions/game_sessions/
      // guess_events/hint_events/game_results/user_streaks/
      // puzzle_aggregates/beta_playtests/beta_feedback.
      case "create_custom_puzzle": {
        let canonical: FakeRow;
        try {
          canonical = canonicalizeCustomPuzzleContent(args._content);
        } catch (err) {
          return { data: null, error: { code: "22023", message: (err as Error).message } };
        }
        const visibility = args._visibility;
        if (visibility !== "public" && visibility !== "private") {
          return { data: null, error: { code: "22023", message: "visibility must be public or private" } };
        }
        const title = typeof args._title === "string" ? args._title.trim() : "";
        if (!title) return { data: null, error: { code: "22023", message: "a puzzle needs a title" } };
        if (title.length > 100) return { data: null, error: { code: "22023", message: "title is too long" } };
        const creatorName = typeof args._creator_name === "string" ? args._creator_name.trim() : "";
        if (!creatorName) return { data: null, error: { code: "22023", message: "a designer name is required" } };
        if (creatorName.length > 60) return { data: null, error: { code: "22023", message: "designer name is too long" } };

        const shareId = `share-${this._newId()}`;
        const id = this._newId();
        // Collision retry, mirroring the SQL loop (unique_violation -> redraw).
        let shortCode = this._drawShortCode();
        for (let attempt = 0; this.tables.custom_puzzles.some((p) => p.short_code === shortCode); attempt++) {
          if (attempt >= 9) return { data: null, error: { code: "23505", message: "short_code collision" } };
          shortCode = this._drawShortCode();
        }
        if (uid !== null && !this.tables.creator_profiles.some((c) => c.user_id === uid)) {
          const base = creatorName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "creator";
          this.tables.creator_profiles.push({
            user_id: uid,
            public_slug: `${base}-${Math.random().toString(36).slice(2, 6)}`,
            display_name: creatorName.slice(0, 60),
            created_at: new Date().toISOString(),
          });
          this._log("creator_profiles", "insert");
        }
        this.tables.custom_puzzles.push({
          id,
          share_id: shareId,
          short_code: shortCode,
          visibility,
          created_by: uid,
          creator_name: creatorName,
          title,
          moderation_status: "active",
          content: canonical,
          created_at: new Date().toISOString(),
        });
        this._log("custom_puzzles", "insert");
        return { data: { puzzle_id: id, share_id: shareId, short_code: shortCode }, error: null };
      }
      case "get_custom_puzzle": {
        const row = this.tables.custom_puzzles.find(
          (p) => p.share_id === args._share_id && p.moderation_status === "active"
        );
        return { data: row ? this._publicPuzzleJson(row, uid) : null, error: null };
      }
      case "get_custom_puzzle_by_short_code": {
        const row = this.tables.custom_puzzles.find(
          (p) => p.short_code === args._short_code && p.moderation_status === "active"
        );
        return { data: row ? this._publicPuzzleJson(row, uid) : null, error: null };
      }
      case "set_custom_puzzle_favorite": {
        // anon is revoked from this function: the database refuses, it does not return null.
        if (uid === null) {
          return { data: null, error: { code: "42501", message: "permission denied for function set_custom_puzzle_favorite" } };
        }
        const puzzle = this.tables.custom_puzzles.find(
          (p) => p.share_id === args._share_id && p.moderation_status === "active"
        );
        if (!puzzle) return { data: null, error: null };
        const mine = (r: FakeRow) => r.custom_puzzle_id === puzzle.id && r.user_id === uid;
        if (args._favorite === true) {
          if (!this.tables.custom_puzzle_favorites.some(mine)) {
            this.tables.custom_puzzle_favorites.push({
              custom_puzzle_id: puzzle.id,
              user_id: uid,
              created_at: new Date().toISOString(),
            });
            this._log("custom_puzzle_favorites", "insert");
          }
        } else {
          const before = this.tables.custom_puzzle_favorites.length;
          this.tables.custom_puzzle_favorites = this.tables.custom_puzzle_favorites.filter((r) => !mine(r));
          if (this.tables.custom_puzzle_favorites.length !== before) this._log("custom_puzzle_favorites", "update");
        }
        return {
          data: {
            favorited: this.tables.custom_puzzle_favorites.some(mine),
            favorite_count: this.tables.custom_puzzle_favorites.filter((r) => r.custom_puzzle_id === puzzle.id).length,
          },
          error: null,
        };
      }
      case "get_my_favorites": {
        if (uid === null) {
          return { data: null, error: { code: "42501", message: "permission denied for function get_my_favorites" } };
        }
        const items = this.tables.custom_puzzle_favorites
          .filter((r) => r.user_id === uid)
          .map((r) => ({ fav: r, p: this.tables.custom_puzzles.find((x) => x.id === r.custom_puzzle_id) }))
          .filter((x) => x.p && x.p.moderation_status === "active")
          .sort((a, b) => String(b.fav.created_at).localeCompare(String(a.fav.created_at)))
          .map(({ fav, p }) => ({
            title: p!.title,
            creator_name: p!.creator_name,
            creator_slug: this.tables.creator_profiles.find((c) => c.user_id === p!.created_by)?.public_slug ?? null,
            mode: (p!.content as FakeRow).mode,
            short_code: p!.short_code,
            favorite_count: this.tables.custom_puzzle_favorites.filter((x) => x.custom_puzzle_id === p!.id).length,
            favorited_at: fav.created_at,
          }));
        return { data: items, error: null };
      }
      case "get_creator_profile": {
        const profile = this.tables.creator_profiles.find((c) => c.public_slug === args._slug);
        if (!profile) return { data: null, error: null };
        const sort = ["newest", "plays", "favorites"].includes(args._sort as string) ? (args._sort as string) : "newest";
        const pub = this.tables.custom_puzzles
          .filter((p) => p.created_by === profile.user_id && p.visibility === "public" && p.moderation_status === "active")
          .map((p) => ({
            title: p.title,
            mode: (p.content as FakeRow).mode,
            short_code: p.short_code,
            finished_plays: this._customPlays(p.id as string),
            favorite_count: this.tables.custom_puzzle_favorites.filter((r) => r.custom_puzzle_id === p.id).length,
            created_at: p.created_at as string,
          }));
        const byNewest = (a: FakeRow, b: FakeRow) => String(b.created_at).localeCompare(String(a.created_at));
        const ordered = [...pub].sort((a, b) => {
          if (sort === "plays" && a.finished_plays !== b.finished_plays) return b.finished_plays - a.finished_plays;
          if (sort === "favorites" && a.favorite_count !== b.favorite_count) return b.favorite_count - a.favorite_count;
          return byNewest(a, b);
        });
        return {
          data: {
            display_name: profile.display_name,
            public_slug: profile.public_slug,
            puzzle_count: pub.length,
            total_plays: pub.reduce((n, p) => n + p.finished_plays, 0),
            total_favorites: pub.reduce((n, p) => n + p.favorite_count, 0),
            puzzles: ordered.slice(0, 100),
          },
          error: null,
        };
      }
      case "submit_custom_puzzle_result": {
        if (!deviceProven) return { data: false, error: null };
        if (args._won === null || args._won === undefined) {
          return { data: null, error: { code: "22023", message: "won is required" } };
        }
        const totalGuesses = args._total_guesses as number;
        if (!Number.isInteger(totalGuesses) || totalGuesses < 0 || totalGuesses > 60) {
          return { data: null, error: { code: "22023", message: "total_guesses out of range" } };
        }
        // The legacy 5-argument form derives a per-(puzzle, device) run id, so it
        // keeps its old "first result per device only" behaviour.
        const runId = (args._run_id as string | undefined) ?? `legacy:${args._share_id}:${deviceId}`;
        if (args._run_id === null) {
          return { data: null, error: { code: "22023", message: "run_id is required" } };
        }
        const puzzle = this.tables.custom_puzzles.find(
          (p) => p.share_id === args._share_id && p.moderation_status === "active"
        );
        if (!puzzle) return { data: false, error: null };

        let row = this.tables.custom_puzzle_results.find(
          (r) => r.custom_puzzle_id === puzzle.id && r.device_id === deviceId
        );
        let counted = false;
        if (!row) {
          row = {
            id: this._newId(),
            custom_puzzle_id: puzzle.id,
            device_id: deviceId,
            won: args._won,
            total_guesses: totalGuesses,
            completed_at: new Date().toISOString(),
            recent_run_ids: [runId],
          };
          this.tables.custom_puzzle_results.push(row);
          this._log("custom_puzzle_results", "insert");
          counted = true;
        } else if (!((row.recent_run_ids as string[]) ?? []).includes(runId)) {
          row.recent_run_ids = [runId, ...((row.recent_run_ids as string[]) ?? [])].slice(0, 10);
          this._log("custom_puzzle_results", "update");
          counted = true;
        }
        if (counted) {
          let st = this.tables.custom_puzzle_stats.find((x) => x.custom_puzzle_id === puzzle.id);
          if (!st) {
            st = {
              custom_puzzle_id: rowId(puzzle.id), wins: 0, losses: 0,
              guesses_4: 0, guesses_5: 0, guesses_6: 0, guesses_7: 0, guesses_8_plus: 0, win_guess_total: 0,
            };
            this.tables.custom_puzzle_stats.push(st);
          }
          this._log("custom_puzzle_stats", "update");
          if (args._won) {
            st.wins = st.wins + 1;
            const bucket = guessBucket(totalGuesses);
            st[bucket] = st[bucket] + 1;
            st.win_guess_total = st.win_guess_total + totalGuesses;
          } else {
            st.losses = st.losses + 1;
          }
        }
        return { data: true, error: null };
      }
      case "get_custom_puzzle_stats": {
        const puzzle = this.tables.custom_puzzles.find(
          (p) => p.share_id === args._share_id && p.moderation_status === "active"
        );
        if (!puzzle) return { data: null, error: null };
        const st = this.tables.custom_puzzle_stats.find((x) => x.custom_puzzle_id === puzzle.id);
        const n = (k: StatsCounter) => (st ? st[k] : 0);
        const plays = n("wins") + n("losses");
        return {
          data: {
            completed_plays: plays,
            finished_plays: plays,
            wins: n("wins"),
            losses: n("losses"),
            avg_guesses: n("wins") > 0 ? Math.round((n("win_guess_total") / n("wins")) * 100) / 100 : 0,
            guess_distribution: {
              "4": n("guesses_4"), "5": n("guesses_5"), "6": n("guesses_6"), "7": n("guesses_7"), "8+": n("guesses_8_plus"),
            },
          },
          error: null,
        };
      }
      case "admin_set_custom_puzzle_status": {
        if (uid === null || !this.isAdmin) {
          return { data: null, error: { code: "42501", message: "admin role required" } };
        }
        const row = this.tables.custom_puzzles.find((p) => p.id === args._puzzle_id);
        if (!row) return { data: false, error: null };
        row.moderation_status = args._status;
        this._log("custom_puzzles", "update");
        return { data: true, error: null };
      }
      default:
        // Includes claim_anonymous_sessions, which the cutover migration
        // dropped: an unknown function is not a silent success.
        return { data: null, error: null };
    }
  };

  private nextId() {
    this.idCounter += 1;
    return `id-${this.idCounter}`;
  }

  private matches(row: FakeRow, filters: Filter[], table?: string): boolean {
    // Reads go through the NOT NULL DEFAULT table (see NOT_NULL_DEFAULTS), so
    // a fixture row that omits a defaulted column behaves exactly like a real
    // pre-migration row does after the column is added: it HAS the default,
    // it is not null.
    const read = (col: string) => {
      const v = row[col];
      if (v !== undefined || !table) return v;
      return NOT_NULL_DEFAULTS[table]?.[col];
    };
    return filters.every((f) => {
      switch (f.kind) {
        case "eq":
          return read(f.column) === f.value;
        case "in":
          return f.values.includes(read(f.column));
        case "is":
          return row[f.column] === null || row[f.column] === undefined;
        case "or":
          return f.clauses.some((c) => read(c.column) === c.value);
        case "cmp": {
          const v = read(f.column) as string | number | null | undefined;
          if (v === null || v === undefined) return false;
          const target = f.value as string | number;
          if (f.op === "lte") return v <= target;
          if (f.op === "gte") return v >= target;
          if (f.op === "lt") return v < target;
          return v > target;
        }
      }
    });
  }

  from(table: string) {
    if (!this.tables[table]) {
      throw new Error(`FakeSupabase: unknown table "${table}"`);
    }
    return new FakeQuery(this, table);
  }

  /** Internal hooks used by FakeQuery. */
  _rows(table: string) {
    return this.tables[table];
  }
  /** Completed plays (wins + losses) for a custom puzzle, from its counter row. */
  _customPlays(puzzleId: string): number {
    const st = this.tables.custom_puzzle_stats.find((x) => x.custom_puzzle_id === puzzleId);
    return st ? st.wins + st.losses : 0;
  }

  _log(table: string, op: "insert" | "update" | "upsert") {
    this.writeLog.push({ table, op });
  }

  /**
   * Every SELECT: which table, the equality filters it carried, and the rows
   * it returned.
   *
   * Exists so a test can assert what a page ASKED FOR, not merely what it
   * happened to render. The archive-isolation suite needs exactly that: a
   * page that renders no Mini puzzles because none matched is not the same
   * guarantee as a page that never asks for a Mini at all, and only the
   * second one stays correct as data changes.
   */
  readLog: {
    table: string;
    filters: Record<string, unknown>;
    rows: FakeRow[];
    isCount: boolean;
  }[] = [];

  _logRead(table: string, filters: Filter[], rows: FakeRow[], isCount: boolean) {
    const eq: Record<string, unknown> = {};
    for (const f of filters) {
      // Equality filters only — those are what "scoped to this format" means,
      // and the shape a test can assert against readably.
      if (f.kind === "eq") eq[f.column] = f.value;
    }
    this.readLog.push({ table, filters: eq, rows: rows.map((r) => ({ ...r })), isCount });
  }
  _newId() {
    return this.nextId();
  }
  _match(row: FakeRow, filters: Filter[], table?: string) {
    return this.matches(row, filters, table);
  }
  /**
   * Which direct writes the post-migration policies refuse.
   *
   * game_sessions keeps its narrow INSERT policy on purpose, for cached
   * older client bundles; everything else about it, and every child-table
   * insert, now goes through a capability-checked function.
   */
  _writeDenied(table: string, op: string): string | null {
    if (op === "select") return null;
    // puzzle_versions has NO insert, update or delete policy for any role,
    // admins included, plus a trigger that refuses every UPDATE. The only
    // producer of a version anywhere is admin_save_puzzle().
    if (table === "puzzle_versions") {
      return `puzzle_versions is immutable and has no ${op} policy: use admin_save_puzzle`;
    }
    // "Admins can manage puzzles"/"...puzzle groups" are the only write
    // policies on these two, so a non-admin client cannot promote a version
    // by writing puzzles.current_version_id directly either.
    //
    // For puzzles this is now belt AND braces: 20260918003000 also revokes
    // insert/update/delete on public.puzzles from anon, so an anonymous
    // caller is stopped by the table grant before RLS is consulted at all.
    // authenticated keeps update/delete, which the Admin editor's publish
    // toggle and delete button use directly, and the policy below is what
    // narrows those to admins.
    if (table === "puzzles" || table === "puzzle_groups") {
      if (!this.isAdmin) return `admin role required to ${op} ${table}`;
      return null;
    }
    // The cutover migration removed the last direct write route into
    // gameplay, including the legacy game_sessions INSERT policy that cached
    // bundles used and that bypassed the onboarding gate.
    if (
      table === "game_sessions" ||
      table === "guess_events" ||
      table === "hint_events" ||
      table === "user_streaks" ||
      table === "game_results" ||
      table === "device_identities" ||
      table === "account_onboarding" ||
      // beta_playtests/beta_feedback (20260918020000): no insert/update/
      // delete policy for any role, admins included — writes go only
      // through start_beta_playtest/complete_beta_playtest/
      // reset_beta_playtest/submit_beta_feedback. Direct SELECT is admin-only
      // and handled separately by _visibleForRead.
      table === "beta_playtests" ||
      table === "beta_feedback"
    ) {
      return `no ${op} policy on ${table}: use a scoped function`;
    }
    // custom_puzzle_results: no policy at all, not even for admins — see
    // 20260919000000. custom_puzzles allows admin-only direct SELECT
    // (mirrored in _visibleForRead) but every write, admin included, goes
    // only through create_custom_puzzle/admin_set_custom_puzzle_status.
    if (table === "custom_puzzle_results" || table === "custom_puzzle_stats" || table === "custom_puzzle_favorites" || table === "creator_profiles") {
      return `no ${op} policy on ${table}: use a scoped function`;
    }
    if (table === "custom_puzzles") {
      if (op === "select") return null;
      return `no ${op} policy on ${table}: use a scoped function`;
    }
    return null;
  }
  _uniqueKey(table: string) {
    return UNIQUE_KEYS[table];
  }

  /**
   * puzzles_check_current_version(), mirrored.
   *
   * A puzzle may only point at a snapshot that BELONGS TO IT. Without this,
   * an admin (or a bug) could promote puzzle B's content as puzzle A's
   * current version, and every new player of A would be handed a board from
   * a different puzzle. Enforced in the database by a trigger, so it holds
   * for direct writes as well as for admin_save_puzzle.
   */
  _currentVersionDenied(puzzleId: unknown, versionId: unknown): string | null {
    if (versionId === null || versionId === undefined) return null;
    const version = this.tables.puzzle_versions.find((v) => v.id === versionId);
    if (!version) return `current_version_id ${String(versionId)} does not exist`;
    if (version.puzzle_id !== puzzleId) {
      return `current_version_id ${String(versionId)} belongs to puzzle ${String(version.puzzle_id)}, not ${String(puzzleId)}`;
    }
    return null;
  }
  /**
   * The session-capability check from migration section 7a, mirrored exactly.
   *
   * An account-owned session is unlocked ONLY by a matching auth.uid(); a
   * supplied device_id is ignored for it. An anonymous session is unlocked
   * only by the device_id it was created with, and never by the shared
   * unknown literal.
   */
  _capabilityOk(
    sessionId: string,
    deviceId: string | undefined,
    deviceToken: string | undefined
  ): boolean {
    const gs = this.tables.game_sessions.find((r) => r.id === sessionId);
    if (!gs) return false;
    const uid = this.authUser?.id ?? null;
    if (gs.user_id !== null && gs.user_id !== undefined) return uid !== null && gs.user_id === uid;
    return gs.device_id === deviceId && this._verifyDevice(deviceId, deviceToken);
  }

  /**
   * verify_device(), mirrored: the device must exist, must not be retired,
   * and the supplied token must match the stored hash. Holding a device_id
   * alone proves nothing any more — which is the entire point of the change.
   */
  _verifyDevice(deviceId: string | undefined | null, token: string | undefined | null): boolean {
    if (!deviceId || !token || deviceId === "unknown") return false;
    const row = this.tables.device_identities.find((d) => d.device_id === deviceId);
    if (!row) return false;
    if (row.retired_at) return false;
    if (!row.token_hash) return false;
    return row.token_hash === `sha256:${token}`;
  }

  /** Register an identity directly, for fixtures that need a known token. */
  _seedDeviceIdentity(deviceId: string, token: string, retiredAt: string | null = null) {
    if (this.tables.device_identities.some((d) => d.device_id === deviceId)) return;
    this.tables.device_identities.push({
      device_id: deviceId,
      token_hash: `sha256:${token}`,
      created_at: new Date().toISOString(),
      retired_at: retiredAt,
      retired_reason: retiredAt ? "seeded" : null,
    });
  }

  /**
   * record_streak(), mirrored — including the pre-existing quirk that a
   * first-ever game seeds 1/1 even on a loss. The security migration
   * deliberately preserved the streak rule rather than quietly changing it.
   *
   * The date comes from the PLAYER'S clock, as it always has; computing it
   * server-side would move every streak boundary to UTC.
   */
  _recordStreak(
    userId: string | null,
    deviceId: string | null,
    won: boolean,
    localDate: string | null,
    format: string = "full"
  ) {
    const today = localDate ?? new Date().toLocaleDateString("en-CA");
    const rows = this.tables.user_streaks;
    const inFormat = (r: FakeRow) => rowFormat(r) === format;
    const row =
      userId != null
        ? rows.find((r) => r.user_id === userId && inFormat(r))
        : deviceId && deviceId !== "unknown"
          ? rows.find((r) => r.device_id === deviceId && r.user_id == null && inFormat(r))
          : undefined;

    if (!row) {
      if (userId == null && (!deviceId || deviceId === "unknown")) return;
      rows.push({
        id: this._newId(),
        user_id: userId,
        device_id: deviceId,
        format,
        current_streak: 1,
        longest_streak: 1,
        last_played_date: today,
        updated_at: new Date().toISOString(),
      });
      return;
    }

    if (row.last_played_date === today) return;

    const yesterday = new Date(`${today}T12:00:00`);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toLocaleDateString("en-CA");

    const next = won
      ? row.last_played_date === yesterdayStr
        ? ((row.current_streak as number) ?? 0) + 1
        : 1
      : 0;
    row.current_streak = next;
    row.longest_streak = Math.max(next, (row.longest_streak as number) ?? 0);
    row.last_played_date = today;
    row.updated_at = new Date().toISOString();
  }

  /** Mark an account as already onboarded, so it may play. */
  _seedOnboarding(userId: string, status = "legacy") {
    const existing = this.tables.account_onboarding.find((r) => r.user_id === userId);
    if (existing) {
      existing.status = status;
      return;
    }
    this.tables.account_onboarding.push({
      user_id: userId,
      status,
      source_device_id: null,
      decided_at: status === "pending" ? null : new Date().toISOString(),
      created_at: new Date().toISOString(),
    });
  }

  /** Applies column DEFAULTs to keys the insert did not mention. */
  _withDefaults(table: string, row: FakeRow): FakeRow {
    const defaults = COLUMN_DEFAULTS[table];
    if (!defaults) return row;
    const out: FakeRow = { ...row };
    for (const [k, v] of Object.entries(defaults)) {
      if (!(k in out)) out[k] = v;
    }
    return out;
  }
}

class FakeQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  private filters: Filter[] = [];
  private pending:
    | { op: "select" }
    | { op: "insert"; rows: FakeRow[] }
    | { op: "update"; patch: FakeRow }
    | { op: "upsert"; rows: FakeRow[]; ignoreDuplicates: boolean }
    | null = null;
  private wantSingle: "single" | "maybeSingle" | null = null;
  private limitCount: number | null = null;
  private headCount = false;
  private orderBy: { column: string; ascending: boolean } | null = null;
  /** Embedded child tables requested as `child(*)` in select(). */
  private embeds: string[] = [];

  constructor(private db: FakeSupabase, private table: string) {}

  select(cols?: string, opts?: { count?: string; head?: boolean }) {
    if (!this.pending) this.pending = { op: "select" };
    if (opts?.head) this.headCount = true;
    // PostgREST embedded resources: `"*, puzzle_groups(*)"`. The live game
    // board loads through exactly this shape, so the fake has to reproduce
    // it or a page test would see a puzzle with no categories.
    for (const m of (cols ?? "").matchAll(/([a-z_]+)\s*\(\s*\*\s*\)/g)) {
      this.embeds.push(m[1]);
    }
    return this;
  }
  insert(rows: FakeRow | FakeRow[]) {
    this.pending = { op: "insert", rows: Array.isArray(rows) ? rows : [rows] };
    return this;
  }
  update(patch: FakeRow) {
    this.pending = { op: "update", patch };
    return this;
  }
  upsert(rows: FakeRow | FakeRow[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.pending = {
      op: "upsert",
      rows: Array.isArray(rows) ? rows : [rows],
      ignoreDuplicates: !!opts?.ignoreDuplicates,
    };
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push({ kind: "eq", column, value });
    return this;
  }
  in(column: string, values: unknown[]) {
    this.filters.push({ kind: "in", column, values });
    return this;
  }
  is(column: string, value: null) {
    this.filters.push({ kind: "is", column, value });
    return this;
  }
  not() {
    return this;
  }
  lte(column: string, value: unknown) {
    this.filters.push({ kind: "cmp", column, op: "lte", value });
    return this;
  }
  gte(column: string, value: unknown) {
    this.filters.push({ kind: "cmp", column, op: "gte", value });
    return this;
  }
  lt(column: string, value: unknown) {
    this.filters.push({ kind: "cmp", column, op: "lt", value });
    return this;
  }
  gt(column: string, value: unknown) {
    this.filters.push({ kind: "cmp", column, op: "gt", value });
    return this;
  }
  order(column?: string, opts?: { ascending?: boolean }) {
    if (column) this.orderBy = { column, ascending: opts?.ascending !== false };
    return this;
  }
  /** Supports the `user_id.eq.X,device_id.eq.Y` form this codebase uses. */
  or(expr: string) {
    const clauses = expr.split(",").map((part) => {
      const [column, op, ...rest] = part.split(".");
      if (op !== "eq") throw new Error(`FakeSupabase: unsupported or() op "${op}"`);
      return { column, value: rest.join(".") };
    });
    this.filters.push({ kind: "or", clauses });
    return this;
  }
  limit(n: number) {
    this.limitCount = n;
    return this;
  }
  single() {
    this.wantSingle = "single";
    return this;
  }
  maybeSingle() {
    this.wantSingle = "maybeSingle";
    return this;
  }

  private run(): { data: unknown; error: unknown; count?: number } {
    const rows = this.db._rows(this.table);
    const p = this.pending ?? { op: "select" as const };

    // Modelled write policies. After migration section 7 there is no
    // UPDATE policy on game_sessions and no INSERT policy on either child
    // table, so a direct write from application code is refused outright.
    // Refusing loudly here is the point: if any code path regresses to a
    // direct write, it fails in tests rather than silently in production.
    const deniedWrite = this.db._writeDenied(this.table, p.op);
    if (deniedWrite) {
      return {
        data: null,
        error: { code: "42501", message: deniedWrite },
      };
    }

    if (p.op === "insert") {
      const inserted = p.rows.map((r) => this.db._withDefaults(this.table, { id: this.db._newId(), ...r }));
      rows.push(...inserted);
      this.db._log(this.table, "insert");
      return this.shape(inserted);
    }

    if (p.op === "upsert") {
      const key = this.db._uniqueKey(this.table);
      const inserted: FakeRow[] = [];
      for (const r of p.rows) {
        const clash =
          key && rows.some((existing) => key.every((k) => existing[k] === r[k]));
        if (clash) {
          // Matches ON CONFLICT DO NOTHING: the duplicate is discarded.
          if (p.ignoreDuplicates) continue;
          return {
            data: null,
            error: { code: "23505", message: "duplicate key value violates unique constraint" },
          };
        }
        const row = this.db._withDefaults(this.table, { id: this.db._newId(), ...r });
        rows.push(row);
        inserted.push(row);
      }
      this.db._log(this.table, "upsert");
      return this.shape(inserted);
    }

    if (p.op === "update") {
      const targets = rows.filter((r) => this.db._match(r, this.filters, this.table));
      if (this.table === "puzzles" && "current_version_id" in p.patch) {
        for (const t of targets) {
          const denied = this.db._currentVersionDenied(t.id, p.patch.current_version_id);
          if (denied) return { data: null, error: { code: "23503", message: denied } };
        }
      }
      for (const t of targets) Object.assign(t, p.patch);
      this.db._log(this.table, "update");
      return this.shape(targets);
    }

    // Modelled SELECT policies apply before any client filter, exactly as
    // RLS does: a policy restricts the visible set, the WHERE clause then
    // narrows it further.
    let out = this.db._visibleForRead(this.table, rows).filter((r) => this.db._match(r, this.filters, this.table));
    if (this.orderBy) {
      const { column, ascending } = this.orderBy;
      // Stable (Array#sort is stable in every engine this runs on), so rows
      // with an equal key keep their insertion order, like Postgres with no
      // secondary key.
      out = [...out].sort((a, b) => {
        const av = a[column] as string | number | null | undefined;
        const bv = b[column] as string | number | null | undefined;
        if (av === bv) return 0;
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        return (av < bv ? -1 : 1) * (ascending ? 1 : -1);
      });
    }
    if (this.limitCount !== null) out = out.slice(0, this.limitCount);
    this.db._logRead(this.table, this.filters, out, this.headCount);
    if (this.headCount) return { data: null, error: null, count: out.length };
    return this.shape(this.withEmbeds(out));
  }

  /**
   * Attaches each requested embedded child table, joined on <table>_id —
   * the FK naming every relationship in this schema uses.
   */
  private withEmbeds(out: FakeRow[]): FakeRow[] {
    if (this.embeds.length === 0) return out;
    const fk = `${this.table.replace(/s$/, "")}_id`;
    return out.map((row) => {
      const withChildren: FakeRow = { ...row };
      for (const child of this.embeds) {
        withChildren[child] = this.db
          ._rows(child)
          .filter((c) => String(c[fk]) === String(row.id))
          .map((c) => ({ ...c }));
      }
      return withChildren;
    });
  }

  private shape(out: FakeRow[]) {
    if (this.wantSingle === "single") {
      if (out.length !== 1) {
        return { data: null, error: { code: "PGRST116", message: "no rows" } };
      }
      return { data: { ...out[0] }, error: null };
    }
    if (this.wantSingle === "maybeSingle") {
      return { data: out.length ? { ...out[0] } : null, error: null };
    }
    return { data: out.map((r) => ({ ...r })), error: null, count: out.length };
  }

  then<TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
    onfulfilled?: ((v: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}
