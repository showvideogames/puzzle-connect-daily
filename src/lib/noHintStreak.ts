export interface NoHintStreak { best: number | null; tracked: number; unknown: number }
export const unavailableNoHintStreak = (): NoHintStreak => ({ best: null, tracked: 0, unknown: 0 });

/** Server-issued acceptance order, not dates. Unknown evidence breaks a run. */
export function bestNoHintStreak(rows: readonly { completion_order: unknown; qualified: unknown }[]): NoHintStreak {
  const seen = new Set<string>();
  for (const row of rows) {
    if (typeof row.completion_order !== 'string' || !/^[1-9]\d*$/.test(row.completion_order) || seen.has(row.completion_order)) return unavailableNoHintStreak();
    seen.add(row.completion_order);
  }
  const sorted = [...rows].sort((a,b) => {
    const x = BigInt(a.completion_order as string), y = BigInt(b.completion_order as string);
    return x < y ? -1 : x > y ? 1 : 0;
  });
  let best = 0, current = 0, unknown = 0;
  for (const row of sorted) {
    if (row.qualified === true) { current++; best = Math.max(best, current); }
    else { current = 0; if (row.qualified !== false) unknown++; }
  }
  return { best, tracked: rows.length, unknown };
}

/** Validate the one-row server summary; missing/unavailable is not zero. */
export function noHintStreakSummary(value: unknown): NoHintStreak {
  if (!value || typeof value !== 'object') return unavailableNoHintStreak();
  const {best,tracked,unknown} = value as Record<string,unknown>;
  if (![best,tracked,unknown].every(n => Number.isSafeInteger(n) && (n as number) >= 0) || (best as number) > (tracked as number) || (unknown as number) > (tracked as number)) return unavailableNoHintStreak();
  return {best:best as number,tracked:tracked as number,unknown:unknown as number};
}
