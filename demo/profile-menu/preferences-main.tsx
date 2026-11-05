import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createMockWorld } from '@/social/conformance';
import { SocialScreens } from '@/components/social/SocialScreens';
import type { FriendsTab } from '@/components/account/FriendsHome';
import type { SocialApi } from '@/components/social/socialApi';
import '@/index.css';
const world = createMockWorld();
const alice = world.signIn('rainbow','River');
const bob = world.signIn('rainbow','Jordan');
const carol = world.signIn('rainbow','Sky');
for (const friend of [bob,carol]) {
  const invite=await alice.call('createFriendInvite',{noticeVersion:1});
  if (invite.ok) await friend.call('acceptFriendInvite',{code:invite.data.code,noticeVersion:1});
}
for (const name of ['Coffee Club','Puzzle Pals','Book Club']) {
  world.advance(1000);
  const made=await alice.call('createGroup',{name,myName:'River',noticeVersion:1});
  if(made.ok)await bob.call('joinGroup',{code:made.data.inviteCode,myName:'Jordan',noticeVersion:1});
}
await bob.call('setProfile',{displayName:'Jordan',animalId:'otter',backgroundColor:'#CCE6CA'});
await carol.call('setProfile',{displayName:'Sky',animalId:'owl',backgroundColor:'#CCE1F1'});
world.advance(1000);
for (const person of new URLSearchParams(location.search).has('completed') ? ['Jordan','River'] : ['Jordan']) {
  await world.hub.serverFor('rainbow').recordCompletion({gameId:'rainbow',puzzleId:'fixture-day',globalUserId:world.globalIdOf(person),completedAt:new Date(world.now()).toISOString(),summary:{solved:true,mistakes:0},detail:'🟨🟨🟨🟨\n🟩🟩🟩🟩'});
}
if (new URLSearchParams(location.search).has('weekly')) {
  for (const [puzzleId, people] of [['week-mon',['River','Jordan']],['week-wed',['Jordan']]] as const) {
    for(const person of people) await world.hub.serverFor('rainbow').recordCompletion({gameId:'rainbow',puzzleId,globalUserId:world.globalIdOf(person),completedAt:new Date(world.now()).toISOString(),summary:{solved:true,mistakes:1},detail:'🟨🟨🟨🟨'});
  }
}
if(new URLSearchParams(location.search).has('standings')) {
  for(const [person,seconds] of [['River',10],['Jordan',10]] as const){
    world.signIn('crosspuns',person);
    await world.hub.serverFor('crosspuns').recordCompletion({gameId:'crosspuns',puzzleId:'old-crosspuns',globalUserId:world.globalIdOf(person),completedAt:new Date(world.now()).toISOString(),summary:{seconds},detail:null});
  }
  const friends=await alice.call('listFriends',{});
  if(friends.ok)await alice.call('block',{ref:friends.data.find(f=>f.name==='Jordan')!.friendRef});
}
const api: SocialApi = { client:alice, puzzleId:()=>'fixture-day', today:()=>new Date(2026,10,5), linkUrl:()=>'', share:async()=>'done' };
if (new URLSearchParams(location.search).has('weekly')) api.weekPuzzles=async()=>[{id:'week-mon',date:'2026-11-02'},{id:'week-wed',date:'2026-11-04'},{id:'fixture-day',date:'2026-11-05'}];
function Preview() {
  const [tab,setTab]=useState<FriendsTab>('friends');
  const [account,setAccount]=useState('River');
  return <div className="mx-auto max-w-xl p-4">
    <button className="mb-3 min-h-11 rounded border px-3" onClick={()=>{const next=account==='River'?'Jordan':'River';world.become(alice,next);setAccount(next);}}>Switch account</button>
    <p>Preview account: {account}</p>
    <SocialScreens key={account} api={api} signedIn code={null} tab={tab} onTab={setTab} onNote={()=>{}} onLeaveLink={()=>{}} onSignIn={()=>{}} onNameLater={()=>{}} guest={<p>Guest</p>} waiting={<p>Loading</p>} />
  </div>;
}
if (['127.0.0.1','localhost'].includes(location.hostname)) createRoot(document.getElementById('root')!).render(<Preview />);
