import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GroupFlow } from '@/components/social/GroupFlow';
import type { SocialApi } from '@/components/social/socialApi';
import type { MemberRow } from '@/social/contract';
import '@/index.css';
const initial: MemberRow[] = [
  { memberRef: 'owner', name: 'River', isOwner: true, isMe: true, animalId: 'fox', backgroundColor: '#DED1F2', joinedAt: '2026-11-01' },
  { memberRef: 'friend', name: 'Jordan', isOwner: false, isMe: false, animalId: 'otter', backgroundColor: '#CCE6CA', joinedAt: '2026-11-02' },
  { memberRef: 'long', name: 'A very long member name', isOwner: false, isMe: false, animalId: 'owl', backgroundColor: '#F8D0BD', joinedAt: '2026-11-03' },
];
function Preview() {
  const [count, setCount] = useState(initial.length);
  const api = useMemo(() => {
    let members = [...initial];
    return {
      client: { forget() {}, async call(op: string, args: { memberRef?: string }) {
        if (op === 'listMembers') return { ok: true, data: members };
        if (op === 'listResults') return { ok: true, data: [] };
        if (op === 'removeMember') { members = members.filter(m => m.memberRef !== args.memberRef); setCount(members.length); return { ok: true, data: {} }; }
        return { ok: false, outcome: 'unavailable' };
      } }, puzzleId: () => 'fixture-puzzle', today: () => new Date(2026,10,5), linkUrl: () => '', share: async () => 'done',
    } as unknown as SocialApi;
  }, []);
  return <div className="mx-auto max-w-xl p-4">
    <GroupFlow api={api} group={{ groupId: 'fixture-group', name: 'Puzzle Pals', memberCount: count, emblemId: 'campfire', photo: null, accentColor: '#DED1F2', isOwner: true, inviteCode: null }} onBack={() => {}} onLeft={() => {}} onReload={async () => {}} />
  </div>;
}
if (['127.0.0.1', 'localhost'].includes(location.hostname)) createRoot(document.getElementById('root')!).render(<Preview />);
