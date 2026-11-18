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
  expect(screen.getByText('No Rainbows Yet')).toBeInTheDocument();
  expect(screen.getByText('No Recorded Colors')).toBeInTheDocument();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
 });
 it('uses only classified finds as the denominator and discloses unknown finds separately', () => {
  const insights=personalStatsInsights([row(['red'],true,'in_game'),row(['green'],true,'post_game'),row([],true,null)],FULL_FORMAT);
  render(<PersonalStatsInsightsCards insights={insights} hasRainbow />);
  expect(screen.getByRole('img',{name:'First 50%. Last 50%'})).toBeInTheDocument();
  expect(document.querySelector('.personal-stats-slice-majority')).toBeNull();
  expect(screen.queryByText('Known Timing Only')).not.toBeInTheDocument();
  const card=document.querySelector('.personal-stats-timing-card')!;
  expect([...card.children].filter(e=>!e.classList.contains('sr-only')).map(e=>e.tagName.toLowerCase())).toEqual(['h3','svg']);
  expect(document.querySelector('.personal-stats-timing-card')).toHaveAccessibleDescription(/1 historical finds have unknown timing/);
  expect(screen.getByText('Tie')).toBeInTheDocument();
 });
 it('uses pink/purple and positions the First majority label higher within its slice', () => {
  const insights=personalStatsInsights([],FULL_FORMAT); insights.rainbowTiming={first:7,last:3,unknown:2};
  render(<PersonalStatsInsightsCards insights={insights} hasRainbow />);
  const chart=screen.getByRole('img',{name:'First 70%. Last 30%'});
  expect([...chart.querySelectorAll('path')].map(p=>p.getAttribute('fill'))).toEqual(['#f6a6d2','#8739d7']);
  expect(screen.getByRole('heading',{name:'Spotted the Rainbow 🌈'})).toBeInTheDocument();
  for(const text of chart.querySelectorAll('text')) expect(text).toHaveAttribute('fill','#fff');
  expect(chart.querySelectorAll('.personal-stats-slice-majority')).toHaveLength(1);
  const luminance=(hex:string)=>{
    const channels=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);
    return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;
  };
  // Deb explicitly selected the original light pink with white labels.
  // Record its actual contrast without substituting a darker color.
  expect(1.05/(luminance('#f6a6d2')+.05)).toBeCloseTo(1.86,1);
  expect(1.05/(luminance('#8739d7')+.05)).toBeGreaterThanOrEqual(4.5);
  const first=chart.querySelector('text')!;
  expect(Number(first.getAttribute('y'))).toBeLessThan(135);
  expect(screen.queryByText('Known Timing Only')).not.toBeInTheDocument();
 });
 it('keeps a small readable slice label inside the chart without a side legend', () => {
  const insights=personalStatsInsights([],FULL_FORMAT); insights.rainbowTiming={first:9,last:1,unknown:0};
  render(<PersonalStatsInsightsCards insights={insights} hasRainbow />);
  expect(screen.getByRole('img',{name:'First 90%. Last 10%'})).toBeInTheDocument();
  expect(document.querySelector('.personal-stats-slice-compact')).toHaveTextContent('Last 10%');
  expect(document.querySelector('.personal-stats-timing-legend')).toBeNull();
 });
 it.each([[1,0,'First 100%. Last 0%','Last'],[0,1,'First 0%. Last 100%','First'],[999,1,'First >99%. Last <1%','Last']])('handles zero/tiny slices without misplaced labels: %s/%s', (first,last,name,omitted) => {
  const insights=personalStatsInsights([],FULL_FORMAT);
  insights.rainbowTiming={first:Number(first),last:Number(last),unknown:0};
  render(<PersonalStatsInsightsCards insights={insights} hasRainbow />);
  expect(screen.getByRole('img',{name:String(name)})).toBeInTheDocument();
  expect([...document.querySelectorAll('.personal-stats-slice-name')].some(e=>e.textContent===omitted)).toBe(false);
 });
 it('does not draw a pie for unknown-only finds or manufacture a middle segment', () => {
  render(<PersonalStatsInsightsCards insights={personalStatsInsights([row(null,true,null)],MINI_FORMAT)} hasRainbow />);
  expect(document.querySelector('.personal-stats-pie')).toBeNull();
  expect(screen.queryByText(/middle/i)).not.toBeInTheDocument();
 });
});
