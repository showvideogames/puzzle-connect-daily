import { supabase } from "@/integrations/supabase/client";
import { Puzzle } from "./types";

// Fetch today's published puzzle from the database
export async function getTodaysPuzzle(): Promise<Puzzle | null> {
  const today = new Date().toISOString().split("T")[0];

  // Try today's puzzle first, then the most recent published one
  const { data, error } = await supabase
    .from("puzzles")
    .select("*, puzzle_groups(*)")
    .eq("is_published", true)
    .lte("date", today)
    .order("date", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return null;

  return mapPuzzle(data);
}

export async function getPuzzleById(id: string): Promise<Puzzle | null> {
  const { data, error } = await supabase
    .from("puzzles")
    .select("*, puzzle_groups(*)")
    .eq("id", id)
    .eq("is_published", true)
    .single();

  if (error || !data) return null;
  return mapPuzzle(data);
}

export async function getPuzzleByDate(date: string): Promise<Puzzle | null> {
  const { data, error } = await supabase
    .from("puzzles")
    .select("*, puzzle_groups(*)")
    .eq("date", date)
    .eq("is_published", true)
    .single();

  if (error || !data) return null;
  return mapPuzzle(data);
}

function mapPuzzle(data: any): Puzzle {
  const groups = [...(data.puzzle_groups || [])]
    .sort((a: any, b: any) => a.sort_order - b.sort_order)
    .map((g: any) => ({
      category: g.category,
      words: g.words as string[],
      difficulty: g.difficulty as 1 | 2 | 3 | 4,
    }));

  return {
    id: data.id,
    date: data.date,
    groups,
    wordOrder: data.word_order || null,
    rainbowHerring: data.rainbow_herring || null,
  };
}
