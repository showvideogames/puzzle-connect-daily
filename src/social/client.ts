import type { Operations, OpName, Outcome, Result, SessionState, SocialTransport } from './contract';

/**
 * The client every game uses to reach the hub. PORTABLE: copied unchanged into
 * every game. It holds nothing about a person and never puts an identity in an
 * operation's args: who is calling is the credential's business alone.
 */

export interface SocialClient {
  /** Never rejects: every failure is an outcome. */
  call<O extends OpName>(op: O, args: Operations[O]['args']): Promise<Result<Operations[O]['data']>>;
  /** After a sign-out: any answer still on its way is dropped as stale. */
  forget(): void;
}

export interface SocialClientOptions {
  getSession: () => SessionState;
  transport: SocialTransport;
}

const refuse = (outcome: Outcome) => ({ ok: false, outcome }) as const;

/** What to compare before and after a call: a scope, 'checking' or null. */
const scopeOf = (session: SessionState) => (session !== null && session !== 'checking' ? session.scope : session);

export function createSocialClient({ getSession, transport }: SocialClientOptions): SocialClient {
  // Bumped by forget(), so an answer to an earlier call can't land afterwards.
  let visit = 0;

  return {
    async call<O extends OpName>(op: O, args: Operations[O]['args']): Promise<Result<Operations[O]['data']>> {
      try {
        const session = getSession();
        // Not a sign-out, and we don't know who this is yet, so not even a preview goes.
        if (session === 'checking') return refuse('still_checking');
        // Previewing an invite is the one thing a guest can do.
        if (!session && op !== 'previewInvite') return refuse('not_signed_in');

        const scope = scopeOf(session);
        const startedVisit = visit;
        let answer: Result<Operations[O]['data']>;
        try {
          answer = await transport.call(op, args, session?.credential ?? null);
        } catch {
          answer = refuse('unavailable');
        }

        // Someone else may be signed in by now. Their screen must not get this answer.
        if (visit !== startedVisit || scopeOf(getSession()) !== scope) return refuse('stale_session');
        return answer;
      } catch {
        // A session source that throws can't vouch for anyone, before the call or after it.
        return refuse('unavailable');
      }
    },
    forget() {
      visit += 1;
    },
  };
}

/** The client when the feature is off or the game is disabled. No transport exists to reach. */
export function disabledSocialClient(outcome: 'unavailable' | 'game_disabled'): SocialClient {
  return {
    async call() {
      return refuse(outcome);
    },
    forget() {},
  };
}
