/**
 * Who the Friends and Groups page shows. Rainbow re-checks the account on every
 * focus, reconnect and auth event, so "checking" is normal for a finished player,
 * while a new person, a sign-out or a failed check must clear everything.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSocial } from "@/components/social/appSocial";
import { SocialPage } from "@/components/social/SocialPage";
import type { SocialApi } from "@/components/social/socialApi";
import { LOOK_MS, START, reconcileSession, sessionKey, type SessionFacts, type SessionMemo } from "@/components/social/useSocialSession";
import { clearPendingInvite, pendingInviteCode, rememberPendingInvite } from "@/lib/accountFlow";
import type { Operations, Result } from "@/social/contract";

const ALEX = "account-alex";
const BEN = "account-ben";
const CODE = "abc123abc123";

const confirmed = (scope: string, accountId = ALEX, generation = 1): SessionFacts => ({ state: { scope, credential: "token" }, accountId, storedOwner: accountId, generation, checkRunning: false });
const checking = (accountId: string | null = ALEX, generation = 1): SessionFacts => ({ state: "checking", accountId, storedOwner: accountId, generation, checkRunning: true });
/** Same person, same sign-in, nothing running: all a failure at ensure_account leaves behind. */
const failedCheck = (): SessionFacts => ({ ...checking(), checkRunning: false });
const guest: SessionFacts = { state: null, accountId: null, storedOwner: null, generation: 2, checkRunning: false };

const memoFor = (facts: SessionFacts): SessionMemo => reconcileSession(START, facts);

describe("reconcileSession", () => {
  const held = reconcileSession(memoFor(confirmed("s1")), checking());

  it("keeps the view through a re-check of the same sign-in, for as long as it runs", () => {
    expect(sessionKey(held.view)).toBe("scope:s1");
    expect(sessionKey(reconcileSession(held, checking()).view)).toBe("scope:s1");
    expect(sessionKey(reconcileSession(held, confirmed("s1")).view)).toBe("scope:s1");
  });

  it("clears at once for a check that failed at ensure_account", () => {
    expect(sessionKey(reconcileSession(held, failedCheck()).view)).toBe("checking");
  });

  it("clears at once for a different person", () => {
    expect(sessionKey(reconcileSession(held, checking(BEN, 1)).view)).toBe("checking");
    expect(sessionKey(reconcileSession(held, confirmed("s2", BEN, 2)).view)).toBe("scope:s2");
  });

  it("clears at once when the sign-in generation moved, which a check that failed at the user step does", () => {
    expect(sessionKey(reconcileSession(held, checking(ALEX, 2)).view)).toBe("checking");
  });

  it("clears at once when the stored session is someone else's or can't be read", () => {
    expect(sessionKey(reconcileSession(held, { ...checking(), storedOwner: BEN }).view)).toBe("checking");
    expect(sessionKey(reconcileSession(held, { ...checking(), storedOwner: undefined }).view)).toBe("checking");
  });

  it("clears at once for a sign-out", () => {
    expect(sessionKey(reconcileSession(held, guest).view)).toBe("guest");
  });

  it("holds nothing for someone it never confirmed", () => {
    expect(sessionKey(memoFor(checking()).view)).toBe("checking");
  });

  it("holds nothing once a failed check has cleared, until someone is confirmed again", () => {
    const failed = reconcileSession(held, failedCheck());
    expect(sessionKey(reconcileSession(failed, checking()).view)).toBe("checking");
    expect(sessionKey(reconcileSession(failed, confirmed("s1")).view)).toBe("scope:s1");
  });
});

type Answers = { [O in keyof Operations]?: (args: Operations[O]["args"]) => Result<unknown> | Promise<Result<unknown>> };

const me = (displayName: string | null, friendCode: string) => ({
  ok: true as const,
  data: { displayName, animalId: "fox", backgroundColor: "#DED1F2", friendCode, friendCount: 0, groupCount: 0 },
});

const listsOf = (empty: unknown) => () => ({ ok: true as const, data: empty });

const person = (displayName: string | null, friendCode: string, more: Answers = {}): Answers => ({
  getMe: () => me(displayName, friendCode),
  listFriendRequests: listsOf({ incoming: [], outgoing: [] }),
  listFriends: listsOf([]),
  listResults: listsOf([]),
  listMyGroups: listsOf([]),
  ...more,
});

