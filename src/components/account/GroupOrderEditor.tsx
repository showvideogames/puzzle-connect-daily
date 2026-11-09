import { useRef, useState } from 'react';
import type { GroupSummary } from './GroupsTab';
import { outlineAction, primaryAction, quietText, rowName, sectionTitle } from './accountStyles';
import { GroupEmblem } from './GroupEmblem';
interface Props {
  groups: readonly GroupSummary[];
  onCancel: () => void;
  onSave: (ids: string[]) => Promise<string | void>;
}
export function GroupOrderEditor({ groups, onCancel, onSave }: Props) {
  const [draft, setDraft] = useState(() => [...groups]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const saving = useRef(false);
  const move = (index: number, direction: number) => setDraft(rows => {
    const next = [...rows]; const other = index + direction;
    if (other < 0 || other >= next.length) return rows;
    [next[index], next[other]] = [next[other], next[index]]; return next;
  });
  return <section aria-label="Reorder groups">
    <h2 className={sectionTitle}>Your group order</h2>
    <p className={`${quietText} mt-1`}>Only your group list changes. Leaderboard ranks stay the same.</p>
    <ol className="mt-3 divide-y divide-border">
      {draft.map((group,index) => <li key={group.groupId} className="py-3">
        <div className="flex items-center gap-2.5">
          <GroupEmblem emblemId={group.emblemId} photo={group.photo} color={group.accentColor} size={44} className="!rounded-xl" />
          <p className={`${rowName} min-w-0 flex-1 break-words`}>{group.name}</p>
        </div>
        <div className="mt-2 flex gap-2">
          <button type="button" disabled={busy || index===0} aria-label={`Move ${group.name} up`} onClick={()=>move(index,-1)} className={`${outlineAction} min-h-11`}>↑ Up</button>
          <button type="button" disabled={busy || index===draft.length-1} aria-label={`Move ${group.name} down`} onClick={()=>move(index,1)} className={`${outlineAction} min-h-11`}>↓ Down</button>
        </div>
      </li>)}
    </ol>
    {problem && <p role="alert" className="my-2 text-destructive">{problem}</p>}
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" disabled={busy} className={`${primaryAction} min-h-11`} onClick={async()=>{
        if(saving.current) return;
        saving.current=true;setBusy(true);setProblem(null);
        try {const error=await onSave(draft.map(g=>g.groupId!));if(error)setProblem(error);else onCancel();}
        catch {setProblem("We couldn't save that order. Please try again.");}
        finally {saving.current=false;setBusy(false);}
      }}>{busy?'Saving…':'Save order'}</button>
      <button type="button" disabled={busy} onClick={onCancel} className={`${outlineAction} min-h-11`}>Cancel</button>
    </div>
  </section>;
}
