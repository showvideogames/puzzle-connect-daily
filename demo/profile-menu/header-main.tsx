import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import type { User } from '@supabase/supabase-js';
import { GameHeader } from '@/components/GameHeader';
import { MinimalHeader } from '@/components/MinimalHeader';
import { SocialPage } from '@/components/social/SocialPage';
import { appSocial, setNotifications } from './fixtureSocial';
import { HEADER_REFRESH } from '@/components/social/socialHeaderEvents';
import '@/index.css';
function Preview() {
  const [kind, setKind] = useState('daily');
  const [signedIn, setSignedIn] = useState(true);
  const location = useLocation();
  const user = signedIn ? { id: 'fixture', email: 'preview@example.test' } as User : null;
  return <>
    <div className="p-3 text-sm">Header integration preview · synthetic account
      <select aria-label="Header type" value={kind} onChange={e => setKind(e.target.value)} className="m-2 bg-background"><option value="daily">Daily</option><option value="minimal">Secondary</option></select>
      <button className="m-2" onClick={() => document.documentElement.classList.toggle('dark')}>Toggle theme</button>
      <button className="m-2" onClick={() => { setNotifications(0); dispatchEvent(new Event(HEADER_REFRESH)); }}>Clear notifications</button>
    </div>
    {kind === 'daily' ? <GameHeader variant="minimal" user={user} onSignOut={() => setSignedIn(false)} showHint onHintClick={() => {}} onStatsClick={() => {}} onSettingsClick={() => {}} /> : <MinimalHeader />}
    <div className="mx-auto max-w-lg p-3">
      <p role="status">{location.pathname}</p>
      <Routes><Route path="/friends" element={<SocialPage social={appSocial()} code={null} />} /><Route path="*" element={null} /></Routes>
    </div>
  </>;
}
if (['127.0.0.1', 'localhost'].includes(location.hostname)) createRoot(document.getElementById('root')!).render(<MemoryRouter><Preview /></MemoryRouter>);
