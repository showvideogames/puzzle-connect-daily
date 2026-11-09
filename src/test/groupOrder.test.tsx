import {fireEvent,render,screen,act,waitFor,within} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {GroupOrderEditor} from '@/components/account/GroupOrderEditor';
import {MyGroups} from '@/components/social/MyGroups';
import type {SocialApi} from '@/components/social/socialApi';
import type {GroupSummary} from '@/components/account/GroupsTab';
import {applyGroupOrder} from '@/lib/socialPreferences';
const groups:GroupSummary[]=['One','Two','Three'].map((name,i)=>({groupId:`g${i}`,name,emblemId:'campfire',photo:null,accentColor:'#DED1F2',memberCount:2}));
it('orders known groups and appends newly joined ones without mutating the source',()=>{
 expect(applyGroupOrder(groups,['g2','g0']).map(g=>g.groupId)).toEqual(['g2','g0','g1']);expect(groups[0].groupId).toBe('g0');
});
it('keeps changes local until save and cancellation sends nothing',()=>{
 const save=vi.fn(),cancel=vi.fn();render(<GroupOrderEditor groups={groups} onSave={save} onCancel={cancel}/>);
 fireEvent.click(screen.getByRole('button',{name:'Move Two up'}));
 expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Two');expect(save).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Cancel'}));expect(cancel).toHaveBeenCalledOnce();expect(save).not.toHaveBeenCalled();
});
it('saves exact ids once, retains a rejected draft and bounds the arrow controls',async()=>{
 let resolve!:(error:string)=>void;const save=vi.fn(()=>new Promise<string>(done=>{resolve=done;}));
 render(<GroupOrderEditor groups={groups} onSave={save} onCancel={vi.fn()}/>);
 expect(screen.getByRole('button',{name:'Move One up'})).toBeDisabled();expect(screen.getByRole('button',{name:'Move Three down'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Move Two up'}));fireEvent.click(screen.getByRole('button',{name:'Save order'}));
 expect(save).toHaveBeenCalledWith(['g1','g0','g2']);fireEvent.click(screen.getByRole('button',{name:'Saving…'}));expect(save).toHaveBeenCalledOnce();
 await act(async()=>resolve('Try again.'));expect(screen.getByRole('alert')).toHaveTextContent('Try again.');expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Two');
});

// jsdom has no PointerEvent; MouseEvent carries the clientY the drag reads.
if (!('PointerEvent' in window)) Object.defineProperty(window,'PointerEvent',{value:class extends MouseEvent{pointerId:number;constructor(type:string,init:PointerEventInit={}){super(type,init);this.pointerId=init.pointerId??1;}}});
// Rows stand 100px tall in list order, wherever a drag has moved them.
function rowBoxes(){
 return vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){
  const index=this.tagName==='LI'?[...this.parentElement!.children].indexOf(this):0;
  return {top:index*100,bottom:index*100+100,height:100,left:0,right:300,width:300,x:0,y:index*100,toJSON(){}} as DOMRect;
 });
}
const names=()=>screen.getAllByRole('listitem').map(row=>row.querySelector('p')!.textContent);
const handle=(name:string)=>within(screen.getAllByRole('listitem').find(row=>row.textContent!.includes(name))!).getByTestId('group-drag-handle');
const drag=(name:string,toY:number,finish:'up'|'cancel'|'none'='up')=>{
 const grip=handle(name);fireEvent.pointerDown(grip,{button:0,clientY:50,pointerId:1});fireEvent.pointerMove(grip,{clientY:toY,pointerId:1});
 if(finish==='up')fireEvent.pointerUp(grip,{clientY:toY,pointerId:1});if(finish==='cancel')fireEvent.pointerCancel(grip,{pointerId:1});
};
describe('dragging groups',()=>{
 afterEach(()=>vi.restoreAllMocks());
 it('moves a group past each row whose middle the pointer crosses, repeatedly, and saves that order',async()=>{
  rowBoxes();const save=vi.fn(async()=>undefined);render(<GroupOrderEditor groups={groups} onSave={save} onCancel={vi.fn()}/>);
  drag('One',260);expect(names()).toEqual(['Two','Three','One']);expect(screen.getByText('One, position 3 of 3.')).toBeInTheDocument();
  drag('Three',40);expect(names()).toEqual(['Three','Two','One']);
  drag('Two',140);expect(names()).toEqual(['Three','Two','One']);
  expect(save).not.toHaveBeenCalled();
  await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Save order'})));
  expect(save).toHaveBeenCalledWith(['g2','g1','g0']);
 });
 it('puts the order back when Escape or the browser cancels a drag, and keeps earlier moves',()=>{
  rowBoxes();render(<GroupOrderEditor groups={groups} onSave={vi.fn()} onCancel={vi.fn()}/>);
  drag('One',260);expect(names()).toEqual(['Two','Three','One']);
  drag('Three',-10,'none');expect(names()).toEqual(['Three','Two','One']);
  fireEvent.keyDown(window,{key:'Escape'});expect(names()).toEqual(['Two','Three','One']);
  expect(document.querySelector('[data-dragging]')).toBeNull();
  fireEvent.pointerMove(handle('Three'),{clientY:-10,pointerId:1});expect(names()).toEqual(['Two','Three','One']);
  drag('Two',260,'cancel');expect(names()).toEqual(['Two','Three','One']);
 });
 it('lifts only the dragged row and ignores drags while saving or from other buttons',async()=>{
  rowBoxes();let finish!:(error?:string)=>void;const save=vi.fn(()=>new Promise<string|void>(done=>{finish=done;}));
  render(<GroupOrderEditor groups={groups} onSave={save} onCancel={vi.fn()}/>);
  fireEvent.pointerDown(handle('Two'),{button:0,clientY:150,pointerId:1});
  expect(screen.getAllByRole('listitem').filter(row=>row.hasAttribute('data-dragging')).map(row=>row.textContent)).toEqual([expect.stringContaining('Two')]);
  fireEvent.pointerUp(handle('Two'),{clientY:150,pointerId:1});
  fireEvent.pointerDown(handle('One'),{button:2,clientY:50,pointerId:1});fireEvent.pointerMove(handle('One'),{clientY:260,pointerId:1});expect(names()).toEqual(['One','Two','Three']);
  drag('One',260);fireEvent.click(screen.getByRole('button',{name:'Save order'}));
  drag('Two',260);expect(names()).toEqual(['Two','Three','One']);
  await act(async()=>finish("We couldn't save that order. Please try again."));
  expect(screen.getByRole('alert')).toHaveTextContent("We couldn't save that order.");expect(names()).toEqual(['Two','Three','One']);
 });
 it('keeps keyboard focus on the row when Up or Down turns off at an end, and says where the group went',async()=>{
  render(<GroupOrderEditor groups={groups} onSave={vi.fn()} onCancel={vi.fn()}/>);
  const up=screen.getByRole('button',{name:'Move Two up'});up.focus();fireEvent.click(up);
  expect(names()).toEqual(['Two','One','Three']);expect(screen.getByText('Two, position 1 of 3.')).toBeInTheDocument();
  await waitFor(()=>expect(screen.getByRole('button',{name:'Move Two down'})).toHaveFocus());
  const down=screen.getByRole('button',{name:'Move One down'});down.focus();fireEvent.click(down);
  await waitFor(()=>expect(screen.getByRole('button',{name:'Move One up'})).toHaveFocus());
  expect(screen.getByText('One, position 3 of 3.')).toBeInTheDocument();
  expect(handle('One')).toHaveAttribute('aria-hidden','true');
 });
});
describe('saving through the group order service',()=>{
 afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
 it('sends the dragged order once, reloads, and reports a stale list',async()=>{
  vi.stubEnv('VITE_GROUP_ORDER','true');rowBoxes();
  const call=vi.fn().mockResolvedValueOnce({ok:true,data:{}}).mockResolvedValueOnce({ok:false,outcome:'not_found'});const onReload=vi.fn(async()=>undefined);
  const api={client:{call,forget:vi.fn()}} as unknown as SocialApi;
  render(<MyGroups api={api} groups={groups} displayName="Alex" onNote={vi.fn()} onReload={onReload} onOpen={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button',{name:'Reorder groups'}));drag('One',260);
  await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Save order'})));
  expect(call).toHaveBeenCalledWith('setGroupOrder',{groupIds:['g1','g2','g0']});expect(onReload).toHaveBeenCalledOnce();
  expect(screen.queryByRole('region',{name:'Reorder groups'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Reorder groups'}));drag('Three',40);
  await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Save order'})));
  expect(screen.getByRole('alert')).toHaveTextContent('Your groups have changed.');expect(onReload).toHaveBeenCalledTimes(2);
  expect(names()).toEqual(['Three','One','Two']);
 });
});
