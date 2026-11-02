/**
 * The callback page mounts twice in an ordinary sign-in: the new session changes
 * the player, and OnboardingGate rebuilds every page while the first mount is
 * still checking the account. By then the code has left the address bar, and a
 * sign-in that isn't a Rainbow account has been signed out again, so asking a
 * second time gives a different answer. The page must show the first one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const handleCallback = vi.hoisted(() => vi.fn());
const ensureAccount = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock("@/lib/platformSignIn", () => ({ handleCallback, ensureAccount }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess } }));

const NOT_RAINBOW_ACCOUNT = "That sign-in is not a Rainbow Categories account.";

/** Exactly what the second ask gets in a real sign-in. */
const askedAgain = {
  callback: { ok: false, errorCode: "missing_code", errorMessage: "No sign-in code was returned.", returnTo: "/" },
  account: { ok: false, reason: "unavailable", message: "permission denied for function ensure_account" },
};

function settle<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

async function freshPage() {
  vi.resetModules();
  const { default: AuthCallback } = await import("@/pages/AuthCallback");
  return (key: string) => (
    <MemoryRouter initialEntries={["/auth/callback"]} key={key}>
      <Routes>
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/archive" element={<div>Returned to the archive</div>} />
      </Routes>
    </MemoryRouter>
  );
}

/** Mounts, lets the exchange finish, then rebuilds the page as the gate does while the account is checked. */
async function signInWithRebuild(firstAccountAnswer: unknown) {
  const page = await freshPage();
  const account = settle<unknown>();
  handleCallback
    .mockResolvedValueOnce({ ok: true, returnTo: "/archive" })
    .mockResolvedValue(askedAgain.callback);
  ensureAccount.mockReturnValueOnce(account.promise).mockResolvedValue(askedAgain.account);

  const { rerender } = render(page("guest"));
  await vi.waitFor(() => expect(ensureAccount).toHaveBeenCalledTimes(1));
  rerender(page("account"));
  account.resolve(firstAccountAnswer);
}

beforeEach(() => {
  handleCallback.mockReset();
  ensureAccount.mockReset();
  toastSuccess.mockReset();
});

describe("AuthCallback", () => {
  it("finishes the sign-in on the mount that survives, with no failure shown", async () => {
    await signInWithRebuild({ ok: true, account: { user_id: "u1" }, reason: "ok", message: "" });

    expect(await screen.findByText("Returned to the archive")).toBeTruthy();
    expect(screen.queryByTestId("auth-callback-error")).toBeNull();
    expect(handleCallback).toHaveBeenCalledTimes(1);
    expect(ensureAccount).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalledTimes(1);
  });

  it("says a sign-in isn't a Rainbow account, not what a second check would say", async () => {
    await signInWithRebuild({ ok: false, account: null, reason: "not_platform_linked", message: NOT_RAINBOW_ACCOUNT });

    expect((await screen.findByTestId("auth-callback-error")).textContent).toBe(NOT_RAINBOW_ACCOUNT);
    expect(screen.queryByText("Returned to the archive")).toBeNull();
  });

  it("shows a failure, not an endless spinner, when the exchange throws", async () => {
    const page = await freshPage();
    handleCallback.mockRejectedValue(new Error("network"));

    render(page("guest"));

    expect((await screen.findByTestId("auth-callback-error")).textContent).toBe("Sign-in did not complete.");
    expect(ensureAccount).not.toHaveBeenCalled();
  });

  it("still reports a callback that arrives with no code", async () => {
    const page = await freshPage();
    handleCallback.mockResolvedValue(askedAgain.callback);

    render(page("guest"));

    expect((await screen.findByTestId("auth-callback-error")).textContent).toBe("No sign-in code was returned.");
    expect(ensureAccount).not.toHaveBeenCalled();
  });
});
