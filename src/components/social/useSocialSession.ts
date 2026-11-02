import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { SessionState } from "@/social/contract";

/**
 * Who the Friends and Groups page is showing, kept apart from what the session
 * says at this instant.
 *
 * Rainbow re-checks the account on every focus, reconnect and auth event, and
 * the session answers "checking" while it does. For a finished player that
 * changes nothing, so the page holds on while that check runs rather than
 * dropping them to setup or the name gate. Anything else is a change, including
 * a check that ended without confirming them, and the rule is the same one as a
 * clear-first reconcile: the view moves on at once, and whatever the old view
 * held goes with it.
 */

export interface SessionFacts {
  state: SessionState;
  /** Who the account check last named. */
  accountId: string | null;
  /** Who holds the stored session: null for nobody, undefined when it can't be read. */
  storedOwner: string | null | undefined;
  /** Moves when the person changes or a confirmation is forgotten. The scope lasts exactly as long as this does. */
  generation: number;
  /** An account check is running now. "checking" with none running means the last one failed. */
  checkRunning: boolean;
}

export interface SessionSource {
  read(): SessionFacts;
  /** Tells the listener when the account changes. A check that ends tells nobody, so the hook looks as well. */
  subscribe(listener: () => void): () => void;
}

export type SessionView = { kind: "checking" } | { kind: "guest" } | { kind: "signed-in"; scope: string };

interface Confirmed {
  accountId: string | null;
  generation: number;
}

export interface SessionMemo {
  view: SessionView;
  /** The sign-in the view belongs to, while it is held. */
  confirmed: Confirmed | null;
}

/** How often the hook looks when nothing has told it to. A check that ends tells nobody, so this is how soon a failed one clears. */
export const LOOK_MS = 250;

const CHECKING: SessionView = { kind: "checking" };
const GUEST: SessionView = { kind: "guest" };

export const START: SessionMemo = { view: CHECKING, confirmed: null };

/** A new key means a new person, or that the old view can't be trusted: everything on screen goes. */
export function sessionKey(view: SessionView): string {
  return view.kind === "signed-in" ? `scope:${view.scope}` : view.kind;
}

export function reconcileSession(memo: SessionMemo, facts: SessionFacts): SessionMemo {
  const { state, accountId, storedOwner, generation, checkRunning } = facts;
  if (state === null) return { view: GUEST, confirmed: null };
  if (state !== "checking") return { view: { kind: "signed-in", scope: state.scope }, confirmed: { accountId, generation } };

  const { confirmed } = memo;
  const sameSignIn = confirmed !== null && accountId !== null && accountId === confirmed.accountId && storedOwner === accountId && generation === confirmed.generation;
  return sameSignIn && checkRunning ? memo : START;
}

export function useSocialSession(source: SessionSource): SessionView {
  const memo = useRef<SessionMemo>(START);
  const [view, setView] = useState<SessionView>(() => {
    memo.current = reconcileSession(START, source.read());
    return memo.current.view;
  });

  useEffect(() => {
    /** Urgent is every look but the first: a change of person clears before anything else paints. */
    const look = (urgent: boolean) => {
      const before = sessionKey(memo.current.view);
      memo.current = reconcileSession(memo.current, source.read());
      const next = memo.current.view;
      if (sessionKey(next) === before) return;
      if (urgent) flushSync(() => setView(next));
      else setView(next);
    };
    const lookNow = () => look(true);

    look(false);
    const stop = source.subscribe(lookNow);
    const timer = setInterval(lookNow, LOOK_MS);
    addEventListener("focus", lookNow);
    addEventListener("online", lookNow);
    addEventListener("storage", lookNow);
    return () => {
      stop();
      clearInterval(timer);
      removeEventListener("focus", lookNow);
      removeEventListener("online", lookNow);
      removeEventListener("storage", lookNow);
    };
  }, [source]);

  return view;
}
