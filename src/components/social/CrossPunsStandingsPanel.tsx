import {ProfileAvatar} from '@/components/account/ProfileAvatar';
import {faceOf} from '@/lib/socialView';
import {localPuzzleDate} from '@/lib/socialWeek';
import {useEffect,useState} from 'react';
import type {Operations} from '@/social/contract';
import {accountCard,quietText} from '@/components/account/accountStyles';
import type {SocialApi} from './socialApi';

export function CrossPunsStandingsPanel({api,groupId}:{api:SocialApi;groupId:string}) {
 const [showAll,setShowAll]=useState(false);
 const [days,setDays]=useState<0|7|30|365>(0);
 const [through,setThrough]=useState(()=>localPuzzleDate(api.today()));
 const [offset,setOffset]=useState(0),[revision,setRevision]=useState(0);
 const [read,setRead]=useState<{key:string;data?:Operations['crossPunsStandings']['data'];failed?:boolean}|null>(null);
 const key=`${groupId}/${offset}/${revision}/${days}/${through}`;
 useEffect(()=>{
  const refresh=()=>{setThrough(localPuzzleDate(api.today()));setOffset(0);setRevision(r=>r+1);};
  const timer=window.setInterval(()=>setThrough(localPuzzleDate(api.today())),30_000);
  window.addEventListener('focus',refresh);return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);};
 },[api]);
 useEffect(()=>{
  let active=true;
  void api.client.call('crossPunsStandings',{groupId,offset,...(days?{days,through}:{})}).then(answer=>{
   if(!active)return;
   if(answer.ok===false)setRead({key,failed:true});else setRead({key,data:answer.data});
  });return()=>{active=false;};
 },[api,groupId,offset,key,days,through]);
 useEffect(()=>{setShowAll(false);setOffset(0);},[groupId]);
 const current=read?.key===key?read:null;
 return <section aria-label="CrossPuns standings" className={`${accountCard} mt-4`}>
  <h2 className="text-xl font-bold">CrossPuns · {days?`Last ${days} days`:'All time'}</h2>
  <label className="mt-3 block">Period<select aria-label="Period" className="ml-2 min-h-11 max-w-full rounded border bg-background px-2" value={days} onChange={event=>{setDays(Number(event.target.value) as 0|7|30|365);setOffset(0);}}>
   <option value={0}>All time</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={365}>Last 365 days</option>
  </select></label>
  {!current?<p role="status">Loading standings…</p>:current.failed?<p role="status">Standings couldn't be loaded.</p>:<>
   <ol className="mt-3 space-y-3">{(showAll?current.data!.rows:current.data!.rows.slice(0,3)).map((row,index)=><li key={index} className="flex items-center gap-3" data-testid="standing-row">
    <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-bold ${row.rank===1?'bg-amber-300 text-amber-950 ring-2 ring-amber-500/50':row.rank===2?'bg-slate-300 text-slate-950 ring-2 ring-slate-500/50':row.rank===3?'bg-orange-300 text-orange-950 ring-2 ring-orange-600/50':''}`} aria-label={`Rank ${row.rank}`}>{row.rank}</span>
    {row.blocked===true?<span className={`${quietText} italic`}>This player is blocked</span>:<><ProfileAvatar {...faceOf({animalId:row.animalId??'',backgroundColor:row.backgroundColor??''})} size={40} /><span className="min-w-0 flex-1 break-words">{row.name}</span><span className="shrink-0">{row.points} pts</span></>}
   </li>)}</ol>
   {!current.data!.rows.length&&<p>No standings on this page.</p>}
   {current.data!.total>3&&<button className="mt-3 min-h-11 underline" aria-expanded={showAll} onClick={()=>{setShowAll(value=>!value);setOffset(0);}}>{showAll?'Show less':`See all (${current.data!.total})`}</button>}
   {showAll&&<div className="mt-3 flex flex-wrap gap-4">
    {offset>0&&<button className="min-h-11 underline" onClick={()=>setOffset(Math.max(0,offset-50))}>Previous</button>}
    {offset+50<current.data!.total&&<button className="min-h-11 underline" onClick={()=>setOffset(offset+50)}>Next</button>}
   </div>}
  </>}
  {current?.failed&&<button className="mt-2 min-h-11 underline" onClick={()=>{setOffset(0);setRevision(r=>r+1);}}>Try again</button>}
 </section>;
}
