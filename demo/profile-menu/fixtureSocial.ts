import type { AppSocial } from '@/components/social/appSocial';
let name = 'River';
let incoming = 2;
export function setNotifications(count: number) { incoming = count; }
const social = {
  source: {
    read: () => ({ state: { scope: 'fixture', credential: 'fixture' }, accountId: 'fixture', storedOwner: 'fixture', generation: 1, checkRunning: false }),
    subscribe: () => () => {},
  },
  api: {
    client: {
      forget() {},
      async call(op: string, args: { displayName?: string }) {
        if (op === 'listGroupOrder') return { ok: true, data: { groupIds: [] } };
        if (op === 'getMe') return { ok: true, data: { displayName: name, animalId: 'fox', backgroundColor: '#DED1F2', friendCode: 'ABC-234', friendCount: 0, groupCount: 0 } };
        if (op === 'listFriendRequests') return { ok: true, data: { incoming: Array.from({ length: incoming }, (_, i) => ({ requestRef: `r${i}` })), outgoing: [] } };
        if (op === 'setProfile') { name = args.displayName ?? name; return { ok: true, data: {} }; }
        if (['listFriendPreferences', 'listFriends', 'listResults', 'listMyGroups', 'listBlocked'].includes(op)) return { ok: true, data: [] };
        return { ok: false, outcome: 'unavailable' };
      },
    },
    puzzleId: () => null, today: () => new Date(), linkUrl: () => '', share: async () => 'done',
  },
  signIn: async () => 'Mock preview only',
} as unknown as AppSocial;
/** The Friends preview swaps in its mock world, so the real page and header read the same fictional account. */
let override: AppSocial | null = null;
export function setFixtureSocial(next: AppSocial) { override = next; }
export function appSocial() { return override ?? social; }
