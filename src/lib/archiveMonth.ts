/**
 * Calendar month helpers shared by every archive page and the archive
 * calendar component.
 *
 * Their own module rather than exports from the component file, so that file
 * only exports components (React Fast Refresh needs that to work).
 */

export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** The `?month=` URL value for a viewed month: "2026-09". */
export function monthParam(year: number, month: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

/**
 * The year/month a `?month=YYYY-MM` param selects, falling back to the
 * current month when it is absent or malformed.
 */
export function resolveViewedMonth(rawMonth: string | null, today: Date): { viewYear: number; viewMonth: number } {
  const valid = rawMonth && /^\d{4}-\d{2}$/.test(rawMonth) ? rawMonth : null;
  return {
    viewYear: valid ? parseInt(valid.slice(0, 4), 10) : today.getFullYear(),
    viewMonth: valid ? parseInt(valid.slice(5, 7), 10) - 1 : today.getMonth(),
  };
}
