import {fireEvent,render,screen,act} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {GroupOrderEditor} from '@/components/account/GroupOrderEditor';
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
