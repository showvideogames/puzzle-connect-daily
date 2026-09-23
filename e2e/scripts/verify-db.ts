/**
 * The Docker-free half of the harness: prove the SCHEMA and the FIXTURES on
 * a real Postgres engine, in-process.
 *
 * `npm run e2e:db:verify`
 *
 * WHAT THIS IS
 * ------------
 * PGlite is genuine PostgreSQL compiled to WebAssembly. This script starts an
 * empty one, applies the pre-git baseline and every migration in order, then
 * runs the ENTIRE seed through the application's own RPCs — which means
 * `validate_puzzle_content`, `validate_custom_puzzle_content`,
 * `admin_save_puzzle`'s versioning logic and the admin-role check all really
 * execute, in PL/pgSQL, against real tables.
 *
 * WHAT THIS IS NOT
 * ----------------
 * It is not the E2E environment and it does not replace it. There is no
 * PostgREST and no GoTrue here, so nothing about HTTP request shapes,
 * table-level GRANTs, JWT handling or the browser is exercised. A green run
 * here means "the schema builds and the fixtures are valid"; it says nothing
 * about whether the app works. Only `npm run e2e:test` answers that.
 *
 * It exists because (a) it is the fastest possible check that a new migration
 * has not broken the clean-database path, and (b) on a machine with no
 * container runtime it is the most that CAN be verified — stated plainly
 * rather than dressed up as coverage it does not have.
 */

import { PGlite } from "@electric-sql/pglite";
import { applySchemaPlan, buildSchemaPlan } from "./lib/schema.ts";
import { seedFixtures, type SeedBackend } from "./lib/seed-core.ts";
import {
  ACCOUNTS,
  CUSTOM_PUBLIC,
  FULL_RAINBOW,
  MINI_RAINBOW,
  OFFICIAL_PUZZLES,
} from "../fixtures/catalog.ts";

/** Identity switching, the same contract auth.uid() implements on a real instance. */
async function actAs(db: PGlite, userId: string | null): Promise<void> {
  const claims = userId ? JSON.stringify({ sub: userId, role: "authenticated" }) : "";
  await db.query("select set_config('request.jwt.claims', $1, false)", [claims]);
}

function pgliteSeedBackend(db: PGlite): SeedBackend {
  return {
    async createAccount(email) {
      const result = await db.query<{ id: string }>(
        "insert into auth.users (email) values ($1) returning id",
        [email]
      );
      return result.rows[0].id;
    },
    async grantAdmin(userId) {
      await db.query("insert into public.user_roles (user_id, role) values ($1, 'admin')", [userId]);
    },
    async saveOfficialPuzzle(adminUserId, metadata, content) {
      await actAs(db, adminUserId);
      const result = await db.query<{ result: { puzzle_id: string } }>(
        "select public.admin_save_puzzle(null, $1::jsonb, $2::jsonb) as result",
        [JSON.stringify(metadata), JSON.stringify(content)]
      );
      return result.rows[0].result.puzzle_id;
    },
    async createCustomPuzzle(creatorName, title, visibility, content) {
      // A visitor to /create is anonymous; seed it as one.
      await actAs(db, null);
      const result = await db.query<{
        result: { puzzle_id: string; share_id: string; short_code: string | null };
      }>("select public.create_custom_puzzle($1, $2, $3, $4::jsonb) as result", [
        creatorName,
        title,
        visibility,
        JSON.stringify(content),
      ]);
      const row = result.rows[0].result;
      return { puzzleId: row.puzzle_id, shareId: row.share_id, shortCode: row.short_code ?? null };
    },
  };
}

interface Check {
  name: string;
  run: (db: PGlite) => Promise<void>;
}

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/**
 * Assertions about what the seed actually produced. These are the invariants
 * the browser tests will lean on, checked here first so a broken fixture
 * fails in two seconds rather than in a browser five minutes later.
 */
