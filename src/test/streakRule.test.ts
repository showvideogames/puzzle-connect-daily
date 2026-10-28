/**
 * The streak counts consecutive days WON, per format.
 *
 * The real rule lives in the database (record_streak, migration 0003) and is
 * checked there by e2e/scripts/verify-db.ts. This pins the in-memory fake to
 * the same answers, so every other suite that plays games against it sees
 * the streaks production would.
 */
import { describe, it, expect } from "vitest";
import { FakeSupabase } from "./fakeSupabase";

function streakOf(db: FakeSupabase, device: string, format: string) {
  const rows = db.tables.user_streaks.filter(
    (r) => r.device_id === device && r.user_id == null && (r.format ?? "full") === format
  );
  expect(rows).toHaveLength(1);
  return { current: rows[0].current_streak, max: rows[0].longest_streak };
}

describe.each(["full", "mini"])("%s streak", (format) => {
  it("a first-game win starts the streak at 1", () => {
    const db = new FakeSupabase();
    db._recordStreak(null, "dev-win", true, "2026-07-01", format);
    expect(streakOf(db, "dev-win", format)).toEqual({ current: 1, max: 1 });
  });

  it("a first-game loss starts it at 0", () => {
    const db = new FakeSupabase();
    db._recordStreak(null, "dev-loss", false, "2026-07-01", format);
    expect(streakOf(db, "dev-loss", format)).toEqual({ current: 0, max: 0 });
  });

  it("a loss followed by a win the next day is a 1-day streak", () => {
    const db = new FakeSupabase();
    db._recordStreak(null, "dev-back", false, "2026-07-01", format);
    db._recordStreak(null, "dev-back", true, "2026-07-02", format);
    expect(streakOf(db, "dev-back", format)).toEqual({ current: 1, max: 1 });
  });
});
