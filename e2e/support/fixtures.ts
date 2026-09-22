/**
 * The Playwright fixture every spec imports instead of `@playwright/test`.
 *
 * It does five things, all of which would otherwise be copy-pasted into
 * every test:
 *
 *   1. Pins the browser clock to the fixture date, so "today's puzzle" is a
 *      fixed row and nothing depends on when the suite is run.
 *   2. Seeds localStorage before the app boots — the tutorial flag, the
 *      settings blob (including dark mode) and, by default, the
 *      landing-screen flag.
 *   3. Blocks every request that is not to the app or the local Supabase
 *      instance. Google Analytics is in index.html, so without this a test
 *      run would send real hits to the production property; more broadly, a
 *      test that cannot reach the internet cannot touch production at all.
 *   4. Collects page errors, console errors and failed app/API requests, and
 *      FAILS the test if any appear.
 *   5. Exposes a service-role Supabase client for the few set-up and
 *      verification steps that legitimately need one, always pointed at the
 *      validated local instance.
 */

import { test as base, expect, type Page, type Request } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { guardContext, loadE2eConfig } from "../env.ts";
import { assertDisposableTarget } from "../safety.ts";
import { FIXTURE_CLOCK_ISO, FIXTURE_TODAY } from "../fixtures/catalog.ts";
import { readSeedManifest, type SeedManifest } from "../fixtures/manifest.ts";

const config = loadE2eConfig();

/** Settings this app keeps in localStorage. Mirrors src/lib/settings.ts. */
export interface SeededSettings {
  darkMode?: boolean;
  colorPaletteMode?: boolean;
  colorCodeTiles?: boolean;
  soundEnabled?: boolean;
  guessHistory?: boolean;
  arrangeTiles?: boolean;
  showRainbowColors?: boolean;
  hapticEnabled?: boolean;
}

export interface AppOptions {
  /**
   * Skip the "Play" landing screen by pre-setting its per-date flag.
   * True by default: the landing is a one-screen gate that has its own test,
   * and going through it in every spec would only add a click.
   */
  skipLanding: boolean;
  /** Settings written to `connections-settings` before the app boots. */
  settings: SeededSettings;
  /** Extra localStorage entries, written before any app script runs. */
  storage: Record<string, string>;
  /**
   * Console messages that are expected in this test and must not fail it.
   * Deliberately per-test and explicit: a global allowlist is how a real
   * regression ends up permanently ignored.
   */
  allowedConsoleErrors: RegExp[];
}

export interface AppFixtures {
  /** The ids the seed generated. */
  seed: SeedManifest;
  /** Errors observed so far in this test — readable by a test that wants to assert on them. */
  pageProblems: PageProblems;
  /** Service-role client against the validated local instance. */
  admin: SupabaseClient;
}

export interface PageProblems {
  pageErrors: string[];
  consoleErrors: string[];
  failedRequests: string[];
  /**
   * Requests the browser cancelled because the page navigated away while
   * they were in flight. Not failures — see the requestfailed handler.
   */
  abortedByNavigation: string[];
  /**
   * Every off-machine request the page attempted, blocked. Includes the
   * known ones — `isolation.spec.ts` asserts on this list, so "the app
   * suddenly talks to somewhere new" is still visible even though the known
   * entries do not fail every test.
   */
  blockedExternal: string[];
}

/**
 * Hosts a test is allowed to reach: the app and the local Supabase instance,
 * and nothing else.
 */
function isLocalRequest(request: Request): boolean {
  let host: string;
  try {
    host = new URL(request.url()).hostname.toLowerCase();
  } catch {
    return true; // data:, blob: — nothing leaves the browser
  }
  return host === "127.0.0.1" || host === "localhost" || host === "::1" || host.endsWith(".localhost");
}

/**
 * External hosts the application loads BY DESIGN in production, and which
 * the harness blocks deliberately rather than by accident.
 *
 * `index.html` loads Google's analytics tag on every page. Blocking it is the
 * whole point — a test run must never send hits to the live property — but
 * treating a request the app makes unconditionally as a per-test failure
 * would simply turn the entire suite red and teach everyone to ignore it.
 *
 * So these are blocked silently, and `tests/isolation.spec.ts` asserts that
 * this list is exactly what the app attempts. Anything else that tries to
 * leave the machine fails the test it happened in.
 */
const KNOWN_EXTERNAL_HOSTS = ["www.googletagmanager.com", "www.google-analytics.com"];

function isKnownExternalHost(request: Request): boolean {
  try {
    return KNOWN_EXTERNAL_HOSTS.includes(new URL(request.url()).hostname.toLowerCase());
  } catch {
    return false;
  }
}

