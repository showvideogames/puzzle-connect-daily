import {useId,useRef,useState} from 'react';
import {LIMITS} from '@/social/contract';
import {outlineAction,primaryAction,quietText} from './accountStyles';
export function GroupDescriptionEditor({initial,onSave,onCancel}:{initial:string|null;onSave:(description:string|null)=>Promise<string|void>;onCancel:()=>void}) {
 const id=useId();const [draft,setDraft]=useState(initial??'');const [busy,setBusy]=useState(false);const [problem,setProblem]=useState<string|null>(null);const saving=useRef(false);
 return <form className="space-y-3" onSubmit={async event=>{
  event.preventDefault();if(saving.current)return;saving.current=true;setBusy(true);setProblem(null);
  try{const error=await onSave(draft.trim()||null);if(error)setProblem(error);else onCancel();}
  catch{setProblem("We couldn't save the description. Please try again.");}
  finally{saving.current=false;setBusy(false);}
 }}>
  <label htmlFor={id} className="block font-semibold">Group description</label>
  <textarea id={id} value={draft} maxLength={LIMITS.groupDescriptionMax} disabled={busy} onChange={e=>setDraft(e.target.value)} rows={5} className="w-full rounded-xl border border-border bg-background p-3 text-foreground" />
  <p className={`text-sm ${quietText}`}>Visible to group members. Leave blank to remove it. Up to {LIMITS.groupDescriptionMax} characters.</p>
  {problem&&<p role="alert" className="text-destructive">{problem}</p>}
  <div className="flex flex-wrap gap-2"><button type="submit" disabled={busy} className={`${primaryAction} min-h-11`}>{busy?'Saving…':'Save description'}</button><button type="button" disabled={busy} onClick={onCancel} className={`${outlineAction} min-h-11`}>Cancel</button></div>
 </form>;
}
