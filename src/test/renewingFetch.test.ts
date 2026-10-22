import { describe, expect, it, vi } from "vitest";
import { renewingFetch, type Renewed } from "@/lib/renewingFetch";

const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const pass = (sub: string) => `${b64({ alg: "ES256" })}.${b64({ sub, role: "authenticated" })}.sig`;
const REST = "https://p.supabase.co/rest/v1/rpc/my_account";
const UPLOAD = "https://p.supabase.co/storage/v1/object/emojis/a.png";
const FUNCTION = "https://p.supabase.co/functions/v1/submit-feedback";
const expiredRest = () => new Response('{"code":"PGRST303","message":"JWT expired"}', { status: 401 });
const expiredStorage = () =>
  new Response('{"statusCode":"403","error":"InvalidJWT","message":"\\"exp\\" claim timestamp check failed"}', { status: 400 });
const ok = () => new Response("[]", { status: 200 });
const authOf = (init?: RequestInit) => new Headers(init?.headers).get("Authorization");
const as = (sub: string): RequestInit => ({ headers: { Authorization: `Bearer ${pass(sub)}` } });

describe("renewingFetch", () => {
  it("passes a normal answer straight through", async () => {
    const renew = vi.fn();
    expect((await renewingFetch(renew, vi.fn(async () => ok()))(REST, as("u1"))).status).toBe(200);
    expect(renew).not.toHaveBeenCalled();
  });

  it("renews an expired pass and retries once, as the same user", async () => {
    const base = vi.fn<typeof fetch>().mockResolvedValueOnce(expiredRest()).mockResolvedValueOnce(ok());
    const res = await renewingFetch(async () => ({ token: "fresh", userId: "u1" }), base)(REST, {
      method: "POST",
      body: "{}",
      headers: { Authorization: `Bearer ${pass("u1")}`, apikey: "k" },
    });
    expect(res.status).toBe(200);
    const retry = base.mock.calls[1][1];
    expect(authOf(retry)).toBe("Bearer fresh");
    expect(new Headers(retry?.headers).get("apikey")).toBe("k");
    expect(retry?.body).toBe("{}");
  });

  it("covers storage (its 400-with-the-reason-inside answer) and server functions", async () => {
    for (const [url, refused] of [
      [UPLOAD, expiredStorage],
      [FUNCTION, () => new Response('{"code":401,"message":"Invalid JWT"}', { status: 401 })],
    ] as const) {
      const base = vi.fn<typeof fetch>().mockResolvedValueOnce(refused()).mockResolvedValueOnce(ok());
      expect((await renewingFetch(async () => ({ token: "fresh", userId: "u1" }), base)(url, as("u1"))).status).toBe(200);
    }
  });

  it("never retries as a different user", async () => {
    const base = vi.fn<typeof fetch>().mockResolvedValueOnce(expiredRest());
    expect((await renewingFetch(async () => ({ token: "x", userId: "u2" }), base)(REST, as("u1"))).status).toBe(401);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("never touches a request signed with the publishable key", async () => {
    const renew = vi.fn();
    await renewingFetch(renew, vi.fn(async () => expiredRest()))(REST, { headers: { Authorization: "Bearer sb_publishable_x" } });
    expect(renew).not.toHaveBeenCalled();
  });

  it("leaves a refusal that is not about the pass alone", async () => {
    const renew = vi.fn();
    const rls = () => new Response('{"statusCode":"403","error":"Unauthorized","message":"new row violates row-level security policy"}', { status: 400 });
    expect((await renewingFetch(renew, vi.fn(async () => rls()))(UPLOAD, as("u1"))).status).toBe(400);
    expect(renew).not.toHaveBeenCalled();
  });

  it("never retries the sign-in endpoints, so a renewal cannot loop", async () => {
    const renew = vi.fn();
    await renewingFetch(renew, vi.fn(async () => expiredRest()))("https://p.supabase.co/auth/v1/token?grant_type=refresh_token", as("u1"));
    expect(renew).not.toHaveBeenCalled();
  });

  it("hands back the original answer when renewal is impossible or fails", async () => {
    expect((await renewingFetch(async () => null, vi.fn<typeof fetch>().mockResolvedValueOnce(expiredRest()))(REST, as("u1"))).status).toBe(401);
    const failing = async (): Promise<Renewed | null> => {
      throw new Error("offline");
    };
    expect((await renewingFetch(failing, vi.fn<typeof fetch>().mockResolvedValueOnce(expiredRest()))(REST, as("u1"))).status).toBe(401);
  });

  it("shares one renewal between requests that fail together", async () => {
    const base = vi.fn<typeof fetch>(async (_u, init) => (authOf(init) === "Bearer fresh" ? ok() : expiredRest()));
    let release!: (r: Renewed) => void;
    const renew = vi.fn(() => new Promise<Renewed>((r) => (release = r)));
    const f = renewingFetch(renew, base);
    const both = Promise.all([f(REST, as("u1")), f(REST, as("u1"))]);
    await vi.waitFor(() => expect(renew).toHaveBeenCalled());
    release({ token: "fresh", userId: "u1" });
    expect((await both).map((r) => r.status)).toEqual([200, 200]);
    expect(renew).toHaveBeenCalledTimes(1);
  });
});
