import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  createDeviceIdentity,
  ensureDeviceIdentity,
  getDeviceId,
  getDeviceToken,
  resetDeviceIdentity,
} from "@/lib/gameStats";

/**
 * The one-time "Bring your progress with you?" decision, driven entirely by
 * server state.
 *
 * This deliberately does NOT try to work out whether an auth event was a
 * signup or a sign-in. That inference was the source of the old flow's
 * silent failures: the event type varies by provider and redirect shape, and
 * a client-side "already prompted" flag is lost on a new device and can be
 * set by an error path. Instead every authenticated load asks the server
 * "is there an unresolved decision for me?", and the server — which created
 * the account's row and owns the one-shot compare-and-swap — answers.
 *
 * While the answer is "pending with real history", normal gameplay must not
 * begin: the account would start accumulating its own sessions and streak
 * before the import it is about to be offered. The database enforces that
 * (create_game_session refuses a pending account); this hook is what makes it
 * a coherent experience rather than a silent failure.
 */
export type OnboardingPhase =
  /** Still asking the server. Nothing should be playable yet. */
  | { phase: "checking" }
  /** Resolved (or anonymous): play normally. */
  | { phase: "ready" }
  /**
   * The new RPCs are not reachable — during the cutover window this means
   * the migration has not landed yet. Show maintenance, keep retrying.
   */
  | { phase: "unavailable" }
  /** A real decision is outstanding. */
  | {
      phase: "decision";
      gamesPlayed: number;
      currentStreak: number;
      longestStreak: number;
      email: string | null;
      /**
       * True when this browser holds a credential the server would not
       * accept. We cannot show real numbers and must not auto-resolve, so the
       * player is offered an explicit Start Fresh instead.
       */
      degraded: boolean;
    };

/** PostgREST's "no such function in the schema cache". */
function isMissingFunction(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || /does not exist/i.test(error.message ?? "");
}

interface ResolveRow {
  outcome: string;
  status: string | null;
  games_played: number | null;
  current_streak: number | null;
  longest_streak: number | null;
}

export function useAccountOnboarding() {
  const [state, setState] = useState<OnboardingPhase>({ phase: "checking" });
  const running = useRef(false);

  const check = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      // Every client needs an identity, signed in or not, so this doubles as
      // the probe for whether the new schema is live at all.
      let identity: { deviceId: string; deviceToken: string } | null = null;
      try {
        identity = await ensureDeviceIdentity();
      } catch (err) {
        if (isMissingFunction(err as { code?: string; message?: string })) {
          setState({ phase: "unavailable" });
          return;
        }
        // Storage blocked, or a transient failure. Play can continue
        // anonymously; the server will simply refuse durable writes.
        identity = null;
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setState({ phase: "ready" });
        return;
      }

      const { data, error } = await supabase.rpc("resolve_onboarding", {
        _device_id: identity?.deviceId ?? getDeviceId(),
        _device_token: identity?.deviceToken ?? getDeviceToken(),
      });

      if (error) {
        // Missing function (migration not landed yet) and a transient failure
        // get the same treatment: never guess, never let gameplay start, keep
        // retrying. The server would refuse the writes anyway.
        setState({ phase: "unavailable" });
        return;
      }

      const row = (Array.isArray(data) ? data[0] : data) as ResolveRow | null;
      switch (row?.outcome) {
        case "import_available":
          setState({
            phase: "decision",
            gamesPlayed: row.games_played ?? 0,
            currentStreak: row.current_streak ?? 0,
            longestStreak: row.longest_streak ?? 0,
            email: user.email ?? null,
            degraded: false,
          });
          return;
        case "credential_invalid":
          // Fails closed server-side: the account is still pending, so the
          // one-time opportunity has NOT been spent. Offer the explicit
          // choice rather than silently resolving it away.
          setState({
            phase: "decision",
            gamesPlayed: 0,
            currentStreak: 0,
            longestStreak: 0,
            email: user.email ?? null,
            degraded: true,
          });
          return;
        case "already_resolved":
        case "no_guest_history":
        case "unauthenticated":
          setState({ phase: "ready" });
          return;
        default:
          setState({ phase: "unavailable" });
          return;
      }
    } catch {
      setState({ phase: "unavailable" });
    } finally {
      running.current = false;
    }
  }, []);

  useEffect(() => {
    void check();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        // A later logout starts a genuinely separate guest identity, so the
        // account holder's browser does not keep playing as the identity
        // their account already absorbed.
        resetDeviceIdentity();
      }
      void check();
    });

    // The maintenance case self-heals: the cutover migration lands while the
    // tab is open, and the next focus picks it up without a manual reload.
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener("focus", onFocus);
    };
  }, [check]);

  /**
   * After either decision the source identity is retired server-side, so this
   * browser must mint a fresh one before it writes any more gameplay —
   * otherwise every subsequent write would fail its device check.
   */
  const rotateAfterDecision = useCallback(async () => {
    try {
      await createDeviceIdentity();
    } catch {
      // A failed mint leaves the player effectively storage-blocked, which
      // the rest of the app already tolerates.
    }
  }, []);

  const addMyProgress = useCallback(async () => {
    const { data, error } = await supabase.rpc("import_guest_history", {
      _device_id: getDeviceId(),
      _device_token: getDeviceToken(),
    });
    const row = (Array.isArray(data) ? data[0] : data) as { outcome?: string } | null;
    if (error || !row || (row.outcome !== "imported" && row.outcome !== "already_resolved")) {
      // Left pending on purpose: a failed import must not consume the
      // opportunity. Re-checking shows the choice again.
      await check();
      return;
    }
    await rotateAfterDecision();
    setState({ phase: "ready" });
  }, [check, rotateAfterDecision]);

  const startFresh = useCallback(async () => {
    const { data, error } = await supabase.rpc("decline_guest_history", {
      _device_id: getDeviceId(),
      _device_token: getDeviceToken(),
    });
    const row = (Array.isArray(data) ? data[0] : data) as { outcome?: string } | null;
    if (error || !row || (row.outcome !== "started_fresh" && row.outcome !== "already_resolved")) {
      await check();
      return;
    }
    await rotateAfterDecision();
    setState({ phase: "ready" });
  }, [check, rotateAfterDecision]);

  return { state, recheck: check, addMyProgress, startFresh };
}
