import { supabase } from "@/integrations/supabase/client";

export interface PuzzleStats {
  total: number;
  mistakes0: number;
  mistakes1: number;
  mistakes2: number;
  mistakes3: number;
  mistakes4: number;
}

function submittedKey(puzzleId: string) {
  return `global-stats-submitted-v2-${puzzleId}`;
}

export function hasSubmittedStats(puzzleId: string): boolean {
  try {
    return localStorage.getItem(submittedKey(puzzleId)) === "true";
  } catch {
    return false;
  }
}

function markSubmitted(puzzleId: string) {
  try {
    localStorage.setItem(submittedKey(puzzleId), "true");
  } catch {}
}

/**
 * Submit a player's result to global stats.
 * Deduped per browser via localStorage flag.
 * mistakes: 0–3 for wins, 4 for losses.
 */
export async function submitGlobalStats(
  puzzleId: string,
  mistakes: number
): Promise<void> {
  if (hasSubmittedStats(puzzleId)) return;

  const col = `mistakes_${Math.min(mistakes, 4) as 0 | 1 | 2 | 3 | 4}`;

  await supabase.rpc("increment_puzzle_stat", {
    p_puzzle_id: puzzleId,
    p_column: col,
  });

  markSubmitted(puzzleId);
}

/**
 * Fetch global stats for a puzzle.
 */
export async function fetchGlobalStats(
  puzzleId: string
): Promise<PuzzleStats | null> {
  const { data, error } = await supabase
    .from("puzzle_stats")
    .select("*")
    .eq("puzzle_id", puzzleId)
    .single();

  if (error || !data) return null;

  const m0 = data.mistakes_0 ?? 0;
  const m1 = data.mistakes_1 ?? 0;
  const m2 = data.mistakes_2 ?? 0;
  const m3 = data.mistakes_3 ?? 0;
  const m4 = data.mistakes_4 ?? 0;
  const total = m0 + m1 + m2 + m3 + m4;

  return { total, mistakes0: m0, mistakes1: m1, mistakes2: m2, mistakes3: m3, mistakes4: m4 };
}
