import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  createDeviceIdentity,
  ensureDeviceIdentity,
  getDeviceId,
  getDeviceToken,
  resetDeviceIdentity,
} from "@/lib/gameStats";
import { ensureAccount } from "@/lib/platformSignIn";
import { copyGuestProgressToAccount, sameOwner, type ProgressOwner } from "@/lib/progressOwner";

/**
 * The one-time "Bring your progress with you?" decision, driven entirely by
 * server state — and, since the launch baseline, asked once per DEVICE
 * rather than once per account.
 *
 * Every authenticated load asks the server two things:
 *
 *   1. ensure_account      is this session a Rainbow account? (creates the
 *                          accounts row on first sight; an auth user that did
 *                          not come through the shared sign-in is signed out
 *                          locally and stays a guest)
 *   2. resolve_device_import  does THIS browser's device still owe the
 *                          import decision? The server, which owns the device
 *                          row and its one-way retirement, answers.
 *
 * While the answer is "import available", normal gameplay must not begin:
 * the account would start accumulating its own sessions and streak before
 * the import it is about to be offered. The database enforces that
 * (create_game_session refuses a Rainbow account on a live device with guest
 * history); this hook is what makes it a coherent experience rather than a
 * silent failure.
 *
 * Asking per device is what lets a phone that also played as a guest get its
 * own question, and what stops guest games played after a sign-out from
 * being stranded when the same person signs in again.
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

interface ResolveRow {
  outcome: string;
  games_played: number | null;
  current_streak: number | null;
  longest_streak: number | null;
}

/** The first Supabase auth error means "nobody is signed in", not a failure. */
function isNoSession(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === "AuthSessionMissingError";
}

