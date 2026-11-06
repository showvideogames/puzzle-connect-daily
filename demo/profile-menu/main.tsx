import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ProfileMenu } from '@/components/account/ProfileMenu';
import '@/index.css';

function Preview() {
  const [count, setCount] = useState<number | null>(2);
  const [action, setAction] = useState('Open your profile picture.');
  return <div className="mx-auto max-w-lg p-4">
    <header className="flex items-center justify-between border-b border-border pb-4">
      <img src="/rainbow-categories-logo-stacked.webp" alt="Rainbow Categories" className="w-28" />
      <ProfileMenu profile={{ version: 1, displayName: 'River', animalId: 'fox', backgroundColor: '#DED1F2' }} pendingCount={count}
        onProfile={() => setAction('My profile selected')} onFriends={() => setAction('Friends & Groups selected')} onAccount={() => setAction('Account options selected')} />
    </header>
    <p className="my-6 text-sm text-muted-foreground">Menu checkpoint · synthetic profile and notifications. Navigation is demonstrated below.</p>
    <div className="flex flex-wrap gap-3">
      <button className="rounded-lg border p-3" onClick={() => document.documentElement.classList.toggle('dark')}>Toggle theme</button>
      <label>Notifications <select aria-label="Notifications" className="rounded-lg border bg-background p-3" value={count ?? 'unknown'} onChange={e => setCount(e.target.value === 'unknown' ? null : Number(e.target.value))}>
        <option value="0">None</option><option value="2">2 pending</option><option value="105">105 pending</option><option value="unknown">Loading / unavailable</option>
      </select></label>
    </div>
    <p role="status" className="my-6">{action}</p>
  </div>;
}
if (['localhost', '127.0.0.1'].includes(location.hostname)) createRoot(document.getElementById('root')!).render(<Preview />);
