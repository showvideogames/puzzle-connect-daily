/**
 * Rainbow's shared-social session guard, driven through the REAL account code:
 * every account state here arrives by way of ensureAccount() and
 * signOutOfRainbow(), so the guard is tested against what the app really
 * publishes rather than against a stand-in.
 *
 * The guard has three answers: a session, "checking", or null. Null means a
 * known guest or someone who is not an account here, and a guest may preview
 * invites, so a wrong null is as serious as a wrong session.
 *
 * The stored session is real too, in jsdom's localStorage, written in the shape
 * Supabase writes it. Only the Supabase client is mocked, and it is a recording
 * Proxy: the guard swallows thrown errors, so a stray use of the client could
 * otherwise pass as an ordinary refusal. Refusals inspect that record after a
 * macrotask, so use that is merely delayed is caught as well.
 *
 * Each test loads fresh modules, because ACCOUNTS_ENABLED and the adapter's
 * listeners are set up at load and account state lives in the module. Nothing
 * can leak from one test to the next.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SocialTransport } from "@/social/contract";

const { auth, fetchSpy, from, recordingClient, rpc, supabaseTouches } = vi.hoisted(() => {
  const supabaseTouches: string[] = [];
  const recording = <T extends object>(name: string, target: T): T =>
    new Proxy(target, {
      get(obj, key, receiver) {
        supabaseTouches.push(`${name}.${String(key)}`);
        return Reflect.get(obj, key, receiver);
      },
    });
  const auth = {
    getSession: vi.fn(),
    getUser: vi.fn(),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => {} } } })),
    // Removes the stored session, as the real local sign-out does when it works.
    signOut: vi.fn(async () => {
      localStorage.removeItem("rc-auth");
      return { error: null };
    }),
  };
  const from = vi.fn();
  const rpc = vi.fn();
  return {
    auth,
    fetchSpy: vi.fn(),
    from,
    recordingClient: recording("supabase", { auth: recording("auth", auth), from, rpc }),
    rpc,
    supabaseTouches,
  };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: recordingClient }));

async function load() {
  vi.resetModules();
  const signIn = await import("@/lib/platformSignIn");
  const adapter = await import("@/social/rainbowAdapter");
  return { ...signIn, ...adapter };
}

type Rainbow = Awaited<ReturnType<typeof load>>;
type Refusal = "checking" | null;

/** The key the real client stores its session under (integrations/supabase/client.ts). */
const AUTH_KEY = "rc-auth";

const ALEX = {
  user_id: "c0a80101-0000-4000-8000-00000000a1e7",
  global_user_id: "user_01ALEXGLOBAL",
  email: "alex@example.test",
  created_at: "2026-01-01T00:00:00Z",
};
const BLAKE = {
  user_id: "c0a80101-0000-4000-8000-00000000b1a4",
  global_user_id: "user_01BLAKEGLOBAL",
  email: "blake@example.test",
  created_at: "2026-02-02T00:00:00Z",
};
type Person = typeof ALEX;

/** Different per person, so a mix-up shows, and opaque, so identity checks can look at the whole session. */
const CREDENTIALS: Record<string, string> = {
  [ALEX.user_id]: "opaque-credential-a",
  [BLAKE.user_id]: "opaque-credential-b",
};
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const accountOk = (person: Person) => ({ data: [{ outcome: "ok", ...person }], error: null });
const noAccount = { user_id: null, global_user_id: null, email: null, created_at: null };
const notLinked = { data: [{ outcome: "not_platform_linked", ...noAccount }], error: null };
const notSignedIn = { data: [{ outcome: "not_signed_in", ...noAccount }], error: null };
const rpcError = { data: null, error: { code: "PGRST202", message: "not in schema cache" } };
const emptyAnswer = { data: [], error: null };

/** The next local sign-out reports an error, so the stored session stays. */
const signOutWillFail = () => auth.signOut.mockResolvedValueOnce({ error: { message: "offline" } });

const storeSession = (person: Person, token = CREDENTIALS[person.user_id]) =>
  localStorage.setItem(AUTH_KEY, JSON.stringify({ access_token: token, refresh_token: "r", user: { id: person.user_id } }));

/** What a real caller would supply: the token of whoever holds the stored session. */
const credentialFor = vi.fn((): string | null => {
  const raw = localStorage.getItem(AUTH_KEY);
  return raw ? JSON.parse(raw).access_token ?? null : null;
});

function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A real, finished, successful sign-in: a stored session and an ok account check. */
async function signInAs(rainbow: Rainbow, person: Person, token = CREDENTIALS[person.user_id]) {
  storeSession(person, token);
  rpc.mockResolvedValueOnce(accountOk(person));
  expect((await rainbow.ensureAccount()).ok).toBe(true);
}

async function signedIn(person = ALEX) {
  const rainbow = await load();
  await signInAs(rainbow, person);
  return rainbow;
}

async function recheck(rainbow: Rainbow, person: Person) {
  rpc.mockResolvedValueOnce(accountOk(person));
  await rainbow.ensureAccount();
}

/** An ensureAccount() left running until the test answers it. */
function startCheck(rainbow: Rainbow) {
  const answer = deferred();
  rpc.mockReturnValueOnce(answer.promise);
  const running = rainbow.ensureAccount();
  return {
    finishWith: async (value: unknown) => {
      answer.resolve(value);
      await running;
    },
    failWith: async (reason: unknown) => {
      answer.reject(reason);
      await running.catch(() => undefined);
    },
  };
}

const flushDelayedWork = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function clearClientRecord() {
  supabaseTouches.length = 0;
  for (const fn of Object.values(auth)) fn.mockClear();
  from.mockClear();
  rpc.mockClear();
}

/** After a macrotask, so queueMicrotask or setTimeout on the way out is caught too. */
async function expectClientUntouched() {
  await flushDelayedWork();
  expect(supabaseTouches).toEqual([]);
  for (const fn of [...Object.values(auth), from, rpc]) expect(fn).not.toHaveBeenCalled();
}

/** The guard's answer, with proof it neither asked for a credential nor used the client, then or later. */
async function expectRefused(rainbow: Rainbow, refusal: Refusal) {
  clearClientRecord();
  credentialFor.mockClear();
  expect(rainbow.rainbowSession(credentialFor)).toBe(refusal);
  expect(credentialFor).not.toHaveBeenCalled();
  await expectClientUntouched();
}

function expectSessionFor(rainbow: Rainbow, person: Person, credential = CREDENTIALS[person.user_id]) {
  const session = rainbow.rainbowSession(credentialFor);
  expect(session).toMatchObject({ scope: expect.stringMatching(UUID_V4), credential });
  return session as Exclude<typeof session, "checking" | null>;
}

/** Control for an off state: the same sign-in does get a session once the switches are right. */
async function expectMockGivesASession() {
  vi.stubEnv("VITE_SHARED_SOCIAL", "mock");
  vi.stubEnv("PROD", false);
  const rainbow = await signedIn();
  expectSessionFor(rainbow, ALEX);
}

function storageEvent(key: string | null, newValue: string | null) {
  window.dispatchEvent(new StorageEvent("storage", { key, newValue }));
}

/** Another tab storing a session: the store changes and this tab hears about it. */
function writeSessionElsewhere(person: Person, token?: string) {
  storeSession(person, token);
  storageEvent(AUTH_KEY, localStorage.getItem(AUTH_KEY));
}

const spyOnWindowListeners = () => vi.spyOn(window, "addEventListener");
let windowListen: ReturnType<typeof spyOnWindowListeners>;

const storageListeners = () =>
  windowListen.mock.calls.filter(([type]) => type === "storage").map(([, listener]) => listener);

beforeEach(() => {
  localStorage.clear();
  auth.getSession.mockReset();
  auth.getUser.mockReset();
  auth.onAuthStateChange.mockClear();
  auth.signOut.mockClear();
  credentialFor.mockClear();
  fetchSpy.mockClear();
  from.mockClear();
  rpc.mockReset();
  supabaseTouches.length = 0;
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubEnv("VITE_SHARED_SOCIAL", "mock");
  vi.stubEnv("PROD", false);
  windowListen = spyOnWindowListeners();
});

afterEach(() => {
  try {
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    // Each load registers a listener on the one shared window.
    for (const listener of storageListeners()) window.removeEventListener("storage", listener as EventListener);
    windowListen.mockRestore();
  }
});

