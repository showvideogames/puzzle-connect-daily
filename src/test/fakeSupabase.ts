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

type Filter =
  | { kind: "eq"; column: string; value: unknown }
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
export function canonicalizePuzzleContent(raw: unknown): FakeRow {
  const content = (raw ?? {}) as Record<string, unknown>;
  const blankToNull = (v: unknown): string | null => {
    const t = typeof v === "string" ? v.trim() : "";
    return t === "" ? null : t;
  };

  const groups = content.groups;
  if (!Array.isArray(groups) || groups.length !== 4) {
    throw new Error("puzzle content must contain exactly 4 groups");
  }

  const all: string[] = [];
  const outGroups = groups.map((g, index) => {
    const group = (g ?? {}) as Record<string, unknown>;
    const category = typeof group.category === "string" ? group.category.trim() : "";
    if (category === "") throw new Error(`group ${index + 1} needs a category name`);
    const difficulty = Number(group.difficulty);
    if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 4) {
      throw new Error(`group ${index + 1} needs a difficulty between 1 and 4`);
    }
    const words = group.words;
    if (!Array.isArray(words) || words.length !== 4) {
      throw new Error(`group ${index + 1} needs exactly 4 words`);
    }
    for (const w of words) {
      if (typeof w !== "string" || w.trim() === "") {
        throw new Error(`group ${index + 1} contains an empty word`);
      }
      all.push(w);
    }
    return {
      category,
      words: [...(words as string[])],
      difficulty,
      hint_word: blankToNull(group.hint_word),
      // Positional, exactly as the SQL assigns it.
      sort_order: index,
    };
  });

  if (new Set(all).size !== 16) throw new Error("a puzzle needs 16 unique words");

  const herringRaw = content.rainbow_herring;
  let herring: string[] | null = null;
  if (herringRaw !== null && herringRaw !== undefined) {
    if (!Array.isArray(herringRaw) || herringRaw.length !== 4) {
      throw new Error("rainbow_herring must have exactly 4 words");
    }
    for (const w of herringRaw) {
      if (!all.includes(w as string)) {
        throw new Error(`rainbow_herring word "${w}" is not one of this puzzle's 16 words`);
      }
    }
    herring = [...(herringRaw as string[])];
  }

  const orderRaw = content.word_order;
  let order: string[] | null = null;
  if (orderRaw !== null && orderRaw !== undefined) {
    if (!Array.isArray(orderRaw) || orderRaw.length !== 16) {
      throw new Error("word_order must list all 16 words");
    }
    for (const w of orderRaw) {
      if (!all.includes(w as string)) {
        throw new Error(`word_order word "${w}" is not one of this puzzle's 16 words`);
      }
    }
    order = [...(orderRaw as string[])];
  }

  // Fixed key order, so JSON.stringify of two canonical forms is the same
  // exact-equality test jsonb comparison gives the real function.
  return {
    groups: outGroups,
    word_order: order,
    rainbow_herring: herring,
    rainbow_category_name: blankToNull(content.rainbow_category_name),
    rainbow_hint_word: blankToNull(content.rainbow_hint_word),
    theme: blankToNull(content.theme),
    is_emoji_puzzle: content.is_emoji_puzzle === true,
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

export class FakeSupabase {
  tables: Record<string, FakeRow[]> = {
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
  };

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
    if (["user_streaks", "device_identities", "account_onboarding"].includes(table)) return [];
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

  rpc = async (name: string, args: Record<string, unknown> = {}) => {
    this.rpcLog.push(name);
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
        const pick = (rows: FakeRow[]) =>
          rows.sort((a, b) => ((b.longest_streak as number) ?? 0) - ((a.longest_streak as number) ?? 0))[0];
        const row =
          uid !== null
            ? pick(this.tables.user_streaks.filter((s) => s.user_id === uid))
            : deviceProven
              ? pick(this.tables.user_streaks.filter((s) => s.device_id === deviceId && s.user_id == null))
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

        const contentColumns = {
          word_order: canonical.word_order,
          rainbow_herring: canonical.rainbow_herring,
          rainbow_category_name: canonical.rainbow_category_name,
          rainbow_hint_word: canonical.rainbow_hint_word,
          theme: canonical.theme,
          is_emoji_puzzle: canonical.is_emoji_puzzle,
        };
        const metadataColumns = {
          date: metadata.date,
          title: metadata.title ?? null,
          is_published: metadata.is_published === true,
          emoji_puzzle_icon: metadata.emoji_puzzle_icon ?? null,
          is_free_puzzle: metadata.is_free_puzzle === true,
          free_puzzle_order: metadata.free_puzzle_order ?? null,
        };

        let pid = (args._puzzle_id as string | null) ?? null;
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
          },
          error: null,
        };
      }
      case "create_game_session": {
        // Every gameplay write now comes from a proven device.
        if (!deviceProven) return { data: null, error: null };
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
        const rows = this.tables.game_sessions
          .filter((r) => completed(r) && r.is_official === true && ownsRow(r))
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
            (args._local_date as string | undefined) ?? null
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

  private matches(row: FakeRow, filters: Filter[]): boolean {
    return filters.every((f) => {
      switch (f.kind) {
        case "eq":
          return row[f.column] === f.value;
        case "in":
          return f.values.includes(row[f.column]);
        case "is":
          return row[f.column] === null || row[f.column] === undefined;
        case "or":
          return f.clauses.some((c) => row[c.column] === c.value);
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
  _log(table: string, op: "insert" | "update" | "upsert") {
    this.writeLog.push({ table, op });
  }
  _newId() {
    return this.nextId();
  }
  _match(row: FakeRow, filters: Filter[]) {
    return this.matches(row, filters);
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
      table === "account_onboarding"
    ) {
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
    localDate: string | null
  ) {
    const today = localDate ?? new Date().toLocaleDateString("en-CA");
    const rows = this.tables.user_streaks;
    const row =
      userId != null
        ? rows.find((r) => r.user_id === userId)
        : deviceId && deviceId !== "unknown"
          ? rows.find((r) => r.device_id === deviceId && r.user_id == null)
          : undefined;

    if (!row) {
      if (userId == null && (!deviceId || deviceId === "unknown")) return;
      rows.push({
        id: this._newId(),
        user_id: userId,
        device_id: deviceId,
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

  constructor(private db: FakeSupabase, private table: string) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (!this.pending) this.pending = { op: "select" };
    if (opts?.head) this.headCount = true;
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
  order() {
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
      const targets = rows.filter((r) => this.db._match(r, this.filters));
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
    let out = this.db._visibleForRead(this.table, rows).filter((r) => this.db._match(r, this.filters));
    if (this.limitCount !== null) out = out.slice(0, this.limitCount);
    if (this.headCount) return { data: null, error: null, count: out.length };
    return this.shape(out);
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
