/**
 * The contract's conformance suite, on Rainbow's real session source and
 * factory. platformSignIn is the real module and the stored session is real,
 * in jsdom's localStorage. Every account state arrives through the real
 * ensureAccount(), and the suite waits for each drive step to finish. Only the
 * Supabase client is mocked, down to rpc and the local sign-out, so anything
 * else here that reached it would throw rather than pass.
 *
 * Not in the normal typecheck, because it imports conformance.ts.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSocialClient } from "@/social/client";
import { adapterConformanceScenarios, adapterSourceProblems } from "@/social/conformance";
import type { AdapterFixture, AdapterPlug } from "@/social/conformance";
import type { Operations, OpName, SessionState, SocialTransport } from "@/social/contract";

const { rpc, signOut } = vi.hoisted(() => ({
  rpc: vi.fn(),
  // Removes the stored session, as the real local sign-out does.
  signOut: vi.fn(async () => {
    localStorage.removeItem("rc-auth");
    return { error: null };
  }),
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc, auth: { signOut } } }));

// The adapter registers its storage listener at load, and only in mock mode.
vi.stubEnv("VITE_SHARED_SOCIAL", "mock");
const { AUTH_STORAGE_KEY, accountCheckState, ensureAccount, getCurrentAccount } = await import("@/lib/platformSignIn");
const { createRainbowSocial, rainbowSession } = await import("@/social/rainbowAdapter");
vi.unstubAllEnvs();

/** A not-ok row. The server sends nulls for the rest, and nothing here reads them. */
const answered = (outcome: string) => ({
  data: [{ outcome, user_id: null, global_user_id: null, email: null, created_at: null }],
  error: null,
});

const accountOk = (userId: string) => ({
  data: [{ outcome: "ok", user_id: userId, global_user_id: `user_${userId}`, email: null, created_at: "" }],
  error: null,
});

const rpcError = { data: null, error: { message: "the check failed" } };

const STILL_CHECKING = { ok: false, outcome: "still_checking" };