describe("socialMode", () => {
  it("is mock only for the exact flag outside production", async () => {
    const { socialMode } = await load();
    expect(socialMode({ VITE_SHARED_SOCIAL: "mock", PROD: false })).toBe("mock");
    expect(socialMode({ VITE_SHARED_SOCIAL: "mock" })).toBe("mock");
  });

  it("is off in production, even with the flag", async () => {
    const { socialMode } = await load();
    expect(socialMode({ VITE_SHARED_SOCIAL: "mock", PROD: true })).toBe("off");
  });

  it("is off for every other value", async () => {
    const { socialMode } = await load();
    const others: unknown[] = [undefined, null, "", "off", "true", "MOCK", "Mock", " mock", "mock ", "mock\n", 1, true, {}, ["mock"]];
    expect(socialMode({})).toBe("off");
    for (const flag of others) {
      expect(socialMode({ VITE_SHARED_SOCIAL: flag, PROD: false })).toBe("off");
    }
  });

  it("reads the build environment by default", async () => {
    const { socialMode } = await load();
    expect(socialMode()).toBe("mock");
    vi.stubEnv("PROD", true);
    expect(socialMode()).toBe("off");
  });

  it("does not answer to the old flag name", async () => {
    vi.stubEnv("VITE_SHARED_SOCIAL", undefined);
    vi.stubEnv("VITE_SHARED_SOCIAL_MODE", "mock");
    const { socialMode } = await load();
    expect(socialMode()).toBe("off");
  });

  it("is beta for the exact flag, in a production build too", async () => {
    const { socialMode } = await load();
    expect(socialMode({ VITE_SHARED_SOCIAL: "beta" })).toBe("beta");
    expect(socialMode({ VITE_SHARED_SOCIAL: "beta", PROD: false })).toBe("beta");
    expect(socialMode({ VITE_SHARED_SOCIAL: "beta", PROD: true })).toBe("beta");
  });

  it.each([true, false])("is off for anything nearly the beta flag, with production %j", async (production) => {
    const { socialMode } = await load();
    const nearly: unknown[] = ["BETA", "Beta", " beta", "beta ", "beta\n", "true", 1, true, {}, ["beta"]];
    for (const flag of nearly) {
      expect(socialMode({ VITE_SHARED_SOCIAL: flag, PROD: production })).toBe("off");
    }
  });

  it("reads the beta flag from the build environment, in a production build", async () => {
    vi.stubEnv("VITE_SHARED_SOCIAL", "beta");
    vi.stubEnv("PROD", true);
    const { socialMode } = await load();
    expect(socialMode()).toBe("beta");
  });
});

describe("in beta mode", () => {
  const TRANSPORT_ANSWER = { ok: true, data: { displayName: "From the gateway" } };

  beforeEach(() => {
    vi.stubEnv("VITE_SHARED_SOCIAL", "beta");
  });

  function fakeTransport() {
    const call = vi.fn(async () => TRANSPORT_ANSWER);
    return { call, transport: { call } as unknown as SocialTransport };
  }

  it.each([false, true])("gives a confirmed account a session, with production %j", async (production) => {
    vi.stubEnv("PROD", production);
    expectSessionFor(await signedIn(), ALEX);
  });

  it("registers the storage listener, so a sign-out elsewhere ends the sign-in", async () => {
    const rainbow = await signedIn();
    expect(storageListeners()).toHaveLength(1);

    localStorage.removeItem(AUTH_KEY);
    storageEvent(AUTH_KEY, null);
    storeSession(ALEX);

    expect(rainbow.accountCheckState()).toBe("unsettled");
    await expectRefused(rainbow, "checking");
  });

  it("gives a guest null and a check in flight checking, as mock does", async () => {
    const rainbow = await load();
    await expectRefused(rainbow, null);

    storeSession(ALEX);
    startCheck(rainbow);
    await expectRefused(rainbow, "checking");
  });

  it("refuses an account's session when accounts are off", async () => {
    vi.stubEnv("VITE_ACCOUNTS_ENABLED", "false");
    await expectRefused(await signedIn(), null);
  });

  it.each([false, true])("builds a client that reaches the transport with the credential, with production %j", async (production) => {
    vi.stubEnv("PROD", production);
    const rainbow = await signedIn();
    const { call, transport } = fakeTransport();

    const answer = await rainbow.createRainbowSocial({ transport, credentialFor }).call("getMe", {});

    expect(answer).toEqual(TRANSPORT_ANSWER);
    expect(call).toHaveBeenCalledWith("getMe", {}, CREDENTIALS[ALEX.user_id]);
  });

  it("builds a client when beta is asked for by name", async () => {
    const rainbow = await signedIn();
    const { call, transport } = fakeTransport();

    await rainbow.createRainbowSocial({ mode: "beta", transport, credentialFor }).call("getMe", {});

    expect(call).toHaveBeenCalledTimes(1);
  });

  it("lets a guest preview with no credential, and nothing more", async () => {
    const rainbow = await load();
    const { call, transport } = fakeTransport();
    const client = rainbow.createRainbowSocial({ transport, credentialFor });

    await client.call("previewInvite", { code: "x" });
    expect(call).toHaveBeenCalledWith("previewInvite", { code: "x" }, null);

    expect(await client.call("getMe", {})).toEqual({ ok: false, outcome: "not_signed_in" });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("still refuses mock by name in a production build", async () => {
    vi.stubEnv("PROD", true);
    const rainbow = await signedIn();
    const { call, transport } = fakeTransport();

    const answer = await rainbow.createRainbowSocial({ mode: "mock", transport, credentialFor }).call("getMe", {});

    expect(answer).toEqual({ ok: false, outcome: "unavailable" });
    expect(call).not.toHaveBeenCalled();
  });

  it("keeps the adapter's source clear of the outside world", () => {
    const source = readFileSync(path.join(__dirname, "..", "social", "rainbowAdapter.ts"), "utf8");
    for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "localStorage", "sessionStorage", "recordCompletion"]) {
      expect(source).not.toMatch(new RegExp(`\\b${name}\\b`));
    }
  });
});

describe("when off", () => {
  it.each([undefined, "", "off", "true", "MOCK", " mock", "mock "])(
    "gives a confirmed account null and registers nothing when the flag is %j",
    async (flag) => {
      vi.stubEnv("VITE_SHARED_SOCIAL", flag);
      const rainbow = await signedIn();

      expect(rainbow.socialMode()).toBe("off");
      await expectRefused(rainbow, null);
      expect(storageListeners()).toEqual([]);

      await expectMockGivesASession();
    },
  );

  it("refuses mock in a production build and registers nothing", async () => {
    vi.stubEnv("PROD", true);
    const rainbow = await signedIn();

    expect(rainbow.socialMode()).toBe("off");
    await expectRefused(rainbow, null);
    expect(storageListeners()).toEqual([]);

    await expectMockGivesASession();
  });

  it("leaves the account check state alone, even with no stored session", async () => {
    vi.stubEnv("VITE_SHARED_SOCIAL", "off");
    const rainbow = await signedIn();
    localStorage.removeItem(AUTH_KEY);

    await expectRefused(rainbow, null);
    expect(rainbow.accountCheckState()).toBe("confirmed");
  });

  it.each([
    ["the switch", "VITE_ACCOUNTS_ENABLED", "false"],
    ["an empty discovery URL", "VITE_PLATFORM_DISCOVERY_URL", ""],
  ])("gives null when accounts are off by %s, and leaves the check state alone", async (_label, name, value) => {
    vi.stubEnv(name, value);
    const rainbow = await signedIn();
    expect(rainbow.ACCOUNTS_ENABLED).toBe(false);

    expect(rainbow.accountCheckState()).toBe("confirmed");
    await expectRefused(rainbow, null);

    localStorage.removeItem(AUTH_KEY);
    await expectRefused(rainbow, null);
    expect(rainbow.accountCheckState()).toBe("confirmed");
  });

  it("loads and registers nothing where there is no window", async () => {
    vi.resetModules();
    await import("@/lib/platformSignIn");
    vi.stubGlobal("window", undefined);
    await import("@/social/rainbowAdapter");
    expect(storageListeners()).toEqual([]);
  });
});

