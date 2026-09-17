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
  /** Still asking the server. Brief, and shows a spinner. */
  | { phase: "checking" }
  /** Resolved (or anonymous): play normally, saving works. */
  | { phase: "ready" }
  /**
   * Secure recording is not available: the credential could not be minted,
   * the RPCs are not reachable, or this browser cannot keep an identity.
   *
   * This is NOT a blocking state. The puzzle itself is fine, so the player
   * keeps playing locally and gets a small notice that this game may not
   * count. Only missing PUZZLE CONTENT blocks — there is nothing to play
   * then. Replacing a working puzzle with a maintenance page because a
   * background write failed takes away the thing that still works.
   */
  | { phase: "saving_unavailable" }
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
      // the probe for whether secure recording is available at all.
      //
      // All three failures mean the same thing to the player, so they get the
      // same honest answer rather than three behaviours:
      //   * PGRST202 — the migration has not landed yet (cutover window)
      //   * a network/database error — transient
      //   * a null identity — this browser cannot keep one (private mode,
      //     blocked storage), so it can never hold a credential
      //
      // In every case no durable write can succeed, so saying "ready" would
      // hand the player a board that silently loses their game.
      let identity: { deviceId: string; deviceToken: string } | null = null;
      try {
        identity = await ensureDeviceIdentity();
      } catch {
        identity = null;
      }

      if (!identity) {
        setState({ phase: "saving_unavailable" });
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        // An anonymous player with a credential already in hand still needs
        // to know whether the server is actually reachable — otherwise the
        // first thing they'd learn is a finished game that never saved. One
        // cheap call, which doubles as the probe for the cutover window.
        const { error: probeError } = await supabase.rpc("count_own_anonymous_sessions", {
          _device_id: identity.deviceId,
          _device_token: identity.deviceToken,
        });
        setState({ phase: probeError ? "saving_unavailable" : "ready" });
        return;
      }

      const { data, error } = await supabase.rpc("resolve_onboarding", {
        _device_id: identity.deviceId,
        _device_token: identity.deviceToken,
      });

      if (error) {
        // Same reasoning: we cannot tell whether this account owes a decision,
        // so we must not start account-owned gameplay — but the puzzle is
        // still perfectly playable, so let them play unsaved.
        setState({ phase: "saving_unavailable" });
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
          setState({ phase: "saving_unavailable" });
          return;
      }
    } catch {
      setState({ phase: "saving_unavailable" });
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

    // Saving restores itself without a reload: the migration lands, or the
    // connection comes back, and the next focus or online event picks it up.
    const recheck = () => void check();
    window.addEventListener("focus", recheck);
    window.addEventListener("online", recheck);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener("focus", recheck);
      window.removeEventListener("online", recheck);
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
