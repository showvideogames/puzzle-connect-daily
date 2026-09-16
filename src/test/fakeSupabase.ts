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

  signIn(userId: string | null) {
    this.authUser = userId ? { id: userId } : null;
  }

  rpc = async (name: string, _args: unknown) => {
    this.writeLog.push({ table: `rpc:${name}`, op: "rpc" });
    return { data: null, error: null };
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
      const inserted = p.rows.map((r) => ({ id: this.db._newId(), ...r }));
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
        const row = { id: this.db._newId(), ...r };
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

    let out = rows.filter((r) => this.db._match(r, this.filters));
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
