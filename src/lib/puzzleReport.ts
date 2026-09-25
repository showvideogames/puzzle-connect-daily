/**
 * Rainbow Bot report — the client side of public.get_puzzle_report.
 *
 * The function returns aggregates only (counts and histograms), so this
 * module's job is to fetch that JSON and turn it into sentences: what the
 * most common wrong guess was made of, and where the player's own score
 * sits among everyone who finished the same puzzle.
 */

import { supabase } from "@/integrations/supabase/client";
import type { Puzzle, PuzzleGroup } from "@/lib/types";
import { SOLVE_ORDER_NAME, type Difficulty } from "@/lib/puzzleFormat";

export interface WrongGuessSummary {
  /** Sorted, upper-cased words, as the SQL keyed them. */
  words: string[];
  /** Distinct finished sessions that submitted this exact set. */
  players: number;
  one_away: boolean;
  rainbow_attempt: boolean;
  almost_rainbow: boolean;
}

export interface PuzzleReport {
  total_players: number;
  wins: number;
  perfect: number;
  players_with_wrong_guess: number;
  rainbow_in_game: number;
  rainbow_post_game: number;
  /** Keyed by the colour name the client writes into solve_order:
   *  "orange" (Yellow), "green", "blue", "red". */
  first_solved: Record<string, number>;
  /** Keyed by skill score as a string, e.g. {"90": 4, "84": 1}. */
  score_counts: Record<string, number>;
  common_wrong_guesses: WrongGuessSummary[];
}

export async function fetchPuzzleReport(puzzleId: string): Promise<PuzzleReport | null> {
  const { data, error } = await supabase.rpc("get_puzzle_report", { _puzzle_id: puzzleId });
  if (error || !data || typeof data !== "object") return null;
  const raw = data as Record<string, unknown>;
  return {
    total_players: num(raw.total_players),
    wins: num(raw.wins),
    perfect: num(raw.perfect),
    players_with_wrong_guess: num(raw.players_with_wrong_guess),
    rainbow_in_game: num(raw.rainbow_in_game),
    rainbow_post_game: num(raw.rainbow_post_game),
    first_solved: numRecord(raw.first_solved),
    score_counts: numRecord(raw.score_counts),
    common_wrong_guesses: Array.isArray(raw.common_wrong_guesses)
      ? raw.common_wrong_guesses.map((g) => {
          const row = (g ?? {}) as Record<string, unknown>;
          return {
            words: Array.isArray(row.words) ? row.words.map((w) => String(w)) : [],
            players: num(row.players),
            one_away: row.one_away === true,
            rainbow_attempt: row.rainbow_attempt === true,
            almost_rainbow: row.almost_rainbow === true,
          };
        })
      : [],
  };
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function numRecord(v: unknown): Record<string, number> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = num(val);
  return out;
}

export interface ScoreStanding {
  /** Other players counted — the player's own session is removed once. */
  others: number;
  /** Share of OTHER players with a strictly lower score, 0–100, or null
   *  when there is nobody to compare against. */
  betterThanPct: number | null;
  /** Mean score across everyone, including the player, or null if empty. */
  average: number | null;
}

/**
 * Where a score sits among the puzzle's finished sessions. The player's own
 * finished session is in `scoreCounts` too, so one instance of `myScore`
 * is removed before comparing — otherwise a solo player would be told they
 * beat 0% of players, which is true and useless.
 */
export function scoreStanding(scoreCounts: Record<string, number>, myScore: number): ScoreStanding {
  let total = 0;
  let sum = 0;
  let lower = 0;
  for (const [k, n] of Object.entries(scoreCounts)) {
    const s = Number(k);
    if (!Number.isFinite(s) || n <= 0) continue;
    total += n;
    sum += s * n;
    if (s < myScore) lower += n;
  }
  const average = total > 0 ? Math.round(sum / total) : null;
  const selfIncluded = (scoreCounts[String(myScore)] ?? 0) > 0;
  const others = selfIncluded ? total - 1 : total;
  const betterThanPct = others > 0 ? Math.round((lower / others) * 100) : null;
  return { others, betterThanPct, average };
}

export interface WrongGuessPart {
  category: string;
  difficulty: Difficulty;
  count: number;
}

export interface WrongGuessDescription {
  /** Categories the words came from, most words first. */
  parts: WrongGuessPart[];
  /** True when the words are exactly the puzzle's Rainbow set. */
  isRainbowSet: boolean;
  /** Words that matched no category (a stale or custom-emoji guess). */
  unknown: number;
}

const norm = (w: string) => w.trim().toUpperCase();

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].map(norm).sort();
  const sb = [...b].map(norm).sort();
  return sa.every((w, i) => w === sb[i]);
}

/** Which categories a wrong guess drew from, so the UI can say
 *  "3 from Parts of the Leg and 1 from Adore". */
export function describeWrongGuess(words: readonly string[], puzzle: Puzzle): WrongGuessDescription {
  const counts = new Map<PuzzleGroup, number>();
  let unknown = 0;
  for (const w of words) {
    const key = norm(w);
    const group = puzzle.groups.find((g) => g.words.some((gw) => norm(gw) === key));
    if (group) counts.set(group, (counts.get(group) ?? 0) + 1);
    else unknown += 1;
  }
  const parts = [...counts.entries()]
    .map(([g, count]) => ({ category: g.category, difficulty: g.difficulty, count }))
    .sort((a, b) => b.count - a.count || a.difficulty - b.difficulty);
  const herring = puzzle.rainbowHerring ?? null;
  const isRainbowSet = !!herring && herring.length > 0 && sameSet(words, herring);
  return { parts, isRainbowSet, unknown };
}

/** One plain sentence for a wrong guess. */
export function wrongGuessSentence(guess: WrongGuessSummary, puzzle: Puzzle): string {
  const d = describeWrongGuess(guess.words, puzzle);
  const who = guess.players === 1 ? "1 player" : `${guess.players} players`;
  if (d.isRainbowSet) {
    return `${who} submitted the Rainbow words as a normal category. That is the trap working.`;
  }
  if (d.parts.length === 0) return `${who} tried this one.`;
  const pieces = d.parts.map((p) => `${p.count} from ${p.category}`);
  const list = pieces.length <= 1 ? pieces[0] : `${pieces.slice(0, -1).join(", ")} and ${pieces[pieces.length - 1]}`;
  const tail = guess.one_away ? " One away." : "";
  return `${who}: ${list}.${tail}`;
}

/** Category name for a first-solved colour key ("orange", "green", …). */
export function categoryForSolveKey(key: string, puzzle: Puzzle): PuzzleGroup | undefined {
  const difficulty = ([1, 2, 3, 4] as const).find((d) => SOLVE_ORDER_NAME[d] === key);
  if (difficulty === undefined) return undefined;
  return puzzle.groups.find((g) => g.difficulty === difficulty);
}
