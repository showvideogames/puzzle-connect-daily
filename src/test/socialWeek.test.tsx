import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {describe,expect,it,vi} from 'vitest';
import {socialWeek,localPuzzleDate} from '@/lib/socialWeek';
import {FriendWeek} from '@/components/social/FriendWeek';
import {readFriendWeek} from '@/components/social/friendWeekData';
import type {SocialApi} from '@/components/social/socialApi';
import type {FriendResult} from '@/lib/friendResults';
const friend:FriendResult={id:'friend',name:'Jordan',isYou:false,animalId:'otter',backgroundColor:'#CCE6CA',gameId:'rainbow',status:'solved',mistakes:0,detail:null};
function fixture(){
 const call=vi.fn().mockImplementation(async(_op,args)=>({ok:true,data:[{friendRef:'friend',isMe:false,summary:{solved:true,mistakes:1},detailLocked:args.puzzleId!=='mon',detail:'🟨🟨🟨🟨'}]}));
 const weekPuzzles=vi.fn().mockResolvedValue([{id:'mon',date:'2026-11-02'},{id:'wed',date:'2026-11-04'},{id:'future',date:'2026-11-06'}]);
 const api={client:{call},today:()=>new Date(2026,10,5,23,59),weekPuzzles} as unknown as SocialApi;
 return {api,call,weekPuzzles};
}
describe('local Monday–Sunday calendar',()=>{
 it('keeps Sunday in the same week and moves at local Monday midnight',()=>{
  expect(socialWeek(new Date(2026,10,8,23,59)).map(x=>x.date)).toEqual(['2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06','2026-11-07','2026-11-08']);
  expect(socialWeek(new Date(2026,10,9))[0].date).toBe('2026-11-09');
 });
 it('uses calendar days across year boundaries and DST transitions',()=>{
  expect(socialWeek(new Date(2027,0,1))[0].date).toBe('2026-12-28');
  expect(socialWeek(new Date(2026,2,8)).map(x=>x.date)).toEqual(['2026-03-02','2026-03-03','2026-03-04','2026-03-05','2026-03-06','2026-03-07','2026-03-08']);
  expect(localPuzzleDate(new Date(2026,10,5,0,1))).toBe('2026-11-05');
 });
});
it('requests exact past puzzle ids; never falls back or uses future puzzles, and strips locked detail',async()=>{
 const {api,call,weekPuzzles}=fixture();const days=await readFriendWeek(api,friend,api.today());
 expect(weekPuzzles).toHaveBeenCalledWith('2026-11-02','2026-11-05');
 expect(call.mock.calls.map(x=>x[1].puzzleId)).toEqual(['mon','wed']);
 expect(days[0].result?.detail).toBe('🟨🟨🟨🟨');expect(days[1].result).toBeNull();expect(days[2].result?.detail).toBeNull();
});
it('does not mislabel a refused result read as unplayed',async()=>{
 const {api,call}=fixture();call.mockResolvedValue({ok:false,outcome:'unavailable'});
 await expect(readFriendWeek(api,friend,api.today())).rejects.toThrow();
});
it('renders individual locks and missing/future days; retries failures',async()=>{
 const {api,weekPuzzles}=fixture();weekPuzzles.mockRejectedValueOnce(new Error('offline'));
 render(<FriendWeek api={api} friend={friend}/>);await screen.findByText(/couldn't be loaded/);
 fireEvent.click(screen.getByRole('button',{name:'Try again'}));await screen.findByText('Finish this same puzzle to see their details.');
 expect(screen.getAllByText('No published puzzle')).toHaveLength(2);expect(screen.getAllByText('Upcoming')).toHaveLength(3);expect(screen.getAllByText('View details')).toHaveLength(1);
});
it('discards a late response after friend identity changes',async()=>{
 const {api,weekPuzzles}=fixture();let resolve!:(value:{id:string;date:string}[])=>void;
 weekPuzzles.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
 const view=render(<FriendWeek api={api} friend={friend}/>);
 view.rerender(<FriendWeek api={api} friend={{...friend,id:'other'}}/>);
 await screen.findAllByText('Not played yet');await act(async()=>resolve([{id:'mon',date:'2026-11-02'}]));
 expect(screen.queryByText(/Solved/)).toBeNull();
});
it('refreshes dates on focus across Monday rollover',async()=>{
 const {api,weekPuzzles}=fixture();render(<FriendWeek api={api} friend={friend}/>);await screen.findByText('View details');
 api.today=()=>new Date(2026,10,9,0,1);fireEvent.focus(window);
 await waitFor(()=>expect(weekPuzzles).toHaveBeenLastCalledWith('2026-11-09','2026-11-09'));
 expect(screen.queryByText('View details')).toBeNull();
});
