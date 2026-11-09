import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import { COMPLETIONS_SQL } from "../../supabase/functions/social-gateway/core";
/** Stand-ins for the Rainbow tables the reader joins; game_sessions matches the current shape, Mini time included. */
const RAINBOW_TABLES = `create table public.puzzles(id uuid primary key,date date,title text,is_published boolean,format text,is_beta boolean,is_free_puzzle boolean);
 create table public.accounts(user_id text,global_user_id text);
 create table public.game_sessions(user_id text,puzzle_id text,status text,mistakes int,share_grid text,completed_at timestamptz,is_official boolean,format text,entry_context text,active_time_seconds int);`;
it("reads bounded first completions by play date, preserving eligibility, relationships and exact-puzzle gates", async () => {
  const db = new PGlite();
  const a = "user_recent000001",
    b = "user_recent000002",
    c = "user_recent000003";
  const old = "00000000-0000-4000-8000-000000000102",
    fresh = "00000000-0000-4000-8000-000000000103";
  const from = "2026-11-01T00:00:00.000Z",
    until = "2026-11-06T00:00:00.000Z";
  try {
    await db.exec(
      "create role anon nologin;create role authenticated nologin;create role service_role nologin;",
    );
    await db.exec(
      readFileSync("shared-service/fixtures/hub-eb238dd.sql", "utf8"),
    );
    await db.exec(RAINBOW_TABLES);
    await db.exec(
      readFileSync(
        "shared-service/patches/0012_recent_completions.sql",
        "utf8",
      ),
    );
    async function call(fn: string, args: unknown[], role = "social_gateway") {
      await db.exec(`set role ${role}`);
      try {
        return (
          await db.query<{ r: any }>(
            `select social.${fn}(${args.map((_, i) => `$${i + 1}`).join(",")}) r`,
            args,
          )
        ).rows[0].r;
      } finally {
        await db.exec("reset role");
      }
    }
    const read = (who = a, ref: string | null = null) =>
      call("recent_completions", [who, from, until, ref]);
    const record = (
      who: string,
      puzzle: string,
      at = "2026-11-05T12:00:00.000Z",
      detail = "SECRET",
    ) =>
      call(
        "record_completion",
        [
          who,
          "rainbow",
          puzzle,
          at,
          JSON.stringify({ solved: true, mistakes: 1 }),
          JSON.stringify(detail),
        ],
        "social_game_server",
      );
    for (const who of [a, b, c]) {
      await call("ensure_person", [who, "rainbow"]);
      await call("set_profile", [who, who, "fox", "#DED1F2"]);
    }
    const invite = (await call("create_friend_invite", [a, 1])).data;
    const ref = (await call("accept_friend_invite", [b, invite.code, 1])).data
      .friendRef;
    await db.exec("update social.friendships set since='2026-11-01T00:00:00Z'");
    await db.query(
      "insert into public.puzzles values ($1,$2,$3,true,'full',false,false)",
      [old, "2026-09-22", "#102"],
    );
    await db.query("insert into public.accounts values ($1,$1)", [b]);
    await db.query(
      "insert into public.game_sessions values ($1,$2,'won',1,'SECRET','2026-11-05T12:00:00Z',true,'full','daily_home')",
      [b, old],
    );
    // Old #102 still qualifies under the existing gateway, despite Sept publication.
    expect(
      (await db.query(COMPLETIONS_SQL, [JSON.stringify([b]), old])).rows,
    ).toHaveLength(1);
    await record(b, old);
    let response = await read();
    expect(response.ok).toBe(true);
    expect(response.data.rows).toHaveLength(1);
    expect(response.data.rows[0]).toMatchObject({
      puzzleId: old,
      completedAt: "2026-11-05T12:00:00.000Z",
      puzzleDate: "2026-09-22",
      puzzleTitle: "#102",
      result: { friendRef: ref, detailLocked: true },
    });
    expect(JSON.stringify(response)).not.toContain("SECRET");
    // Publishing a newer Daily doesn't erase an already accepted completion.
    await db.query(
      "insert into public.puzzles values ($1,$2,$3,true,'full',false,false)",
      [fresh, "2026-11-06", "#103"],
    );
    expect(
      (await db.query(COMPLETIONS_SQL, [JSON.stringify([b]), old])).rows,
    ).toHaveLength(0);
    expect((await read()).data).toEqual(response.data);
    // Unrelated puzzle completion does not unlock #102. The exact one does.
    await record(a, fresh);
    expect((await read()).data.rows[0].result.detailLocked).toBe(true);
    await record(a, old);
    expect((await read()).data.rows[0].result).toMatchObject({
      detailLocked: false,
      detail: "SECRET",
    });
    // A replay cannot replace its first completion timestamp or result.
    await record(b, old, "2026-11-06T00:00:00.000Z", "REPLAY");
    expect((await read()).data.rows[0]).toMatchObject({
      completedAt: "2026-11-05T12:00:00.000Z",
      result: { detail: "SECRET" },
    });
    // Unshared/archived/beta/free sessions are not imported by this reader.
    for (const context of ["archive", "unlimited"]) {
      await db.query("update public.game_sessions set entry_context=$1", [
        context,
      ]);
      expect(
        (await db.query(COMPLETIONS_SQL, [JSON.stringify([b]), old])).rows,
      ).toHaveLength(0);
    }
    await db.query(
      "update public.game_sessions set entry_context='daily_home',puzzle_id=$1",
      [fresh],
    );
    for (const field of ["is_beta", "is_free_puzzle"]) {
      await db.exec(
        `update public.puzzles set ${field}=true where id='${fresh}'`,
      );
      expect(
        (await db.query(COMPLETIONS_SQL, [JSON.stringify([b]), fresh])).rows,
      ).toHaveLength(0);
      await db.exec(
        `update public.puzzles set ${field}=false where id='${fresh}'`,
      );
    }
    expect((await read(c)).data.rows).toEqual([]);
    expect((await read(a, "not-a-friend")).data.rows).toEqual([]);
    await record(b, "before-connection", "2026-10-31T23:59:59.999Z");
    expect((await read()).data.rows).toHaveLength(1);
    // Window is half-open, and output is strictly bounded before serialization.
    await record(b, "at-start", from);
    await record(b, "at-end", until);
    expect(
      (await read()).data.rows.some((r: any) => r.puzzleId === "at-start"),
    ).toBe(true);
    expect(
      (await read()).data.rows.some((r: any) => r.puzzleId === "at-end"),
    ).toBe(false);
    for (let i = 0; i < 30; i++) await record(b, `p-${i}`);
    response = await read();
    expect(response.data.rows).toHaveLength(25);
    expect(response.data.hasMore).toBe(true);
    expect((await read()).data).toEqual(response.data);
    for (const args of [
      [a, "bad", until, null],
      [a, from, "2026-12-01T00:00:00.000Z", null],
      [a, until, from, null],
    ])
      expect((await call("recent_completions", args)).ok).toBe(false);
    for (const who of [a, b]) {
      await db.exec(
        `update social.friendships set since='2026-11-06T00:00:00Z'`,
      );
      expect((await read(who)).data.rows).toEqual([]);
    }
    await db.exec("update social.friendships set since='2026-11-01T00:00:00Z'");
    await call("block", [b, ref]);
    expect((await read()).data.rows).toEqual([]);
    expect((await read(b)).data.rows).toEqual([]);
    for (const role of [
      "anon",
      "authenticated",
      "service_role",
      "social_game_server",
    ])
      expect(
        (
          await db.query<{ allowed: boolean }>(
            "select has_function_privilege($1,'social.recent_completions(text,text,text,text)','execute') allowed",
            [role],
          )
        ).rows[0].allowed,
      ).toBe(false);
    expect(
      (
        await db.query<{ allowed: boolean }>(
          "select has_function_privilege('social_gateway','social.recent_completions(text,text,text,text)','execute') allowed",
        )
      ).rows[0].allowed,
    ).toBe(true);
  } finally {
    await db.close();
  }
}, 30000);

