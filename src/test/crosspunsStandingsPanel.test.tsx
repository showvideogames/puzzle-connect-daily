import {act,fireEvent,render,screen,within} from '@testing-library/react';import {expect,it,vi} from 'vitest';
import {CrossPunsStandingsPanel} from '@/components/social/CrossPunsStandingsPanel';import type {SocialApi} from '@/components/social/socialApi';
const data={rows:[{blocked:true,rank:1,label:'This player is blocked'},{blocked:false,rank:2,memberRef:'me',name:'Viewer',points:2}],total:2};
const apiFor=(call:ReturnType<typeof vi.fn>)=>({client:{call},today:()=>new Date(2026,10,5)} as unknown as SocialApi);
it('renders canonical ranks without a blocked profile link, name or points',async()=>{
 const call=vi.fn().mockResolvedValue({ok:true,data});render(<CrossPunsStandingsPanel api={apiFor(call)} groupId="g"/>);
 await screen.findByText('This player is blocked');const row=screen.getAllByTestId('standing-row')[0];
 expect(row.textContent).toBe('1This player is blocked');expect(within(row).queryByRole('link')).toBeNull();expect(within(row).queryByRole('button')).toBeNull();
 expect(call).toHaveBeenCalledWith('crossPunsStandings',{groupId:'g',offset:0});
});
it('refusals are errors, retry does not invent empty results; paging is bounded',async()=>{
 const call=vi.fn().mockResolvedValueOnce({ok:false,outcome:'unavailable'}).mockResolvedValue({ok:true,data:{...data,total:51}});
 render(<CrossPunsStandingsPanel api={apiFor(call)} groupId="g"/>);await screen.findByText(/couldn't be loaded/);fireEvent.click(screen.getByRole('button',{name:'Try again'}));await screen.findByText('Viewer');
 fireEvent.click(screen.getByRole('button',{name:'Next'}));await screen.findByRole('button',{name:'Previous'});expect(call).toHaveBeenLastCalledWith('crossPunsStandings',{groupId:'g',offset:50});
});
it('discards an interrupted response after switching groups',async()=>{
 let resolve!:(value:unknown)=>void;const call=vi.fn().mockImplementationOnce(()=>new Promise(r=>{resolve=r;})).mockResolvedValue({ok:true,data:{rows:[],total:0}});const api=apiFor(call);
 const view=render(<CrossPunsStandingsPanel api={api} groupId="old"/>);view.rerender(<CrossPunsStandingsPanel api={api} groupId="new"/>);await screen.findByText('No standings on this page.');
 await act(async()=>resolve({ok:true,data}));expect(screen.queryByText('Viewer')).toBeNull();
});

it('switches rolling periods using the local date and resets paging',async()=>{
 const call=vi.fn().mockResolvedValue({ok:true,data:{...data,total:51}});render(<CrossPunsStandingsPanel api={apiFor(call)} groupId="g"/>);await screen.findByText('Viewer');
 fireEvent.click(screen.getByRole('button',{name:'Next'}));await screen.findByRole('button',{name:'Previous'});
 fireEvent.change(screen.getByLabelText('Period'),{target:{value:'7'}});await screen.findByText('Viewer');
 expect(call).toHaveBeenLastCalledWith('crossPunsStandings',{groupId:'g',offset:0,days:7,through:'2026-11-05'});
 expect(screen.queryByRole('button',{name:'Previous'})).toBeNull();
});

it('updates the rolling end date on focus after local midnight',async()=>{
 const call=vi.fn().mockResolvedValue({ok:true,data});const api=apiFor(call);render(<CrossPunsStandingsPanel api={api} groupId="g"/>);await screen.findByText('Viewer');
 fireEvent.change(screen.getByLabelText('Period'),{target:{value:'30'}});await screen.findByText('Viewer');
 api.today=()=>new Date(2026,10,6,0,1);fireEvent.focus(window);await screen.findByText('Viewer');
 expect(call).toHaveBeenLastCalledWith('crossPunsStandings',{groupId:'g',offset:0,days:30,through:'2026-11-06'});
});
