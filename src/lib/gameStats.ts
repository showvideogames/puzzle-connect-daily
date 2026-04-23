import { supabase } from "@/integrations/supabase/client";

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
      ? await supabase.from("game_sessions").select("id").eq("puzzle_id", puzzleId).eq("user_id", userId).limit(1).maybeSingle()
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

    const { data: existing } = await supabase
      .from("puzzle_aggregates")
      .select("*")
      .eq("puzzle_id", puzzleId)
      .single();

    const totalPlays = (existing?.total_plays ?? 0) + 1;
    const totalWins = (existing?.total_wins ?? 0) + (won ? 1 : 0);
    const prevAvgMistakes = existing?.avg_mistakes ?? 0;
    const newAvgMistakes = (prevAvgMistakes * (totalPlays - 1) + mistakes) / totalPlays;
    const prevAvgTime = existing?.avg_time_seconds ?? 0;
    const newAvgTime = (prevAvgTime * (totalPlays - 1) + activeTimeSeconds) / totalPlays;
    const firstSolve = solveOrder[0] ?? null;

    await supabase.from("puzzle_aggregates").upsert({
      puzzle_id: puzzleId,
      total_plays: totalPlays,
      total_wins: totalWins,
      avg_mistakes: newAvgMistakes,
      avg_time_seconds: newAvgTime,
      most_common_first_solve: firstSolve,
      updated_at: new Date().toISOString(),
    }, { onConflict: "puzzle_id" });

    if (!skipStreak) {
      await updateStreak(userId, deviceId);
    }

  } catch (err) {
    console.error("saveGameStats error:", err);
  }
}

async function updateStreak(userId: string | null, deviceId: string): Promise<void> {
  try {
    const today = new Date().toLocaleDateString("en-CA");
    const query = userId
      ? supabase.from("user_streaks").select("*").eq("user_id", userId).single()
      : supabase.from("user_streaks").select("*").eq("device_id", deviceId).single();
    const { data: existing } = await query;

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