describe("the state table", () => {
  const off = (name: string, value: string | boolean) => {
    vi.stubEnv(name, value as never);
    return signedIn();
  };

  const rows: [string, () => Promise<Rainbow>, Refusal][] = [
    ["1: flag off, signed in", () => off("VITE_SHARED_SOCIAL", "off"), null],
    ["1: production, signed in", () => off("PROD", true), null],
    ["1: accounts off, signed in", () => off("VITE_ACCOUNTS_ENABLED", "false"), null],
    ["1: flag off, check running", async () => {
      vi.stubEnv("VITE_SHARED_SOCIAL", "off");
      const rainbow = await load();
      storeSession(ALEX);
      startCheck(rainbow);
      return rainbow;
    }, null],
    ["1: flag off, unreadable store", async () => {
      const rainbow = await off("VITE_SHARED_SOCIAL", "off");
      localStorage.setItem(AUTH_KEY, "{not json");
      return rainbow;
    }, null],
    ["2: nothing stored, never checked", () => load(), null],
    ["2: nothing stored, account confirmed", async () => {
      const rainbow = await signedIn();
      localStorage.removeItem(AUTH_KEY);
      return rainbow;
    }, null],
    ["2: nothing stored, check running", async () => {
      const rainbow = await signedIn();
      startCheck(rainbow);
      localStorage.removeItem(AUTH_KEY);
      return rainbow;
    }, null],
    ["2: unreadable store, account confirmed", async () => {
      const rainbow = await signedIn();
      localStorage.setItem(AUTH_KEY, "{not json");
      return rainbow;
    }, "checking"],
    ["2: no usable id, no account", async () => {
      const rainbow = await load();
      localStorage.setItem(AUTH_KEY, JSON.stringify({ user: {} }));
      return rainbow;
    }, "checking"],
    ["2: not_signed_in, store really gone", async () => {
      const rainbow = await load();
      storeSession(ALEX);
      rpc.mockResolvedValueOnce(notSignedIn);
      await rainbow.ensureAccount();
      localStorage.removeItem(AUTH_KEY);
      return rainbow;
    }, null],
    ["3: not_platform_linked, sign-out failing, store kept", async () => {
      const rainbow = await load();
      storeSession(ALEX);
      signOutWillFail();
      rpc.mockResolvedValueOnce(notLinked);
      await rainbow.ensureAccount();
      return rainbow;
    }, null],
    ["4: not_signed_in, store kept", async () => {
      const rainbow = await load();
      storeSession(ALEX);
      rpc.mockResolvedValueOnce(notSignedIn);
      await rainbow.ensureAccount();
      return rainbow;
    }, "checking"],
    ["4: stored, never checked", async () => {
      const rainbow = await load();
      storeSession(ALEX);
      return rainbow;
    }, "checking"],
    ["4: first check running", async () => {
      const rainbow = await load();
      storeSession(ALEX);
      startCheck(rainbow);
      return rainbow;
    }, "checking"],
    ["4: first check failed", async () => {
      const rainbow = await load();
      storeSession(ALEX);
      rpc.mockResolvedValueOnce(rpcError);
      await rainbow.ensureAccount();
      return rainbow;
    }, "checking"],
    ["4: no account row returned", async () => {
      const rainbow = await load();
      storeSession(ALEX);
      rpc.mockResolvedValueOnce(emptyAnswer);
      await rainbow.ensureAccount();
      return rainbow;
    }, "checking"],
    ["4: re-check running", async () => {
      const rainbow = await signedIn();
      startCheck(rainbow);
      return rainbow;
    }, "checking"],
    ["4: re-check failed", async () => {
      const rainbow = await signedIn();
      rpc.mockResolvedValueOnce(rpcError);
      await rainbow.ensureAccount();
      return rainbow;
    }, "checking"],
    ["4: confirmation forgotten", async () => {
      const rainbow = await signedIn();
      rainbow.forgetAccountConfirmation();
      return rainbow;
    }, "checking"],
    ["5: stored session is someone else's", async () => {
      const rainbow = await signedIn();
      storeSession(BLAKE);
      return rainbow;
    }, "checking"],
    ["3: an older ok, after the newest check said not an account, brings nobody back", async () => {
      const rainbow = await load();
      storeSession(ALEX);
      const older = startCheck(rainbow);
      const newest = startCheck(rainbow);
      signOutWillFail();
      await newest.finishWith(notLinked);
      await older.finishWith(accountOk(ALEX));
      expect(rainbow.accountCheckState()).toBe("not_an_account");
      expect(rainbow.getCurrentAccount()).toBeNull();
      return rainbow;
    }, null],
  ];

  it.each(rows)("%s", async (_label, arrive, refusal) => {
    await expectRefused(await arrive(), refusal);
  });

  // Pins today's behavior, a known gap rather than a goal. "unsettled" is
  // answered before the person comparison, so a read during a check does not
  // end the sign-in, and with no storage event nothing else sees the change:
  // Alex's return confirms with the old scope.
  it("5: with a check running, a person change with no event goes unnoticed if Alex returns before it ends", async () => {
    const rainbow = await signedIn();
    const before = expectSessionFor(rainbow, ALEX);
    const running = startCheck(rainbow);

    storeSession(BLAKE);
    await expectRefused(rainbow, "checking");
    storeSession(ALEX);
    await running.finishWith(accountOk(ALEX));

    expect(rainbow.accountCheckState()).toBe("confirmed");
    expect(expectSessionFor(rainbow, ALEX).scope).toBe(before.scope);
  });

  it.each([
    ["null", () => null],
    ["an empty string", () => ""],
    ["a throw", () => { throw new Error("no token"); }],
  ])("6: a credential of %s says checking, costing neither the confirmation nor the scope", async (_label, badCredential) => {
    const rainbow = await signedIn();
    const before = expectSessionFor(rainbow, ALEX);
    clearClientRecord();

    expect(rainbow.rainbowSession(badCredential)).toBe("checking");

    await expectClientUntouched();
    expect(rainbow.accountCheckState()).toBe("confirmed");
    expect(expectSessionFor(rainbow, ALEX).scope).toBe(before.scope);
  });

  it("7: a confirmed account whose stored session matches gets exactly a scope and credential", async () => {
    const rainbow = await signedIn();
    clearClientRecord();

    expect(rainbow.rainbowSession(credentialFor)).toEqual({
      scope: expect.stringMatching(UUID_V4),
      credential: CREDENTIALS[ALEX.user_id],
    });

    await expectClientUntouched();
  });

  it("8: an unexpected failure says checking, never null, because a guest may preview", async () => {
    const rainbow = await signedIn();
    vi.stubGlobal("crypto", {});
    expect(rainbow.rainbowSession(credentialFor)).toBe("checking");
  });
});

describe("who is in the mock", () => {
  it("registers exactly one storage listener", async () => {
    await load();
    expect(storageListeners()).toHaveLength(1);
  });

  it("signs out an auth user with no Rainbow account, and the emptied store then reads as a guest", async () => {
    const rainbow = await load();
    storeSession(ALEX);
    rpc.mockResolvedValueOnce(notLinked);
    expect((await rainbow.ensureAccount()).reason).toBe("not_platform_linked");
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(localStorage.getItem(AUTH_KEY)).toBeNull();
    await expectRefused(rainbow, null);
  });

  it.each<[string, unknown, Refusal]>([
    ["not_platform_linked, whose sign-out empties the store", notLinked, null],
    ["not_signed_in, which leaves the store", notSignedIn, "checking"],
  ])("takes the session away when a later check says %s", async (_label, answer, refusal) => {
    const rainbow = await signedIn();
    rpc.mockResolvedValueOnce(answer);
    await rainbow.ensureAccount();

    expect(rainbow.getCurrentAccount()).toBeNull();
    await expectRefused(rainbow, refusal);
  });

  it.each([
    ["reports an error", signOutWillFail],
    ["rejects", () => auth.signOut.mockRejectedValueOnce(new Error("offline"))],
  ])("still calls not_platform_linked null when the local sign-out %s and the store stays", async (_label, failSignOut) => {
    const rainbow = await load();
    storeSession(ALEX);
    failSignOut();
    rpc.mockResolvedValueOnce(notLinked);

    await rainbow.ensureAccount().catch(() => undefined);

    expect(localStorage.getItem(AUTH_KEY)).not.toBeNull();
    expect(rainbow.accountCheckState()).toBe("not_an_account");
    await expectRefused(rainbow, null);
  });
});

describe("the store is read before the account check", () => {
  it("a first check in flight, with no account, gets null when the store goes, and cannot confirm", async () => {
    const rainbow = await load();
    storeSession(ALEX);
    const check = startCheck(rainbow);

    localStorage.removeItem(AUTH_KEY);
    await expectRefused(rainbow, null);

    storeSession(ALEX);
    await check.finishWith(accountOk(ALEX));

    expect(rainbow.accountCheckState()).toBe("unsettled");
    await expectRefused(rainbow, "checking");
  });

  it("a removal event with no current account does the same, with no read at all", async () => {
    const rainbow = await load();
    storeSession(ALEX);
    const check = startCheck(rainbow);

    localStorage.removeItem(AUTH_KEY);
    storageEvent(AUTH_KEY, null);
    storeSession(ALEX);
    await check.finishWith(accountOk(ALEX));

    expect(rainbow.accountCheckState()).toBe("unsettled");
    await expectRefused(rainbow, "checking");
  });

  it("a storage clear with no current account does the same", async () => {
    const rainbow = await load();
    storeSession(ALEX);
    const check = startCheck(rainbow);

    localStorage.clear();
    storageEvent(null, null);
    storeSession(ALEX);
    await check.finishWith(accountOk(ALEX));

    expect(rainbow.accountCheckState()).toBe("unsettled");
    await expectRefused(rainbow, "checking");
  });
});

