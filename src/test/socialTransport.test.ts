/**
 * The live transport. The network is a stub, so nothing here leaves the test.
 * Failures are answers: a transport that throws would put a token's request into
 * someone's error log.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_STORAGE_KEY } from "@/lib/platformSignIn";
import { createGatewayTransport, readStoredAccessToken } from "@/lib/socialTransport";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const BASE_URL = "http://127.0.0.1:54421";
const KEY = "publishable-key-for-the-test";
const TOKEN = "user-token-for-the-test";
const UNAVAILABLE = { ok: false, outcome: "unavailable" };

const fetchSpy = vi.fn();

const answerWith = (body: unknown, status = 200) =>
  fetchSpy.mockResolvedValueOnce(new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));

const transport = () => createGatewayTransport({ baseUrl: BASE_URL, publishableKey: KEY });

/** The headers of the one request made, as sent. */
function sentHeaders(): Record<string, string> {
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  return fetchSpy.mock.calls[0][1].headers;
}

beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createGatewayTransport", () => {
  it("posts the operation and its arguments to the gateway, once", async () => {
    answerWith({ ok: true, data: { displayName: "Ada" } });

    const answer = await transport().call("setDisplayName", { name: "Ada" }, TOKEN);

    expect(answer).toEqual({ ok: true, data: { displayName: "Ada" } });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/functions/v1/social-gateway?forceFunctionRegion=us-east-1`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ op: "setDisplayName", args: { name: "Ada" } });
  });

  it("sends the key and the credential", async () => {
    answerWith({ ok: true, data: {} });
    await transport().call("getMe", {}, TOKEN);

    expect(sentHeaders()).toEqual({
      "Content-Type": "application/json",
      apikey: KEY,
      Authorization: `Bearer ${TOKEN}`,
    });
  });

  it.each([null, ""])("sends no Authorization header at all when the credential is %j", async (credential) => {
    answerWith({ ok: true, data: {} });
    await transport().call("previewInvite", { code: "x" }, credential);

    const headers = sentHeaders();
    expect(headers.apikey).toBe(KEY);
    expect(Object.keys(headers).map((name) => name.toLowerCase())).not.toContain("authorization");
  });

  it("copes with a trailing slash on the base address", async () => {
    answerWith({ ok: true, data: {} });
    await createGatewayTransport({ baseUrl: `${BASE_URL}/`, publishableKey: KEY }).call("getMe", {}, TOKEN);

    expect(fetchSpy.mock.calls[0][0]).toBe(`${BASE_URL}/functions/v1/social-gateway?forceFunctionRegion=us-east-1`);
  });

  it("passes on the gateway's outcomes and empty answers", async () => {
    answerWith({ ok: false, outcome: "not_a_member" });
    expect(await transport().call("leaveGroup", { groupId: "g" }, TOKEN)).toEqual({ ok: false, outcome: "not_a_member" });

    answerWith({ ok: true, data: [] });
    expect(await transport().call("listFriends", {}, TOKEN)).toEqual({ ok: true, data: [] });
  });

  it.each<[string, unknown, number]>([
    ["a server error with a JSON body", { ok: true, data: {} }, 500],
    ["a refusal from in front of the function", { message: "Invalid JWT" }, 401],
    ["a body that isn't JSON", "<html>bad gateway</html>", 200],
    ["JSON of the wrong shape", { hello: "there" }, 200],
    ["JSON null", "null", 200],
    ["ok with no data", { ok: true }, 200],
    ["an outcome the contract doesn't know", { ok: false, outcome: "made_up" }, 200],
    ["no outcome at all", { ok: false }, 200],
  ])("answers unavailable for %s", async (_label, body, status) => {
    answerWith(body, status);
    expect(await transport().call("getMe", {}, TOKEN)).toEqual(UNAVAILABLE);
  });

  it("answers unavailable for a network failure, logs nothing and doesn't retry", async () => {
    const methods = ["log", "info", "warn", "error", "debug"] as const;
    const spies = methods.map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
    try {
      fetchSpy.mockRejectedValueOnce(new Error(`could not reach it with ${TOKEN}`));

      expect(await transport().call("getMe", {}, TOKEN)).toEqual(UNAVAILABLE);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe("readStoredAccessToken", () => {
  it("reads the access token of the stored session", () => {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ access_token: TOKEN, refresh_token: "r", user: { id: "u" } }));
    expect(readStoredAccessToken()).toBe(TOKEN);
  });

  it("is null with nothing stored", () => {
    expect(readStoredAccessToken()).toBeNull();
  });

  it.each([
    ["unreadable JSON", "{not json"],
    ["a JSON null", "null"],
    ["no token", JSON.stringify({ user: { id: "u" } })],
    ["an empty token", JSON.stringify({ access_token: "" })],
    ["a token that isn't text", JSON.stringify({ access_token: 42 })],
  ])("is null for %s", (_label, stored) => {
    localStorage.setItem(AUTH_STORAGE_KEY, stored);
    expect(readStoredAccessToken()).toBeNull();
  });

  it("is null when storage is blocked", () => {
    const blocked = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    try {
      expect(readStoredAccessToken()).toBeNull();
    } finally {
      blocked.mockRestore();
    }
  });
});
