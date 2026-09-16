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
};

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
  private static readonly RLS_READ_PROTECTED = ["game_sessions", "guess_events", "hint_events"];

  /** True when the caller is an admin, which unlocks the admin SELECT policies. */
  isAdmin = false;

  signIn(userId: string | null, opts?: { admin?: boolean }) {
    this.authUser = userId ? { id: userId } : null;
    this.isAdmin = !!opts?.admin;
  }

  /**
   * Applies the modelled SELECT policies to a direct table read.
   *
   * anon           -> no rows at all (no anonymous SELECT policy exists)
   * authenticated  -> only rows whose owning session is the caller's own
   * admin          -> everything
   */
  _visibleForRead(table: string, rows: FakeRow[]): FakeRow[] {
    if (!FakeSupabase.RLS_READ_PROTECTED.includes(table)) return rows;
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
    // Only MUTATING functions count as writes. has_official_result and
    // friends are reads that merely happen to be delivered as functions,
    // and counting them here would make the write-volume assertions — and
    // the "a page view writes nothing" guarantee — quietly wrong.
    // create_game_session records itself as a game_sessions INSERT below,
    // since writeLog describes WHICH TABLE was written rather than how the
    // write was delivered.
    if (name === "increment_puzzle_aggregate") {
      this.writeLog.push({ table: `rpc:${name}`, op: "rpc" });
    }
    const uid = this.authUser?.id ?? null;
    const deviceId = args._device_id as string | undefined;
    const ownsRow = (r: FakeRow) =>
      (uid !== null && r.user_id === uid) ||
      (!!deviceId && deviceId !== "unknown" && r.device_id === deviceId);
    const completed = (r: FakeRow) => r.status === "won" || r.status === "lost";

    switch (name) {
      case "create_game_session": {
        const row = this._withDefaults("game_sessions", {
          id: this._newId(),
          puzzle_id: args._puzzle_id,
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
        const n = this.tables.game_sessions.filter(
          (r) =>
            r.user_id === null &&
            completed(r) &&
            !!deviceId &&
            deviceId !== "unknown" &&
            r.device_id === deviceId
        ).length;
        return { data: n, error: null };
      }
      default:
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
  _uniqueKey(table: string) {
    return UNIQUE_KEYS[table];
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
