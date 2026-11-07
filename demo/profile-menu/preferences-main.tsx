import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HelmetProvider } from 'react-helmet-async';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { SlidersHorizontal } from 'lucide-react';
import { createMockWorld } from '@/social/conformance';
import type { SocialApi } from '@/components/social/socialApi';
import Friends from '@/pages/Friends';
import { MinimalHeader } from '@/components/MinimalHeader';
import { setFixtureSocial } from './fixtureSocial';
import '@/index.css';
const previewParams = new URLSearchParams(location.search);
document.documentElement.classList.toggle('dark', previewParams.get('theme') === 'dark');
const world = createMockWorld();
world.advance(new Date('2026-11-01T12:00:00.000Z').getTime()-world.now());
const alice = world.signIn('rainbow','River');
const bob = world.signIn('rainbow','Jordan');
const carol = world.signIn('rainbow','Sky');
for (const friend of previewParams.has('empty') ? [] : [bob,carol]) {
  const invite=await alice.call('createFriendInvite',{noticeVersion:1});
  if (invite.ok) await friend.call('acceptFriendInvite',{code:invite.data.code,noticeVersion:1});
}
// The longest names the server takes: 24 for a person, 40 for a group (LIMITS in src/social/contract.ts).
// The long group comes first, so it is also on the Home card, not only the Groups tab.
const LONG_NICKNAME='Bartholomew the Puzzler!';
const LONG_GROUP='The Saturday Morning Puzzle Club of Utah';
if(previewParams.has('long')&&!previewParams.has('empty')) {
  world.advance(1000);
  const made=await alice.call('createGroup',{name:LONG_GROUP,myName:'River',noticeVersion:1});
  if(made.ok)for(const [friend,myName] of [[bob,'Jordan'],[carol,'Sky']] as const)await friend.call('joinGroup',{code:made.data.inviteCode,myName,noticeVersion:1});
}
for (const name of previewParams.has('empty') ? [] : ['Coffee Club','Puzzle Pals','Book Club']) {
  world.advance(1000);
  const made=await alice.call('createGroup',{name,myName:'River',noticeVersion:1});
  if(made.ok)await bob.call('joinGroup',{code:made.data.inviteCode,myName:'Jordan',noticeVersion:1});
}
if(!previewParams.has('empty'))await alice.call('setProfile',{displayName:'River',animalId:'penguin',backgroundColor:'#DED1F2'});
await bob.call('setProfile',{displayName:'Jordan',animalId:'otter',backgroundColor:'#CCE6CA'});
await carol.call('setProfile',{displayName:'Sky',animalId:'owl',backgroundColor:'#CCE1F1'});
world.advance(1000);
world.advance(new Date('2026-11-05T12:00:00.000Z').getTime()-world.now());
world.hub.seedRainbowPublication('fixture-day','2026-09-22','#102');
if(previewParams.has('newdaily'))world.hub.seedRainbowPublication('fresh-day','2026-11-06','#103');
world.hub.seedRainbowPublication('week-mon','2026-11-02','#103');
world.hub.seedRainbowPublication('week-wed','2026-11-04','#104');
for (const person of previewParams.has('completed') ? ['Jordan','River'] : ['Jordan']) {
  await world.hub.serverFor('rainbow').recordCompletion({gameId:'rainbow',puzzleId:'fixture-day',globalUserId:world.globalIdOf(person),completedAt:new Date(world.now()).toISOString(),summary:{solved:true,mistakes:0},detail:'🟨🟨🟨🟨\n🟩🟩🟩🟩'});
}
if (previewParams.has('weekly') && !previewParams.has('older') && !previewParams.has('newdaily')) {
  for (const [puzzleId, people] of [['week-mon',['River','Jordan']],['week-wed',['Jordan']]] as const) {
    for(const person of people) await world.hub.serverFor('rainbow').recordCompletion({gameId:'rainbow',puzzleId,globalUserId:world.globalIdOf(person),completedAt:new Date(world.now()).toISOString(),summary:{solved:true,mistakes:1},detail:'🟨🟨🟨🟨'});
  }
}
if(previewParams.has('standings')) {
  // Fictional larger group demonstrates medals, ties and View all standings.
  const extras=[carol,world.signIn('rainbow','Alex'),world.signIn('rainbow','Robin')];
  const groups=await alice.call('listMyGroups',{});
  if(groups.ok)for(const group of groups.data) {
    const invitation=await alice.call('getGroupInvitation',{groupId:group.groupId});
    if(invitation.ok&&invitation.data.inviteCode)for(const [index,friend] of extras.entries())await friend.call('joinGroup',{code:invitation.data.inviteCode,myName:['Sky','Alex','Robin'][index],noticeVersion:1});
  }
  await extras[1].call('setProfile',{displayName:'Alex',animalId:'panda',backgroundColor:'#F1CDDA'});
  await extras[2].call('setProfile',{displayName:'Robin',animalId:'fox',backgroundColor:'#F8E4A0'});
  for(const [person,seconds] of [['River',10],['Jordan',10],['Sky',20],['Alex',30],['Robin',40]] as const){
    world.signIn('crosspuns',person);
    world.hub.seedCrossPunsPublication('old-crosspuns','2026-11-01');
    await world.hub.serverFor('crosspuns').recordCompletion({gameId:'crosspuns',puzzleId:'old-crosspuns',globalUserId:world.globalIdOf(person),completedAt:new Date(world.now()).toISOString(),summary:{seconds},detail:null});
  }
  const friends=await alice.call('listFriends',{});
  if(friends.ok)await alice.call('block',{ref:friends.data.find(f=>f.name==='Jordan')!.friendRef});
}
if(previewParams.has('large')) {
  const groups=await alice.call('listMyGroups',{});
  const group=groups.ok?groups.data.find(group=>group.name==='Coffee Club'):null;
  if(group){const invite=await alice.call('getGroupInvitation',{groupId:group.groupId});
    if(invite.ok&&invite.data.inviteCode)for(let i=0;i<995;i++){
      const name=`Guest ${String(i+1).padStart(4,'0')}`;
      await world.signIn('rainbow',name).call('joinGroup',{code:invite.data.inviteCode,myName:name,noticeVersion:1});
    }
  }
}
const preferred = await alice.call('listFriends',{});
if(preferred.ok && preferred.data[0]) await alice.call('setFriendPreference',{friendRef:preferred.data[0].friendRef,favorite:true,nickname:null});
if(previewParams.has('long')&&preferred.ok) {
  // River's private nickname for Sky. Sky's public name stays "Sky".
  const sky=preferred.data.find(friend=>friend.name==='Sky');
  if(sky)await alice.call('setFriendPreference',{friendRef:sky.friendRef,favorite:sky.friendRef===preferred.data[0]?.friendRef,nickname:LONG_NICKNAME});
}
if(previewParams.has('newdaily'))world.advance(new Date('2026-11-06T12:00:00.000Z').getTime()-world.now());

