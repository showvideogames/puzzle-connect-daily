import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {describe,expect,it,vi} from 'vitest';
import {socialWeek,localPuzzleDate,rollingSocialDays} from '@/lib/socialWeek';
import {FriendWeek} from '@/components/social/FriendWeek';
import {readFriendWeek,recentBounds} from '@/components/social/friendWeekData';
import type {SocialApi} from '@/components/social/socialApi';
import type {FriendResult} from '@/lib/friendResults';
const friend:FriendResult={id:'friend',name:'Jordan',isYou:false,animalId:'otter',backgroundColor:'#CCE6CA',gameId:'rainbow',status:'solved',mistakes:0,detail:null};
function fixture(){
 const rows=[{puzzleId:'mon',puzzleDate:'2026-09-22',puzzleTitle:'#102',completedAt:new Date(2026,10,2,12).toISOString(),result:{friendRef:'friend',isMe:false,summary:{solved:true,mistakes:1},detailLocked:false,detail:'🟨🟨🟨🟨'}},{puzzleId:'wed',puzzleDate:'2026-10-01',puzzleTitle:'#103',completedAt:new Date(2026,10,4,12).toISOString(),result:{friendRef:'friend',isMe:false,summary:{solved:true,mistakes:1},detailLocked:true,detail:'SECRET'}}];
 const call=vi.fn().mockResolvedValue({ok:true,data:{rows,hasMore:false}});
 const api={client:{call},today:()=>new Date(2026,10,5,23,59),recentActivity:true} as unknown as SocialApi;
 return {api,call,rows};
}
describe('rolling local calendar',()=>{
 it('includes today and advances one day at local midnight',()=>{
  expect(socialWeek(new Date(2026,10,8,23,59)).map(x=>x.date)).toEqual(['2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06','2026-11-07','2026-11-08']);
  expect(socialWeek(new Date(2026,10,9))[0].date).toBe('2026-11-03');
 });
 it('uses calendar days across year boundaries and DST transitions',()=>{
  expect(socialWeek(new Date(2027,0,1))[0].date).toBe('2026-12-26');
  expect(socialWeek(new Date(2026,2,8)).map(x=>x.date)).toEqual(['2026-03-02','2026-03-03','2026-03-04','2026-03-05','2026-03-06','2026-03-07','2026-03-08']);
  expect(localPuzzleDate(new Date(2026,10,5,0,1))).toBe('2026-11-05');
 });
});
it('requests completion dates, not publication dates, and strips locked detail',async()=>{
 const {api,call}=fixture();const days=await readFriendWeek(api,friend,api.today());
 expect(call).toHaveBeenCalledWith('recentCompletions',{...recentBounds(api.today()),friendRef:'friend'});
 expect(days).toHaveLength(2);expect(days[0]).toMatchObject({date:'2026-11-02',puzzleDate:'2026-09-22'});
 expect(days[0].result.detail).toBe('🟨🟨🟨🟨');expect(days[1].result.detail).toBeNull();
});
it('does not mislabel a refused result read as unplayed',async()=>{
 const {api,call}=fixture();call.mockResolvedValue({ok:false,outcome:'unavailable'});
 await expect(readFriendWeek(api,friend,api.today())).rejects.toThrow();
});
it('renders individual locks and missing days; retries failures',async()=>{
 const {api,call}=fixture();call.mockRejectedValueOnce(new Error('offline'));
 render(<FriendWeek api={api} friend={friend}/>);await screen.findByText(/couldn't be loaded/);
 fireEvent.click(screen.getByRole('button',{name:'Try again'}));await screen.findByText('Finish this same puzzle to see their details.');
 expect(screen.queryByText('No published puzzle')).toBeNull();expect(screen.queryByText('Upcoming')).toBeNull();expect(screen.getAllByText('View details')).toHaveLength(1);
});
it('discards a late response after friend identity changes',async()=>{
 const {api,call,rows}=fixture();let resolve!:(value:unknown)=>void;
 call.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
 const view=render(<FriendWeek api={api} friend={friend}/>);
 view.rerender(<FriendWeek api={api} friend={{...friend,id:'other'}}/>);
 await screen.findByText('No recent activity');await act(async()=>resolve({ok:true,data:{rows,hasMore:false}}));
 expect(screen.queryByText(/Solved/)).toBeNull();
});
it('refreshes dates on focus across a daily rollover',async()=>{
 const {api,call}=fixture();render(<FriendWeek api={api} friend={friend}/>);await screen.findByText('View details');
 api.today=()=>new Date(2026,10,9,0,1);fireEvent.focus(window);
 await waitFor(()=>expect(call).toHaveBeenLastCalledWith('recentCompletions',{...recentBounds(api.today()),friendRef:'friend'}));
 expect(screen.queryByText('View details')).toBeNull();
});

it('uses fixed 30 and 365 day windows rather than calendar months or years',()=>{
 const today=new Date(2024,2,1);
 const month=rollingSocialDays(today,30),year=rollingSocialDays(today,365);
 expect(month).toHaveLength(30);expect(month[0].date).toBe('2024-02-01');expect(month[29].date).toBe('2024-03-01');
 expect(year).toHaveLength(365);expect(year[0].date).toBe('2023-03-03');expect(year[364].date).toBe('2024-03-01');
 expect(new Set(year.map(day=>day.date)).size).toBe(365);
});

it('uses half-open local midnight boundaries, preserving calendar-day arithmetic',()=>{
 const now=new Date(2026,10,5,23,59);const bounds=recentBounds(now);
 expect(new Date(bounds.from)).toEqual(new Date(2026,9,30));
 expect(new Date(bounds.until)).toEqual(new Date(2026,10,6));
});
