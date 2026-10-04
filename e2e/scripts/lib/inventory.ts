/**
 * The Rainbow/Mini OWNERSHIP INVENTORY: every database object Rainbow owns,
 * read from `pg_catalog` on a database that was built from the repository's
 * baseline and nothing else.
 *
 * Why this exists
 * ---------------
 * Rainbow shares a Supabase project with other games during beta. "What is
 * Rainbow's" must therefore be an exact, machine-readable list rather than a
 * habit, because two tools act on it:
 *
 *   * the CI check (`npm run db:manifest -- --check`) fails when the baseline
 *     no longer produces exactly the committed manifest — so an object that
 *     was created by hand in a dashboard, or a migration that forgot a grant,
 *     is caught as a diff instead of discovered on a blank project later;
 *   * the scoped teardown (`e2e/scripts/teardown-sql.ts`) drops ONLY what the
 *     manifest names, object by object, and can never touch another tenant's
 *     tables or reset the shared `public` schema.
 *
 * Everything is read from the catalog, never from the SQL files, so the
 * manifest describes what the database actually contains.
 *
 * Runs on both backends: the real local stack (via `pg`) and PGlite. Both are
 * genuine PostgreSQL, so the catalog queries are identical; only the
 * `storage` schema is guarded, because PGlite has no Supabase Storage.
 */

export interface SqlQueryRunner {
  query<T = Record<string, unknown>>(sql: string): Promise<{ rows: T[] }>;
}

export interface ColumnInfo {
  name: string;
  type: string;
  notNull: boolean;
  default: string | null;
  comment: string | null;
}

export interface TableInfo {
  name: string;
  rlsEnabled: boolean;
  rlsForced: boolean;
  comment: string | null;
  columns: ColumnInfo[];
  constraints: { name: string; type: string; definition: string }[];
  indexes: { name: string; definition: string }[];
  triggers: { name: string; definition: string }[];
  policies: {
    name: string;
    command: string;
    permissive: boolean;
    roles: string[];
    using: string | null;
    withCheck: string | null;
  }[];
  /** Privileges per role, e.g. { anon: ["SELECT"], authenticated: [...] }. */
  grants: Record<string, string[]>;
}

export interface FunctionInfo {
  name: string;
  /** `pg_get_function_identity_arguments` — the signature the CLI and DROP need. */
  args: string;
  returns: string;
  language: string;
  kind: "function" | "procedure" | "aggregate" | "window";
  securityDefiner: boolean;
  volatility: "immutable" | "stable" | "volatile";
  config: string[] | null;
  /** Roles that may EXECUTE, out of anon / authenticated / service_role. */
  executableBy: string[];
  comment: string | null;
}

export interface Inventory {
  schema: "public";
  types: { name: string; labels: string[] }[];
  tables: TableInfo[];
  views: string[];
  sequences: string[];
  functions: FunctionInfo[];
  /** Extensions installed on the database the inventory was read from — for information only. */
  extensions: { name: string; schema: string }[];
  storage: {
    available: boolean;
    buckets: { id: string; name: string; public: boolean }[];
    policies: {
      name: string;
      command: string;
      roles: string[];
      using: string | null;
      withCheck: string | null;
    }[];
  };
}

const CLIENT_ROLES = ["anon", "authenticated", "service_role"] as const;

function volatility(code: string): FunctionInfo["volatility"] {
  return code === "i" ? "immutable" : code === "s" ? "stable" : "volatile";
}

function kind(code: string): FunctionInfo["kind"] {
  return code === "p" ? "procedure" : code === "a" ? "aggregate" : code === "w" ? "window" : "function";
}

/** Postgres returns text[] as a string in some drivers; normalise both shapes. */
function toArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    const inner = value.replace(/^\{|\}$/g, "");
    return inner === "" ? [] : inner.split(",").map((s) => s.replace(/^"|"$/g, ""));
  }
  return [];
}

