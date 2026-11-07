/**
 * The day someone played, right-aligned in an activity row. Phones get "Nov 4",
 * wider screens "Nov 4, 2026", and screen readers the whole day.
 */
export function ActivityDate({ date, prefix = "Played" }: { date: string; prefix?: string }) {
  const day = new Date(`${date}T12:00:00`);
  const show = (options: Intl.DateTimeFormatOptions) => day.toLocaleDateString(undefined, options);
  return (
    <time dateTime={date} className="shrink-0 whitespace-nowrap text-right text-sm text-slate">
      <span className="sr-only">{prefix} {show({ weekday: "long", month: "long", day: "numeric" })}</span>
      <span aria-hidden="true" className="sm:hidden">{show({ month: "short", day: "numeric" })}</span>
      <span aria-hidden="true" className="hidden sm:inline">{show({ month: "short", day: "numeric", year: "numeric" })}</span>
    </time>
  );
}
