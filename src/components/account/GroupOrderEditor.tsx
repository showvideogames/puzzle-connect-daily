import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { GripVertical } from 'lucide-react';
import type { GroupSummary } from './GroupsTab';
import { outlineAction, primaryAction, quietText, rowName, sectionTitle } from './accountStyles';
import { GroupEmblem } from './GroupEmblem';
interface Props {
  groups: readonly GroupSummary[];
  onCancel: () => void;
  onSave: (ids: string[]) => Promise<string | void>;
}
const moveTo = (rows: GroupSummary[], from: number, to: number) => {
  const next = [...rows]; const [row] = next.splice(from, 1); next.splice(to, 0, row); return next;
};
export function GroupOrderEditor({ groups, onCancel, onSave }: Props) {
  const [draft, setDraft] = useState(() => [...groups]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const saving = useRef(false);
  // The group being dragged by its handle, and the order to go back to if the drag is cancelled.
  const [dragging, setDragging] = useState<string | null>(null);
  const beforeDrag = useRef<GroupSummary[] | null>(null);
  const rows = useRef(new Map<string, HTMLLIElement>());
  const say = (order: GroupSummary[], index: number) => setSaid(`${order[index].name}, position ${index + 1} of ${order.length}.`);
  const move = (index: number, direction: number, button: HTMLButtonElement) => {
    const other = index + direction;
    if (other < 0 || other >= draft.length) return;
    const next = moveTo(draft, index, other);
    setDraft(next); say(next, other);
    // At the top or bottom this button turns off; keep focus on the row's other one.
    requestAnimationFrame(() => { if (button.disabled) button.parentElement?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(); });
  };
  const cancelDrag = useCallback(() => {
    if (beforeDrag.current) setDraft(beforeDrag.current);
    beforeDrag.current = null; setDragging(null);
  }, []);
  useEffect(() => {
    if (!dragging) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') cancelDrag(); };
    addEventListener('keydown', escape);
    return () => removeEventListener('keydown', escape);
  }, [dragging, cancelDrag]);
  const startDrag = (event: PointerEvent<HTMLElement>, id: string) => {
    if (busy || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    beforeDrag.current = draft; setDragging(id);
  };
  // Moves the dragged group past every row whose middle the pointer has crossed.
  const dragOver = (event: PointerEvent<HTMLElement>, id: string) => {
    if (dragging !== id) return;
    const from = draft.findIndex(group => group.groupId === id);
    let to = from;
    draft.forEach((group, index) => {
      const box = rows.current.get(group.groupId!)?.getBoundingClientRect();
      if (!box) return;
      const middle = box.top + box.height / 2;
      if (index < from && event.clientY < middle) to = Math.min(to, index);
      if (index > from && event.clientY > middle) to = Math.max(to, index);
    });
    if (to !== from) setDraft(moveTo(draft, from, to));
  };
  const endDrag = (id: string) => {
    if (dragging !== id) return;
    const index = draft.findIndex(group => group.groupId === id);
    if (beforeDrag.current?.[index]?.groupId !== id) say(draft, index);
    beforeDrag.current = null; setDragging(null);
  };
  return <section aria-label="Reorder groups">
    <h2 className={sectionTitle}>Your group order</h2>
    <p className={`${quietText} mt-1`}>Drag a group by its handle, or use Up and Down. Only your group list changes. Leaderboard ranks stay the same.</p>
    <ol className="mt-3 divide-y divide-border">
      {draft.map((group,index) => <li key={group.groupId} ref={row => { if (row) rows.current.set(group.groupId!, row); else rows.current.delete(group.groupId!); }}
        data-dragging={dragging === group.groupId || undefined}
        className="py-3 transition-shadow data-[dragging]:relative data-[dragging]:z-10 data-[dragging]:-mx-2 data-[dragging]:px-2 data-[dragging]:rounded-xl data-[dragging]:bg-card data-[dragging]:shadow-lg data-[dragging]:ring-2 data-[dragging]:ring-[hsl(258_90%_52%)]">
        <div className="flex items-center gap-2.5">
          <GroupEmblem emblemId={group.emblemId} photo={group.photo} color={group.accentColor} size={44} className="!rounded-xl" />
          <p className={`${rowName} min-w-0 flex-1 break-words`}>{group.name}</p>
          {/* Pointer only, for mouse and touch: Up and Down are the keyboard and screen reader way. */}
          <span aria-hidden="true" title="Drag to reorder" data-testid="group-drag-handle"
            onPointerDown={event => startDrag(event, group.groupId!)} onPointerMove={event => dragOver(event, group.groupId!)}
            onPointerUp={() => endDrag(group.groupId!)} onPointerCancel={cancelDrag}
            className={`flex h-11 w-11 shrink-0 touch-none select-none items-center justify-center rounded-xl text-muted-foreground ${busy ? 'opacity-40' : 'cursor-grab hover:bg-secondary active:cursor-grabbing'}`}>
            <GripVertical className="h-6 w-6" />
          </span>
        </div>
        <div className="mt-2 flex gap-2">
          <button type="button" disabled={busy || index===0} aria-label={`Move ${group.name} up`} onClick={event=>move(index,-1,event.currentTarget)} className={`${outlineAction} min-h-11`}>↑ Up</button>
          <button type="button" disabled={busy || index===draft.length-1} aria-label={`Move ${group.name} down`} onClick={event=>move(index,1,event.currentTarget)} className={`${outlineAction} min-h-11`}>↓ Down</button>
        </div>
      </li>)}
    </ol>
    <p aria-live="polite" className="sr-only">{said}</p>
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
