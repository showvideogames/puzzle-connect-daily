import { useId, useRef, useState } from 'react';
import type { FriendResult } from '@/lib/friendResults';
import { DISPLAY_NAME_MAX } from '@/lib/sharedProfile';
import { outlineAction, primaryAction, quietText } from './accountStyles';

interface Props {
  friend: FriendResult;
  onSave: (preference: { favorite: boolean; nickname: string | null }) => Promise<string | void>;
}
export function FriendPreferences({ friend, onSave }: Props) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [favorite, setFavorite] = useState(false);
  const [nickname, setNickname] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  return <div className="w-full">
    {!editing ? <button type="button" className={`${outlineAction} min-h-11`} onClick={() => {
      setFavorite(friend.favorite ?? false); setNickname(friend.nickname ?? ''); setProblem(null); setEditing(true);
    }}>Favorite & nickname</button> : <form className="space-y-3" onSubmit={async event => {
      event.preventDefault();
      if (saving.current) return;
      saving.current = true; setBusy(true); setProblem(null);
      try {
        const error = await onSave({ favorite, nickname: nickname.trim() || null });
        if (error) setProblem(error); else setEditing(false);
      } catch { setProblem("We couldn't save that. Please try again."); }
      finally { saving.current = false; setBusy(false); }
    }}>
      <p className={`text-sm ${quietText}`}>Only you can see these preferences. Their public profile stays the same.</p>
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={favorite} disabled={busy} onChange={e => setFavorite(e.target.checked)} />Favorite</label>
      <div><label htmlFor={id} className="block font-semibold">Private nickname</label>
        <input id={id} value={nickname} maxLength={DISPLAY_NAME_MAX} disabled={busy} onChange={e => setNickname(e.target.value)} className="mt-1 h-11 w-full rounded-lg border border-border bg-background px-3 text-foreground" />
        <p className={`mt-1 text-sm ${quietText}`}>Leave blank to use {friend.name}'s public name.</p>
      </div>
      {problem && <p role="alert" className="text-destructive">{problem}</p>}
      <div className="flex flex-wrap gap-2"><button disabled={busy} className={`${primaryAction} min-h-11`} type="submit">{busy ? 'Saving…' : 'Save preferences'}</button>
        <button disabled={busy} className={`${outlineAction} min-h-11`} type="button" onClick={() => setEditing(false)}>Cancel</button></div>
    </form>}
  </div>;
}
