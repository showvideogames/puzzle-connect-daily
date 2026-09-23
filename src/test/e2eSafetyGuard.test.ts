/**
 * The E2E safety guard, tested in the ordinary Vitest suite.
 *
 * This is the single piece of the end-to-end harness whose job is to stop a
 * catastrophe, so it is the one piece that must be covered by a test that
 * runs on every commit — not only when someone remembers to run the browser
 * suite (which, on a machine with no Docker, they cannot).
 *
 * See e2e/safety.ts.
 */

import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  disposableTargetViolations,
  assertDisposableTarget,
  linkedProjectRef,
  parseDotEnv,
  UnsafeTargetError,
  type DisposableTarget,
} from "../../e2e/safety";

/** A JWT the local Supabase stack would issue: demo issuer, no project ref. */
function localKey(role: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: "supabase-demo", role })).toString("base64url");
  return `${header}.${payload}.signature-not-checked`;
}

/** A JWT a HOSTED Supabase project would issue: it names the project. */
function hostedKey(role: string, ref = "zzzzexamplerefzz"): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: "supabase", ref, role })).toString("base64url");
  return `${header}.${payload}.signature-not-checked`;
}

const SAFE: DisposableTarget = {
  apiUrl: "http://127.0.0.1:54421",
  dbUrl: "postgresql://postgres:postgres@127.0.0.1:54422/postgres",
  appUrl: "http://127.0.0.1:5183",
  anonKey: localKey("anon"),
  serviceRoleKey: localKey("service_role"),
};

describe("the E2E disposable-target guard", () => {
  it("accepts a fully local stack", () => {
    expect(disposableTargetViolations(SAFE)).toEqual([]);
  });

  it("accepts localhost and *.localhost as well as the loopback literal", () => {
    expect(
      disposableTargetViolations({
        ...SAFE,
        apiUrl: "http://localhost:54421",
        appUrl: "http://app.localhost:5183",
      })
    ).toEqual([]);
  });

  it.each([
    ["the API", { apiUrl: "https://abcdefghijklmno.supabase.co" }],
    ["the database", { dbUrl: "postgresql://postgres:pw@db.abcdefghijklmno.supabase.co:5432/postgres" }],
    ["the app", { appUrl: "https://rainbowcategories.com" }],
  ])("refuses a non-local %s endpoint", (_label, override) => {
    const reasons = disposableTargetViolations({ ...SAFE, ...override });
    expect(reasons.length).toBeGreaterThan(0);
  });

  it("refuses a hosted-project JWT even when every URL is local", () => {
    // This is the important one: a correct-looking local setup with a
    // production key pasted in is exactly how a service-role key ends up
    // pointed somewhere it should never be.
    const reasons = disposableTargetViolations({ ...SAFE, serviceRoleKey: hostedKey("service_role") });
    expect(reasons.some((r) => /ref.*claim/i.test(r))).toBe(true);
  });

  it("refuses the new-style publishable and secret key formats", () => {
    const reasons = disposableTargetViolations({
      ...SAFE,
      anonKey: "sb_publishable_abc123",
      serviceRoleKey: "sb_secret_abc123",
    });
    expect(reasons.filter((r) => /real Supabase project key/.test(r))).toHaveLength(2);
  });

  it("refuses a value that is missing entirely rather than assuming a default", () => {
    expect(disposableTargetViolations({ ...SAFE, serviceRoleKey: "" })).toContain(
      "serviceRoleKey is not set"
    );
  });

  it("refuses anything carrying the repository's linked project ref", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "e2e-guard-"));
    const configPath = path.join(dir, "config.toml");
    writeFileSync(configPath, 'project_id = "wxyzlinkedproject"\n', "utf8");

    expect(linkedProjectRef(configPath)).toBe("wxyzlinkedproject");

    const reasons = disposableTargetViolations(
      { ...SAFE, apiUrl: "http://wxyzlinkedproject.localhost:54421" },
      { linkedConfigPath: configPath }
    );
    expect(reasons.some((r) => /linked Supabase project ref/.test(r))).toBe(true);
  });

  it("refuses a credential copied out of the repository's own .env", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "e2e-guard-"));
    const envPath = path.join(dir, ".env");
    writeFileSync(
      envPath,
      ["SUPABASE_URL=https://example.supabase.co", "SUPABASE_SERVICE_ROLE_KEY=super-secret-production-key"].join("\n"),
      "utf8"
    );

    const reasons = disposableTargetViolations(
      { ...SAFE, serviceRoleKey: "super-secret-production-key" },
      { productionEnvPath: envPath }
    );
    expect(reasons.some((r) => /copied verbatim from the repository's \.env/.test(r))).toBe(true);
  });

  it("allows an explicitly designated disposable host, but never one on the deny list", () => {
    expect(
      disposableTargetViolations({
        ...SAFE,
        apiUrl: "http://supabase-kong:8000",
        extraDisposableHosts: ["supabase-kong"],
      })
    ).toEqual([]);

    // A designation cannot buy past the deny list.
    const reasons = disposableTargetViolations({
      ...SAFE,
      apiUrl: "https://myproject.supabase.co",
      extraDisposableHosts: ["myproject.supabase.co"],
    });
    expect(reasons.some((r) => /production marker/.test(r))).toBe(true);
  });

  it("throws an UnsafeTargetError naming the operation and every reason", () => {
    expect(() =>
      assertDisposableTarget("e2e:reset", { ...SAFE, appUrl: "https://rainbowcategories.com" })
    ).toThrow(UnsafeTargetError);

    try {
      assertDisposableTarget("e2e:reset", { ...SAFE, appUrl: "https://rainbowcategories.com" });
    } catch (error) {
      expect((error as Error).message).toContain("e2e:reset");
      expect((error as Error).message).toContain("Nothing was changed.");
    }
  });
});

describe("the guard's .env parser", () => {
  it("reads plain, quoted and commented lines", () => {
    expect(
      parseDotEnv(
        ["# a comment", "PLAIN=value", 'QUOTED="quoted value"', "SINGLE='single'", "", "NO_EQUALS"].join("\n")
      )
    ).toEqual([
      ["PLAIN", "value"],
      ["QUOTED", "quoted value"],
      ["SINGLE", "single"],
    ]);
  });
});