describe("the conformance suite, on the real session source and factory", () => {
  let token: string | null = null;
  const credentialFor = () => token;
  const networkCalls = vi.fn();

  /** The real ensureAccount() that checking() left waiting on its rpc. */
  let runningCheck: { answer: (value: unknown) => void; finished: Promise<unknown> } | null = null;

  /** Answers it and waits for it to end: the next step starts from nothing running. */
  async function settleRunningCheck(): Promise<void> {
    const check = runningCheck;
    runningCheck = null;
    if (!check) return;
    check.answer(rpcError);
    await check.finished;
  }

  /** One finished check, the rpc giving this answer. */
  async function finishCheck(answer: unknown): Promise<void> {
    await settleRunningCheck();
    rpc.mockResolvedValueOnce(answer);
    await ensureAccount();
  }

  const storeSessionFor = (userId: string) =>
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ access_token: "stored", user: { id: userId } }));

  /** A confirmed account, as a sign-in leaves things: the session stored, then the check answered ok. */
  async function confirm(userId: string, credential: string): Promise<void> {
    token = credential;
    storeSessionFor(userId);
    await finishCheck(accountOk(userId));
  }

  /** Someone holds a session, and the server says it is no Rainbow account. */
  async function notAnAccount(userId: string): Promise<void> {
    token = null;
    storeSessionFor(userId);
    await finishCheck(answered("not_platform_linked"));
  }

  async function guest(): Promise<void> {
    token = null;
    localStorage.removeItem(AUTH_STORAGE_KEY);
    await finishCheck(answered("not_signed_in"));
  }

  /**
   * A check needs a session to be about: with none stored this is simply a
   * guest. Any token stays, as it does through a real re-check, so it is the
   * check that refuses here and not a missing credential.
   */
  function keepASessionToCheck(): void {
    if (localStorage.getItem(AUTH_STORAGE_KEY) === null) storeSessionFor("uid-being-checked");
  }

  /** Returns with a real check running: its rpc has been called and has not answered. */
  async function checking(): Promise<void> {
    keepASessionToCheck();
    await settleRunningCheck();
    let rpcWasCalled!: () => void;
    const rpcCalled = new Promise<void>((resolve) => {
      rpcWasCalled = resolve;
    });
    let answer!: (value: unknown) => void;
    const unanswered = new Promise((resolve) => {
      answer = resolve;
    });
    rpc.mockImplementationOnce(() => {
      rpcWasCalled();
      return unanswered;
    });
    runningCheck = { answer, finished: ensureAccount() };
    await rpcCalled;
  }

  async function failedCheck(): Promise<void> {
    keepASessionToCheck();
    await finishCheck(rpcError);
  }

  /** A check whose rpc rejects. ensureAccount() passes that on, and this step expects it. */
  async function rejectedCheck(): Promise<void> {
    keepASessionToCheck();
    await settleRunningCheck();
    rpc.mockRejectedValueOnce(new Error("the rpc rejected"));
    await expect(ensureAccount()).rejects.toThrow("the rpc rejected");
  }

  const signIn = (name: string) => confirm(`uid-${name}`, `token-${name}`);

  const buildUnder = (flag?: string, production = false) => (transport: SocialTransport) => {
    vi.unstubAllEnvs();
    if (flag !== undefined) vi.stubEnv("VITE_SHARED_SOCIAL", flag);
    if (production) vi.stubEnv("PROD", true);
    return createRainbowSocial({ transport, credentialFor });
  };

  const fixture: AdapterFixture = {
    game: "rainbow",
    drive: {
      guest,
      checking,
      failedCheck,
      // Rainbow has anonymous sign-ins off, so the nearest thing is a session
      // that did not come through the shared sign-in, which is not_platform_linked.
      anonymous: () => notAnAccount("uid-anonymous"),
      // ensure_account creates the row for anyone linked, so an auth user can
      // only lack one by not being linked.
      noAccountRow: () => notAnAccount("uid-no-row"),
      signIn,
      // A new visit for Rainbow is a sign-in ending and another starting. A
      // re-check of a confirmed person keeps the scope, on purpose.
      revisit: async (name) => {
        await finishCheck(answered("not_signed_in"));
        await signIn(name);
      },
    },
    session: () => rainbowSession(credentialFor),
    build: {
      defaultEnv: buildUnder(),
      garbageFlag: buildUnder("yes please"),
      production: buildUnder("mock", true),
      mock: buildUnder("mock"),
    },
  };

  // The world signs several people in side by side; Rainbow knows one person at
  // a time. So the real state is pointed at the calling player's session just
  // before each call, and again as the answer comes back: that is how a change
  // of person mid-call reaches the adapter, through the real state, as it would.
  // Each world session is its own person here, so its scope is the user id.
  async function follow(session: SessionState): Promise<void> {
    if (session === "checking") await checking();
    else if (session === null) await guest();
    else await confirm(session.scope, session.credential);
  }

  const adapt: AdapterPlug = (game, getSession, transport, buildAdapter) => {
    if (game !== "rainbow") return createSocialClient({ getSession, transport });
    const followed: SocialTransport = {
      async call<O extends OpName>(op: O, args: Operations[O]["args"], credential: string | null) {
        try {
          return await transport.call(op, args, credential);
        } finally {
          // A call that fails can still outlast the person who made it.
          await follow(getSession());
        }
      },
    };
    const client = buildAdapter(followed);
    // Following takes time, so a call reaches the client a little after it is
    // made. A forget() made after that call has to reach the client after it too.
    // It queues on the same promise as the call, so the call goes first.
    let entering: Promise<void> = Promise.resolve();
    return {
      async call<O extends OpName>(op: O, args: Operations[O]["args"]) {
        entering = follow(getSession());
        await entering;
        return client.call(op, args);
      },
      forget() {
        const forget = () => client.forget();
        void entering.then(forget, forget);
      },
    };
  };

  /** The real factory in mock mode, and what reaches its transport. */
  function mockClient() {
    const call = vi.fn(async () => ({ ok: true, data: { displayName: "From the transport", friendCount: 0, groupCount: 0 } }));
    return { call, client: buildUnder("mock")({ call } as unknown as SocialTransport) };
  }

  beforeEach(async () => {
    await settleRunningCheck();
    localStorage.clear();
    vi.stubEnv("VITE_SHARED_SOCIAL", "mock");
    networkCalls.mockClear();
    rpc.mockReset();
    signOut.mockClear();
    vi.stubGlobal("fetch", networkCalls);
    await guest();
  });

  afterEach(async () => {
    try {
      await settleRunningCheck();
      expect(rpc.mock.calls.filter(([name, ...rest]) => name !== "ensure_account" || rest.length > 0)).toEqual([]);
      expect(networkCalls).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });

  for (const scenario of adapterConformanceScenarios({ fixture, adapt })) {
    it(scenario.name, () => scenario.run());
  }

  it("really registered the storage listener at load", async () => {
    await signIn("alice");
    localStorage.removeItem(AUTH_STORAGE_KEY);
    window.dispatchEvent(new StorageEvent("storage", { key: AUTH_STORAGE_KEY, newValue: null }));
    storeSessionFor("uid-alice");

    expect(fixture.session()).toBe("checking");
  });

  it("counts for nothing while a delayed rpc is pending, and for the person once it answers ok", async () => {
    const { call, client } = mockClient();
    token = "token-alice";
    storeSessionFor("uid-alice");
    let answer!: (value: unknown) => void;
    rpc.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const running = ensureAccount();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fixture.session()).toBe("checking");
    expect(await client.call("getMe", {})).toEqual(STILL_CHECKING);
    expect(call).not.toHaveBeenCalled();

    answer(accountOk("uid-alice"));
    expect((await running).ok).toBe(true);

    expect(fixture.session()).toEqual({ scope: expect.any(String), credential: "token-alice" });
    await client.call("getMe", {});
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith("getMe", {}, "token-alice");
  });

  describe.each<[string, () => Promise<void>]>([
    ["with nobody confirmed yet", async () => undefined],
    ["from a confirmed person", () => signIn("alice")],
  ])("a check that fails, %s", (_start, begin) => {
    async function expectNothingUsable({ call, client }: ReturnType<typeof mockClient>) {
      expect(fixture.session()).toBe("checking");
      expect(await client.call("getMe", {})).toEqual(STILL_CHECKING);
      expect(call).not.toHaveBeenCalled();
    }

    it("a rejected rpc rejects ensureAccount, which the step catches, and leaves it checking", async () => {
      const mock = mockClient();
      await begin();

      await rejectedCheck();

      await expectNothingUsable(mock);
    });

    it.each([
      ["an rpc error", rpcError],
      ["an answer with no row", { data: [], error: null }],
      ["no data at all", { data: null, error: null }],
      ["an ok row with a null user_id", { data: [{ outcome: "ok", user_id: null, global_user_id: null, email: null, created_at: null }], error: null }],
      ["an unknown outcome", answered("an_outcome_nobody_knows")],
    ])("%s leaves it checking", async (_answer, answer) => {
      const mock = mockClient();
      await begin();
      keepASessionToCheck();

      rpc.mockResolvedValueOnce(answer);
      expect((await ensureAccount()).reason).toBe("unavailable");

      await expectNothingUsable(mock);
    });
  });

  it("not_platform_linked leaves no session and nothing confirmed", async () => {
    const { call, client } = mockClient();
    await signIn("alice");

    rpc.mockResolvedValueOnce(answered("not_platform_linked"));
    expect((await ensureAccount()).reason).toBe("not_platform_linked");

    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    expect(getCurrentAccount()).toBeNull();
    expect(accountCheckState()).toBe("not_an_account");
    expect(fixture.session()).toBeNull();
    expect(await client.call("getMe", {})).toEqual({ ok: false, outcome: "not_signed_in" });
    expect(call).not.toHaveBeenCalled();
  });
});

describe("the adapter file", () => {
  it("reaches nothing itself", () => {
    const source = readFileSync(path.join(__dirname, "..", "social", "rainbowAdapter.ts"), "utf8");
    expect(source).toContain("createRainbowSocial");
    expect(adapterSourceProblems(source)).toEqual([]);
  });
});
