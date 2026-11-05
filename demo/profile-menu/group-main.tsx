import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GroupAppearanceForm } from '@/components/account/GroupAppearanceForm';
import type { GroupAppearance } from '@/components/account/GroupAppearanceForm';
import '@/index.css';
function Preview() {
  const [saved, setSaved] = useState<GroupAppearance | null>(null);
  return <div className="mx-auto max-w-md p-4">
    <button onClick={() => document.documentElement.classList.toggle('dark')} className="mb-4 rounded-lg border p-2">Toggle theme</button>
    <GroupAppearanceForm initial={{ name: 'Puzzle Pals', emblemId: 'campfire', photo: null, accentColor: '#DED1F2' }} onSave={setSaved} />
    {saved && <div role="status">Draft saved locally{saved.photo && <img data-testid="saved-picture" src={saved.photo} alt="Saved group picture" />}</div>}
  </div>;
}
if (['127.0.0.1', 'localhost'].includes(location.hostname)) createRoot(document.getElementById('root')!).render(<Preview />);