// The page's reads. The header's own two (who am I, pending requests) always
// answer, so it shows the signed-in avatar even while the page is loading.
const HEADER_OPS=new Set<string>(['getMe','listFriendRequests']);
const previewClient: SocialApi['client'] = {
  forget: () => alice.forget(),
  async call(op, args) {
    if (previewParams.has('loading') && !HEADER_OPS.has(op)) return new Promise<never>(() => {});
    if (op === 'listResults' && previewParams.has('slow')) await new Promise(resolve => setTimeout(resolve, 8000));
    if ((op === 'listResults' || op === 'recentCompletions') && previewParams.has('failResults')) return { ok: false, outcome: 'unavailable' };
    return alice.call(op, args);
  },
};
// Like production by default: recent completions off, this week's puzzles on. recent=1 turns the new reader on.
const api: SocialApi = { recentActivity:previewParams.has('recent'), client:previewClient, puzzleId:()=>previewParams.has('newdaily')?'fresh-day':'fixture-day', today:()=>new Date(2026,10,previewParams.has('newdaily')?6:5), linkUrl:()=>'', share:async()=>'done' };
api.weekPuzzles=async()=>[{id:'week-mon',date:'2026-11-02'},{id:'week-wed',date:'2026-11-04'},{id:'fixture-day',date:'2026-11-05'}];

// Who is signed in, told to the real page and header the way the app's own
// session source tells them: a new scope per person, so nothing stale paints.
let account='River';
let generation=1;
const listeners=new Set<() => void>();
setFixtureSocial({
  api,
  source: {
    read: () => ({ state: { scope: `fixture:${account}`, credential: 'fixture' }, accountId: account, storedOwner: account, generation, checkRunning: false }),
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  },
  signIn: async () => 'Mock preview only',
});
function switchAccount() {
  account=account==='River'?'Jordan':'River';
  world.become(alice,account);
  generation++;
  for(const listener of listeners)listener();
}

