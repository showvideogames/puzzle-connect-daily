import { supabase } from "@/integrations/supabase/client";

export interface PuzzleStats {
  total: number;
  mistakes0: number;
  mistakes1: number;
  mistakes2: number;
  mistakes3: number;
  mistakes4: number;
}

/**
 * Submit a player's result to global stats.
 * No deduplication — honor system.
 * mistakes: 0–3 for wins, 4 for losses.
 */
export async function submitGlobalStats(
  puzzleId: string,
  mistakes: number
): Promise<void> {
  await supabase.from("puzzle_stat_submissions").insert({
    puzzle_id: puzzleId,
    mistakes: Math.min(mistakes, 4),
  });
}

/**
 * Fetch and compute global stats for a puzzle.
 */
export async function fetchGlobalStats(
  puzzleId: string
): Promise<PuzzleStats | null> {
  const { data, error } = await supabase
    .from("puzzle_stat_submissions")
    .select("mistakes")
    .eq("puzzle_id", puzzleId);

  if (error || !data || data.length === 0) return null;

  const counts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const row of data) {
    const m = Math.min(row.mistakes, 4) as 0 | 1 | 2 | 3 | 4;
    counts[m]++;
  }

  return {
    total: data.length,
    mistakes0: counts[0],
    mistakes1: counts[1],
    mistakes2: counts[2],
    mistakes3: counts[3],
    mistakes4: counts[4],
  };
}
