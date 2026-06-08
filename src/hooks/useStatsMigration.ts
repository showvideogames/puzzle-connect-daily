import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getDeviceId } from "@/lib/gameStats";
import type { User } from "@supabase/supabase-js";

interface GuestStats {
  streakRowId: string;
  currentStreak: number;
  longestStreak: number;
  gamesPlayed: number;
}

const PROMPTED_KEY_PREFIX = "rc-migration-prompted-";

function wasAlreadyPrompted(userId: string): boolean {
  try {
    return localStorage.getItem(PROMPTED_KEY_PREFIX + userId) === "1";
  } catch {
    return true; // Can't read localStorage — skip the prompt
  }
}

function markPrompted(userId: string): void {
  try {
    localStorage.setItem(PROMPTED_KEY_PREFIX + userId, "1");
  } catch {
    // ignore
  }
}

export function useStatsMigration() {
  const [migrationData, setMigrationData] = useState<GuestStats | null>(null);
  const [migrationUser, setMigrationUser] = useState<User | null>(null);

  /**
   * Called when auth transitions from null → a real user.
   * Checks if this device has orphaned guest stats worth importing.
   */
  const checkForGuestStats = useCallback(async (user: User) => {
    if (wasAlreadyPrompted(user.id)) return;

    const deviceId = getDeviceId();
    if (deviceId === "unknown") return;

    try {
      // 1. Does the user already have their own streak row? (returning user)
      const { data: existingUserRow } = await supabase
        .from("user_streaks")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (existingUserRow) {
        // Returning user — they already have account stats, skip
        markPrompted(user.id);
        return;
      }

      // 2. Is there an orphaned guest row on this device?
      const { data: guestRow } = await supabase
        .from("user_streaks")
        .select("id, current_streak, longest_streak")
        .eq("device_id", deviceId)
        .is("user_id", null)
        .maybeSingle();

      if (!guestRow) {
        markPrompted(user.id);
        return;
      }

      const currentStreak = guestRow.current_streak ?? 0;
      const longestStreak = guestRow.longest_streak ?? 0;

      // Only prompt if there's meaningful data
      if (currentStreak <= 0 && longestStreak <= 1) {
        markPrompted(user.id);
        return;
      }

      // 3. Count guest game sessions on this device
      const { count } = await supabase
        .from("game_sessions")
        .select("id", { count: "exact", head: true })
        .eq("device_id", deviceId)
        .is("user_id", null);

      setMigrationData({
        streakRowId: guestRow.id,
        currentStreak,
        longestStreak,
        gamesPlayed: count ?? 0,
      });
      setMigrationUser(user);
    } catch (err) {
      console.error("checkForGuestStats error:", err);
      markPrompted(user.id);
    }
  }, []);

  /**
   * User chose "Import Stats" — claim the guest streak row and
   * all guest game sessions for this device.
   */
  const importStats = useCallback(async () => {
    if (!migrationData || !migrationUser) return;

    const deviceId = getDeviceId();
    const userId = migrationUser.id;

    try {
      // Claim the streak row
      await supabase
        .from("user_streaks")
        .update({ user_id: userId, device_id: null })
        .eq("id", migrationData.streakRowId);

      // Claim all orphaned game sessions from this device
      await supabase
        .from("game_sessions")
        .update({ user_id: userId })
        .eq("device_id", deviceId)
        .is("user_id", null);
    } catch (err) {
      console.error("importStats error:", err);
    }

    markPrompted(userId);
    setMigrationData(null);
    setMigrationUser(null);
  }, [migrationData, migrationUser]);

  /**
   * User chose "Start Fresh" — create a fresh streak row for their account
   * so the existing auto-claim logic in updateStreak() doesn't silently
   * adopt the guest row on their next completed puzzle.
   */
  const startFresh = useCallback(async () => {
    if (migrationUser) {
      try {
        await supabase.from("user_streaks").insert({
          user_id: migrationUser.id,
          device_id: null,
          current_streak: 0,
          longest_streak: 0,
          last_played_date: null,
        });
      } catch (err) {
        console.error("startFresh error:", err);
      }
      markPrompted(migrationUser.id);
    }
    setMigrationData(null);
    setMigrationUser(null);
  }, [migrationUser]);

  return {
    showMigration: migrationData !== null,
    guestStreak: migrationData?.currentStreak ?? 0,
    guestLongest: migrationData?.longestStreak ?? 0,
    guestGamesPlayed: migrationData?.gamesPlayed ?? 0,
    checkForGuestStats,
    importStats,
    startFresh,
  };
}
