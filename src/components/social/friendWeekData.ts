import type {FriendResult} from '@/lib/friendResults';
import {resultFor} from '@/lib/socialView';
import {localPuzzleDate, socialWeek} from '@/lib/socialWeek';
import type {SocialApi} from './socialApi';

export type DayResult = {date: string; result: FriendResult | null};

export async function readFriendWeek(api: SocialApi, friend: FriendResult, today: Date): Promise<DayResult[]> {
  if (!api.weekPuzzles) throw new Error('Unavailable');
  const days = socialWeek(today);
  const puzzles = await api.weekPuzzles(days[0].date, localPuzzleDate(today));
  const result: DayResult[] = [];
  for (const day of days.filter(day => !day.future)) {
    const puzzle = puzzles.find(puzzle => puzzle.date === day.date);
    if (!puzzle) { result.push({date:day.date, result:null}); continue; }
    // Each request is independently authorized and gated by this exact puzzle id.
    const answer = await api.client.call('listResults', {gameId:'rainbow', puzzleId:puzzle.id});
    if (answer.ok === false) throw new Error('Unavailable');
    const row = answer.data.find(row => !row.isMe && 'friendRef' in row && row.friendRef === friend.id);
    result.push({date:day.date, result:resultFor(friend, row)});
  }
  return result;
}

