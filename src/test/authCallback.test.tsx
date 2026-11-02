/**
 * The callback page mounts twice in an ordinary sign-in: the new session changes
 * the player, and OnboardingGate rebuilds every page. The second mount must
 * finish the sign-in, not report that no code came back.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const handleCallback = vi.hoisted(() => vi.fn());
const ensureAccount = vi.hoisted(() => vi.fn());
vi.mock("@/lib/platformSignIn", () => ({ handleCallback, ensureAccount }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

import AuthCallback from "@/pages/AuthCallback";

function page(key: string) {
  return (
    <MemoryRouter initialEntries={["/auth/callback"]} key={key}>
      <Routes>
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/archive" element={<div>Returned to the archive</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe("AuthCallback", () => {
  it("exchanges the code once and finishes the sign-in on the mount that survives", async () => {
    let finishExchange: (result: { ok: boolean; returnTo: string }) => void = () => {};
    handleCallback.mockReturnValue(new Promise((resolve) => (finishExchange = resolve)));
    ensureAccount.mockResolvedValue({ ok: true });

    const { rerender } = render(page("guest"));
    rerender(page("account"));
    finishExchange({ ok: true, returnTo: "/archive" });

    expect(await screen.findByText("Returned to the archive")).toBeTruthy();
    expect(handleCallback).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(ensureAccount).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("auth-callback-error")).toBeNull();
  });
});
