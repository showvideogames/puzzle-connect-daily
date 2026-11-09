/** A YYYY-MM-DD day as "Sep 22, 2026", read as a local date so no time zone moves it. */
export function shortDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const day = new Date(`${date}T12:00:00`);
  return Number.isNaN(day.getTime()) ? date : day.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
