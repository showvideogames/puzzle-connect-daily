import { supabase } from "@/integrations/supabase/client";
import { GameStats } from "./types";

// Gets or creates a stable device ID for anonymous players
export function getDeviceId(): string {
  const key = "rc-device-id";
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const newId = crypto.randomUUID();
    localStorage.setItem(key, newId);
    return newId;
  } catch {
    return "unknown";
  }
}

interface GuessEvent {
  words: string[];
  correct: boolean;
  group_name: string | null;
}

interface SaveGameStatsParams {
  puzzleId: string;
  won: boolean;
  mistakes: number;
  activeTimeSeconds: number;
  foundRainbow: boolean;
  solveOrder: string[];
  guessHistory: GuessEvent[];
  skipStreak?: boolean;
  hintsUsed?: boolean;
  shareGrid?: string;
}

export async function hasExistingSession(puzzleId: string): Promise<boolean> {
  try {
    const deviceId = getDeviceId();
    const { data: { user } } = await supabase.auth.getUser();
    const userId = user?.id ?? null;
    const { data } = userId
      ? await supabase.from("game_sessions").select("id").eq("puzzle_id", puzzleId).or(`user_id.eq.${userId},device_id.eq.${deviceId}`).limit(1).maybeSingle()
      : await supabase.from("game_sessions").select("id").eq("puzzle_id", puzzleId).eq("device_id", deviceId).limit(1).maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}

export async function saveGameStats(params: SaveGameStatsParams): Promise<void> {
  const {
    puzzleId,
    won,
    mistakes,
    activeTimeSeconds,
    foundRainbow,
    solveOrder,
    guessHistory,
    skipStreak = false,
    hintsUsed = false,
    shareGrid = "",
  } = params;

  try {
    const deviceId = getDeviceId();
    const { data: { user } } = await supabase.auth.getUser();
    const userId = user?.id ?? null;

    // 1. Save game session
    const { data: session, error: sessionError } = await supabase
      .from("game_sessions")
      .insert({
        puzzle_id: puzzleId,
        user_id: userId,
        device_id: deviceId,
        won,
        mistakes,
        active_time_seconds: activeTimeSeconds,
        found_rainbow: foundRainbow,
        solve_order: solveOrder,
        hints_used: hintsUsed,
        share_grid: shareGrid,
      })
      .select("id")
      .single();

    if (sessionError || !session) {
      console.error("Failed to save game session:", sessionError);
      return;
    }

    // 2. Save individual guess events
    if (guessHistory.length > 0) {
      const guessRows = guessHistory.map((guess, index) => ({
        game_session_id: session.id,
        guess_number: index + 1,
        words: guess.words,
        correct: guess.correct,
        group_name: guess.group_name,
      }));
      const { error: guessError } = await supabase.from("guess_events").insert(guessRows);
      if (guessError) console.error("Failed to save guess events:", guessError);
    }

    // 3. Update puzzle aggregates via secure RPC
    //    (the database does the math — no client-side tampering possible)
    const firstSolve = solveOrder[0] ?? null;
    const { error: rpcError } = await supabase.rpc("increment_puzzle_aggregate", {
      _puzzle_id: puzzleId,
      _won: won,
      _mistakes: mistakes,
      _time_seconds: activeTimeSeconds,
      _first_solve: firstSolve,
    });
    if (rpcError) console.error("Failed to update puzzle aggregates:", rpcError);

    // 4. Update streak
    if (!skipStreak) {
      await updateStreak(userId, deviceId);
    }

  } catch (err) {
    console.error("saveGameStats error:", err);
  }
}

export async function loadStatsFromSupabase(): Promise<GameStats> {
  const empty: GameStats = {
    gamesPlayed: 0,
    gamesWon: 0,
    currentStreak: 0,
    maxStreak: 0,
    lastPlayedDate: null,
    guessDistribution: [0, 0, 0, 0, 0],
    rainbowSpotRate: null,
    rainbowSpottedCount: 0,
    hardestFirstCount: 0,
  };

  try {
    const deviceId = getDeviceId();
    const { data: { user } } = await supabase.auth.getUser();
    const userId = user?.id ?? null;

    const streakQuery = userId
      ? supabase.from("user_streaks").select("current_streak, longest_streak, last_played_date, user_id").or(`user_id.eq.${userId},device_id.eq.${deviceId}`)
      : supabase.from("user_streaks").select("current_streak, longest_streak, last_played_date, user_id").eq("device_id", deviceId);
    const { data: streakRows } = await streakQuery;
    // Prefer the row tied to the logged-in user; tiebreak on longest streak
    const streak = (streakRows ?? []).slice().sort((a, b) => {
      if (a.user_id && !b.user_id) return -1;
      if (!a.user_id && b.user_id) return 1;
      return (b.longest_streak ?? 0) - (a.longest_streak ?? 0);
    })[0] ?? null;

    const sessionsQuery = userId
      ? supabase.from("game_sessions").select("puzzle_id, won, mistakes, found_rainbow, solve_order").or(`user_id.eq.${userId},device_id.eq.${deviceId}`)
      : supabase.from("game_sessions").select("puzzle_id, won, mistakes, found_rainbow, solve_order").eq("device_id", deviceId);
    const { data: sessions } = await sessionsQuery;

    const rows = sessions ?? [];

    // Separate query: which of these puzzles actually had a rainbow herring?
    const puzzleIds = Array.from(new Set(rows.map((r) => r.puzzle_id).filter(Boolean)));
    const rainbowPuzzleIds = new Set<string>();
    if (puzzleIds.length > 0) {
      const { data: puzzleRows } = await supabase
        .from("puzzles")
        .select("id, rainbow_herring")
        .in("id", puzzleIds);
      for (const p of puzzleRows ?? []) {
        const herring = (p as any).rainbow_herring;
        if (Array.isArray(herring) && herring.length === 4) {
          rainbowPuzzleIds.add(p.id);
        }
      }
    }

    const guessDistribution: number[] = [0, 0, 0, 0, 0];
    let gamesWon = 0;
    let rainbowEligible = 0;
    let rainbowFound = 0;
    let hardestFirstCount = 0;
    for (const r of rows) {
      if (r.won) {
        gamesWon++;
        guessDistribution[Math.min(r.mistakes ?? 0, 4)]++;
      }
      if (r.puzzle_id && rainbowPuzzleIds.has(r.puzzle_id)) {
        rainbowEligible++;
        if (r.found_rainbow) rainbowFound++;
      }
      if (Array.isArray(r.solve_order) && r.solve_order[0] === "red") hardestFirstCount++;
    }

    return {
      gamesPlayed: rows.length,
      gamesWon,
      currentStreak: streak?.current_streak ?? 0,
      maxStreak: streak?.longest_streak ?? 0,
      lastPlayedDate: streak?.last_played_date ?? null,
      guessDistribution,
      rainbowSpotRate: rainbowEligible > 0 ? Math.round((rainbowFound / rainbowEligible) * 100) : null,
      rainbowSpottedCount: rainbowFound,
      hardestFirstCount,
    };
  } catch (err) {
    console.error("loadStatsFromSupabase error:", err);
    return empty;
  }
}

async function updateStreak(userId: string | null, deviceId: string): Promise<void> {
  try {
    const today = new Date().toLocaleDateString("en-CA");
    let existing: any = null;
    if (userId) {
      const r1 = await supabase.from("user_streaks").select("*").eq("user_id", userId).maybeSingle();
      existing = r1.data;
      if (!existing) {
        const r2 = await supabase.from("user_streaks").select("*").eq("device_id", deviceId).maybeSingle();
        existing = r2.data;
        // Claim orphaned anonymous row for this user
        if (existing && !existing.user_id) {
          await supabase.from("user_streaks").update({ user_id: userId }).eq("id", existing.id);
          existing.user_id = userId;
        }
      }
    } else {
      const r = await supabase.from("user_streaks").select("*").eq("device_id", deviceId).maybeSingle();
      existing = r.data;
    }

    if (!existing) {
      await supabase.from("user_streaks").insert({
        user_id: userId,
        device_id: deviceId,
        current_streak: 1,
        longest_streak: 1,
        last_played_date: today,
      });
      return;
    }

    const lastPlayed = existing.last_played_date;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toLocaleDateString("en-CA");

    let newStreak = existing.current_streak;
    if (lastPlayed === today) return;
    else if (lastPlayed === yesterdayStr) newStreak = existing.current_streak + 1;
    else newStreak = 1;

    const newLongest = Math.max(newStreak, existing.longest_streak);

    await supabase.from("user_streaks").update({
      current_streak: newStreak,
      longest_streak: newLongest,
      last_played_date: today,
      updated_at: new Date().toISOString(),
    }).eq("id", existing.id);

  } catch (err) {
    console.error("updateStreak error:", err);
  }
}
