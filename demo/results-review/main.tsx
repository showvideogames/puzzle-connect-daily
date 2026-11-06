import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {ResultsDialog} from '@/components/ResultsDialog';
import type {ResultRow,ResultCellKind} from '@/components/ResultGrid';
import {FULL_FORMAT,MINI_FORMAT} from '@/lib/puzzleFormat';
import {resolveTheme} from '@/lib/themes';
import '@/index.css';
const q=new URLSearchParams(location.search),mini=q.get('format')==='mini';
document.documentElement.classList.toggle('dark',q.get('theme')==='dark');
const colors:ResultCellKind[]=['yellow','green','blue','red'];
const rows:ResultRow[]=[{type:'guess',cells:colors},...colors.map(c=>({type:'guess' as const,cells:Array(mini?3:4).fill(c)}))];
function Preview(){const[open,setOpen]=useState(true);return <MemoryRouter><main className="mx-auto max-w-4xl space-y-3 p-8">{['#F6D968','#8CCB91','#7DB9DD','#E9786D'].map(color=><div key={color} className="h-28 rounded-xl" style={{background:color}}/>)}<button onClick={()=>setOpen(true)}>View results</button></main><ResultsDialog open={open} onOpenChange={setOpen} headline="Excellent!" timeLabel={mini?'1m 05s':null} resultRows={rows} onShare={()=>{}} copied={false} statsFormat={mini?MINI_FORMAT:FULL_FORMAT} statsPending={false} showStreak={false} animateStreak={false} onStreakAnimated={()=>{}} spotTheme={resolveTheme(null)} onSpotRainbow={()=>{}} gameFormat={mini?'mini':'full'} officialDaily puzzleId={mini?'mini-7':'full-1'} solved mistakes={1}/></MemoryRouter>}
if(['127.0.0.1','localhost'].includes(location.hostname))createRoot(document.getElementById('root')!).render(<Preview/>);