export async function collectInventory(runner: SqlQueryRunner): Promise<Inventory> {
  const q = async <T>(sql: string) => (await runner.query<T>(sql)).rows;

  const types = (
    await q<{ name: string; labels: unknown }>(`
      select t.typname as name, array_agg(e.enumlabel order by e.enumsortorder) as labels
        from pg_type t
        join pg_enum e on e.enumtypid = t.oid
        join pg_namespace n on n.oid = t.typnamespace
       where n.nspname = 'public'
       group by t.typname
       order by t.typname`)
  ).map((r) => ({ name: r.name, labels: toArray(r.labels) }));

  const tableRows = await q<{ name: string; rls_enabled: boolean; rls_forced: boolean; comment: string | null }>(`
    select c.relname as name, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced,
           obj_description(c.oid, 'pg_class') as comment
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
     order by c.relname`);

  const columnRows = await q<{
    table: string; name: string; type: string; not_null: boolean; default: string | null; comment: string | null;
  }>(`
    select c.relname as "table", a.attname as name, format_type(a.atttypid, a.atttypmod) as type,
           a.attnotnull as not_null, pg_get_expr(d.adbin, d.adrelid) as "default",
           col_description(c.oid, a.attnum) as comment
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where n.nspname = 'public' and c.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped
     order by c.relname, a.attnum`);

  const constraintRows = await q<{ table: string; name: string; type: string; definition: string }>(`
    select c.relname as "table", con.conname as name, con.contype as type, pg_get_constraintdef(con.oid) as definition
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       -- PostgreSQL 18 (PGlite) catalogues NOT NULL as constraints (contype n);
       -- the hosted stack is 15 and does not. Columns carry notNull already.
       and con.contype <> 'n'
     order by c.relname, con.conname`);

  const indexRows = await q<{ table: string; name: string; definition: string }>(`
    select tablename as "table", indexname as name, indexdef as definition
      from pg_indexes
     where schemaname = 'public'
     order by tablename, indexname`);

  const triggerRows = await q<{ table: string; name: string; definition: string }>(`
    select c.relname as "table", t.tgname as name, pg_get_triggerdef(t.oid) as definition
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and not t.tgisinternal
     order by c.relname, t.tgname`);

  const policyRows = await q<{
    table: string; name: string; cmd: string; permissive: string; roles: unknown; qual: string | null; with_check: string | null;
  }>(`
    select tablename as "table", policyname as name, cmd, permissive, roles, qual, with_check
      from pg_policies
     where schemaname = 'public'
     order by tablename, policyname`);

  const grantRows = await q<{ table: string; grantee: string; privilege: string }>(`
    select table_name as "table", grantee, privilege_type as privilege
      from information_schema.role_table_grants
     where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role')
     order by table_name, grantee, privilege_type`);

  const tables: TableInfo[] = tableRows.map((t) => ({
    name: t.name,
    rlsEnabled: t.rls_enabled,
    rlsForced: t.rls_forced,
    comment: t.comment,
    columns: columnRows
      .filter((c) => c.table === t.name)
      .map((c) => ({ name: c.name, type: c.type, notNull: c.not_null, default: c.default, comment: c.comment })),
    constraints: constraintRows
      .filter((c) => c.table === t.name)
      .map((c) => ({ name: c.name, type: c.type, definition: c.definition })),
    indexes: indexRows.filter((i) => i.table === t.name).map((i) => ({ name: i.name, definition: i.definition })),
    triggers: triggerRows.filter((r) => r.table === t.name).map((r) => ({ name: r.name, definition: r.definition })),
    policies: policyRows
      .filter((p) => p.table === t.name)
      .map((p) => ({
        name: p.name,
        command: p.cmd,
        permissive: p.permissive === "PERMISSIVE",
        roles: toArray(p.roles),
        using: p.qual,
        withCheck: p.with_check,
      })),
    grants: Object.fromEntries(
      CLIENT_ROLES.map((role) => [
        role,
        grantRows.filter((g) => g.table === t.name && g.grantee === role).map((g) => g.privilege),
      ]).filter(([, privileges]) => (privileges as string[]).length > 0)
    ),
  }));

  const views = (await q<{ name: string }>(`select viewname as name from pg_views where schemaname = 'public' order by 1`)).map(
    (r) => r.name
  );
  const sequences = (
    await q<{ name: string }>(`select sequencename as name from pg_sequences where schemaname = 'public' order by 1`)
  ).map((r) => r.name);

  const functionRows = await q<{
    name: string; args: string; returns: string; language: string; prokind: string; security_definer: boolean;
    provolatile: string; config: unknown; comment: string | null; anon: boolean; authenticated: boolean; service_role: boolean;
  }>(`
    select p.proname as name,
           pg_get_function_identity_arguments(p.oid) as args,
           pg_get_function_result(p.oid) as returns,
           l.lanname as language,
           p.prokind::text as prokind,
           p.prosecdef as security_definer,
           p.provolatile::text as provolatile,
           p.proconfig as config,
           obj_description(p.oid, 'pg_proc') as comment,
           has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
           has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_language l on l.oid = p.prolang
     where n.nspname = 'public'
     order by p.proname, pg_get_function_identity_arguments(p.oid)`);

  const functions: FunctionInfo[] = functionRows.map((f) => ({
    name: f.name,
    args: f.args,
    returns: f.returns,
    language: f.language,
    kind: kind(f.prokind),
    securityDefiner: f.security_definer,
    volatility: volatility(f.provolatile),
    config: f.config == null ? null : toArray(f.config),
    executableBy: CLIENT_ROLES.filter((role) => f[role]),
    comment: f.comment,
  }));

  const extensions = await q<{ name: string; schema: string }>(`
    select extname as name, extnamespace::regnamespace::text as schema from pg_extension order by 1`);

  // "Available" means Supabase Storage has initialised this database, which
  // is when storage.buckets carries the columns the Storage API adds. A local
  // stack started without the storage service has a bare `storage` schema
  // and no buckets; PGlite has no `storage` schema at all.
  const storageAvailable =
    (
      await q<{ ok: boolean }>(`
        select to_regclass('storage.buckets') is not null
           and to_regclass('storage.objects') is not null
           and exists (
             select 1 from information_schema.columns
              where table_schema = 'storage' and table_name = 'buckets' and column_name = 'public'
           ) as ok`)
    )[0]?.ok === true;
  const buckets = storageAvailable
    ? await q<{ id: string; name: string; public: boolean }>(`select id, name, public from storage.buckets order by id`)
    : [];
  const storagePolicies = storageAvailable
    ? (
        await q<{ name: string; cmd: string; roles: unknown; qual: string | null; with_check: string | null }>(`
          select policyname as name, cmd, roles, qual, with_check
            from pg_policies
           where schemaname = 'storage' and tablename = 'objects'
           order by policyname`)
      ).map((p) => ({ name: p.name, command: p.cmd, roles: toArray(p.roles), using: p.qual, withCheck: p.with_check }))
    : [];

  return {
    schema: "public",
    types,
    tables,
    views,
    sequences,
    functions,
    extensions,
    storage: { available: storageAvailable, buckets, policies: storagePolicies },
  };
}

