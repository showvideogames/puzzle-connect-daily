import {useEffect,useState} from 'react';
import type {Operations} from '@/social/contract';
import {accountCard,quietText} from '@/components/account/accountStyles';
import type {SocialApi} from './socialApi';

export function CrossPunsStandingsPanel({api,groupId}:{api:SocialApi;groupId:string}) {
 const [offset,setOffset]=useState(0),[revision,setRevision]=useState(0);
 const [read,setRead]=useState<{key:string;data?:Operations['crossPunsStandings']['data'];failed?:boolean}|null>(null);
 const key=`${groupId}/${offset}/${revision}`;
 useEffect(()=>{
  const refresh=()=>{setOffset(0);setRevision(r=>r+1);};
  window.addEventListener('focus',refresh);return()=>window.removeEventListener('focus',refresh);
 },[]);
 useEffect(()=>{
  let active=true;
  void api.client.call('crossPunsStandings',{groupId,offset}).then(answer=>{
   if(!active)return;
   if(answer.ok===false)setRead({key,failed:true});else setRead({key,data:answer.data});
  });return()=>{active=false;};
 },[api,groupId,offset,key]);
 const current=read?.key===key?read:null;
 return <section aria-label="CrossPuns standings" className={`${accountCard} mt-4`}>
  <h2 className="text-xl font-bold">CrossPuns · All time</h2>
  <p className={quietText}>3 points for first, 2 for second, 1 for third. Ties share places. Includes current members' earlier results.</p>
  {!current?<p role="status">Loading standings…</p>:current.failed?<p role="status">Standings couldn't be loaded.</p>:<>
   <ol className="mt-3 space-y-3">{current.data!.rows.map((row,index)=><li key={index} className="flex items-start gap-3" data-testid="standing-row">
    <span className="min-w-6 font-bold" aria-label={`Rank ${row.rank}`}>{row.rank}</span>
    {row.blocked===true?<span className={`${quietText} italic`}>This player is blocked</span>:<><span className="min-w-0 flex-1 break-words">{row.name}</span><span className="shrink-0">{row.points} pts</span></>}
   </li>)}</ol>
   {!current.data!.rows.length&&<p>No standings on this page.</p>}
   <div className="mt-3 flex flex-wrap gap-4">
    {offset>0&&<button className="min-h-11 underline" onClick={()=>setOffset(Math.max(0,offset-50))}>Previous</button>}
    {offset+50<current.data!.total&&<button className="min-h-11 underline" onClick={()=>setOffset(offset+50)}>Next</button>}
   </div>
  </>}
  <button className="mt-2 min-h-11 underline" disabled={!current} onClick={()=>{setOffset(0);setRevision(r=>r+1);}}>{current?.failed?'Try again':'Refresh standings'}</button>
 </section>;
}
