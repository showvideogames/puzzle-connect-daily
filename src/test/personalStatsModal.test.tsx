import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StatsModal } from '@/components/StatsModal';
import { FULL_FORMAT, MINI_FORMAT } from '@/lib/puzzleFormat';
import type { GameStats } from '@/lib/types';
import { loadStatsFromSupabase } from '@/lib/gameStats';
vi.mock('@/lib/gameStats', async (original) => ({ ...await original<typeof import('@/lib/gameStats')>(), loadStatsFromSupabase: vi.fn() }));
const empty: GameStats = { noHintStreak:{best:0,tracked:0,unknown:0}, insights: {rainbowTiming:{first:0,last:0,unknown:0},startingColors:{counts:{},leaders:[],known:0,excluded:0}}, gamesPlayed:0,gamesWon:0,currentStreak:0,maxStreak:0,lastPlayedDate:null,guessDistribution:[0,0,0,0,0],rainbowSpotRate:null,rainbowSpottedCount:0,hardestFirstCount:0,perfectGamesCount:0,noHintsUsedCount:0,inOrderCount:0,reverseRainbowCount:0,averageMistakes:0 };
const full = { ...empty, gamesPlayed:19, gamesWon:15, maxStreak:9, perfectGamesCount:7, rainbowSpottedCount:11, guessDistribution:[7,4,3,1,4] };
const mini = { ...empty, gamesPlayed:3, gamesWon:2, maxStreak:2, perfectGamesCount:1, rainbowSpottedCount:2 };
beforeEach(() => vi.mocked(loadStatsFromSupabase).mockImplementation(async f => f?.id === 'mini' ? mini : full));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe('personal stats modal', () => {
 it('reads live format-specific numbers and switches without introducing solve times', async () => {
  render(<StatsModal open onClose={() => {}} />);
  expect(await screen.findByText('79%')).toBeInTheDocument();
  expect(screen.getByText('19')).toBeInTheDocument();
  expect(screen.getByText('11')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Mini'}));
  expect(await screen.findByText('67%')).toBeInTheDocument();
  expect(loadStatsFromSupabase).toHaveBeenLastCalledWith(MINI_FORMAT);
  expect(screen.queryByText('19')).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Mini'})).toHaveAttribute('aria-pressed','true');
  expect(screen.queryByText(/solve time/i)).not.toBeInTheDocument();
 });
 it('shows a genuine empty record without sample numbers', async () => {
  vi.mocked(loadStatsFromSupabase).mockResolvedValue(empty);
  render(<StatsModal open onClose={() => {}} />);
  expect(await screen.findByText('0%')).toBeInTheDocument();
  expect(screen.queryByText('84')).not.toBeInTheDocument();
  expect(screen.queryByText('Advanced Stats')).not.toBeInTheDocument();
  expect(document.querySelectorAll('.personal-stats-track > div')).toHaveLength(5);
  document.querySelectorAll<HTMLElement>('.personal-stats-track > div').forEach(bar => expect(bar.style.width).toBe('0%'));
 });
 it('ignores an old Full response arriving after switching to Mini', async () => {
  let resolveFull!: (value:GameStats) => void;
  vi.mocked(loadStatsFromSupabase).mockImplementation(f => f?.id === 'mini' ? Promise.resolve(mini) : new Promise(r => {resolveFull=r;}));
  render(<StatsModal open onClose={() => {}} />);
  fireEvent.click(screen.getByRole('button',{name:'Mini'}));
  expect(await screen.findByText('67%')).toBeInTheDocument();
  await act(async () => resolveFull(full));
  expect(screen.queryByText('79%')).not.toBeInTheDocument();
 });
 it('closes and reloads the page format when reopened', async () => {
  const close=vi.fn();
  const view=render(<StatsModal open onClose={close} format={MINI_FORMAT} />);
  await screen.findByText('67%');
  fireEvent.click(screen.getByRole('button',{name:'Full'}));
  await screen.findByText('79%');
  fireEvent.click(screen.getByRole('button',{name:'Close'}));
  expect(close).toHaveBeenCalledOnce();
  view.rerender(<StatsModal open={false} onClose={close} format={MINI_FORMAT} />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  view.rerender(<StatsModal open onClose={close} format={MINI_FORMAT} />);
  await screen.findByText('67%');
  await waitFor(() => expect(loadStatsFromSupabase).toHaveBeenLastCalledWith(MINI_FORMAT));
 });
 it.each([FULL_FORMAT, MINI_FORMAT])('keeps entry format $name first across both switches', async format => {
  render(<StatsModal open onClose={() => {}} format={format} />);
  await screen.findByText(format.id === 'mini' ? '67%' : '79%');
  const order = () => [...screen.getByRole('group',{name:'Stats Format'}).querySelectorAll('button')].map(b=>b.textContent);
  const expected = format.id === 'mini' ? ['Mini','Full'] : ['Full','Mini'];
  expect(order()).toEqual(expected);
  for (const name of [...expected].reverse()) {
    fireEvent.click(screen.getByRole('button',{name}));
    await screen.findByText(name === 'Mini' ? '67%' : '79%');
    expect(order()).toEqual(expected);
  }
 });
 it('limits Mini chart to 0–3 and discloses untouched historical buckets', async () => {
  vi.mocked(loadStatsFromSupabase).mockResolvedValue({...mini,guessDistribution:[1,2,3,4,5,6]});
  render(<StatsModal open onClose={() => {}} format={MINI_FORMAT} />);
  await screen.findByText('67%');
  expect([...document.querySelectorAll('.personal-stats-bucket')].map(b=>b.textContent)).toEqual(['0','1','2','3']);
  expect(screen.getByText('Failure Bucket: 3 Mistakes')).toBeInTheDocument();
  expect(screen.getByText(/11 historical games with more than 3 mistakes/)).toBeInTheDocument();
  expect([...document.querySelectorAll('.personal-stats-count')].map(b=>b.textContent)).toEqual(['1','2','3','4']);
 });

 it('does not claim zero when forward tracking is unavailable', async () => {
  vi.mocked(loadStatsFromSupabase).mockResolvedValue({...full,noHintStreak:{best:null,tracked:0,unknown:0}});
  render(<StatsModal open onClose={() => {}} />);
  await screen.findByText('Tracking is unavailable right now.');
  expect(screen.getByText('Consecutive Official Wins Without Hints')).toBeInTheDocument();
  expect(screen.getByText('Losses or hints break the streak. Calendar gaps do not.')).toBeInTheDocument();
 });

});
