import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FriendPreferences } from '@/components/account/FriendPreferences';
import { applyFriendPreferences } from '@/lib/socialPreferences';
import type { FriendResult } from '@/lib/friendResults';
import { createMockWorld } from '@/social/conformance';
const friend: FriendResult = { id:'f1', name:'Jordan', isYou:false, animalId:'fox', backgroundColor:'#DED1F2', gameId:'rainbow', status:'not-played', mistakes:0, detail:null };
const click = (name: string) => fireEvent.click(screen.getByRole('button',{name}));
it('puts favorites first without changing public names, result details or favoriting self', () => {
  const you = {...friend,id:'you',isYou:true};
  const rows = applyFriendPreferences([you, friend, {...friend,id:'f2'}],[{friendRef:'you',favorite:true,nickname:'Not you'},{friendRef:'f2',favorite:true,nickname:'Pal'}]);
  expect(rows.map(r=>r.id)).toEqual(['f2','you','f1']);
  expect(rows[0]).toMatchObject({name:'Jordan',nickname:'Pal',detail:null});
  expect(rows[1]).toEqual(you);
});
it('cancel sends nothing and reopening resets the unsaved draft', () => {
  const save = vi.fn(); render(<FriendPreferences friend={friend} onSave={save} />);
  click('Favorite & nickname'); fireEvent.change(screen.getByLabelText('Private nickname'),{target:{value:'Unsaved'}}); click('Cancel');
  expect(save).not.toHaveBeenCalled(); click('Favorite & nickname'); expect(screen.getByLabelText('Private nickname')).toHaveValue('');
});
it('retains a refused draft, trims nicknames and prevents repeated saves in flight', async () => {
  let resolve!: (error: string) => void;
  const save = vi.fn(() => new Promise<string>(done => { resolve=done; }));
  render(<FriendPreferences friend={friend} onSave={save} />); click('Favorite & nickname');
  fireEvent.change(screen.getByLabelText('Private nickname'),{target:{value:' Pal '}}); fireEvent.click(screen.getByLabelText('Favorite')); click('Save preferences');
  fireEvent.submit(screen.getByLabelText('Private nickname').closest('form')!);
  expect(save).toHaveBeenCalledTimes(1); expect(save).toHaveBeenCalledWith({favorite:true,nickname:'Pal'});
  await act(async()=>resolve('Please try again.'));
  expect(screen.getByRole('alert')).toHaveTextContent('Please try again.'); expect(screen.getByLabelText('Private nickname')).toHaveValue(' Pal ');
});
describe('private preference memory transport', () => {
  it('isolates both sides, clears on removal, and refuses signed-out writes', async () => {
    const world = createMockWorld(); const alice=world.signIn('rainbow','alice'); const bob=world.signIn('rainbow','bob');
    const invite=await alice.call('createFriendInvite',{noticeVersion:1}); if (!invite.ok) throw Error('invite');
    const joined=await bob.call('acceptFriendInvite',{code:invite.data.code,noticeVersion:1}); if (!joined.ok) throw Error('join');
    const friendRef=joined.data.friendRef;
    expect(await alice.call('setFriendPreference',{friendRef,favorite:true,nickname:'Pal'})).toMatchObject({ok:true});
    expect(await bob.call('listFriendPreferences',{})).toMatchObject({data:[]});
    expect(JSON.stringify(await alice.call('listFriends',{}))).not.toContain('Pal');
    const release = world.hold('rainbow');
    const pending = alice.call('setFriendPreference',{friendRef,favorite:false,nickname:'Late'});
    world.become(alice,'eve'); release();
    expect(await pending).toMatchObject({ok:false,outcome:'stale_session'});
    expect(await alice.call('listFriendPreferences',{})).toMatchObject({data:[]});
    world.become(alice,'alice');
    await alice.call('removeFriend',{friendRef});
    expect(await alice.call('listFriendPreferences',{})).toMatchObject({data:[]});
    world.signOut(alice,{scope:'local'});
    expect(await alice.call('setFriendPreference',{friendRef,favorite:true,nickname:null})).toMatchObject({ok:false,outcome:'not_signed_in'});
  });
});
