import {afterEach,expect,it,vi} from 'vitest';
import {readPerson} from '@/components/social/socialData';
import type {SocialApi} from '@/components/social/socialApi';
const answers:Record<string,unknown>={getMe:{displayName:'Viewer',friendCode:'AAA-222'},listFriendRequests:{incoming:[],outgoing:[]},listFriends:[],listMyGroups:[],listFriendPreferences:[],listGroupOrder:{groupIds:[]},listResults:[]};
const apiFor=(call:ReturnType<typeof vi.fn>)=>({client:{call},puzzleId:()=>Promise.resolve('puzzle')} as unknown as SocialApi);
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
it('starts independent reads together and exposes groups before slow results, without inventing not-played states',async()=>{
 vi.stubEnv('VITE_SOCIAL_PREFERENCES','true');vi.stubEnv('VITE_GROUP_ORDER','true');
 let finish!:(value:unknown)=>void;
 const call=vi.fn((op:string)=>op==='listResults'?new Promise(r=>{finish=r;}):Promise.resolve({ok:true,data:answers[op]}));
 const ready=vi.fn();const pending=readPerson(apiFor(call),ready);
 await vi.waitFor(()=>expect(ready).toHaveBeenCalledTimes(1));
 expect(call.mock.calls.map(([op])=>op).sort()).toEqual(Object.keys(answers).sort());
 expect(ready.mock.calls[0][0]).toMatchObject({results:[],resultsPending:true,noResults:false,groups:[]});
 finish({ok:true,data:[]});expect(await pending).toMatchObject({resultsPending:false,noResults:false});
});
it('overlaps seven 200ms reads instead of paying seven serial delays',async()=>{
 vi.useFakeTimers();vi.stubEnv('VITE_SOCIAL_PREFERENCES','true');vi.stubEnv('VITE_GROUP_ORDER','true');
 const call=vi.fn((op:string)=>new Promise(r=>setTimeout(()=>r({ok:true,data:answers[op]}),200)));
 let completed=false;const start=Date.now();const pending=readPerson(apiFor(call)).then(()=>{completed=true;});
 await vi.advanceTimersByTimeAsync(199);expect(completed).toBe(false);
 await vi.advanceTimersByTimeAsync(1);await pending;expect(Date.now()-start).toBe(200);expect(call).toHaveBeenCalledTimes(7);
});
it.each(['not_signed_in','stale_session','unavailable'])('does not publish partial identity when a core read refuses %s',async(outcome)=>{
 const call=vi.fn(async(op:string)=>op==='getMe'?{ok:false,outcome}:{ok:true,data:answers[op]});const ready=vi.fn();
 expect(await readPerson(apiFor(call),ready)).toEqual({outcome});expect(ready).not.toHaveBeenCalled();
});
it('returns genuine result failures instead of empty results after the group shell appears',async()=>{
 const call=vi.fn(async(op:string)=>op==='listResults'?{ok:false,outcome:'unavailable'}:{ok:true,data:answers[op]});const ready=vi.fn();
 expect(await readPerson(apiFor(call),ready)).toEqual({outcome:'unavailable'});expect(ready).toHaveBeenCalledWith(expect.objectContaining({resultsPending:true,results:[]}));
});