function fakeSocial(start: SessionFacts, answers: Answers, signIn: AppSocial["signIn"] = vi.fn(async () => null)) {
  let facts = start;
  const listeners = new Set<() => void>();
  const answersRef = { current: answers };
  const call = vi.fn(async (op: string, args: unknown) => {
    const answer = (answersRef.current as Record<string, ((given: unknown) => unknown) | undefined>)[op];
    return (answer ? answer(args) : { ok: false, outcome: "unavailable" }) as never;
  });
  const api: SocialApi = {
    client: { call: call as never, forget: vi.fn() },
    puzzleId: () => "puzzle-1",
    today: () => new Date(2026, 9, 31),
    linkUrl: (code) => `http://rainbow.test/join/${code}`,
    share: vi.fn(async () => "done" as const),
  };
  const social: AppSocial = {
    api,
    signIn,
    source: {
      read: () => facts,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
  return {
    social,
    call,
    setAnswers: (next: Answers) => {
      answersRef.current = next;
    },
    /** The session moves, and tells the page, as a published account does. */
    become(next: SessionFacts) {
      facts = next;
      act(() => {
        for (const listener of listeners) listener();
      });
    },
    /** The session moves and tells nobody, as a check that ends does. */
    becomeQuietly(next: SessionFacts) {
      facts = next;
    },
  };
}

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>;
}

const open = (social: AppSocial, code: string | null = null, at = "/friends") =>
  render(
    <MemoryRouter initialEntries={[at]}>
      <SocialPage social={social} code={code} />
      <Where />
    </MemoryRouter>,
  );

beforeEach(() => {
  clearPendingInvite();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the page, during a background re-check", () => {
  it("keeps the last known profile on screen, with no setup, gate or reload", async () => {
    const fake = fakeSocial(confirmed("s1"), person("Alex", "AAA-222"));
    open(fake.social);
    expect(await screen.findByText("AAA-222")).toBeInTheDocument();
    const reads = fake.call.mock.calls.length;

    fake.become(checking());
    expect(screen.getByText("AAA-222")).toBeInTheDocument();
    expect(screen.queryByTestId("display-name-gate")).toBeNull();
    expect(screen.queryByTestId("social-waiting")).toBeNull();

    fake.become(confirmed("s1"));
    expect(screen.getByText("AAA-222")).toBeInTheDocument();
    expect(fake.call.mock.calls.length).toBe(reads);
  });

  it("clears at once for a different person, before any answer about them", async () => {
    const fake = fakeSocial(confirmed("s1"), person("Alex", "AAA-222"));
    open(fake.social);
    await screen.findByText("AAA-222");

    fake.become(checking(BEN, 2));
    expect(screen.queryByText("AAA-222")).toBeNull();
    expect(screen.getByTestId("social-waiting")).toHaveTextContent("Checking who this is");

    fake.setAnswers(person("Ben", "BBB-333"));
    fake.become(confirmed("s2", BEN, 2));
    expect(await screen.findByText("BBB-333")).toBeInTheDocument();
    expect(screen.queryByText("AAA-222")).toBeNull();
    expect(fake.social.api.client.forget).toHaveBeenCalled();
  });

  it("clears at once for a sign-out", async () => {
    const fake = fakeSocial(confirmed("s1"), person("Alex", "AAA-222"));
    open(fake.social);
    await screen.findByText("AAA-222");
    fake.become(guest);
    expect(screen.queryByText("AAA-222")).toBeNull();
    expect(await screen.findByTestId("social-guest")).toBeInTheDocument();
  });

  it("clears a check that fails at ensure_account on its next look, though nobody says so, and loads afresh after", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fake = fakeSocial(confirmed("s1"), person("Alex", "AAA-222"));
    open(fake.social);
    await screen.findByText("AAA-222");

    fake.become(checking());
    expect(screen.getByText("AAA-222")).toBeInTheDocument();

    fake.becomeQuietly(failedCheck());
    act(() => {
      vi.advanceTimersByTime(LOOK_MS);
    });
    expect(screen.queryByText("AAA-222")).toBeNull();
    expect(screen.getByTestId("social-waiting")).toBeInTheDocument();

    fake.become(confirmed("s1"));
    expect(await screen.findByText("AAA-222")).toBeInTheDocument();
  });

  it("holds through a check that runs a long time, because it hasn't failed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fake = fakeSocial(confirmed("s1"), person("Alex", "AAA-222"));
    open(fake.social);
    await screen.findByText("AAA-222");

    fake.become(checking());
    act(() => {
      vi.advanceTimersByTime(60000);
    });
    expect(screen.getByText("AAA-222")).toBeInTheDocument();
    expect(screen.queryByTestId("social-waiting")).toBeNull();
  });

  it("quietly asks again when a read was stopped by the re-check, and says nothing about it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fake = fakeSocial(confirmed("s1"), person("Alex", "AAA-222", { getMe: () => ({ ok: false, outcome: "stale_session" }) }));
    open(fake.social);
    await waitFor(() => expect(fake.call).toHaveBeenCalledWith("getMe", {}));
    expect(screen.queryByTestId("social-note")).toBeNull();

    fake.setAnswers(person("Alex", "AAA-222"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    expect(await screen.findByText("AAA-222")).toBeInTheDocument();
  });
});

