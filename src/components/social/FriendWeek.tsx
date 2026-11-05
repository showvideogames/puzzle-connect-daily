import {useEffect, useState} from 'react';
import {accountCard, quietText} from '@/components/account/accountStyles';
import {ResultDetail} from '@/components/account/ResultDetail';
import {resultSummary, type FriendResult} from '@/lib/friendResults';
import {readFriendWeek, type DayResult} from './friendWeekData';
import {localPuzzleDate, socialWeek} from '@/lib/socialWeek';
import type {SocialApi} from './socialApi';

export function FriendWeek({api, friend}: {api: SocialApi; friend: FriendResult}) {
  const [revision, setRevision] = useState(0);
  const [date, setDate] = useState(() => localPuzzleDate(api.today()));
  const [read, setRead] = useState<{key:string; days?:DayResult[]; failed?:boolean} | null>(null);
  const key = `${friend.id}/${date}/${revision}`;
  useEffect(() => {
    const refresh = () => {setDate(localPuzzleDate(api.today()));setRevision(value => value+1);};
    const timer = window.setInterval(() => setDate(localPuzzleDate(api.today())), 30_000);
    window.addEventListener('focus', refresh);
    return () => {clearInterval(timer);window.removeEventListener('focus', refresh);};
  }, [api]);
  useEffect(() => {
    let active = true;
    void readFriendWeek(api, friend, api.today()).then(
      days => {if(active) setRead({key, days});},
      () => {if(active) setRead({key, failed:true});},
    );
    return () => {active=false;};
    // Identity, day and explicit refresh determine this read, not today's result object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, key]);
  const current = read?.key === key ? read : null;
  return <section className="mt-6" aria-label="This week's activity">
    <h2 className="text-xl font-bold">This week</h2>
    <p className={quietText}>Full Daily · Monday–Sunday · your local time</p>
    {!current ? <p role="status">Loading weekly activity…</p> : current.failed ? <div role="status"><p>Weekly activity couldn't be loaded.</p><button className="min-h-11 underline" onClick={() => setRevision(value => value+1)}>Try again</button></div> :
      <ol className="mt-3 space-y-3">{socialWeek(api.today()).map(day => {
        const result = current.days?.find(row => row.date===day.date)?.result;
        return <li key={day.date} className={accountCard}>
          <h3 className="font-semibold"><time dateTime={day.date}>{day.day.toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric'})}</time></h3>
          {day.future ? <p className={quietText}>Upcoming</p> : !result ? <p className={quietText}>No published puzzle</p> : <>
            <p>{resultSummary(result)}</p>
            {result.status !== 'not-played' && (result.detail === null ? <p className={quietText}>Finish this same puzzle to see their details.</p> : <details className="mt-2"><summary className="min-h-11 cursor-pointer py-2">View details</summary><ResultDetail result={result}/></details>)}
          </>}
        </li>;
      })}</ol>}
  </section>;
}
