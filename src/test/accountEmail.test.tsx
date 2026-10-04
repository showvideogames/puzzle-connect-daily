/**
 * The account menu shows the account's CURRENT email — the one the server
 * reads from the shared provider's identity — and not the Supabase auth
 * user's email, which GoTrue sets at creation and never refreshes after the
 * person changes their address at the provider (Staging smoke case S6).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { User } from "@supabase/supabase-js";

const { auth, rpc } = vi.hoisted(() => ({
  auth: { signOut: vi.fn(async () => ({ error: null })) },
  rpc: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth, rpc } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PlayerAuth } from "@/components/PlayerAuth";
import { ensureAccount, signOutOfRainbow } from "@/lib/platformSignIn";

/** The auth user object as Supabase hands it to the app: email as stored at creation. */
const staleUser = { id: "u1", email: "old@example.test" } as unknown as User;

function openMenu() {
  render(
    <MemoryRouter>
      <PlayerAuth user={staleUser} onSignOut={() => {}} />
    </MemoryRouter>
  );
  fireEvent.click(screen.getByRole("button", { name: "Account" }));
}

beforeEach(async () => {
  rpc.mockReset();
  await signOutOfRainbow(); // start every test with no current account
});

describe("the account menu's email", () => {
  it("is the current email the server reported, not the auth user's stale one", async () => {
    rpc.mockResolvedValueOnce({
      data: [{ outcome: "ok", user_id: "u1", global_user_id: "user_X", email: "new@example.test", created_at: "now" }],
      error: null,
    });
    await ensureAccount();
    openMenu();
    expect(screen.getByTestId("account-email")).toHaveTextContent("new@example.test");
    expect(screen.getByTestId("account-email")).not.toHaveTextContent("old@example.test");
  });

  it("falls back to the auth user's email only while no account is known", () => {
    openMenu();
    expect(screen.getByTestId("account-email")).toHaveTextContent("old@example.test");
  });
});
