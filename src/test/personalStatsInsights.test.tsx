import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { personalStatsInsights } from '@/lib/personalStatsInsights';
import { FULL_FORMAT, MINI_FORMAT } from '@/lib/puzzleFormat';
import { PersonalStatsInsightsCards } from '@/components/PersonalStatsInsightsCards';
const row = (solve_order: unknown, found_rainbow: unknown = false, rainbow_source: unknown = null) => ({ solve_order, found_rainbow, rainbow_source });
afterEach(cleanup);
describe('personal history insights', () => {
 it('classifies found Rainbows by source alone, including post-loss indices, and never guesses null timing', () => {
  const rows = [0,1,2,3,4].map(rainbow_solve_index => ({...row([],true,'post_game'),rainbow_solve_index}));
  rows.push({...row([],true,'in_game'),rainbow_solve_index:0});
  const result = personalStatsInsights([...rows,row([],true,null),row([],true,'other'),row([],false,'in_game'),row([],null,'post_game')],FULL_FORMAT);
  expect(result.rainbowTiming).toEqual({first:1,last:5,unknown:2});
 });
 it('uses regular category order, normalizes orange, retains ties, and rejects unusable records', () => {
  const result=personalStatsInsights([row(['orange','red']),row(['green']),row(['rainbow','red']),row(['blue','blue']),row([]),row(null),row(['yellow']),row(['red','bad'])],FULL_FORMAT);
  expect(result.startingColors).toEqual({counts:{yellow:1,green:1,blue:0,red:0},leaders:['yellow','green'],known:2,excluded:6});
 });
 it('respects Mini colors and accepts partial loss orders', () => {
  expect(personalStatsInsights([row(['orange']),row(['red']),row(['red','green','blue'])],MINI_FORMAT).startingColors).toEqual({counts:{green:0,blue:0,red:2},leaders:['red'],known:2,excluded:1});
 });
 it('has no winners or percentages for empty history', () => {
  const insights=personalStatsInsights([],FULL_FORMAT);
  expect(insights.startingColors.leaders).toEqual([]);
  render(<PersonalStatsInsightsCards insights={insights} hasRainbow />);
  expect(screen.getByText('No Rainbow finds with known timing yet.')).toBeInTheDocument();
  expect(screen.getByText('No recorded starting colors yet.')).toBeInTheDocument();
  expect(screen.queryByText(/%/)).not.toBeInTheDocument();
 });
 it('uses only classified finds as the denominator and discloses unknown finds separately', () => {
  const insights=personalStatsInsights([row(['red'],true,'in_game'),row(['green'],true,'post_game'),row([],true,null)],FULL_FORMAT);
  render(<PersonalStatsInsightsCards insights={insights} hasRainbow />);
  expect(screen.getAllByText('50%',{exact:false})).toHaveLength(2);
  expect(screen.getByText('Timing unknown for 1 historical find; excluded from the chart.')).toBeInTheDocument();
  expect(screen.getByText('Tied for Most Frequent')).toBeInTheDocument();
 });
 it('does not draw a pie for unknown-only finds or manufacture a middle segment', () => {
  render(<PersonalStatsInsightsCards insights={personalStatsInsights([row(null,true,null)],MINI_FORMAT)} hasRainbow />);
  expect(document.querySelector('.personal-stats-pie')).toBeNull();
  expect(screen.queryByText(/middle/i)).not.toBeInTheDocument();
 });
});
