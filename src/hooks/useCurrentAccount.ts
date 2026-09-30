import { useSyncExternalStore } from "react";
import { getCurrentAccount, subscribeToCurrentAccount, type RainbowAccount } from "@/lib/platformSignIn";

/**
 * The Rainbow account behind the current session, as the server last
 * reported it through ensure_account() — or null for a guest.
 *
 * This is where a component gets the account's email from. Not from the
 * Supabase auth user: after the person changes their address at the shared
 * provider, GoTrue refreshes the identity (which the server reads) but never
 * auth.users.email (which the auth user object carries).
 */
export function useCurrentAccount(): RainbowAccount | null {
  return useSyncExternalStore(subscribeToCurrentAccount, getCurrentAccount, getCurrentAccount);
}