describe("a bad stored session", () => {
  const BAD_SESSIONS = [
    ["unreadable JSON", "{not json"],
    ["an empty value", ""],
    ["a JSON null", "null"],
    ["no user", JSON.stringify({ access_token: "t" })],
    ["a user with no id", JSON.stringify({ user: {} })],
    ["an empty id", JSON.stringify({ user: { id: "" } })],
    ["an id that is not a string", JSON.stringify({ user: { id: 42 } })],
  ];

  it.each(BAD_SESSIONS)("%s says checking and really ends the sign-in", async (_label, stored) => {
    const rainbow = await signedIn();
    const before = expectSessionFor(rainbow, ALEX);

    localStorage.setItem(AUTH_KEY, stored);
    await expectRefused(rainbow, "checking");

    storeSession(ALEX);
    await expectRefused(rainbow, "checking");

    await recheck(rainbow, ALEX);
    expect(expectSessionFor(rainbow, ALEX).scope).not.toBe(before.scope);
  });

  it("blocked storage says checking and really ends the sign-in", async () => {
    const rainbow = await signedIn();
    const before = expectSessionFor(rainbow, ALEX);

    const blocked = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    try {
      await expectRefused(rainbow, "checking");
    } finally {
      blocked.mockRestore();
    }

    await expectRefused(rainbow, "checking");

    await recheck(rainbow, ALEX);
    expect(expectSessionFor(rainbow, ALEX).scope).not.toBe(before.scope);
  });
});

describe("credentialFor", () => {
  it("is the only source of the credential", async () => {
    const rainbow = await signedIn();
    expect(rainbow.rainbowSession(() => "from-the-caller")).toMatchObject({ credential: "from-the-caller" });
  });
});

describe("while an account check is running", () => {
  it("says checking during the first check, then gives a session when it confirms", async () => {
    const rainbow = await load();
    storeSession(ALEX);
    const check = startCheck(rainbow);
    await expectRefused(rainbow, "checking");

    await check.finishWith(accountOk(ALEX));
    expectSessionFor(rainbow, ALEX);
  });

  it("says checking during a re-check, though the account stays on screen, then gives a session again", async () => {
    const rainbow = await signedIn();
    const check = startCheck(rainbow);

    expect(rainbow.getCurrentAccount()).toEqual(ALEX);
    await expectRefused(rainbow, "checking");

    await check.finishWith(accountOk(ALEX));
    expectSessionFor(rainbow, ALEX);
  });
});

describe("after a failed check", () => {
  it.each([
    ["an rpc error", () => rpc.mockResolvedValueOnce(rpcError)],
    ["an empty answer", () => rpc.mockResolvedValueOnce(emptyAnswer)],
    ["an rpc rejection", () => rpc.mockRejectedValueOnce(new Error("network down"))],
    ["an rpc that throws", () => rpc.mockImplementationOnce(() => { throw new Error("client broken"); })],
  ])("%s says checking, keeps the account for the UI, and a later ok restores the session", async (_label, failNextCheck) => {
    const rainbow = await signedIn();

    failNextCheck();
    await rainbow.ensureAccount().catch(() => undefined);

    expect(rainbow.getCurrentAccount()).toEqual(ALEX);
    expect(rainbow.accountCheckState()).toBe("unsettled");
    await expectRefused(rainbow, "checking");

    // Also proves a rejected check did not leave the running count stuck.
    await recheck(rainbow, ALEX);
    expect(rainbow.accountCheckState()).toBe("confirmed");
    expectSessionFor(rainbow, ALEX);
  });

  it("still passes a rejection on to ensureAccount's caller", async () => {
    const rainbow = await load();
    rpc.mockRejectedValueOnce(new Error("network down"));
    await expect(rainbow.ensureAccount()).rejects.toThrow("network down");
  });
});

describe("overlapping account checks", () => {
  it.each<[string, number, number, Person | null]>([
    ["the older", 0, 1, null],
    ["the newer", 1, 0, ALEX],
  ])("is unsettled when only %s has finished, and confirmed once both have", async (_label, firstDone, secondDone, shownSoFar) => {
    const rainbow = await load();
    storeSession(ALEX);
    const checks = [startCheck(rainbow), startCheck(rainbow)];

    await checks[firstDone].finishWith(accountOk(ALEX));
    expect(rainbow.getCurrentAccount()).toEqual(shownSoFar);
    expect(rainbow.accountCheckState()).toBe("unsettled");
    await expectRefused(rainbow, "checking");

    await checks[secondDone].finishWith(accountOk(ALEX));
    expect(rainbow.getCurrentAccount()).toEqual(ALEX);
    expect(rainbow.accountCheckState()).toBe("confirmed");
    expectSessionFor(rainbow, ALEX);
  });

  it("confirms when an older check fails and the newest then confirms", async () => {
    const rainbow = await load();
    storeSession(ALEX);
    const older = startCheck(rainbow);
    const newer = startCheck(rainbow);

    await older.finishWith(rpcError);
    await newer.finishWith(accountOk(ALEX));
    expect(rainbow.accountCheckState()).toBe("confirmed");
  });

  it("is unsettled when an older check fails after the newest confirmed", async () => {
    const rainbow = await load();
    storeSession(ALEX);
    const older = startCheck(rainbow);
    const newer = startCheck(rainbow);

    await newer.finishWith(accountOk(ALEX));
    await older.failWith(new Error("network down"));
    expect(rainbow.accountCheckState()).toBe("unsettled");
    await expectRefused(rainbow, "checking");
  });

  it("is unsettled when the newest fails, even if an older check confirms last", async () => {
    const rainbow = await load();
    storeSession(ALEX);
    const older = startCheck(rainbow);
    const newer = startCheck(rainbow);

    await newer.finishWith(rpcError);
    await older.finishWith(accountOk(ALEX));
    expect(rainbow.getCurrentAccount()).toBeNull();
    expect(rainbow.accountCheckState()).toBe("unsettled");
    await expectRefused(rainbow, "checking");
  });

  it("does not let an older check's not-an-account answer stand for the newer check that confirmed", async () => {
    const rainbow = await load();
    storeSession(ALEX);
    signOutWillFail();
    const older = startCheck(rainbow);
    const newer = startCheck(rainbow);

    await newer.finishWith(accountOk(ALEX));
    await older.finishWith(notLinked);

    expect(rainbow.getCurrentAccount()).toBeNull();
    expect(rainbow.accountCheckState()).toBe("unsettled");
    await expectRefused(rainbow, "checking");
  });

  it("does not let an older check's not-an-account answer stand for a newer check that then fails", async () => {
    const rainbow = await load();
    storeSession(ALEX);
    signOutWillFail();
    const older = startCheck(rainbow);
    const newer = startCheck(rainbow);

    await older.finishWith(notLinked);
    await newer.finishWith(rpcError);

    expect(rainbow.accountCheckState()).toBe("unsettled");
    await expectRefused(rainbow, "checking");
  });

  it("keeps the newest check's not-an-account answer when an older check fails late", async () => {
    const rainbow = await load();
    storeSession(ALEX);
    signOutWillFail();
    const older = startCheck(rainbow);
    const newest = startCheck(rainbow);

    await newest.finishWith(notLinked);
    await older.failWith(new Error("network down"));

    expect(rainbow.accountCheckState()).toBe("not_an_account");
    await expectRefused(rainbow, null);
  });
});

describe("a late ok for Alex after Blake confirmed", () => {
  async function blakeConfirmedThenAlexAnswers() {
    const rainbow = await signedIn();
    const slowAlex = startCheck(rainbow);
    await rainbow.signOutOfRainbow();
    await signInAs(rainbow, BLAKE);
    // Alex's check is still running, so nothing is settled yet, even for Blake.
    await expectRefused(rainbow, "checking");
    const generation = rainbow.accountSignInGeneration();
    const heard = vi.fn();
    const unsubscribe = rainbow.subscribeToCurrentAccount(heard);
    await slowAlex.finishWith(accountOk(ALEX));
    unsubscribe();
    return { rainbow, generation, heard };
  }

  it("is dropped without touching any account state", async () => {
    const { rainbow, generation, heard } = await blakeConfirmedThenAlexAnswers();

    expect(heard).not.toHaveBeenCalled();
    expect(rainbow.getCurrentAccount()).toEqual(BLAKE);
    expect(rainbow.accountCheckState()).toBe("confirmed");
    expect(rainbow.accountSignInGeneration()).toBe(generation);
    expectSessionFor(rainbow, BLAKE);
  });

  it("tells its own caller the sign-in changed, with no account", async () => {
    const rainbow = await signedIn();
    const answer = deferred();
    rpc.mockReturnValueOnce(answer.promise);
    const slowAlex = rainbow.ensureAccount();
    await rainbow.signOutOfRainbow();
    await signInAs(rainbow, BLAKE);

    answer.resolve(accountOk(ALEX));

    expect(await slowAlex).toEqual({ ok: false, account: null, reason: "unavailable", message: rainbow.SIGN_IN_CHANGED });
  });

  it("gives Alex nothing when an Alex session is then written elsewhere, until a check of his own", async () => {
    const { rainbow } = await blakeConfirmedThenAlexAnswers();

    writeSessionElsewhere(ALEX);

    expect(rainbow.accountCheckState()).toBe("unsettled");
    await expectRefused(rainbow, "checking");

    await recheck(rainbow, ALEX);
    expectSessionFor(rainbow, ALEX);
  });
});

