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
        if (op === 'getMe') return { ok: true, data: { displayName: name, animalId: 'fox', backgroundColor: '#DED1F2', friendCode: 'ABC-234', friendCount: 0, groupCount: 0 } };
        if (op === 'listFriendRequests') return { ok: true, data: { incoming: Array.from({ length: incoming }, (_, i) => ({ requestRef: `r${i}` })), outgoing: [] } };
        if (op === 'setProfile') { name = args.displayName ?? name; return { ok: true, data: {} }; }
        if (['listFriends', 'listResults', 'listMyGroups', 'listBlocked'].includes(op)) return { ok: true, data: [] };
        return { ok: false, outcome: 'unavailable' };
      },
    },
    puzzleId: () => null, today: () => new Date(), linkUrl: () => '', share: async () => 'done',
  },
  signIn: async () => 'Mock preview only',
} as unknown as AppSocial;
export function appSocial() { return social; }