const CHECKS: Check[] = [
  {
    name: "every fixture puzzle is stored with the right shape",
    async run(db) {
      for (const fixture of OFFICIAL_PUZZLES) {
        const rows = await db.query<{
          id: string;
          format: string;
          is_published: boolean;
          groups: number;
          words: number;
        }>(
          `select p.id, p.format, p.is_published,
                  count(g.id)::int as groups,
                  coalesce(sum(array_length(g.words, 1)), 0)::int as words
             from public.puzzles p
             left join public.puzzle_groups g on g.puzzle_id = p.id
            where p.date = $1 and p.format = $2
            group by p.id`,
          [fixture.date, fixture.format]
        );
        expect(rows.rows.length === 1, `expected exactly one ${fixture.format} puzzle on ${fixture.date}`);
        const row = rows.rows[0];
        const expectedGroups = fixture.groups.length;
        const expectedWords = fixture.groups.reduce((n, g) => n + g.words.length, 0);
        expect(row.groups === expectedGroups, `${fixture.key}: ${row.groups} groups, expected ${expectedGroups}`);
        expect(row.words === expectedWords, `${fixture.key}: ${row.words} words, expected ${expectedWords}`);
        expect(row.is_published === fixture.isPublished, `${fixture.key}: is_published mismatch`);
      }
    },
  },
  {
    name: "Rainbow herrings are the right size for their format",
    async run(db) {
      const rows = await db.query<{ title: string; herring: string[] | null; format: string }>(
        "select title, rainbow_herring as herring, format from public.puzzles order by date, format"
      );
      const byTitle = new Map(rows.rows.map((r) => [r.title, r]));
      const full = byTitle.get(FULL_RAINBOW.title);
      const mini = byTitle.get(MINI_RAINBOW.title);
      expect(full?.herring?.length === 4, "the Full Rainbow fixture must store four Rainbow answers");
      expect(mini?.herring?.length === 3, "the Mini Rainbow fixture must store three Rainbow answers");
      expect(mini?.format === "mini", "the Mini Rainbow fixture must be stored as format 'mini'");
    },
  },
  {
    name: "every answer was stored uppercase",
    async run(db) {
      const rows = await db.query<{ word: string }>(
        `select unnest(words) as word from public.puzzle_groups`
      );
      const wrong = rows.rows.map((r) => r.word).filter((w) => w !== w.toUpperCase());
      expect(wrong.length === 0, `answers stored in mixed case: ${wrong.join(", ")}`);
    },
  },
  {
    name: "each puzzle has exactly one version, and a re-save mints none",
    async run(db) {
      const before = await db.query<{ n: number }>("select count(*)::int as n from public.puzzle_versions");
      expect(before.rows[0].n === OFFICIAL_PUZZLES.length, "expected one version per seeded puzzle");

      // Re-saving identical content must NOT create a version. This is the
      // exact behaviour the Admin browser test asserts through the UI; it is
      // cheaper and more precise to also pin it here.
      const { officialContent, officialMetadata } = await import("../fixtures/payloads.ts");
      const admin = await db.query<{ user_id: string }>(
        "select user_id from public.user_roles where role = 'admin' limit 1"
      );
      await actAs(db, admin.rows[0].user_id);
      const target = await db.query<{ id: string }>(
        "select id from public.puzzles where date = $1 and format = $2",
        [FULL_RAINBOW.date, FULL_RAINBOW.format]
      );
      const again = await db.query<{ result: { created_version: boolean } }>(
        "select public.admin_save_puzzle($1::uuid, $2::jsonb, $3::jsonb) as result",
        [
          target.rows[0].id,
          JSON.stringify(officialMetadata(FULL_RAINBOW)),
          JSON.stringify(officialContent(FULL_RAINBOW)),
        ]
      );
      expect(
        again.rows[0].result.created_version === false,
        "an unchanged re-save created a new puzzle version"
      );
      const after = await db.query<{ n: number }>("select count(*)::int as n from public.puzzle_versions");
      expect(after.rows[0].n === before.rows[0].n, "puzzle_versions grew on an unchanged re-save");
    },
  },
  {
    name: "a gameplay change DOES mint a new version",
    async run(db) {
      const { officialContent, officialMetadata } = await import("../fixtures/payloads.ts");
      const admin = await db.query<{ user_id: string }>(
        "select user_id from public.user_roles where role = 'admin' limit 1"
      );
      await actAs(db, admin.rows[0].user_id);
      const target = await db.query<{ id: string }>(
        "select id from public.puzzles where date = $1 and format = $2",
        [MINI_RAINBOW.date, MINI_RAINBOW.format]
      );
      const edited = {
        ...MINI_RAINBOW,
        groups: MINI_RAINBOW.groups.map((g, i) =>
          i === 0 ? { ...g, category: `${g.category} (edited)` } : g
        ),
      };
      const result = await db.query<{ result: { created_version: boolean; version_number: number } }>(
        "select public.admin_save_puzzle($1::uuid, $2::jsonb, $3::jsonb) as result",
        [
          target.rows[0].id,
          JSON.stringify(officialMetadata(MINI_RAINBOW)),
          JSON.stringify(officialContent(edited)),
        ]
      );
      expect(result.rows[0].result.created_version === true, "a real content change minted no new version");
      expect(result.rows[0].result.version_number === 2, "the edited puzzle should be at Version 2");
    },
  },
  {
    name: "the admin gate actually refuses a non-admin",
    async run(db) {
      const { officialContent, officialMetadata } = await import("../fixtures/payloads.ts");
      const player = await db.query<{ id: string }>("select id from auth.users where email = $1", [
        ACCOUNTS.player.email,
      ]);
      await actAs(db, player.rows[0].id);
      let refused = false;
      try {
        await db.query("select public.admin_save_puzzle(null, $1::jsonb, $2::jsonb)", [
          JSON.stringify({ ...officialMetadata(FULL_RAINBOW), date: "2026-07-01" }),
          JSON.stringify(officialContent(FULL_RAINBOW)),
        ]);
      } catch (error) {
        refused = /admin role required/i.test(String(error));
      }
      expect(refused, "a non-admin was able to save a puzzle");
      await actAs(db, null);
    },
  },
  {
    name: "the public custom puzzle is readable by its share id",
    async run(db) {
      const rows = await db.query<{ share_id: string; short_code: string | null; title: string }>(
        "select share_id, short_code, title from public.custom_puzzles"
      );
      expect(rows.rows.length === 1, "expected exactly one seeded custom puzzle");
      expect(rows.rows[0].title === CUSTOM_PUBLIC.title, "custom puzzle title mismatch");
      expect(!!rows.rows[0].share_id, "custom puzzle has no share id");
    },
  },
];

async function main(): Promise<number> {
  const db = new PGlite();
  try {
    console.log("Applying baseline + every migration to a clean in-process Postgres…");
    const plan = buildSchemaPlan({ includeSupabaseStubs: true, includeReset: false });
    await applySchemaPlan({ exec: (sql) => db.exec(sql) }, plan, (label, index, total) => {
      if (label.startsWith("migration ")) return; // one line per migration is noise
      console.log(`  [${index}/${total}] ${label}`);
    });
    console.log(`  applied ${plan.filter((s) => s.label.startsWith("migration ")).length} migrations`);

    console.log("Seeding fixtures through the application's own RPCs…");
    await seedFixtures(pgliteSeedBackend(db), {
      apiUrl: "pglite://in-process",
      log: (message) => console.log(`  ${message}`),
    });

    console.log("Checking what the seed produced…");
    for (const check of CHECKS) {
      await check.run(db);
      console.log(`  ✓ ${check.name}`);
    }

    console.log("\nSchema and fixtures verified on a real Postgres engine.\n");
    return 0;
  } finally {
    await db.close();
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`\n${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(1);
  }
);