/** A stable, human-readable Markdown rendering of the inventory. */
export function renderInventoryMarkdown(inv: Inventory, title: string, preamble: string): string {
  const out: string[] = [];
  out.push(`# ${title}`, "", preamble.trim(), "");

  out.push("## Summary", "");
  out.push("| Category | Count |", "|---|---|");
  out.push(`| Tables | ${inv.tables.length} |`);
  out.push(`| Columns | ${inv.tables.reduce((n, t) => n + t.columns.length, 0)} |`);
  out.push(`| Constraints | ${inv.tables.reduce((n, t) => n + t.constraints.length, 0)} |`);
  out.push(`| Indexes | ${inv.tables.reduce((n, t) => n + t.indexes.length, 0)} |`);
  out.push(`| Functions | ${inv.functions.length} |`);
  out.push(`| Triggers | ${inv.tables.reduce((n, t) => n + t.triggers.length, 0)} |`);
  out.push(`| RLS policies | ${inv.tables.reduce((n, t) => n + t.policies.length, 0)} |`);
  out.push(`| Enum types | ${inv.types.length} |`);
  out.push(`| Views | ${inv.views.length} |`);
  out.push(`| Sequences | ${inv.sequences.length} |`);
  out.push(`| Storage buckets | ${inv.storage.available ? inv.storage.buckets.length : "n/a (no storage on this backend)"} |`);
  out.push("");

  if (inv.types.length) {
    out.push("## Enum types", "");
    for (const t of inv.types) out.push(`- \`${t.name}\`: ${t.labels.map((l) => `\`${l}\``).join(", ")}`);
    out.push("");
  }

  out.push("## Tables", "");
  for (const t of inv.tables) {
    out.push(`### \`${t.name}\``, "");
    if (t.comment) out.push(`> ${t.comment}`, "");
    out.push(`RLS: ${t.rlsEnabled ? "enabled" : "**DISABLED**"}${t.rlsForced ? " (forced)" : ""}. Grants: ${
      Object.keys(t.grants).length
        ? Object.entries(t.grants)
            .map(([role, privs]) => `${role}=${privs.join("/")}`)
            .join(", ")
        : "none for anon/authenticated/service_role"
    }`, "");
    out.push("| Column | Type | Null | Default |", "|---|---|---|---|");
    for (const c of t.columns) {
      out.push(`| \`${c.name}\` | ${c.type} | ${c.notNull ? "not null" : "null"} | ${c.default ? `\`${c.default}\`` : ""} |`);
    }
    out.push("");
    if (t.constraints.length) {
      out.push("Constraints:", "");
      for (const c of t.constraints) out.push(`- \`${c.name}\` ${c.definition}`);
      out.push("");
    }
    if (t.indexes.length) {
      out.push("Indexes:", "");
      for (const i of t.indexes) out.push(`- \`${i.definition}\``);
      out.push("");
    }
    if (t.triggers.length) {
      out.push("Triggers:", "");
      for (const tr of t.triggers) out.push(`- \`${tr.definition}\``);
      out.push("");
    }
    if (t.policies.length) {
      out.push("Policies:", "");
      for (const p of t.policies) {
        out.push(
          `- \`${p.name}\` — ${p.command} to ${p.roles.join(", ")}` +
            (p.using ? `; using \`${p.using}\`` : "") +
            (p.withCheck ? `; with check \`${p.withCheck}\`` : "")
        );
      }
      out.push("");
    }
  }

  out.push("## Functions", "");
  out.push("| Function | Returns | Definer | Volatility | Executable by |", "|---|---|---|---|---|");
  for (const f of inv.functions) {
    out.push(
      `| \`${f.name}(${f.args})\` | ${f.returns} | ${f.securityDefiner ? "yes" : "no"} | ${f.volatility} | ${
        f.executableBy.length ? f.executableBy.join(", ") : "none of the client roles"
      } |`
    );
  }
  out.push("");

  out.push("## Storage", "");
  if (!inv.storage.available) {
    out.push("Storage is not part of this backend; see `0002_rainbow_storage.sql` for the bucket and its policies.", "");
  } else {
    for (const b of inv.storage.buckets) out.push(`- bucket \`${b.id}\` (${b.public ? "public" : "private"})`);
    for (const p of inv.storage.policies) {
      out.push(
        `- policy \`${p.name}\` on storage.objects — ${p.command} to ${p.roles.join(", ")}` +
          (p.using ? `; using \`${p.using}\`` : "") +
          (p.withCheck ? `; with check \`${p.withCheck}\`` : "")
      );
    }
    out.push("");
  }

  out.push("## Extensions present on the database this was read from", "");
  out.push("Rainbow requires none beyond what every Supabase project ships with; listed for completeness.", "");
  for (const e of inv.extensions) out.push(`- \`${e.name}\` (${e.schema})`);
  out.push("");

  return out.join("\n");
}

