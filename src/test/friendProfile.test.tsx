import {fireEvent,render,screen,within} from '@testing-library/react';import {expect,it,vi} from 'vitest';
import {FriendProfile} from '@/components/account/FriendProfile';import {FriendsHome} from '@/components/account/FriendsHome';import type {FriendResult} from '@/lib/friendResults';
const friend:FriendResult={id:'f1',name:'Jordan',nickname:'Pal',favorite:true,isYou:false,animalId:'otter',backgroundColor:'#CCE6CA',gameId:'rainbow',status:'solved',mistakes:0,detail:null};
it('shows a real avatar, private nickname and locked details without invented levels',()=>{
 render(<FriendProfile friend={friend} today={new Date(2026,10,5)} resultsAvailable actions={<button>Preferences</button>} onBack={vi.fn()}/>);
 expect(screen.getByRole('heading',{name:'Pal'})).toBeInTheDocument();expect(screen.getByText('Public name: Jordan')).toBeInTheDocument();expect(screen.getByTestId('result-locked')).toBeInTheDocument();
 expect(screen.queryByTestId('result-detail')).toBeNull();expect(screen.queryByText(/Level|XP/)).toBeNull();
});
it('does not guess results when the puzzle lookup was unavailable',()=>{
 render(<FriendProfile friend={friend} today={new Date()} resultsAvailable={false} actions={null} onBack={vi.fn()}/>);
 expect(screen.getByText(/results aren't available/)).toBeInTheDocument();expect(screen.queryByText(/Solved/)).toBeNull();
});
it('excludes self from the favorites strip and opens the selected profile',()=>{
 const open=vi.fn();render(<FriendsHome gameName="Rainbow" results={[{...friend,id:'you',name:'You',nickname:null,isYou:true},friend]} friendCode="ABC" tab="friends" onTabChange={vi.fn()} onAddFriend={vi.fn()} groups={null} onFriendProfile={open}/>);
 const strip=screen.getByRole('region',{name:'Favorite friends'});expect(within(strip).queryByText('You')).toBeNull();
 fireEvent.click(within(strip).getByRole('button',{name:"Open Pal's profile"}));expect(open).toHaveBeenCalledWith(friend);
 const row=screen.getAllByTestId('result-row').find(row=>row.getAttribute('data-person')==='f1')!;
 const button=within(row).getByRole('button');expect(button).not.toHaveAttribute('aria-expanded');fireEvent.click(button);expect(open).toHaveBeenCalledTimes(2);
});