describe("an answer for someone else", () => {
  it("never paints: the page keeps the newer person after the older answer lands", async () => {
    let finishAlex: (answer: unknown) => void = () => undefined;
    const held = new Promise((resolve) => {
      finishAlex = resolve;
    });
    const fake = fakeSocial(confirmed("s1"), person("Alex", "AAA-222", { getMe: () => held as never }));
    open(fake.social);
    await waitFor(() => expect(fake.call).toHaveBeenCalledWith("getMe", {}));

    fake.setAnswers(person("Ben", "BBB-333"));
    fake.become(confirmed("s2", BEN, 2));
    await screen.findByText("BBB-333");

    await act(async () => {
      finishAlex(me("Alex", "AAA-222"));
      await held;
    });
    expect(screen.getByText("BBB-333")).toBeInTheDocument();
    expect(screen.queryByText("AAA-222")).toBeNull();
  });
});

describe("no name yet", () => {
  it("shows the name gate only when getMe says so, and setProfile saves through the form", async () => {
    const answers = person(null, "AAA-222", {
      setProfile: () => {
        fake.setAnswers(person("Alex", "AAA-222"));
        return { ok: true, data: {} };
      },
    });
    const fake = fakeSocial(confirmed("s1"), answers);
    open(fake.social);
    fireEvent.click(await screen.findByRole("button", { name: "Choose a Display Name" }));
    fireEvent.change(await screen.findByLabelText("Display Name"), { target: { value: "Alex" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("AAA-222")).toBeInTheDocument();
    expect(fake.call).toHaveBeenCalledWith("setProfile", { displayName: "Alex", animalId: "fox", backgroundColor: "#DED1F2" });
  });

  it("Not now leaves for the game", async () => {
    const fake = fakeSocial(confirmed("s1"), person(null, "AAA-222"));
    open(fake.social);
    await screen.findByTestId("display-name-gate");
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/$/));
  });
});

describe("signing in", () => {
  const groupPreview = { name: "Friday Puzzlers", emblemId: "campfire", accentColor: "#DED1F2", photo: null, isMember: false, isRemoved: false, memberPreview: { faces: [], leadName: "Jordan", memberCount: 2 } };

  it("keeps the invitation first, then leaves for the real sign-in", async () => {
    const seen: (string | null)[] = [];
    const signIn = vi.fn(async () => {
      seen.push(pendingInviteCode());
      return null;
    });
    const fake = fakeSocial(guest, { previewInvite: () => ({ ok: true, data: groupPreview }) }, signIn);
    open(fake.social, CODE, `/join/${CODE}`);
    fireEvent.click(await screen.findByRole("button", { name: "Sign in to join" }));
    await waitFor(() => expect(signIn).toHaveBeenCalledTimes(1));
    expect(seen).toEqual([CODE]);
    expect(screen.getByRole("button", { name: "Opening sign-in…" })).toBeDisabled();
  });

  it("says why when the sign-in can't start, and lets them try again", async () => {
    const signIn = vi.fn(async () => "Sign-in is temporarily unavailable.");
    const fake = fakeSocial(guest, {}, signIn);
    open(fake.social);
    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    expect(await screen.findByTestId("social-note")).toHaveTextContent("Sign-in is temporarily unavailable.");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("offers the invitation again to someone who came back to /friends with one waiting", async () => {
    rememberPendingInvite(CODE);
    const fake = fakeSocial(confirmed("s1"), person("Alex", "AAA-222"));
    open(fake.social);
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(`/join/${CODE}`));
  });

  it("forgets the invitation once it has been answered", async () => {
    rememberPendingInvite(CODE);
    const fake = fakeSocial(confirmed("s1"), person("Alex", "AAA-222", { previewInvite: () => ({ ok: true, data: groupPreview }) }));
    open(fake.social, CODE, `/join/${CODE}`);
    fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/friends"));
    expect(pendingInviteCode()).toBeNull();
  });
});

it('discards slow results after a partially loaded hub signs out or switches accounts',async()=>{
 let finish!:(value:unknown)=>void;
 const fake=fakeSocial(confirmed('s1'),person('Alex','AAA-222',{listResults:()=>new Promise(resolve=>{finish=resolve;}) as never}));
 open(fake.social);await screen.findByText('AAA-222');await screen.findByText('Loading results…');
 fake.become(guest);expect(screen.queryByText('AAA-222')).toBeNull();
 fake.setAnswers(person('Ben','BBB-333'));fake.become(confirmed('s2',BEN,2));await screen.findByText('BBB-333');
 await act(async()=>{finish({ok:true,data:[]});});
 expect(screen.queryByText('AAA-222')).toBeNull();expect(screen.getByText('BBB-333')).toBeInTheDocument();
});