/** Deep-equality diff of two inventories, as a list of human-readable lines. */
export function diffInventories(expected: Inventory, actual: Inventory): string[] {
  const lines: string[] = [];
  const byName = <T extends { name: string }>(items: T[]) => new Map(items.map((i) => [i.name, i]));

  const compareSets = (label: string, a: string[], b: string[]) => {
    for (const x of a) if (!b.includes(x)) lines.push(`${label}: missing from database: ${x}`);
    for (const x of b) if (!a.includes(x)) lines.push(`${label}: present in database but not in manifest: ${x}`);
  };

  compareSets("table", expected.tables.map((t) => t.name), actual.tables.map((t) => t.name));
  compareSets("view", expected.views, actual.views);
  compareSets("sequence", expected.sequences, actual.sequences);
  compareSets("type", expected.types.map((t) => t.name), actual.types.map((t) => t.name));
  compareSets(
    "function",
    expected.functions.map((f) => `${f.name}(${f.args})`),
    actual.functions.map((f) => `${f.name}(${f.args})`)
  );

  const expectedTables = byName(expected.tables);
  for (const t of actual.tables) {
    const e = expectedTables.get(t.name);
    if (!e) continue;
    const label = `table ${t.name}`;
    if (e.rlsEnabled !== t.rlsEnabled) lines.push(`${label}: RLS enabled ${e.rlsEnabled} -> ${t.rlsEnabled}`);
    compareSets(`${label} column`, e.columns.map((c) => c.name), t.columns.map((c) => c.name));
    for (const c of t.columns) {
      const ec = e.columns.find((x) => x.name === c.name);
      if (!ec) continue;
      if (ec.type !== c.type || ec.notNull !== c.notNull || (ec.default ?? null) !== (c.default ?? null)) {
        lines.push(`${label}.${c.name}: ${ec.type}${ec.notNull ? " not null" : ""} default ${ec.default} -> ${c.type}${c.notNull ? " not null" : ""} default ${c.default}`);
      }
    }
    compareSets(`${label} constraint`, e.constraints.map((c) => `${c.name} ${c.definition}`), t.constraints.map((c) => `${c.name} ${c.definition}`));
    compareSets(`${label} index`, e.indexes.map((i) => i.definition), t.indexes.map((i) => i.definition));
    compareSets(`${label} trigger`, e.triggers.map((i) => i.definition), t.triggers.map((i) => i.definition));
    compareSets(
      `${label} policy`,
      e.policies.map((p) => `${p.name} ${p.command} [${p.roles.join(",")}] using(${p.using}) check(${p.withCheck})`),
      t.policies.map((p) => `${p.name} ${p.command} [${p.roles.join(",")}] using(${p.using}) check(${p.withCheck})`)
    );
    compareSets(
      `${label} grant`,
      Object.entries(e.grants).flatMap(([r, ps]) => ps.map((p) => `${r}:${p}`)),
      Object.entries(t.grants).flatMap(([r, ps]) => ps.map((p) => `${r}:${p}`))
    );
  }

  const expectedFns = new Map(expected.functions.map((f) => [`${f.name}(${f.args})`, f]));
  for (const f of actual.functions) {
    const key = `${f.name}(${f.args})`;
    const e = expectedFns.get(key);
    if (!e) continue;
    if (e.returns !== f.returns) lines.push(`function ${key}: returns ${e.returns} -> ${f.returns}`);
    if (e.securityDefiner !== f.securityDefiner) lines.push(`function ${key}: security definer ${e.securityDefiner} -> ${f.securityDefiner}`);
    if (e.volatility !== f.volatility) lines.push(`function ${key}: volatility ${e.volatility} -> ${f.volatility}`);
    if (JSON.stringify(e.config) !== JSON.stringify(f.config)) lines.push(`function ${key}: config ${JSON.stringify(e.config)} -> ${JSON.stringify(f.config)}`);
    compareSets(`function ${key} executable by`, e.executableBy, f.executableBy);
  }

  if (expected.storage.available && actual.storage.available) {
    compareSets("storage bucket", expected.storage.buckets.map((b) => `${b.id} public=${b.public}`), actual.storage.buckets.map((b) => `${b.id} public=${b.public}`));
    compareSets(
      "storage policy",
      expected.storage.policies.map((p) => `${p.name} ${p.command} [${p.roles.join(",")}] using(${p.using}) check(${p.withCheck})`),
      actual.storage.policies.map((p) => `${p.name} ${p.command} [${p.roles.join(",")}] using(${p.using}) check(${p.withCheck})`)
    );
  }

  return lines;
}