export const test = base.extend<AppOptions & AppFixtures>({
  skipLanding: [true, { option: true }],
  settings: [{}, { option: true }],
  storage: [{}, { option: true }],
  allowedConsoleErrors: [[], { option: true }],

  seed: async ({}, use) => {
    await use(readSeedManifest());
  },

  admin: async ({}, use) => {
    assertDisposableTarget("an E2E service-role client", config, guardContext());
    const client = createClient(config.apiUrl, config.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    await use(client);
  },

  pageProblems: async ({}, use) => {
    await use({
      pageErrors: [],
      consoleErrors: [],
      failedRequests: [],
      blockedExternal: [],
      abortedByNavigation: [],
    });
  },

  page: async (
    { page, skipLanding, settings, storage, allowedConsoleErrors, pageProblems },
    use,
    testInfo
  ) => {
    // ── 1. A fixed clock ──
    // setFixedTime, not install(): Date.now() becomes deterministic while
    // timers, requestAnimationFrame and performance.now() keep running
    // normally. The active-play timer is measured from performance.now(),
    // so it still advances — which is what the Mini timer tests need.
    await page.clock.setFixedTime(new Date(FIXTURE_CLOCK_ISO));

    // ── 2. Pre-boot storage ──
    const seededStorage: Record<string, string> = {
      // The tutorial auto-opens 800ms after the first ever load. Every test
      // would otherwise have to dismiss it.
      "tutorial-seen": "true",
      "connections-settings": JSON.stringify(settings),
      ...(skipLanding
        ? { [`landing-seen-${FIXTURE_TODAY}`]: "1", [`landing-seen-${FIXTURE_TODAY}-mini`]: "1" }
        : {}),
      ...storage,
    };
    await page.addInitScript((entries: Record<string, string>) => {
      for (const [key, value] of Object.entries(entries)) {
        try {
          window.localStorage.setItem(key, value);
        } catch {
          // storage unavailable — the app copes, and so does the test
        }
      }
    }, seededStorage);

    // ── 3. Nothing leaves the machine ──
    await page.route("**/*", async (route) => {
      const request = route.request();
      if (isLocalRequest(request)) {
        await route.continue();
        return;
      }
      pageProblems.blockedExternal.push(`${request.method()} ${request.url()}`);
      if (!isKnownExternalHost(request)) {
        pageProblems.failedRequests.push(
          `an unexpected request tried to leave this machine: ${request.method()} ${request.url()}`
        );
      }
      await route.abort("blockedbyclient");
    });

    // ── 4. Problems are failures ──
    page.on("pageerror", (error) => {
      pageProblems.pageErrors.push(error.message);
    });
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const text = message.text();
      if (allowedConsoleErrors.some((pattern) => pattern.test(text))) return;
      // The blocked-external-request abort above surfaces here too; it is
      // already reported once, as itself.
      if (/net::ERR_BLOCKED_BY_CLIENT/.test(text)) return;
      pageProblems.consoleErrors.push(text);
    });
    page.on("requestfailed", (request) => {
      if (!isLocalRequest(request)) return; // already handled by the route above
      const reason = request.failure()?.errorText ?? "failed";
      // A request the browser CANCELLED because the page navigated away is
      // not a failure, it is what navigation looks like. The app fires
      // several reads on mount, and any test that clicks a link or reloads
      // will cancel whichever have not come back yet. Treating those as
      // defects makes the whole suite red for doing the thing it is for.
      if (/ERR_ABORTED|NS_BINDING_ABORTED/.test(reason)) {
        pageProblems.abortedByNavigation.push(`${request.method()} ${request.url()}`);
        return;
      }
      pageProblems.failedRequests.push(`${request.method()} ${request.url()} — ${reason}`);
    });
    page.on("response", async (response) => {
      if (response.status() < 400) return;
      const url = response.url();
      if (!isLocalRequest(response.request())) return;
      // 404 on an optional asset is not an application failure; a failing
      // API call is, and it is reported with the status and the body, which
      // is what makes a PostgREST error diagnosable at all.
      if (!url.includes("/rest/v1/") && !url.includes("/auth/v1/")) return;
      let body = "";
      try {
        body = (await response.text()).slice(0, 400);
      } catch {
        body = "(body unavailable)";
      }
      pageProblems.failedRequests.push(
        `${response.request().method()} ${url} → ${response.status()} ${body}`
      );
    });

    await use(page);

    // A cancelled fetch also surfaces as the APPLICATION logging its own
    // catch block — `hasOfficialResult failed: TypeError: Failed to fetch`.
    // That is the same navigation, seen from the other side, so it is
    // discounted on the same evidence: only when a request really was
    // aborted in this test. A genuine network failure still shows up, as a
    // non-aborted requestfailed or as a 4xx/5xx response, both still caught.
    const navigationNoise = /Failed to fetch|NetworkError when attempting to fetch|Load failed/;
    const consoleErrors =
      pageProblems.abortedByNavigation.length > 0
        ? pageProblems.consoleErrors.filter((e) => !navigationNoise.test(e))
        : pageProblems.consoleErrors;

    // Attach everything observed, then assert. Attaching first means the
    // report carries the detail even when the assertion below is what fails.
    const report = [
      ...pageProblems.pageErrors.map((e) => `page error: ${e}`),
      ...consoleErrors.map((e) => `console error: ${e}`),
      ...pageProblems.failedRequests.map((e) => `request: ${e}`),
    ];
    if (report.length > 0) {
      await testInfo.attach("browser-problems", {
        body: report.join("\n"),
        contentType: "text/plain",
      });
    }
    expect(
      report,
      "the page reported errors or failed requests (see the browser-problems attachment)"
    ).toEqual([]);
  },
});

export { expect };

/**
 * Navigates and waits for the app shell to be interactive rather than for a
 * fixed delay.
 *
 * "Ready" means past `OnboardingGate`, which renders nothing but a spinner —
 * no header, no main, no heading — until it has asked the server whether
 * this client owes a one-time import decision. That is two real round trips
 * (`create_device_identity`, then `count_own_anonymous_sessions` or
 * `resolve_onboarding`), and under a parallel run every worker is asking one
 * Postgres container at once. The default 10s expect timeout was tight
 * enough to lose that race occasionally, so this waits explicitly and for
 * longer — it is still waiting on a real application state, not sleeping.
 */
export async function gotoApp(page: Page, pathname: string): Promise<void> {
  await page.goto(pathname);
  await expect(
    page.locator("header, main, h1").first(),
    `the app shell never rendered at ${pathname} — OnboardingGate is probably still checking`
  ).toBeVisible({ timeout: 30_000 });
}