describe("a late ok about the person signed in now", () => {
  it("still tells its own caller ok, because the callback page and onboarding overlap, and publishes nothing", async () => {
    const rainbow = await load();
    storeSession(ALEX);
    const answer = deferred();
    rpc.mockReturnValueOnce(answer.promise);
    const callbackPage = rainbow.ensureAccount();
    const onboarding = startCheck(rainbow);
    const heard = vi.fn();
    const unsubscribe = rainbow.subscribeToCurrentAccount(heard);

    answer.resolve(accountOk(ALEX));

    expect(await callbackPage).toEqual({ ok: true, account: ALEX, reason: "ok", message: "" });
    expect(heard).not.toHaveBeenCalled();
    expect(rainbow.getCurrentAccount()).toBeNull();
    expect(rainbow.accountCheckState()).toBe("unsettled");

    await onboarding.finishWith(accountOk(ALEX));
    unsubscribe();
    expect(heard).toHaveBeenCalledTimes(1);
    expect(rainbow.accountCheckState()).toBe("confirmed");
  });
});

describe("a change of stored session during a single check", () => {
  it("drops an ok for the person who has gone, with no newer check involved", async () => {
    const rainbow = await load();
    storeSession(ALEX);
    const check = startCheck(rainbow);

    storeSession(BLAKE);
    await check.finishWith(accountOk(ALEX));

    expect(rainbow.getCurrentAccount()).toBeNull();
    expect(rainbow.accountCheckState()).toBe("unsettled");
    await expectRefused(rainbow, "checking");

    await recheck(rainbow, BLAKE);
    expectSessionFor(rainbow, BLAKE);
  });

  it("drops an ok when the session has gone altogether", async () => {
    const rainbow = await load();
    storeSession(ALEX);
    const check = startCheck(rainbow);

    localStorage.removeItem(AUTH_KEY);
    await check.finishWith(accountOk(ALEX));

    expect(rainbow.getCurrentAccount()).toBeNull();
    expect(rainbow.accountCheckState()).toBe("unsettled");
  });

  it("keeps the ok through a token refresh, which changes no owner", async () => {
    const rainbow = await load();
    storeSession(ALEX);
    const check = startCheck(rainbow);

    storeSession(ALEX, "refreshed-credential");
    await check.finishWith(accountOk(ALEX));

    expect(rainbow.getCurrentAccount()).toEqual(ALEX);
    expect(rainbow.accountCheckState()).toBe("confirmed");
  });

  it("keeps an ok with nothing stored from start to finish, as a check with no local session always has", async () => {
    const rainbow = await load();
    const check = startCheck(rainbow);

    await check.finishWith(accountOk(ALEX));

    expect(rainbow.getCurrentAccount()).toEqual(ALEX);
  });
});

describe("accountCheckState", () => {
  it("is unsettled before any check", async () => {
    const rainbow = await load();
    expect(rainbow.accountCheckState()).toBe("unsettled");
  });

  it("is confirmed after a finished ok and unsettled after signing out", async () => {
    const rainbow = await signedIn();
    expect(rainbow.accountCheckState()).toBe("confirmed");

    await rainbow.signOutOfRainbow();
    expect(rainbow.accountCheckState()).toBe("unsettled");
    await expectRefused(rainbow, null);
  });

  it("is unsettled after signing out even when the sign-out call rejects", async () => {
    const rainbow = await signedIn();
    auth.signOut.mockRejectedValueOnce(new Error("offline"));
    await rainbow.signOutOfRainbow().catch(() => undefined);
    expect(rainbow.accountCheckState()).toBe("unsettled");
  });

  it("is not an account after not_platform_linked, and not after not_signed_in", async () => {
    const rainbow = await load();
    storeSession(ALEX);

    rpc.mockResolvedValueOnce(notSignedIn);
    await rainbow.ensureAccount();
    expect(rainbow.accountCheckState()).toBe("unsettled");

    rpc.mockResolvedValueOnce(notLinked);
    await rainbow.ensureAccount();
    expect(rainbow.accountCheckState()).toBe("not_an_account");
  });

  it("is unsettled while the local sign-out of a not_platform_linked answer is still running", async () => {
    const rainbow = await load();
    storeSession(ALEX);
    const signOut = deferred<{ error: null }>();
    auth.signOut.mockReturnValueOnce(signOut.promise);
    rpc.mockResolvedValueOnce(notLinked);

    const check = rainbow.ensureAccount();
    await vi.waitFor(() => expect(auth.signOut).toHaveBeenCalled());
    expect(rainbow.accountCheckState()).toBe("unsettled");

    signOut.resolve({ error: null });
    await check;
    expect(rainbow.accountCheckState()).toBe("not_an_account");
  });

  it("gives way to a later check, whatever it answers", async () => {
    const rainbow = await load();
    storeSession(ALEX);
    signOutWillFail();
    rpc.mockResolvedValueOnce(notLinked);
    await rainbow.ensureAccount();

    rpc.mockResolvedValueOnce(rpcError);
    await rainbow.ensureAccount();
    expect(rainbow.accountCheckState()).toBe("unsettled");
    await expectRefused(rainbow, "checking");

    await recheck(rainbow, ALEX);
    expect(rainbow.accountCheckState()).toBe("confirmed");
    expectSessionFor(rainbow, ALEX);
  });

  it("cannot be confirmed by a check that began before a sign-out", async () => {
    const rainbow = await signedIn();
    const stale = startCheck(rainbow);

    await rainbow.signOutOfRainbow();
    storeSession(ALEX);
    await stale.finishWith(accountOk(ALEX));

    // The late answer brings nobody back, even with a session stored again.
    expect(rainbow.getCurrentAccount()).toBeNull();
    expect(rainbow.accountCheckState()).toBe("unsettled");
    await expectRefused(rainbow, "checking");

    await recheck(rainbow, ALEX);
    expect(rainbow.accountCheckState()).toBe("confirmed");
  });

  it("documents existing behavior: a sign-out that returns an error keeps the store, and no session comes back without a check", async () => {
    const rainbow = await signedIn();
    const before = expectSessionFor(rainbow, ALEX);
    signOutWillFail();

    await rainbow.signOutOfRainbow();

    expect(localStorage.getItem(AUTH_KEY)).not.toBeNull();
    expect(rainbow.getCurrentAccount()).toBeNull();
    await expectRefused(rainbow, "checking");

    await recheck(rainbow, ALEX);
    expect(expectSessionFor(rainbow, ALEX).scope).not.toBe(before.scope);
  });
});