it("installs after the released 0002-0011 chain, including Mini's 0011, and answers with bounded rows", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "create role anon nologin;create role authenticated nologin;create role service_role nologin;",
    );
    await db.exec(
      readFileSync("shared-service/fixtures/hub-eb238dd.sql", "utf8"),
    );
    await db.exec("create schema auth;create table auth.users(id uuid primary key);");
    await db.exec(
      readFileSync("shared-service/fixtures/crosspuns-eb238dd.sql", "utf8"),
    );
    const released = readdirSync("shared-service/patches")
      .sort()
      .filter((f) => f < "0012");
    expect(released.at(-1)).toBe("0011_rainbow_mini_seconds.sql");
    for (const f of released)
      await db.exec(readFileSync(`shared-service/patches/${f}`, "utf8"));
    await db.exec(RAINBOW_TABLES);
    await db.exec(
      readFileSync("shared-service/patches/0012_recent_completions.sql", "utf8"),
    );
    await db.exec("set role social_gateway");
    const answer = (
      await db.query<{ r: { ok: boolean; data: { rows: unknown[]; hasMore: boolean } } }>(
        "select social.recent_completions($1,$2,$3,null) r",
        ["user_recent000009", "2026-11-01T00:00:00.000Z", "2026-11-06T00:00:00.000Z"],
      )
    ).rows[0].r;
    await db.exec("reset role");
    expect(answer.ok).toBe(true);
    expect(answer.data.rows).toEqual([]);
  } finally {
    await db.close();
  }
}, 30000);