const FIXTURES: [string, string][] = [
  ['Default (as production)', '?weekly=1'],
  ['New recent-completions reader', '?weekly=1&recent=1'],
  ['Old Daily #102', '?weekly=1&older=1'],
  ['After newer Daily', '?weekly=1&newdaily=1'],
  ['Empty', '?weekly=1&empty=1'],
  ['Long names', '?weekly=1&long=1'],
  ['Loading', '?weekly=1&loading=1'],
  ['Standings & blocked player', '?weekly=1&standings=1'],
  ['Slow results', '?weekly=1&slow=1'],
  ['Failed results', '?weekly=1&failResults=1'],
  ['Completed today', '?weekly=1&completed=1'],
  ['Large group (1,000)', '?weekly=1&large=1'],
];

/**
 * A slim strip along the bottom edge, outside the page: the mock notice on the
 * left and the Preview controls disclosure in the right-hand corner. The page
 * is padded by the strip's height, so collapsed it never covers any of the page.
 */
export function PreviewControls() {
  const [shownAccount,setShownAccount]=useState(account);
  const [dark,setDark]=useState(()=>document.documentElement.classList.contains('dark'));
  const details=useRef<HTMLDetailsElement>(null);
  useEffect(()=>{document.documentElement.classList.toggle('dark',dark);},[dark]);
  const close=()=>{ if(details.current?.open){details.current.open=false;details.current.querySelector('summary')?.focus();} };
  return <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] text-foreground" data-testid="preview-bar">
    <div className="mx-auto flex h-11 max-w-2xl items-center gap-2 pl-3 pr-1 text-xs">
      <p className="min-w-0 flex-1 truncate text-slate"><strong className="text-foreground">Mock preview</strong> · Fictional accounts · Resets on reload</p>
      <details ref={details} onKeyDown={e=>{if(e.key==='Escape')close();}} className="relative shrink-0" data-testid="preview-controls">
        <summary className="flex h-11 cursor-pointer list-none items-center gap-1.5 rounded-xl px-2.5 font-bold hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <SlidersHorizontal aria-hidden="true" className="h-4 w-4"/>Preview controls
        </summary>
        <div className="absolute bottom-full right-0 mb-1 max-h-[calc(100dvh-4rem)] w-[min(18rem,calc(100vw-1.5rem))] overflow-y-auto rounded-2xl border border-border bg-card p-3 text-sm shadow-xl">
          <p className="text-slate">Preview account: <strong className="text-foreground">{shownAccount}</strong></p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="min-h-11 rounded-xl border border-border px-3 font-bold hover:bg-secondary" onClick={()=>{switchAccount();setShownAccount(account);}}>Switch account</button>
            <button type="button" className="min-h-11 rounded-xl border border-border px-3 font-bold hover:bg-secondary aria-pressed:bg-secondary" aria-pressed={dark} onClick={()=>setDark(d=>!d)}>Dark theme</button>
          </div>
          <nav aria-label="Fixture states" className="mt-3 border-t border-border pt-2">
            <ul className="grid gap-0.5">
              {FIXTURES.map(([label,query])=><li key={label}><a className="flex min-h-9 items-center rounded-lg px-2 font-semibold underline-offset-2 hover:bg-secondary hover:underline" href={`${query}${dark?'&theme=dark':''}${previewParams.has('recent')&&!query.includes('recent')?'&recent=1':''}`}>{label}</a></li>)}
            </ul>
          </nav>
        </div>
      </details>
    </div>
  </div>;
}

/** Only /friends is real here. Anywhere else the header leads gets a plain note and a way back. */
export function Elsewhere() {
  const { pathname } = useLocation();
  return <div className="min-h-screen flex flex-col items-center pt-2 pb-12">
    <MinimalHeader />
    <main className="w-full max-w-2xl px-3">
      <div className="rounded-2xl border border-border bg-card p-6 text-center">
        <p className="text-base text-slate">This preview only holds the Friends page. In the app this opens <code className="font-bold text-foreground">{pathname}</code>.</p>
        <Link to="/friends" className="mt-4 inline-flex min-h-11 items-center rounded-xl border border-border px-4 font-bold hover:bg-secondary">Back to Friends</Link>
      </div>
    </main>
  </div>;
}

export function Preview() {
  return <HelmetProvider>
    <MemoryRouter initialEntries={['/friends']}>
      {/* The bottom padding is the preview strip's height, so the page's last card scrolls clear of it. */}
      <div className="bg-background pb-[calc(2.75rem+env(safe-area-inset-bottom))]">
        <Routes><Route path="/friends" element={<Friends />} /><Route path="*" element={<Elsewhere />} /></Routes>
      </div>
      <PreviewControls />
    </MemoryRouter>
  </HelmetProvider>;
}
if (['127.0.0.1','localhost'].includes(location.hostname)) createRoot(document.getElementById('root')!).render(<Preview />);