describe("forgetAccountConfirmation", () => {
  it("clears the confirmation without touching the account or telling listeners", async () => {
    const rainbow = await signedIn();
    const listener = vi.fn();
    const unsubscribe = rainbow.subscribeToCurrentAccount(listener);
    try {
      rainbow.forgetAccountConfirmation();

      expect(rainbow.accountCheckState()).toBe("unsettled");
      expect(rainbow.getCurrentAccount()).toEqual(ALEX);
      expect(listener).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it("clears a not-an-account answer as well", async () => {
    const rainbow = await load();
    storeSession(ALEX);
    signOutWillFail();
    rpc.mockResolvedValueOnce(notLinked);
    await rainbow.ensureAccount();

    rainbow.forgetAccountConfirmation();

    expect(rainbow.accountCheckState()).toBe("unsettled");
    await expectRefused(rainbow, "checking");
  });

  it("stops a check already running from confirming, and a new check confirms", async () => {
    const rainbow = await signedIn();
    const running = startCheck(rainbow);

    rainbow.forgetAccountConfirmation();
    await running.finishWith(accountOk(ALEX));
    expect(rainbow.accountCheckState()).toBe("unsettled");

    await recheck(rainbow, ALEX);
    expect(rainbow.accountCheckState()).toBe("confirmed");
  });

  it("moves the sign-in generation, as a new person does, and a re-check of the same person does not", async () => {
    const rainbow = await signedIn();
    const generation = rainbow.accountSignInGeneration();

    await recheck(rainbow, ALEX);
    rpc.mockResolvedValueOnce(rpcError);
    await rainbow.ensureAccount();
    expect(rainbow.accountSignInGeneration()).toBe(generation);

    rainbow.forgetAccountConfirmation();
    const afterForgetting = rainbow.accountSignInGeneration();
    expect(afterForgetting).not.toBe(generation);

    await recheck(rainbow, BLAKE);
    expect(rainbow.accountSignInGeneration()).not.toBe(afterForgetting);
  });
});

const SIGN_OUTS_ELSEWHERE: [string, () => void][] = [
  ["the session removed", () => {
    localStorage.removeItem(AUTH_KEY);
    storageEvent(AUTH_KEY, null);
  }],
  ["storage cleared", () => {
    localStorage.clear();
    storageEvent(null, null);
  }],
];

describe.each(SIGN_OUTS_ELSEWHERE)("a sign-out in another tab, by %s", (_label, signOutElsewhere) => {
  it("says checking for the same person until a new check finishes, and that check gives a new scope", async () => {
    const rainbow = await signedIn();
    const before = expectSessionFor(rainbow, ALEX);

    signOutElsewhere();
    writeSessionElsewhere(ALEX);

    // The account never left the screen: nothing here reached publishAccount.
    expect(rainbow.getCurrentAccount()).toEqual(ALEX);
    expect(rainbow.accountCheckState()).toBe("unsettled");
    await expectRefused(rainbow, "checking");

    await recheck(rainbow, ALEX);
    expect(expectSessionFor(rainbow, ALEX).scope).not.toBe(before.scope);
  });

  it("stops a check in flight from before it from confirming", async () => {
    const rainbow = await signedIn();
    const inFlight = startCheck(rainbow);

    signOutElsewhere();
    storeSession(ALEX);
    await inFlight.finishWith(accountOk(ALEX));

    expect(rainbow.accountCheckState()).toBe("unsettled");
    await expectRefused(rainbow, "checking");
  });

  it("is seen before anyone has asked for a session", async () => {
    const rainbow = await signedIn();

    signOutElsewhere();
    storeSession(ALEX);

    await expectRefused(rainbow, "checking");
  });

  it("leaves a known guest once nothing is stored", async () => {
    const rainbow = await signedIn();

    signOutElsewhere();

    await expectRefused(rainbow, null);
  });

  it("does not hand the old account to a different person who signs in", async () => {
    const rainbow = await signedIn();

    signOutElsewhere();
    storeSession(BLAKE);
    await expectRefused(rainbow, "checking");

    await recheck(rainbow, BLAKE);
    expectSessionFor(rainbow, BLAKE);
  });
});

describe("other storage writes from another tab", () => {
  it("a token refresh changes neither the scope nor the confirmation, and the credential follows it", async () => {
    const rainbow = await signedIn();
    const before = expectSessionFor(rainbow, ALEX);

    writeSessionElsewhere(ALEX, "refreshed-credential");

    expect(rainbow.accountCheckState()).toBe("confirmed");
    expect(expectSessionFor(rainbow, ALEX, "refreshed-credential").scope).toBe(before.scope);
  });

  it.each(["rc-auth-code-verifier", "rc-auth-user", "rc-device-id", "something-else"])(
    "ignores the removal of %s",
    async (key) => {
      const rainbow = await signedIn();
      const before = expectSessionFor(rainbow, ALEX);

      localStorage.removeItem(key);
      storageEvent(key, null);

      expect(rainbow.accountCheckState()).toBe("confirmed");
      expect(expectSessionFor(rainbow, ALEX).scope).toBe(before.scope);
    },
  );

  it.each([
    ["unreadable JSON", "{not json"],
    ["a session with no user", JSON.stringify({ access_token: "t" })],
  ])("the event alone changes nothing for a write of %s, though a read would", async (_label, written) => {
    const rainbow = await signedIn();
    const before = expectSessionFor(rainbow, ALEX);

    localStorage.setItem(AUTH_KEY, written);
    storageEvent(AUTH_KEY, written);
    expect(rainbow.accountCheckState()).toBe("confirmed");

    // Put right before anything read it, so the listener is all that ran.
    writeSessionElsewhere(ALEX);
    expect(expectSessionFor(rainbow, ALEX).scope).toBe(before.scope);
  });

  it("changes nothing with no current account, so a first check still confirms", async () => {
    const rainbow = await load();
    storeSession(BLAKE);
    const firstCheck = startCheck(rainbow);

    writeSessionElsewhere(BLAKE);
    await firstCheck.finishWith(accountOk(BLAKE));

    expect(rainbow.accountCheckState()).toBe("confirmed");
    expectSessionFor(rainbow, BLAKE);
  });

  it("changes nothing with no current account and no verdict", async () => {
    const rainbow = await load();
    const generation = rainbow.accountSignInGeneration();

    writeSessionElsewhere(BLAKE);

    expect(rainbow.accountSignInGeneration()).toBe(generation);
  });
});

// No guard read before the write in these. A read with nothing stored ends the
// sign-in by itself, which would clear the verdict and prove nothing here.
describe.each<[string, () => void]>([
  ["a working sign-out", () => undefined],
  ["a failing sign-out", signOutWillFail],
])("a not-an-account verdict after %s", (_label, prepareSignOut) => {
  async function withVerdict() {
    const rainbow = await load();
    storeSession(ALEX);
    prepareSignOut();
    rpc.mockResolvedValueOnce(notLinked);
    await rainbow.ensureAccount();
    expect(rainbow.accountCheckState()).toBe("not_an_account");
    return rainbow;
  }

  it("does not outlive a write elsewhere for someone else", async () => {
    const rainbow = await withVerdict();

    writeSessionElsewhere(BLAKE);

    expect(rainbow.accountCheckState()).toBe("unsettled");
    await expectRefused(rainbow, "checking");

    await recheck(rainbow, BLAKE);
    expectSessionFor(rainbow, BLAKE);
  });

  it("does not outlive a write elsewhere for the same person", async () => {
    const rainbow = await withVerdict();

    writeSessionElsewhere(ALEX);

    expect(rainbow.accountCheckState()).toBe("unsettled");
    await expectRefused(rainbow, "checking");
  });

  it("survives a write that can't be read", async () => {
    const rainbow = await withVerdict();

    localStorage.setItem(AUTH_KEY, "{not json");
    storageEvent(AUTH_KEY, "{not json");

    expect(rainbow.accountCheckState()).toBe("not_an_account");
  });

  it("leaves a check in flight undisturbed by a write", async () => {
    const rainbow = await withVerdict();
    const inFlight = startCheck(rainbow);

    writeSessionElsewhere(ALEX);
    await inFlight.finishWith(accountOk(ALEX));

    expect(rainbow.accountCheckState()).toBe("confirmed");
    expectSessionFor(rainbow, ALEX);
  });
});

describe("a change of person in another tab, with no removal", () => {
  it("says checking when read during the other person's turn, and after Alex returns, until a new check", async () => {
    const rainbow = await signedIn();
    const before = expectSessionFor(rainbow, ALEX);

    writeSessionElsewhere(BLAKE);
    await expectRefused(rainbow, "checking");
    writeSessionElsewhere(ALEX);

    expect(rainbow.accountCheckState()).toBe("unsettled");
    await expectRefused(rainbow, "checking");

    await recheck(rainbow, ALEX);
    expect(expectSessionFor(rainbow, ALEX).scope).not.toBe(before.scope);
  });

  it("ends the sign-in when the stored value is never read between the writes", async () => {
    const rainbow = await signedIn();
    const before = expectSessionFor(rainbow, ALEX);

    writeSessionElsewhere(BLAKE);
    writeSessionElsewhere(ALEX);

    expect(rainbow.accountCheckState()).toBe("unsettled");
    await expectRefused(rainbow, "checking");

    await recheck(rainbow, ALEX);
    expect(expectSessionFor(rainbow, ALEX).scope).not.toBe(before.scope);
  });

  it("stops a check in flight from before it from confirming", async () => {
    const rainbow = await signedIn();
    const inFlight = startCheck(rainbow);

    writeSessionElsewhere(BLAKE);
    writeSessionElsewhere(ALEX);
    await inFlight.finishWith(accountOk(ALEX));

    expect(rainbow.accountCheckState()).toBe("unsettled");
    await expectRefused(rainbow, "checking");
  });

  it("gives the new person their session once their own check finishes", async () => {
    const rainbow = await signedIn();

    writeSessionElsewhere(BLAKE);
    await expectRefused(rainbow, "checking");

    await recheck(rainbow, BLAKE);
    expectSessionFor(rainbow, BLAKE);
  });
});

describe("a change of person in this tab that raised no event", () => {
  it("ends the sign-in as soon as the guard sees it, so the first person's return needs a new check", async () => {
    const rainbow = await signedIn();
    const before = expectSessionFor(rainbow, ALEX);

    storeSession(BLAKE);
    await expectRefused(rainbow, "checking");
    storeSession(ALEX);

    expect(rainbow.accountCheckState()).toBe("unsettled");
    await expectRefused(rainbow, "checking");

    await recheck(rainbow, ALEX);
    expect(expectSessionFor(rainbow, ALEX).scope).not.toBe(before.scope);
  });
});

describe("a sign-out in this tab that never reached publishAccount", () => {
  it("gives null, and restoring the session says checking until a new check", async () => {
    const rainbow = await signedIn();
    const before = expectSessionFor(rainbow, ALEX);

    localStorage.removeItem(AUTH_KEY);
    await expectRefused(rainbow, null);
    expect(rainbow.accountCheckState()).toBe("unsettled");

    storeSession(ALEX);
    await expectRefused(rainbow, "checking");

    await recheck(rainbow, ALEX);
    expect(expectSessionFor(rainbow, ALEX).scope).not.toBe(before.scope);
  });

  it("stops a check that is still running, because the store is read in every state", async () => {
    const rainbow = await signedIn();
    const running = startCheck(rainbow);

    localStorage.removeItem(AUTH_KEY);
    await expectRefused(rainbow, null);
    storeSession(ALEX);
    await running.finishWith(accountOk(ALEX));

    expect(rainbow.accountCheckState()).toBe("unsettled");
    await expectRefused(rainbow, "checking");
  });
});

describe("the scope", () => {
  it("stays the same across a re-check, including a changed email", async () => {
    const rainbow = await signedIn();
    const before = expectSessionFor(rainbow, ALEX);

    await recheck(rainbow, { ...ALEX, email: "renamed@example.test" });

    expect(expectSessionFor(rainbow, ALEX).scope).toBe(before.scope);
  });

  // Current requirement. Whether a re-check of a confirmed person counts as
  // "being checked" is with the architecture lead.
  it("comes back unchanged when a running re-check of a confirmed account ends ok", async () => {
    const rainbow = await signedIn();
    const before = expectSessionFor(rainbow, ALEX);

    const running = startCheck(rainbow);
    await expectRefused(rainbow, "checking");
    await running.finishWith(accountOk(ALEX));

    expect(expectSessionFor(rainbow, ALEX).scope).toBe(before.scope);
  });

  it("stays the same through a token refresh in this tab while the credential follows it", async () => {
    const rainbow = await signedIn();
    const before = expectSessionFor(rainbow, ALEX);

    storeSession(ALEX, "refreshed-credential");

    expect(expectSessionFor(rainbow, ALEX, "refreshed-credential").scope).toBe(before.scope);
  });

  it("survives a re-check that fails", async () => {
    const rainbow = await signedIn();
    const before = expectSessionFor(rainbow, ALEX);

    const running = startCheck(rainbow);
    await running.finishWith(rpcError);
    await expectRefused(rainbow, "checking");

    await recheck(rainbow, ALEX);
    expect(expectSessionFor(rainbow, ALEX).scope).toBe(before.scope);
  });

  it("differs for two people, with or without a sign-out between them", async () => {
    const rainbow = await signedIn();
    const alex = expectSessionFor(rainbow, ALEX);

    await signInAs(rainbow, BLAKE);
    const blake = expectSessionFor(rainbow, BLAKE);

    await rainbow.signOutOfRainbow();
    await signInAs(rainbow, ALEX);
    const alexAgain = expectSessionFor(rainbow, ALEX);

    expect(new Set([alex.scope, blake.scope, alexAgain.scope]).size).toBe(3);
  });

  it("changes when someone else is confirmed in between, even if nothing asked during their turn", async () => {
    const rainbow = await signedIn();
    const before = expectSessionFor(rainbow, ALEX);

    await signInAs(rainbow, BLAKE);
    await signInAs(rainbow, ALEX);

    expect(expectSessionFor(rainbow, ALEX).scope).not.toBe(before.scope);
  });

  it("changes after signing out and back in as the same person", async () => {
    const rainbow = await signedIn();
    const before = expectSessionFor(rainbow, ALEX);

    await rainbow.signOutOfRainbow();
    await signInAs(rainbow, ALEX);

    expect(expectSessionFor(rainbow, ALEX).scope).not.toBe(before.scope);
  });

  it.each([
    ["not_signed_in", notSignedIn],
    ["not_platform_linked", notLinked],
  ])("changes after a %s check ends the sign-in", async (_label, answer) => {
    const rainbow = await signedIn();
    const before = expectSessionFor(rainbow, ALEX);

    rpc.mockResolvedValueOnce(answer);
    await rainbow.ensureAccount();
    await signInAs(rainbow, ALEX);

    expect(expectSessionFor(rainbow, ALEX).scope).not.toBe(before.scope);
  });

  it("differs on a new visit by the same person", async () => {
    const firstVisit = await signedIn();
    const before = expectSessionFor(firstVisit, ALEX);

    const secondVisit = await signedIn();

    expect(expectSessionFor(secondVisit, ALEX).scope).not.toBe(before.scope);
  });

  it("contains nothing about the person, and the session carries only the scope and credential", async () => {
    const rainbow = await signedIn();
    const session = expectSessionFor(rainbow, ALEX);

    expect(Object.keys(session).sort()).toEqual(["credential", "scope"]);
    const returned = JSON.stringify(session);
    for (const identifying of [ALEX.user_id, ALEX.global_user_id, ALEX.email]) {
      expect(returned).not.toContain(identifying);
    }
  });
});

describe("an account check, through ensureAccount", () => {
  it("confirms an account, and nothing counts until the check closes", async () => {
    const rainbow = await load();
    storeSession(ALEX);
    // A listener hears the account published, while the check is still open.
    const whenPublished: unknown[] = [];
    rainbow.subscribeToCurrentAccount(() => {
      whenPublished.push([rainbow.accountCheckState(), rainbow.rainbowSession(credentialFor)]);
    });

    const answer = deferred();
    rpc.mockReturnValueOnce(answer.promise);
    const running = rainbow.ensureAccount();
    expect(rainbow.accountCheckState()).toBe("unsettled");

    answer.resolve(accountOk(ALEX));
    expect(await running).toEqual({ ok: true, account: ALEX, reason: "ok", message: "" });

    expect(whenPublished).toEqual([["unsettled", "checking"]]);
    expect(rainbow.accountCheckState()).toBe("confirmed");
    expectSessionFor(rainbow, ALEX);
  });

  it("signs out locally after not_platform_linked, and waits for that before it closes", async () => {
    const rainbow = await load();
    storeSession(ALEX);
    const signOut = deferred<{ error: null }>();
    auth.signOut.mockReturnValueOnce(signOut.promise);
    rpc.mockResolvedValueOnce(notLinked);

    let closed = false;
    const running = rainbow.ensureAccount().finally(() => {
      closed = true;
    });
    await flushDelayedWork();

    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(closed).toBe(false);
    expect(rainbow.accountCheckState()).toBe("unsettled");

    signOut.resolve({ error: null });

    expect((await running).reason).toBe("not_platform_linked");
    expect(rainbow.accountCheckState()).toBe("not_an_account");
  });

  it.each([
    ["an empty list", emptyAnswer],
    ["no data at all", { data: null, error: null }],
  ])("says unavailable for an answer with no row, and settles nothing: %s", async (_label, answer) => {
    const rainbow = await load();
    rpc.mockResolvedValueOnce(answer);

    expect((await rainbow.ensureAccount()).reason).toBe("unavailable");
    expect(rainbow.accountCheckState()).toBe("unsettled");
  });
});

describe("createRainbowSocial", () => {
  const TRANSPORT_ANSWER = { ok: true, data: { displayName: "From the transport", friendCount: 0, groupCount: 0 } };
  const UNAVAILABLE = { ok: false, outcome: "unavailable" };

  function fakeTransport() {
    const call = vi.fn(async () => TRANSPORT_ANSWER);
    return { call, transport: { call } as unknown as SocialTransport };
  }

  function heldTransport() {
    const held = deferred<typeof TRANSPORT_ANSWER>();
    return { release: () => held.resolve(TRANSPORT_ANSWER), transport: { call: () => held.promise } as unknown as SocialTransport };
  }

  it("off by name reaches no transport, whoever is signed in", async () => {
    const rainbow = await signedIn();
    const { call, transport } = fakeTransport();
    credentialFor.mockClear();
    const client = rainbow.createRainbowSocial({ mode: "off", transport, credentialFor });

    expect(await client.call("getMe", {})).toEqual(UNAVAILABLE);
    expect(await client.call("previewInvite", { code: "x" })).toEqual(UNAVAILABLE);

    expect(call).not.toHaveBeenCalled();
    expect(credentialFor).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "off", "MOCK", "yes please"])("takes its mode from the environment: %j is off", async (flag) => {
    vi.stubEnv("VITE_SHARED_SOCIAL", flag);
    const rainbow = await signedIn();
    const { call, transport } = fakeTransport();

    expect(await rainbow.createRainbowSocial({ transport, credentialFor }).call("getMe", {})).toEqual(UNAVAILABLE);

    expect(call).not.toHaveBeenCalled();
  });

  it("a production build refuses mock, even when asked for by name", async () => {
    vi.stubEnv("PROD", true);
    const rainbow = await signedIn();
    const { call, transport } = fakeTransport();

    expect(await rainbow.createRainbowSocial({ mode: "mock", transport, credentialFor }).call("getMe", {})).toEqual(UNAVAILABLE);

    expect(call).not.toHaveBeenCalled();
  });

  it("mock reaches the transport for a confirmed account, with that account's credential", async () => {
    const rainbow = await signedIn();
    const { call, transport } = fakeTransport();

    const answer = await rainbow.createRainbowSocial({ transport, credentialFor }).call("getMe", {});

    expect(answer).toEqual(TRANSPORT_ANSWER);
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith("getMe", {}, CREDENTIALS[ALEX.user_id]);
  });

  const unconfirmed: [string, () => Promise<Rainbow>, string][] = [
    ["a guest", () => load(), "not_signed_in"],
    ["a stored session never checked", async () => {
      const rainbow = await load();
      storeSession(ALEX);
      return rainbow;
    }, "still_checking"],
    ["a check running", async () => {
      const rainbow = await signedIn();
      startCheck(rainbow);
      return rainbow;
    }, "still_checking"],
    ["a failed check", async () => {
      const rainbow = await signedIn();
      rpc.mockResolvedValueOnce(rpcError);
      await rainbow.ensureAccount();
      return rainbow;
    }, "still_checking"],
    ["an auth user who is not a Rainbow account", async () => {
      const rainbow = await load();
      storeSession(ALEX);
      signOutWillFail();
      rpc.mockResolvedValueOnce(notLinked);
      await rainbow.ensureAccount();
      return rainbow;
    }, "not_signed_in"],
  ];

  it.each(unconfirmed)("mock sends nothing for %s", async (_label, arrive, outcome) => {
    const rainbow = await arrive();
    const { call, transport } = fakeTransport();

    expect(await rainbow.createRainbowSocial({ transport, credentialFor }).call("getMe", {})).toEqual({ ok: false, outcome });

    expect(call).not.toHaveBeenCalled();
  });

  it("mock lets a guest preview, with no credential", async () => {
    const rainbow = await load();
    const { call, transport } = fakeTransport();

    await rainbow.createRainbowSocial({ transport, credentialFor }).call("previewInvite", { code: "x" });

    expect(call).toHaveBeenCalledWith("previewInvite", { code: "x" }, null);
  });

  it("mock sends not even a preview while checking", async () => {
    const rainbow = await signedIn();
    startCheck(rainbow);
    const { call, transport } = fakeTransport();

    const answer = await rainbow.createRainbowSocial({ transport, credentialFor }).call("previewInvite", { code: "x" });

    expect(answer).toEqual({ ok: false, outcome: "still_checking" });
    expect(call).not.toHaveBeenCalled();
  });

  it("drops an answer that arrives after someone else signed in", async () => {
    const rainbow = await signedIn();
    const { release, transport } = heldTransport();
    const pending = rainbow.createRainbowSocial({ transport, credentialFor }).call("getMe", {});

    await signInAs(rainbow, BLAKE);
    release();

    expect(await pending).toEqual({ ok: false, outcome: "stale_session" });
  });

  it("drops an answer that arrives during a re-check of the same person", async () => {
    const rainbow = await signedIn();
    const { release, transport } = heldTransport();
    const pending = rainbow.createRainbowSocial({ transport, credentialFor }).call("getMe", {});

    startCheck(rainbow);
    release();

    expect(await pending).toEqual({ ok: false, outcome: "stale_session" });
  });
});

describe("what rainbowSession never does", () => {
  it("does not try to recover from a failed check on its own", async () => {
    const rainbow = await signedIn();
    rpc.mockResolvedValueOnce(rpcError);
    await rainbow.ensureAccount();

    await expectRefused(rainbow, "checking");
    await expectRefused(rainbow, "checking");
  });

  it("logs nothing, on success or failure", async () => {
    const methods = ["log", "info", "warn", "error", "debug"] as const;
    const spies = methods.map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
    try {
      const rainbow = await signedIn();
      rainbow.rainbowSession(credentialFor);
      rainbow.rainbowSession(() => { throw new Error("no token"); });
      localStorage.setItem(AUTH_KEY, "{not json");
      rainbow.rainbowSession(credentialFor);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe("useAccountOnboarding finding no user", () => {
  // Preset so the hook asks for no new device identity and goes straight to the user check.
  async function renderOnboarding() {
    localStorage.setItem("rc-device-id", "device-1");
    localStorage.setItem("rc-device-token", "device-token-1");
    const { useAccountOnboarding } = await import("@/hooks/useAccountOnboarding");
    return renderHook(() => useAccountOnboarding());
  }

  const nobodySignedIn = { data: { user: null }, error: { name: "AuthSessionMissingError", message: "no session" } };

  it("forgets the confirmation when the user check fails, with the player still on screen", async () => {
    const rainbow = await signedIn();
    expectSessionFor(rainbow, ALEX);
    auth.getUser.mockResolvedValue({ data: { user: null }, error: { name: "AuthRetryableFetchError", message: "offline" } });
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: ALEX.user_id } } }, error: null });

    const hook = await renderOnboarding();
    await waitFor(() => expect(hook.result.current.state.phase).toBe("saving_unavailable"));

    expect(hook.result.current.owner).toEqual({ kind: "account", userId: ALEX.user_id });
    expect(rainbow.getCurrentAccount()).toEqual(ALEX);
    expect(rainbow.accountCheckState()).toBe("unsettled");
    await expectRefused(rainbow, "checking");
  });

  it("rotates the scope after a failed user check, unlike a failed ensure_account", async () => {
    const rainbow = await signedIn();
    const before = expectSessionFor(rainbow, ALEX);
    auth.getUser.mockResolvedValue({ data: { user: null }, error: { name: "AuthRetryableFetchError", message: "offline" } });
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: ALEX.user_id } } }, error: null });

    const hook = await renderOnboarding();
    await waitFor(() => expect(hook.result.current.state.phase).toBe("saving_unavailable"));

    await recheck(rainbow, ALEX);
    expect(expectSessionFor(rainbow, ALEX).scope).not.toBe(before.scope);
  });

  it("forgets the confirmation when the user check rejects", async () => {
    const rainbow = await signedIn();
    auth.getUser.mockRejectedValue(new Error("network down"));
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: ALEX.user_id } } }, error: null });

    const hook = await renderOnboarding();
    await waitFor(() => expect(hook.result.current.state.phase).toBe("saving_unavailable"));

    expect(rainbow.accountCheckState()).toBe("unsettled");
    await expectRefused(rainbow, "checking");
  });

  it("forgets the confirmation when nobody is signed in, and the store has gone with them", async () => {
    const rainbow = await signedIn();
    localStorage.removeItem(AUTH_KEY);
    auth.getUser.mockResolvedValue(nobodySignedIn);
    rpc.mockResolvedValueOnce({ error: null });

    const hook = await renderOnboarding();
    await waitFor(() => expect(hook.result.current.state.phase).toBe("ready"));

    expect(rainbow.accountCheckState()).toBe("unsettled");
    await expectRefused(rainbow, null);
  });

  it("needs a new check, and gives a new scope, when tab B signs Alex back in with no guard read before it", async () => {
    const rainbow = await signedIn();
    const before = expectSessionFor(rainbow, ALEX);
    localStorage.removeItem(AUTH_KEY);
    auth.getUser.mockResolvedValue(nobodySignedIn);
    rpc.mockResolvedValueOnce({ error: null });

    const hook = await renderOnboarding();
    await waitFor(() => expect(hook.result.current.state.phase).toBe("ready"));

    // A same-person write, which the storage listener rightly ignores, so only
    // the hook's forget stands between the old sign-in and the new one.
    writeSessionElsewhere(ALEX);
    await expectRefused(rainbow, "checking");

    await recheck(rainbow, ALEX);
    expect(expectSessionFor(rainbow, ALEX).scope).not.toBe(before.scope);
  });
});
