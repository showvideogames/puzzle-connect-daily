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
  FULL_CLASSIC,
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
    // The same fixtures src/test/skillScore.test.ts pins for the browser
    // copy of the formula. If either side changes without the other, one
    // of the two fails.
    name: "the SQL skill score matches the browser formula on shared fixtures",
    async run(db) {
      const cases: [boolean, number, string[], boolean, string | null, string, number][] = [
        // Full — the examples in the brief, then each rule on its own.
        [true, 0, ["orange", "green", "blue", "red"], true, "in_game", "full", 96],
        [true, 0, ["red", "orange", "green", "blue"], true, "post_game", "full", 99],
        [true, 0, ["red", "blue", "green", "orange"], false, null, "full", 99],
        [true, 0, ["red", "blue", "green", "orange"], true, "post_game", "full", 100],
        [true, 1, ["orange", "blue", "green", "red"], true, "in_game", "full", 89],
        [false, 4, ["red", "blue"], true, "post_game", "full", 69],
        [true, 0, ["orange", "green", "blue", "red"], false, null, "full", 95],
        [true, 1, ["orange", "green", "blue", "red"], false, null, "full", 88],
        [true, 2, ["orange", "green", "blue", "red"], false, null, "full", 81],
        [true, 3, ["orange", "green", "blue", "red"], false, null, "full", 74],
        [true, 0, ["green", "orange", "blue", "red"], false, null, "full", 96],
        [true, 0, ["blue", "orange", "green", "red"], false, null, "full", 97],
        [true, 0, ["red", "orange", "green", "blue"], false, null, "full", 98],
        [true, 2, ["red", "blue", "green", "orange"], false, null, "full", 85],
        [true, 2, ["red", "blue", "orange", "green"], false, null, "full", 84],
        [false, 4, [], false, null, "full", 50],
        [false, 4, ["orange"], false, null, "full", 54],
        [false, 4, ["blue", "red"], false, null, "full", 68],
        [false, 4, [], true, "post_game", "full", 51],
        [true, 3, ["orange", "green", "blue", "red"], true, null, "full", 75],
        // Mini — the original formula, unchanged.
        [true, 0, ["red", "blue", "green"], false, null, "mini", 95],
        [true, 0, ["green", "blue", "red"], false, null, "mini", 90],
        [true, 0, ["green", "blue", "red"], true, "in_game", "mini", 94],
        [true, 0, ["green", "blue", "red"], true, "post_game", "mini", 91],
        [false, 4, ["green", "blue"], false, null, "mini", 58],
        [false, 4, ["red"], false, null, "mini", 56],
      ];
      for (const [won, mistakes, order, rainbow, source, format, expected] of cases) {
        const r = await db.query<{ score: number }>(
          "select public.skill_score($1, $2, $3::jsonb, $4, $5, $6) as score",
          [won, mistakes, JSON.stringify(order), rainbow, source, format]
        );
        expect(
          r.rows[0].score === expected,
          `skill_score(${won}, ${mistakes}, ${JSON.stringify(order)}, ${rainbow}, ${source}, ${format}) = ${r.rows[0].score}, expected ${expected}`
        );
      }
    },
  },
  {
    name: "the puzzle report aggregates real sessions and their wrong guesses",
    async run(db) {
      await actAs(db, null);
      const puzzle = await db.query<{ id: string }>(
        "select id from public.puzzles where date = $1 and format = 'full'",
        [FULL_RAINBOW.date]
      );
      const puzzleId = puzzle.rows[0].id;
      const g = FULL_RAINBOW.groups;
      // Three from the easiest category plus one from the next: a classic
      // "one away" miss, submitted by both players so it tops the report.
      const wrongGuess = [g[0].words[0], g[0].words[1], g[0].words[2], g[1].words[0]];

      async function play(opts: { mistakes: number; order: string[]; rainbow: boolean; rainbowIndex: number | null }) {
        const identity = await db.query<{ device_id: string; device_token: string }>(
          "select * from public.create_device_identity()"
        );
        const { device_id, device_token } = identity.rows[0];
        const session = await db.query<{ id: string }>(
          "select public.create_game_session($1, $2, $3, 'daily') as id",
          [puzzleId, device_id, device_token]
        );
        const sessionId = session.rows[0].id;
        expect(!!sessionId, "create_game_session should return a session id for a published puzzle");
        const events = [
          {
            guess_number: 1,
            words: wrongGuess,
            correct: false,
            group_name: null,
            guessed_at: new Date().toISOString(),
            is_rainbow_attempt: false,
            is_one_away: true,
            is_almost_rainbow: false,
            active_time_seconds: 10,
            groups_solved: 0,
          },
        ];
        const recorded = await db.query<{ n: number }>(
          "select public.record_guess_events($1, $2, $3, $4::jsonb) as n",
          [sessionId, device_id, device_token, JSON.stringify(events)]
        );
        expect(recorded.rows[0].n === 1, "record_guess_events should insert the wrong guess");
        const done = await db.query<{ ok: boolean }>(
          `select public.finalize_game_session($1, $2, $3, true, $4, 120, $5, $6, $7::jsonb, false, '', true, null) as ok`,
          [sessionId, device_id, device_token, opts.mistakes, opts.rainbow, opts.rainbowIndex, JSON.stringify(opts.order)]
        );
        expect(done.rows[0].ok === true, "finalize_game_session should accept the completed session");
      }

      // Player A: one mistake, easiest-first, Rainbow spotted mid-game → 88 + 0 + 1 = 89.
      await play({ mistakes: 1, order: ["orange", "green", "blue", "red"], rainbow: true, rainbowIndex: 2 });
      // Player B: one mistake, full reverse order, no Rainbow → 88 + 4 = 92.
      await play({ mistakes: 1, order: ["red", "blue", "green", "orange"], rainbow: false, rainbowIndex: null });

      const result = await db.query<{ report: Record<string, unknown> }>(
        "select public.get_puzzle_report($1) as report",
        [puzzleId]
      );
      const report = result.rows[0].report;
      expect(report.total_players === 2, `total_players = ${report.total_players}, expected 2`);
      expect(report.wins === 2, `wins = ${report.wins}, expected 2`);
      expect(report.perfect === 0, `perfect = ${report.perfect}, expected 0`);
      expect(report.players_with_wrong_guess === 2, `players_with_wrong_guess = ${report.players_with_wrong_guess}, expected 2`);
      expect(report.rainbow_in_game === 1, `rainbow_in_game = ${report.rainbow_in_game}, expected 1`);
      expect(report.rainbow_post_game === 0, `rainbow_post_game = ${report.rainbow_post_game}, expected 0`);
      const first = report.first_solved as Record<string, number>;
      expect(first.orange === 1 && first.red === 1, `first_solved = ${JSON.stringify(first)}`);
      const scores = report.score_counts as Record<string, number>;
      expect(scores["89"] === 1 && scores["92"] === 1, `score_counts = ${JSON.stringify(scores)}, expected {89:1, 92:1}`);
      const common = report.common_wrong_guesses as { words: string[]; players: number; one_away: boolean }[];
      expect(common.length === 1, `expected one distinct wrong guess, got ${common.length}`);
      expect(common[0].players === 2, `the shared wrong guess should count 2 players, got ${common[0].players}`);
      expect(common[0].one_away === true, "the shared wrong guess should be flagged one away");
      const expectedWords = [...wrongGuess].map((w) => w.toUpperCase()).sort();
      expect(
        JSON.stringify(common[0].words) === JSON.stringify(expectedWords),
        `wrong-guess words ${JSON.stringify(common[0].words)}, expected ${JSON.stringify(expectedWords)}`
      );
    },
  },
  {
    // Runs after the report check above, on the same puzzle (whose two
    // players each made one wrong guess; one found the Rainbow in play after
    // two categories).
    name: "the crowd report never counts finding the Rainbow as a wrong guess",
    async run(db) {
      await actAs(db, null);
      const pr = await db.query<{ id: string }>("select id from public.puzzles where date = $1 and format = 'full'", [
        FULL_RAINBOW.date,
      ]);
      const puzzleId = pr.rows[0].id;
      const byDifficulty = (d: number) => FULL_RAINBOW.groups.find((g) => g.difficulty === d)!.words;
      const [Y, G, B, R] = [byDifficulty(1), byDifficulty(2), byDifficulty(3), byDifficulty(4)];
      const herring = FULL_RAINBOW.rainbowHerring!;
      const miss = [Y[0], Y[1], G[0], G[1]];
      const colour: Record<number, string> = { 1: "orange", 2: "green", 3: "blue", 4: "red" };

      async function finish(guesses: string[][], opts: { mistakes: number; rainbowIndex: number | null }) {
        const id = (await db.query<{ device_id: string; device_token: string }>("select * from public.create_device_identity()")).rows[0];
        const sessionId = (
          await db.query<{ id: string }>("select public.create_game_session($1, $2, $3, 'daily_home') as id", [
            puzzleId, id.device_id, id.device_token,
          ])
        ).rows[0].id;
        const events = guesses.map((words, i) => {
          const group = FULL_RAINBOW.groups.find((g) => g.words.every((w) => words.includes(w)));
          return { guess_number: i + 1, words, correct: !!group, group_name: group ? colour[group.difficulty] : null };
        });
        await db.query("select public.record_guess_events($1, $2, $3, $4::jsonb)", [
          sessionId, id.device_id, id.device_token, JSON.stringify(events),
        ]);
        await db.query(
          `select public.finalize_game_session($1, $2, $3, true, $4, 60, $5, $6, '["orange","green","blue","red"]'::jsonb, false, '', true, null)`,
          [sessionId, id.device_id, id.device_token, opts.mistakes, opts.rainbowIndex !== null, opts.rainbowIndex]
        );
        return { ...id, sessionId, guesses: guesses.length };
      }

      // Perfect, and found the Rainbow first (before any category).
      await finish([herring, Y, G, B, R], { mistakes: 0, rainbowIndex: 0 });
      // Perfect, never found it.
      await finish([Y, G, B, R], { mistakes: 0, rainbowIndex: null });
      // One real mistake, then found it last through the post-game prompt.
      const p3 = await finish([miss, Y, G, B, R], { mistakes: 1, rainbowIndex: null });
      await db.query(
        "select public.record_bonus_rainbow($1, $2, $3, $4, $5::jsonb, true, now(), 60, 4::smallint)",
        [p3.sessionId, p3.device_id, p3.device_token, p3.guesses + 1, JSON.stringify(herring)]
      );

      const report = (await db.query<{ r: Record<string, unknown> }>("select public.get_puzzle_report($1) as r", [puzzleId]))
        .rows[0].r;
      const total = report.total_players as number;
      expect(total === 5, `total_players = ${total}, expected 5`);
      expect(report.perfect === 2, `perfect = ${report.perfect}, expected 2`);
      expect(
        report.players_with_wrong_guess === 3,
        `players_with_wrong_guess = ${report.players_with_wrong_guess}, expected 3 (the Rainbow finder with no mistakes is perfect, not wrong)`
      );
      expect(
        (report.perfect as number) + (report.players_with_wrong_guess as number) === total,
        "perfect and wrong-guess players must be the same finishers, adding up to the total"
      );
      const herringKey = JSON.stringify([...herring].map((w) => w.toUpperCase()).sort());
      const listed = report.common_wrong_guesses as { words: string[]; players: number }[];
      expect(!listed.some((g) => JSON.stringify(g.words) === herringKey), `the Rainbow's words must not be listed: ${JSON.stringify(listed)}`);
      const missKey = JSON.stringify([...miss].map((w) => w.toUpperCase()).sort());
      expect(listed.some((g) => JSON.stringify(g.words) === missKey), "a real wrong guess must still be listed");
      expect(listed.length === 2, `expected the two real wrong guesses, got ${JSON.stringify(listed)}`);
      expect(report.rainbow_found === 3, `rainbow_found = ${report.rainbow_found}, expected 3`);
      expect(report.rainbow_first === 1, `rainbow_first = ${report.rainbow_first}, expected 1`);
      expect(report.rainbow_last === 1, `rainbow_last = ${report.rainbow_last}, expected 1`);
    },
  },
  {
    // The database half of the Luck Score: who counts, and whose path
    // matches. The browser half (the formula, the 500-player threshold,
    // the wording) is pinned in src/test/luckScore.test.ts.
    name: "Luck counts only eligible first attempts and matches exact ordered paths",
    async run(db) {
      await actAs(db, null);
      const puzzleRow = await db.query<{ id: string }>(
        "select id from public.puzzles where date = $1 and format = 'full'",
        [FULL_CLASSIC.date]
      );
      const puzzleId = puzzleRow.rows[0].id;
      const words = (d: number) => FULL_CLASSIC.groups.find((g) => g.difficulty === d)!.words;
      const [Y, G, B, R] = [words(1), words(2), words(3), words(4)];
      const colour: Record<number, string> = { 1: "orange", 2: "green", 3: "blue", 4: "red" };
      const groupOf = (guess: string[]) => {
        const set = new Set(guess.map((w) => w.toUpperCase()));
        return FULL_CLASSIC.groups.find((g) => g.words.every((w) => set.has(w)));
      };
      // Four wrong guesses, each one word from every category.
      const W = [0, 1, 2, 3].map((i) => [Y[i], G[(i + 1) % 4], B[(i + 2) % 4], R[(i + 3) % 4]]);

      interface Identity { device_id: string; device_token: string }
      interface Played extends Identity { sessionId: string; official: boolean; guesses: number }

      async function newIdentity(): Promise<Identity> {
        const r = await db.query<Identity>("select * from public.create_device_identity()");
        return r.rows[0];
      }

      async function play(guesses: string[][], identity?: Identity): Promise<Played> {
        const id = identity ?? (await newIdentity());
        const s = await db.query<{ id: string }>(
          "select public.create_game_session($1, $2, $3, 'daily_home') as id",
          [puzzleId, id.device_id, id.device_token]
        );
        const sessionId = s.rows[0].id;
        expect(!!sessionId, "create_game_session should return a session id");
        const order: string[] = [];
        let mistakes = 0;
        const events = guesses.map((g, i) => {
          const group = groupOf(g);
          if (group) order.push(colour[group.difficulty]);
          else mistakes += 1;
          return {
            guess_number: i + 1,
            words: g,
            correct: !!group,
            group_name: group ? colour[group.difficulty] : null,
            guessed_at: new Date().toISOString(),
            is_rainbow_attempt: false,
            is_one_away: false,
            is_almost_rainbow: false,
            active_time_seconds: 10 * (i + 1),
            groups_solved: order.length,
          };
        });
        await db.query("select public.record_guess_events($1, $2, $3, $4::jsonb)", [
          sessionId, id.device_id, id.device_token, JSON.stringify(events),
        ]);
        const won = order.length === 4;
        const done = await db.query<{ ok: boolean }>(
          `select public.finalize_game_session($1, $2, $3, $4, $5, 60, false, null, $6::jsonb, false, '', true, null) as ok`,
          [sessionId, id.device_id, id.device_token, won, mistakes, JSON.stringify(order)]
        );
        return { ...id, sessionId, official: done.rows[0].ok === true, guesses: guesses.length };
      }

      // guessedAt defaults to a fresh, distinct time per submission, as the
      // browser captures it at each Submit.
      let clock = Date.parse("2026-06-12T12:00:00Z");
      async function bonus(p: Played, guessNumber: number, bonusWords: string[], correct: boolean, guessedAt?: string) {
        const at = guessedAt ?? new Date((clock += 1000)).toISOString();
        await db.query(
          "select public.record_bonus_rainbow($1, $2, $3, $4, $5::jsonb, $6, $7::timestamptz, 60, 4::smallint)",
          [p.sessionId, p.device_id, p.device_token, guessNumber, JSON.stringify(bonusWords), correct, at]
        );
      }
      const bonusCount = async (p: Played) =>
        (
          await db.query<{ n: number }>(
            "select count(*)::int as n from public.guess_events where game_session_id = $1 and attempt_type = 'bonus_rainbow'",
            [p.sessionId]
          )
        ).rows[0].n;

      type Luck = { status: string; reason?: string; eligible_players?: number; same_path?: number; ceiling?: number; min_players?: number };
      async function luck(id: Identity, pid = puzzleId): Promise<Luck> {
        const r = await db.query<{ r: Luck }>("select public.get_luck_report($1, $2, $3) as r", [
          pid, id.device_id, id.device_token,
        ]);
        return r.rows[0].r;
      }

      // ---- ordering and normalization -------------------------------------
      const a = await play([Y, G, B, R]);
      // Same guesses, words tapped in another order and in lower case.
      const b = await play([[...Y].reverse().map((w) => w.toLowerCase()), [G[2], G[0], G[3], G[1]], B, R]);
      // Same four guesses, different ORDER of guesses: a different path.
      const c = await play([G, Y, B, R]);
      const d = await play([W[0], Y, G, B, R]);
      const e = await play([Y, W[0], W[1], W[2], W[3]]);
      expect([a, b, c, d, e].every((p) => p.official), "every first attempt should be official");

      let r = await luck(a);
      expect(r.status === "ok", `luck(a) status ${r.status}`);
      expect(r.eligible_players === 5, `eligible_players = ${r.eligible_players}, expected 5`);
      expect(r.same_path === 2, `word order within a guess must not matter: same_path = ${r.same_path}, expected 2`);
      expect(r.ceiling === 5000 && r.min_players === 500, `ceiling/min_players = ${r.ceiling}/${r.min_players}`);
      r = await luck(c);
      expect(r.same_path === 1, `guess order must matter: same_path = ${r.same_path}, expected 1`);
      r = await luck(e);
      expect(r.status === "ok" && r.same_path === 1, "a loss has a path too");

      // ---- replays and bad credentials ------------------------------------
      const replay = await play([Y, G, B, R], c);
      expect(!replay.official, "a replay by the same player must not be official");
      r = await luck(c);
      expect(r.eligible_players === 5 && r.same_path === 1, `a replay must not count: ${JSON.stringify(r)}`);
      r = await luck({ device_id: a.device_id, device_token: "not-the-token" });
      expect(r.status === "no_session", `a wrong device token must find nothing, got ${r.status}`);

      // ---- the post-game Rainbow prompt updates the path -------------------
      const rainbowWords = [Y[0], G[0], B[0], R[0]];
      const f = await play([Y, G, B, R]);
      r = await luck(a);
      expect(r.same_path === 3, `f matches a before its Rainbow: same_path = ${r.same_path}, expected 3`);
      await bonus(f, f.guesses + 1, rainbowWords, true);
      r = await luck(f);
      expect(r.same_path === 1, `finding the Rainbow later must change f's path: same_path = ${r.same_path}`);
      r = await luck(a);
      expect(r.same_path === 2, `and a is back to 2, got ${r.same_path}`);

      // One prompt answer per Full game. h answers wrong, sees the Rainbow
      // revealed, then (a refresh, another device) enters the revealed right
      // answer — proposing the same guess number again, as a reloaded page
      // does. It is refused: no second row, and no Rainbow found.
      const wrongRainbow = [Y[1], G[1], B[1], R[1]];
      const h = await play([Y, G, B, R]);
      await bonus(h, h.guesses + 1, wrongRainbow, false);
      await bonus(h, h.guesses + 1, rainbowWords, true);
      expect((await bonusCount(h)) === 1, `a second answer must be refused, found ${await bonusCount(h)} prompt rows`);
      const hRow = await db.query<{ found: boolean; source: string | null; attempted: boolean }>(
        "select found_rainbow as found, rainbow_source as source, bonus_rainbow_attempted as attempted from public.game_sessions where id = $1",
        [h.sessionId]
      );
      expect(
        hRow.rows[0].found === false && hRow.rows[0].source === null && hRow.rows[0].attempted === true,
        `re-entering the revealed answer must earn nothing: ${JSON.stringify(hRow.rows[0])}`
      );
      const j = await play([Y, G, B, R]);
      await bonus(j, j.guesses + 1, wrongRainbow, false);
      await bonus(j, j.guesses + 2, rainbowWords, true);
      r = await luck(h);
      expect(r.same_path === 2, `h and j both have exactly one wrong answer, same_path = ${r.same_path}`);

      // A different second wrong answer is refused too, so k's path is the
      // same one-wrong-answer path as h, j and l.
      const otherWrong = [Y[2], G[2], B[2], R[2]];
      const k = await play([Y, G, B, R]);
      await bonus(k, k.guesses + 1, wrongRainbow, false);
      await bonus(k, k.guesses + 1, otherWrong, false);
      const l = await play([Y, G, B, R]);
      await bonus(l, l.guesses + 1, wrongRainbow, false);
      expect((await bonusCount(k)) === 1, `k's second answer must be refused, found ${await bonusCount(k)}`);
      r = await luck(l);
      expect(r.same_path === 4, `h, j, k and l share one path, same_path(l) = ${r.same_path}`);

      // A repeated save of the SAME submission (a network retry) is stored once.
      const retryAt = "2026-06-12T13:00:00.000Z";
      const m = await play([Y, G, B, R]);
      await bonus(m, m.guesses + 1, wrongRainbow, false, retryAt);
      await bonus(m, m.guesses + 1, wrongRainbow, false, retryAt);
      expect((await bonusCount(m)) === 1, `a retried save must not duplicate, found ${await bonusCount(m)}`);
      r = await luck(m);
      expect(r.same_path === 5, `m (one wrong answer) joins h, j, k and l, same_path = ${r.same_path}`);

      // A Rainbow found during play leaves nothing to answer afterwards.
      const n = await play([Y, G, rainbowWords, B, R]);
      await db.query("update public.game_sessions set found_rainbow = true, rainbow_source = 'in_game', rainbow_solve_index = 2 where id = $1", [n.sessionId]);
      await bonus(n, n.guesses + 1, rainbowWords, true);
      expect((await bonusCount(n)) === 0, `an in-game find must refuse a prompt answer, found ${await bonusCount(n)}`);

      // ---- the Mini boundary: nothing in these migrations reaches a Mini ----
      // A Mini's prompt is saved exactly as before (the browser's guess
      // number, a clash ignored, no server_numbered, no one-answer rule), it
      // gets no crowd report and no Luck — just as on the live site, where
      // neither report function exists yet.
      const miniRow = await db.query<{ id: string }>(
        "select id from public.puzzles where date = $1 and format = 'mini'",
        [MINI_RAINBOW.date]
      );
      const miniId = await newIdentity();
      const miniSession = await db.query<{ id: string }>(
        "select public.create_game_session($1, $2, $3, 'daily_home') as id",
        [miniRow.rows[0].id, miniId.device_id, miniId.device_token]
      );
      await db.query(
        `select public.finalize_game_session($1, $2, $3, true, 0, 30, false, null, '["green","blue","red"]'::jsonb, false, '', true, null)`,
        [miniSession.rows[0].id, miniId.device_id, miniId.device_token]
      );
      const miniPlayed: Played = { ...miniId, sessionId: miniSession.rows[0].id, official: true, guesses: 3 };
      await bonus(miniPlayed, 4, ["X1", "X2", "X3"], false);
      await bonus(miniPlayed, 4, ["X4", "X5", "X6"], false);
      await bonus(miniPlayed, 5, ["X7", "X8", "X9"], false);
      const miniRows = await db.query<{ n: number; numbered: number }>(
        `select count(*)::int as n, count(*) filter (where server_numbered)::int as numbered
           from public.guess_events where game_session_id = $1 and attempt_type = 'bonus_rainbow'`,
        [miniPlayed.sessionId]
      );
      expect(
        miniRows.rows[0].n === 2 && miniRows.rows[0].numbered === 0,
        `a Mini prompt must save as before (clash ignored, later number kept, unmarked): ${JSON.stringify(miniRows.rows[0])}`
      );
      const miniReport = await db.query<{ report: unknown }>("select public.get_puzzle_report($1) as report", [miniRow.rows[0].id]);
      expect(miniReport.rows[0].report === null, `a Mini must get no crowd report, got ${JSON.stringify(miniReport.rows[0].report)}`);
      const miniLuck = await luck(miniId, miniRow.rows[0].id);
      expect(miniLuck.status === "unsupported", `a Mini must get no Luck, got ${miniLuck.status}`);
      const fullReport = await db.query<{ report: { total_players: number } | null }>(
        "select public.get_puzzle_report($1) as report",
        [puzzleId]
      );
      expect((fullReport.rows[0].report?.total_players ?? 0) > 0, "the regular game must still get its crowd report");
      const numbered = await db.query<{ ok: boolean }>(
        `select bool_and(coalesce(g.server_numbered, false)) as ok
           from public.guess_events g join public.game_sessions s on s.id = g.game_session_id
          where g.attempt_type = 'bonus_rainbow' and s.format = 'full'`
      );
      expect(numbered.rows[0].ok === true, "every Full prompt row saved by the function must be marked server_numbered");
      r = await luck(a);
      expect(r.eligible_players === 12, `eligible_players = ${r.eligible_players}, expected 12`);

      // ---- sessions that must never count ---------------------------------
      const admin = await db.query<{ user_id: string }>(
        "select user_id from public.user_roles where role = 'admin' limit 1"
      );
      const adminId = admin.rows[0].user_id;
      async function insertSession(opts: {
        userId?: string | null;
        deviceId: string;
        untyped?: boolean;
        numbers?: number[];
        oldStylePrompt?: boolean;
      }) {
        const s = await db.query<{ id: string }>(
          `insert into public.game_sessions
             (puzzle_id, user_id, device_id, status, won, mistakes, completed_at, is_official, format, solve_order)
           values ($1, $2, $3, 'won', true, 0, now(), true, 'full', '["orange","green","blue","red"]'::jsonb)
           returning id`,
          [puzzleId, opts.userId ?? null, opts.deviceId]
        );
        const numbers = opts.numbers ?? [1, 2, 3, 4];
        for (const [i, g] of [Y, G, B, R].entries()) {
          await db.query(
            `insert into public.guess_events (game_session_id, guess_number, words, correct, attempt_type)
             values ($1, $2, $3::jsonb, true, $4)`,
            [s.rows[0].id, numbers[i], JSON.stringify(g), opts.untyped ? null : "normal"]
          );
        }
        if (opts.oldStylePrompt) {
          // A prompt try saved under the old numbering: no server_numbered
          // mark, so a later try may have been dropped without a trace.
          await db.query(
            `insert into public.guess_events (game_session_id, guess_number, words, correct, attempt_type)
             values ($1, 5, $2::jsonb, false, 'bonus_rainbow')`,
            [s.rows[0].id, JSON.stringify(wrongRainbow)]
          );
        }
      }
      await insertSession({ userId: adminId, deviceId: "admin-device" });
      await insertSession({ deviceId: "legacy-device", untyped: true });
      await insertSession({ deviceId: "unknown" });
      await insertSession({ deviceId: "gappy-device", numbers: [1, 2, 4, 5] });
      await insertSession({ deviceId: "old-prompt-device", oldStylePrompt: true });
      // A "loss" with three categories solved cannot happen in play (the only
      // words left would be the last category, which is then correct), so a
      // row that says so is misrecorded and must not count.
      const misrecorded = await db.query<{ id: string }>(
        `insert into public.game_sessions
           (puzzle_id, device_id, status, won, mistakes, completed_at, is_official, format, solve_order)
         values ($1, 'three-solved-loss', 'lost', false, 4, now(), true, 'full', '["orange","green","blue"]'::jsonb)
         returning id`,
        [puzzleId]
      );
      for (const [i, g] of [Y, G, B, W[0], W[1], W[2], W[3]].entries()) {
        await db.query(
          `insert into public.guess_events (game_session_id, guess_number, words, correct, attempt_type)
           values ($1, $2, $3::jsonb, $4, 'normal')`,
          [misrecorded.rows[0].id, i + 1, JSON.stringify(g), i < 3]
        );
      }
      r = await luck(a);
      expect(
        r.eligible_players === 12,
        `admin, legacy, 'unknown', gapped, old-style prompt and three-solved "loss" sessions must not count: ${r.eligible_players}`
      );
      await actAs(db, adminId);
      r = await luck({ device_id: "", device_token: "" });
      expect(r.status === "not_eligible" && r.reason === "admin", `admin's own report: ${JSON.stringify(r)}`);
      await actAs(db, null);

      // ---- Full only -------------------------------------------------------
      const mini = await db.query<{ id: string }>(
        "select id from public.puzzles where date = $1 and format = 'mini'",
        [MINI_RAINBOW.date]
      );
      r = await luck(a, mini.rows[0].id);
      expect(r.status === "unsupported", `a Mini must not get a Luck report, got ${r.status}`);

      // ---- the ceiling is stable per puzzle --------------------------------
      await db.query(
        "insert into public.luck_score_ceilings (effective_from, ceiling) values (($1::date + 1), 50000)",
        [FULL_CLASSIC.date]
      );
      r = await luck(a);
      expect(r.ceiling === 5000, `a ceiling raised AFTER the puzzle's date must not change it, got ${r.ceiling}`);
      await db.query(
        "insert into public.luck_score_ceilings (effective_from, ceiling) values ($1::date, 20000)",
        [FULL_CLASSIC.date]
      );
      r = await luck(a);
      expect(r.ceiling === 20000, `a ceiling effective on the puzzle's date applies, got ${r.ceiling}`);
      await db.query("delete from public.luck_score_ceilings where effective_from >= $1::date", [FULL_CLASSIC.date]);

      // ---- 500 eligible players --------------------------------------------
      // 488 more perfect Yellow→Red solves, written straight into the tables
      // (this is an in-process throwaway database) to reach exactly 500.
      await db.query(
        `with s as (
           insert into public.game_sessions
             (puzzle_id, device_id, status, won, mistakes, completed_at, is_official, format)
           select $1, 'bulk-' || n, 'won', true, 0, now(), true, 'full'
             from generate_series(1, 488) as n
           returning id
         )
         insert into public.guess_events (game_session_id, guess_number, words, correct, attempt_type)
         select s.id, x.n, x.words, true, 'normal'
           from s
          cross join (values (1, $2::jsonb), (2, $3::jsonb), (3, $4::jsonb), (4, $5::jsonb)) as x(n, words)`,
        [puzzleId, JSON.stringify(Y), JSON.stringify(G), JSON.stringify(B), JSON.stringify(R)]
      );
      r = await luck(a);
      expect(r.eligible_players === 500, `eligible_players = ${r.eligible_players}, expected 500`);
      expect(r.same_path === 490, `same_path = ${r.same_path}, expected 490 (a, b and the 488)`);
      r = await luck(f);
      expect(r.same_path === 1, `f's Rainbow path is still unique among 500, got ${r.same_path}`);
    },
  },
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
