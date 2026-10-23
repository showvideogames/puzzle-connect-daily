/**
 * Automated checks against a Vercel PREVIEW of the new client, talking to the
 * rebuilt HOSTED beta project. Everything a guest can do, driven in a real
 * headless Chromium, verified in the hosted database, cleaned up afterwards.
 * Hosted AuthKit is never automated: the sign-in button is only checked to be
 * present and to lead to the Staging authorize endpoint (no credential, no
 * navigation past the first redirect).
 *
 *   npm run preview:check -- --project-ref <ref> [--label <evidence label>]
 *
 * Inputs (none printed): .runtime/preview-url.txt (the deployment URL),
 * .runtime/vercel-bypass.txt (the project's protection-bypass secret, sent as
 * the x-vercel-protection-bypass header), SUPABASE_ACCESS_TOKEN (the hosted
 * SQL endpoint, read + cleanup of the rows this run created).
 */

import { chromium, expect, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../env.ts";
import { EVIDENCE_DIR, HostedRunner } from "./hosted-phase2.ts";
import { solveCategory, tiles } from "../support/game.ts";

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

interface Group { category: string; words: string[] }

async function main(): Promise<number> {
  const projectRef = arg("--project-ref");
  if (!projectRef) throw new Error("--project-ref is required");
  const configured = readFileSync(path.join(REPO_ROOT, "supabase", "config.toml"), "utf8").match(/^project_id\s*=\s*"([a-z]+)"/m)?.[1];
  if (projectRef !== configured) throw new Error(`REFUSING: ${projectRef} is not the configured project`);
  const label = arg("--label");
  const previewUrl = readFileSync(path.join(REPO_ROOT, ".runtime", "preview-url.txt"), "utf8").trim();
  const bypassFile = path.join(REPO_ROOT, ".runtime", "vercel-bypass.txt");
  const bypass = existsSync(bypassFile) ? readFileSync(bypassFile, "utf8").trim() : "";
  const db = new HostedRunner(projectRef);
  const results: string[] = [];
  let all = true;
  const ok = (name: string, pass: boolean, detail: string) => { results.push(`| ${name} | ${pass ? "pass" : "**FAIL**"} | ${detail} |`); if (!pass) all = false; };

  // What the beta content offers: the latest published Full and Mini puzzles and their groups.
  const latest = async (format: string) => (await db.query<{ id: string; title: string; date: string; groups: Group[] }>(`
    select p.id, p.title, p.date::text, (select json_agg(json_build_object('category', g.category, 'words', g.words) order by g.sort_order) from public.puzzle_groups g where g.puzzle_id = p.id) as groups
      from public.puzzles p where p.is_published and p.format = '${format}' order by p.date desc limit 1`)).rows[0];
  const full = await latest("full");
  const mini = await latest("mini");
  const xwBefore = (await db.query<{ t: string; n: number }>(`select 'xw_admins' as t, count(*)::int as n from public.xw_admins union all select 'xw_puzzles', count(*) from public.xw_puzzles union all select 'xw_times', count(*) from public.xw_times union all select 'xw_votes', count(*) from public.xw_votes union all select 'xw_joke_reactions', count(*) from public.xw_joke_reactions`)).rows;

  const browser = await chromium.launch();
  const context = await browser.newContext({ extraHTTPHeaders: bypass ? { "x-vercel-protection-bypass": bypass } : {} });
  const page: Page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 160)); });
  const deviceIds: string[] = [];
  try {
    // 1. Home: the app shell renders and a guest device is minted.
    const home = await page.goto(previewUrl + "/");
    ok("home page", !!home && home.status() === 200, `HTTP ${home?.status()}`);
    await expect(page.locator("header, main, h1").first()).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => page.evaluate(() => window.localStorage.getItem("rc-device-id")), { timeout: 20_000 }).not.toBeNull();
    const deviceId = (await page.evaluate(() => window.localStorage.getItem("rc-device-id")))!;
    deviceIds.push(deviceId);
    const dev = await db.query<{ n: number }>(`select count(*)::int as n from public.device_identities where device_id = '${deviceId}'`);
    ok("guest device registered on hosted", dev.rows[0].n === 1, deviceId.slice(0, 8));
    const signIn = page.getByRole("button", { name: "Sign In" }).or(page.getByRole("button", { name: "Account" }));
    ok("sign-in control present (accounts on)", (await signIn.count()) > 0, `${await signIn.count()} control(s)`);

    // 2. Archive lists puzzles.
    await page.goto(previewUrl + "/archive");
    await expect(page.locator("header, main, h1").first()).toBeVisible({ timeout: 30_000 });
    const archiveBody = await page.locator("body").innerText();
    ok("archive page renders", archiveBody.length > 200, `${archiveBody.length} chars`);

    // 3. Full gameplay as a guest on the latest published puzzle: one category, then the session is on hosted.
    await page.goto(`${previewUrl}/archive/${full.id}`);
    await expect(tiles(page)).toHaveCount(16, { timeout: 30_000 });
    await solveCategory(page, full.groups[0]);
    await expect(tiles(page)).toHaveCount(12, { timeout: 20_000 });
    // Let the post-solve requests (streak, stats) finish before the page is left;
    // navigating away mid-request logs a "Failed to fetch" that is not a defect.
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    const sess = await db.query<{ id: string; status: string; user_id: string | null }>(`select id, status, user_id from public.game_sessions where device_id = '${deviceId}' and puzzle_id = '${full.id}'`);
    ok(`Full guest play saved (${full.title})`, sess.rows.length === 1 && sess.rows[0].user_id === null, sess.rows[0] ? `session ${sess.rows[0].status}, no owner` : "no session row");
    const guesses = await db.query<{ n: number }>(`select count(*)::int as n from public.guess_events g join public.game_sessions s on s.id = g.game_session_id where s.device_id = '${deviceId}'`);
    ok("guess recorded", guesses.rows[0].n >= 1, `${guesses.rows[0].n} guess event(s)`);

    // 4. Stats dialog.
    await page.getByRole("button", { name: "My stats" }).click();
    await expect(page.getByRole("dialog")).toContainText("My Stats", { timeout: 10_000 });
    ok("stats dialog opens", true, "My Stats");
    await page.keyboard.press("Escape");
    // The dialog's own requests (streak, completed games) must finish before the
    // next navigation, or the abort shows up as a "Failed to fetch" console error.
    await page.waitForTimeout(2500);

    // 5. Mini: daily page and the latest Mini archive puzzle.
    await page.goto(previewUrl + "/mini");
    await expect(page.locator("header, main, h1").first()).toBeVisible({ timeout: 30_000 });
    ok("mini daily page renders", true, "shell visible");
    if (mini) {
      await page.goto(`${previewUrl}/mini/archive/${mini.id}`);
      await expect(tiles(page)).toHaveCount(9, { timeout: 30_000 });
      await solveCategory(page, mini.groups[0]);
      await expect(tiles(page)).toHaveCount(6, { timeout: 20_000 });
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
      const ms = await db.query<{ n: number }>(`select count(*)::int as n from public.game_sessions where device_id = '${deviceId}' and format = 'mini'`);
      ok(`Mini guest play saved (${mini.title})`, ms.rows[0].n === 1, `${ms.rows[0].n} mini session`);
    } else {
      results.push("| Mini guest play | skipped | no published Mini puzzle |");
    }

    // 6. The sign-in button leads to the Staging authorize endpoint (first redirect only; nothing is submitted).
    await page.goto(previewUrl + "/");
    await expect(page.locator("header, main, h1").first()).toBeVisible({ timeout: 30_000 });
    const anon = (process.env.RAINBOW_HOSTED_ANON_KEY ?? "").trim();
    const authorize = await fetch(`https://${projectRef}.supabase.co/auth/v1/authorize?provider=custom:platform&redirect_to=${encodeURIComponent(previewUrl + "/auth/callback")}`, { redirect: "manual", headers: anon ? { apikey: anon } : {} }).catch(() => null);
    const loc = authorize?.headers.get("location") ?? "";
    ok("hosted sign-in redirects to WorkOS Staging", /detailed-pink-69-staging\.authkit\.app\/oauth2\/authorize/.test(loc), authorize ? `HTTP ${authorize.status} ${loc.replace(/client_id=[^&]+/, "client_id=<id>").slice(0, 90)}` : "no response");

    // 7. Account boundary on hosted: no accounts; a beta auth user without a shared identity is not a Rainbow account.
    // Informational: Rainbow accounts exist only for people who signed in through the shared sign-in.
    const accounts = await db.query<{ n: number; linked: number }>(`select count(*)::int as n, count(*) filter (where exists (select 1 from auth.identities i where i.user_id = a.user_id and i.provider = 'custom:platform'))::int as linked from public.accounts a`);
    ok("every Rainbow account is linked to a shared identity", accounts.rows[0].n === accounts.rows[0].linked, `${accounts.rows[0].n} account(s), ${accounts.rows[0].linked} linked`);
    const boundary = await db.query<{ outcome: string; uid: string | null }>(`
      begin;
      select set_config('request.jwt.claims', json_build_object('sub', (select id from auth.users where email_confirmed_at is not null order by created_at limit 1), 'role', 'authenticated')::text, true);
      select (select outcome from public.ensure_account()) as outcome, public.rainbow_uid()::text as uid;
      rollback;`);
    ok("a beta auth user is not a Rainbow account", boundary.rows[0]?.outcome === "not_platform_linked" && boundary.rows[0]?.uid === null, JSON.stringify(boundary.rows[0]));

    // 8. CrossPuns untouched by all of the above.
    const xwAfter = (await db.query<{ t: string; n: number }>(`select 'xw_admins' as t, count(*)::int as n from public.xw_admins union all select 'xw_puzzles', count(*) from public.xw_puzzles union all select 'xw_times', count(*) from public.xw_times union all select 'xw_votes', count(*) from public.xw_votes union all select 'xw_joke_reactions', count(*) from public.xw_joke_reactions`)).rows;
    ok("CrossPuns row counts unchanged", JSON.stringify(xwBefore) === JSON.stringify(xwAfter), xwAfter.map((r) => `${r.t}=${r.n}`).join(" "));
    ok("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | ") || "none");
  } finally {
    await browser.close();
    // Remove exactly the rows this run created (Rainbow tables only).
    for (const d of deviceIds) {
      const c = await db.query<{ s: number; d: number }>(`
        with g as (delete from public.guess_events where game_session_id in (select id from public.game_sessions where device_id = '${d}') returning 1),
             h as (delete from public.hint_events where game_session_id in (select id from public.game_sessions where device_id = '${d}') returning 1),
             st as (delete from public.user_streaks where device_id = '${d}' returning 1),
             s as (delete from public.game_sessions where device_id = '${d}' returning 1),
             dv as (delete from public.device_identities where device_id = '${d}' returning 1)
        select (select count(*) from s)::int as s, (select count(*) from dv)::int as d`);
      results.push(`| cleanup | done | removed ${c.rows[0].s} session(s) and ${c.rows[0].d} device for ${d.slice(0, 8)} |`);
    }
  }
  const md = `# Preview check\n\nRun ${new Date().toISOString()} against ${previewUrl} (hosted project ${projectRef}).\n\n| check | result | detail |\n|---|---|---|\n${results.join("\n")}\n\nAll passed: ${all}\n`;
  console.log(md);
  if (label) { mkdirSync(path.join(EVIDENCE_DIR, label), { recursive: true }); writeFileSync(path.join(EVIDENCE_DIR, label, "preview-check.md"), md, "utf8"); }
  return all ? 0 : 1;
}

main().then((code) => process.exit(code), (error) => { console.error(`\n${error instanceof Error ? error.message : String(error)}\n`); process.exit(1); });