export function useAccountOnboarding() {
  const [state, setState] = useState<OnboardingPhase>({ phase: "checking" });
  /**
   * Whose browser progress the app shows (see lib/progressOwner.ts). Set
   * together with every resolved phase, and cleared the moment a different
   * player signs in or out, so one player's boards are never on screen for
   * the next.
   */
  const [owner, setOwner] = useState<ProgressOwner | null>(null);
  const ownerRef = useRef<ProgressOwner | null>(null);
  const running = useRef(false);
  // A check asked for while another is running. The running one's answer may
  // describe a player who has since signed in or out, so it is thrown away
  // and the check runs again.
  const rerun = useRef(false);

  const resolve = useCallback(async (): Promise<{ state: OnboardingPhase; owner: ProgressOwner }> => {
    // Who is playing, as far as this browser knows. A guest is this
    // browser's device identity ("unknown" only for a browser that cannot
    // store one, where no progress can be saved anyway).
    const guestOwner = (): ProgressOwner => ({ kind: "guest", deviceId: getDeviceId() });
    const accountOwner = (userId: string): ProgressOwner => ({ kind: "account", userId });
    // Whoever holds the stored session, without asking the server. Used when
    // the server cannot be asked: the player is still who they were, and
    // must keep seeing their own boards rather than a guest's.
    const storedSessionOwner = async (): Promise<ProgressOwner> => {
      try {
        const { data } = await supabase.auth.getSession();
        const id = data.session?.user?.id;
        return id ? accountOwner(id) : guestOwner();
      } catch {
        return guestOwner();
      }
    };

    try {
      // Every client needs an identity, signed in or not, so this doubles as
      // the probe for whether secure recording is available at all.
      //
      // All three failures mean the same thing to the player, so they get the
      // same honest answer rather than three behaviours:
      //   * PGRST202 — the function is not in the schema (deploy window)
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
        return { state: { phase: "saving_unavailable" }, owner: await storedSessionOwner() };
      }

      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (!user) {
        // A stored session the server could not be asked about (offline,
        // for one) is still that player, not a guest.
        if (userError && !isNoSession(userError)) {
          return { state: { phase: "saving_unavailable" }, owner: await storedSessionOwner() };
        }
        // An anonymous player with a credential already in hand still needs
        // to know whether the server is actually reachable — otherwise the
        // first thing they'd learn is a finished game that never saved.
        const { error: probeError } = await supabase.rpc("ping");
        return { state: { phase: probeError ? "saving_unavailable" : "ready" }, owner: guestOwner() };
      }

      // A session exists. Is it a Rainbow account? (In a shared Supabase
      // project an auth user can exist without being one.) ensure_account
      // creates the row on first sign-in; not_platform_linked signs the
      // session out locally, which fires SIGNED_OUT and re-runs this check
      // as a guest.
      const account = await ensureAccount();
      if (!account.ok || !account.account) {
        return account.reason === "not_platform_linked"
          ? { state: { phase: "ready" }, owner: guestOwner() }
          : { state: { phase: "saving_unavailable" }, owner: accountOwner(user.id) };
      }
      const owner = accountOwner(user.id);
      // The email shown in the import prompt is the account's CURRENT one,
      // from the server. Never user.email: GoTrue does not refresh it after
      // a change at the shared provider.
      const accountEmail = account.account.email ?? null;

      const { data, error } = await supabase.rpc("resolve_device_import", {
        _device_id: identity.deviceId,
        _device_token: identity.deviceToken,
      });

      if (error) {
        // Same reasoning: we cannot tell whether this device owes a decision,
        // so we must not start account-owned gameplay — but the puzzle is
        // still perfectly playable, so let them play unsaved.
        return { state: { phase: "saving_unavailable" }, owner };
      }

      const row = (Array.isArray(data) ? data[0] : data) as ResolveRow | null;
      switch (row?.outcome) {
        case "import_available":
          return {
            state: {
              phase: "decision",
              gamesPlayed: row.games_played ?? 0,
              currentStreak: row.current_streak ?? 0,
              longestStreak: row.longest_streak ?? 0,
              email: accountEmail,
              degraded: false,
            },
            owner,
          };
        case "credential_invalid":
          // Fails closed server-side: nothing was consumed. Offer the explicit
          // choice rather than silently resolving it away.
          return {
            state: {
              phase: "decision",
              gamesPlayed: 0,
              currentStreak: 0,
              longestStreak: 0,
              email: accountEmail,
              degraded: true,
            },
            owner,
          };
        case "already_decided":
        case "no_guest_history":
        case "unauthenticated":
          return { state: { phase: "ready" }, owner };
        default:
          return { state: { phase: "saving_unavailable" }, owner };
      }
    } catch {
      return { state: { phase: "saving_unavailable" }, owner: await storedSessionOwner() };
    }
  }, []);

  const apply = useCallback((next: { state: OnboardingPhase; owner: ProgressOwner }) => {
    // The same player keeps the same object: this check re-runs on every
    // focus and reconnect, and pages that depend on the player must not
    // reload for an answer that changed nothing.
    const owner = sameOwner(ownerRef.current, next.owner) ? ownerRef.current! : next.owner;
    ownerRef.current = owner;
    setOwner(owner);
    setState(next.state);
  }, []);

  const check = useCallback(async () => {
    if (running.current) {
      rerun.current = true;
      return;
    }
    running.current = true;
    try {
      do {
        rerun.current = false;
        const next = await resolve();
        // Asked again while this ran (a sign-in or sign-out, most often):
        // this answer may describe the previous player, so it is dropped.
        if (rerun.current) continue;
        apply(next);
      } while (rerun.current);
    } finally {
      running.current = false;
    }
  }, [resolve, apply]);

  useEffect(() => {
    void check();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // The stored session this page loaded with — exactly what the check
      // above is already reading. Asking again would only repeat it.
      if (event === "INITIAL_SESSION") return;
      if (event === "SIGNED_OUT") {
        // A later logout starts a genuinely separate guest identity, so the
        // account holder's browser does not keep playing as the identity
        // their account already absorbed.
        resetDeviceIdentity();
      }
      // A different player now: take the previous one's boards off screen
      // straight away, before the check below has asked the server anything.
      // A token refresh for the same player changes nothing here.
      const current = ownerRef.current;
      const nextUserId = event === "SIGNED_OUT" ? null : session?.user?.id ?? null;
      const currentUserId = current?.kind === "account" ? current.userId : null;
      if (current && (event === "SIGNED_OUT" || nextUserId !== currentUserId)) {
        ownerRef.current = null;
        setOwner(null);
        setState({ phase: "checking" });
      }
      void check();
    });

    // Saving restores itself without a reload: the connection comes back,
    // and the next focus or online event picks it up.
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
   * After either decision the source device is retired server-side, so this
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
    const guestDeviceId = getDeviceId();
    const { data, error } = await supabase.rpc("import_guest_history", {
      _device_id: guestDeviceId,
      _device_token: getDeviceToken(),
    });
    const row = (Array.isArray(data) ? data[0] : data) as { outcome?: string } | null;
    if (error || !row || (row.outcome !== "imported" && row.outcome !== "already_decided")) {
      // Left undecided on purpose: a failed import must not consume the
      // opportunity. Re-checking shows the choice again.
      await check();
      return;
    }
    // The player said yes and the server moved their games: their boards in
    // this browser come with them. Only on "imported" — "already_decided"
    // says nothing about which way an earlier decision went.
    const current = ownerRef.current;
    if (row.outcome === "imported" && current?.kind === "account") {
      copyGuestProgressToAccount(guestDeviceId, current.userId);
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
    if (error || !row || (row.outcome !== "started_fresh" && row.outcome !== "already_decided")) {
      await check();
      return;
    }
    await rotateAfterDecision();
    setState({ phase: "ready" });
  }, [check, rotateAfterDecision]);

  return { state, owner, recheck: check, addMyProgress, startFresh };
}
