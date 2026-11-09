import {ProfileAvatar} from '@/components/account/ProfileAvatar';
import {RankBadge} from '@/components/account/MedalBadge';
import {faceOf,isBackgroundCheck} from '@/lib/socialView';
import {localPuzzleDate} from '@/lib/socialWeek';
import {useEffect,useState,useRef} from 'react';
import {ChevronDown,ChevronLeft,ChevronRight} from 'lucide-react';
import type {Operations} from '@/social/contract';
import {accountCard,outlineAction,quietText,rowName,sectionTitle,seeAllAction} from '@/components/account/accountStyles';
import {cn} from '@/lib/utils';
import {RETRY_MS} from './socialData';
import type {SocialApi} from './socialApi';

// Centred on the heading's first line, so it stays there when a narrow screen wraps the heading.
const purpleLink=`${seeAllAction} -mt-[7px] text-base`;
const pageButton=cn(outlineAction,'h-11 gap-1 px-4 text-base');

/** viewerRef is the viewer's own membership from the group's roster. Only the presentation reads it, to mark their row. */
export function CrossPunsStandingsPanel({api,groupId,viewerRef}:{api:SocialApi;groupId:string;viewerRef?:string}) {
 const heading=useRef<HTMLHeadingElement>(null),pageChanged=useRef(false);
 const [showAll,setShowAll]=useState(false);
 const [days,setDays]=useState<0|7|30|365>(0);
 const [through,setThrough]=useState(()=>localPuzzleDate(api.today()));
 const [offset,setOffset]=useState(0),[revision,setRevision]=useState(0);
 const [read,setRead]=useState<{api:SocialApi;key:string;data?:Operations['crossPunsStandings']['data'];failed?:boolean}|null>(null);
 const key=`${groupId}/${offset}/${revision}/${days}/${through}`;
 useEffect(()=>{
  const refresh=()=>{setThrough(localPuzzleDate(api.today()));setOffset(0);setRevision(r=>r+1);};
  const timer=window.setInterval(()=>setThrough(localPuzzleDate(api.today())),30_000);
  window.addEventListener('focus',refresh);return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);};
 },[api]);
 useEffect(()=>{
  let active=true;let retry:ReturnType<typeof setTimeout>|undefined;
  const load=()=>{void api.client.call('crossPunsStandings',{groupId,offset,...(days?{days,through}:{})}).then(answer=>{
   if(!active)return;
   if(answer.ok===false&&isBackgroundCheck(answer.outcome)){retry=setTimeout(load,RETRY_MS);return;}
   if(answer.ok===false)setRead({api,key,failed:true});else setRead({api,key,data:answer.data});
  });};load();return()=>{active=false;clearTimeout(retry);};
 },[api,groupId,offset,key,days,through]);
 useEffect(()=>{setShowAll(false);setOffset(0);},[api,groupId]);
 const current=read?.api===api&&read.key===key?read:null;
 useEffect(()=>{if(current&&pageChanged.current){heading.current?.focus();pageChanged.current=false;}},[current]);
 const goToPage=(next:number)=>{pageChanged.current=true;setOffset(next);};
 return <section aria-label="CrossPuns standings" className={`${accountCard} mt-4`}>
  <div className="flex items-start justify-between gap-3">
   {/* The period stays in the heading for screen readers, since focus lands here on a page change. */}
   <h2 ref={heading} tabIndex={-1} className={`${sectionTitle} min-w-0 flex-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(258_90%_52%)]`}>CrossPuns standings<span className="sr-only"> · {days?`Last ${days} days`:'All time'}</span></h2>
   {current?.data&&current.data.total>3&&<button type="button" className={purpleLink} aria-expanded={showAll} onClick={()=>{setShowAll(value=>!value);setOffset(0);}}>{showAll?'Show less':<>See all<span className="sr-only"> standings</span><ChevronRight aria-hidden="true" className="h-5 w-5"/></>}</button>}
  </div>
  <div className="relative mt-3 inline-flex max-w-full">
   <select aria-label="Period" className="min-h-11 max-w-full cursor-pointer appearance-none rounded-full border border-border bg-background py-1 pl-4 pr-9 text-sm font-bold text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(258_90%_52%)]" value={days} onChange={event=>{setDays(Number(event.target.value) as 0|7|30|365);setOffset(0);}}>
    <option value={0}>All time</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={365}>Last 365 days</option>
   </select>
   <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate"/>
  </div>
  {!current?<p role="status" className={`mt-3 text-base ${quietText}`}>Loading standings…</p>:current.failed?<p role="status" className="mt-3 text-base text-foreground">Standings couldn't be loaded.</p>:<>
   <ol className="mt-2 divide-y divide-border/70">{(showAll?current.data!.rows:current.data!.rows.slice(0,3)).map((row,index)=>{
    // A blocked row carries no memberRef, so it can never be marked as the viewer's.
    const mine=row.blocked!==true&&viewerRef!==undefined&&row.memberRef===viewerRef;
    return <li key={index} className={`flex min-h-[4.5rem] items-center gap-2 px-1.5 py-2 sm:gap-3 sm:px-2 ${mine?'rounded-xl bg-amber-100/70 dark:bg-amber-400/15':''}`} data-testid="standing-row" data-mine={mine||undefined}>
     <RankBadge rank={row.rank}/>
     {row.blocked===true?<><span aria-hidden="true" className="h-14 w-14 shrink-0 rounded-full border-2 border-dashed border-border bg-secondary"/><span className={`${quietText} min-w-0 flex-1 text-base italic`}>This player is blocked</span></>:<><ProfileAvatar {...faceOf({animalId:row.animalId??'',backgroundColor:row.backgroundColor??''})} size={56} /><span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-center sm:gap-3"><span className={`${rowName} line-clamp-2 min-w-0 break-words sm:flex-1`}>{row.name}{mine&&<span className="sr-only"> (you)</span>}</span><span className={`shrink-0 text-sm font-semibold ${quietText}`}>{row.points} {row.points===1?"pt":"pts"}</span></span></>}
    </li>;})}</ol>
   {!current.data!.rows.length&&<p className={`mt-3 text-base ${quietText}`}>No standings on this page.</p>}
   {showAll&&<nav aria-label="Standings pages" className="mt-3 flex flex-wrap items-center gap-2">
    <p role="status" className={`w-full text-sm ${quietText}`}>Page {Math.floor(offset/25)+1} of {Math.max(1,Math.ceil(current.data!.total/25))} · {Math.min(offset+1,current.data!.total)}–{Math.min(offset+25,current.data!.total)} of {current.data!.total}</p>
    {offset>0&&<button type="button" className={pageButton} onClick={()=>goToPage(Math.max(0,offset-25))}><ChevronLeft aria-hidden="true" className="h-5 w-5"/>Previous</button>}
    {offset+25<current.data!.total&&<button type="button" className={`${pageButton} ml-auto`} onClick={()=>goToPage(offset+25)}>Next<ChevronRight aria-hidden="true" className="h-5 w-5"/></button>}
   </nav>}
  </>}
  {current?.failed&&<button type="button" className={`${outlineAction} mt-3 h-11 text-base`} onClick={()=>{setOffset(0);setRevision(r=>r+1);}}>Try again</button>}
 </section>;
}
