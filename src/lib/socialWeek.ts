/** Puzzle dates follow the device-local calendar, like getTodaysPuzzle. */
export function localPuzzleDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

export function socialWeek(today: Date): {date: string; day: Date; future: boolean}[] {
  // Calendar arithmetic at noon survives DST; no UTC parsing or 24-hour addition.
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  monday.setDate(monday.getDate() - (monday.getDay()+6)%7);
  const current = localPuzzleDate(today);
  return Array.from({length:7}, (_, index) => {
    const day = new Date(monday);
    day.setDate(monday.getDate()+index);
    const date = localPuzzleDate(day);
    return {date, day, future: date > current};
  });
}
