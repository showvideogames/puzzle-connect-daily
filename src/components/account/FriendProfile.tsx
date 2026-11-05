import {useEffect,useRef,type ReactNode} from 'react';
import {canOpenResult,resultSummary,type FriendResult} from '@/lib/friendResults';
import {accountCard,accountPanel,quietText} from './accountStyles';
import {BackLink} from './BackLink';
import {ProfileAvatar} from './ProfileAvatar';
import {ResultDetail} from './ResultDetail';
import {TodayHeading} from './ResultRow';

interface Props {
 friend:FriendResult;
 viewer?:FriendResult;
 today:Date;
 resultsAvailable:boolean;
 actions:ReactNode;
 activity?:ReactNode;
 onBack:()=>void;
}
/** A friend's public face and the viewer's private preferences. No level/XP is implied. */
export function FriendProfile({friend,viewer,today,resultsAvailable,actions,activity,onBack}:Props){
 const heading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{heading.current?.focus();},[]);
 return <main className={`${accountPanel} mx-auto w-full max-w-[32rem] px-5 pb-5 pt-2 sm:px-8 sm:pb-8`} data-testid="friend-profile">
  <BackLink onClick={onBack}/>
  <div className="text-center">
   <ProfileAvatar animalId={friend.animalId} backgroundColor={friend.backgroundColor} size={112}/>
   <h1 ref={heading} tabIndex={-1} className="mt-3 break-words font-tile text-3xl font-extrabold outline-none">{friend.nickname||friend.name}</h1>
   {friend.nickname&&<p className={`${quietText} mt-1 break-words`}>Public name: {friend.name}</p>}
   {friend.favorite&&<p className="mx-auto mt-3 w-fit rounded-full bg-yellow-200 px-4 py-1 font-semibold text-yellow-950">★ Favorite</p>}
  </div>
  <TodayHeading today={today}/>
  {resultsAvailable?<>
   <section className={`${accountCard} mt-3`} aria-label="Friend's result today">
    <p className="text-lg font-bold">{resultSummary(friend)}</p>
    {canOpenResult(friend)&&<div className="mt-2"><ResultDetail result={friend}/></div>}
   </section>
   {viewer&&<section className={`${accountCard} mt-3`} aria-label="Your result today"><p className="font-semibold">Your result</p><p className={quietText}>{resultSummary(viewer)}</p></section>}
  </>:<p className={`${quietText} mt-3`}>Today's puzzle results aren't available right now.</p>}
  {activity}
  <div className="mt-5 [&_button]:min-h-11">{actions}</div>
 </main>;
}
