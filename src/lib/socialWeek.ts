/** Puzzle dates follow the device-local calendar, like getTodaysPuzzle. */
export function localPuzzleDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

/** Inclusive local calendar days: today plus the preceding N-1 dates. */
export function rollingSocialDays(today: Date, count: 7 | 30 | 365): {date: string; day: Date; future: boolean}[] {
  // Calendar arithmetic at noon survives DST; no UTC parsing or 24-hour addition.
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  start.setDate(start.getDate() - count + 1);
  return Array.from({length:count}, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate()+index);
    return {date:localPuzzleDate(day), day, future:false};
  });
}

export const socialWeek = (today: Date) => rollingSocialDays(today, 7);
