import { describe, expect, it } from 'vitest';
import { bestNoHintStreak, noHintStreakSummary } from '@/lib/noHintStreak';
const row = (completion_order: string, qualified: unknown) => ({completion_order, qualified});
describe('Best No-Hint Streak', () => {
 it('distinguishes unavailable tracking from an available zero', () => {
  expect(noHintStreakSummary(null).best).toBeNull();
  expect(noHintStreakSummary({best:4,tracked:2,unknown:0}).best).toBeNull();
  expect(noHintStreakSummary({best:0,tracked:0,unknown:0})).toEqual({best:0,tracked:0,unknown:0});
 });
 it('counts consecutive qualifying games, not sequence gaps or calendar days', () => {
  expect(bestNoHintStreak([row('9007199254740994',true),row('1',true),row('3',true)])).toEqual({best:3,tracked:3,unknown:0});
 });
 it('breaks on losses/hints and unknown evidence without bridging runs', () => {
  expect(bestNoHintStreak([row('1',true),row('2',true),row('3',null),row('4',true),row('5',false),row('6',true)])).toEqual({best:2,tracked:6,unknown:1});
 });
 it('returns zero only for available empty tracking, and refuses ambiguous order', () => {
  expect(bestNoHintStreak([])).toEqual({best:0,tracked:0,unknown:0});
  expect(bestNoHintStreak([row('1',true),row('1',true)]).best).toBeNull();
  expect(bestNoHintStreak([row('',true)]).best).toBeNull();
 });
});
