/**
 * Lucky Bot Luck Score — how unusual the player's exact path was.
 *
 * Not a measure of skill, and not literally luck: it is how rare the
 * player's complete, ordered sequence of submitted guesses was among
 * everyone who finished the same Full puzzle on their first official
 * attempt. The database decides who counts and whose path matches
 * (public.get_luck_report, migration 20260928000000); this module turns
 * those two counts into the score and the sentences on the card.
 *
 *   rarity     = eligible players ÷ players who took the same exact path
 *   Luck Score = round(100 × log10(rarity) ÷ log10(ceiling)), kept to 0–100
 *
 * The ceiling (5,000 at launch) is chosen per puzzle by the database, from
 * the puzzle's date, so raising it later never lowers an older puzzle's
 * score. No number is shown until the puzzle has `min_players` (500)
 * eligible players; before that the card says Lucky Bot is still collecting
 * results and shows the observed rarity so far.
 */

import { supabase } from "@/integrations/supabase/client";
import { getIdentity } from "@/lib/gameSession";

export const DEFAULT_LUCK_CEILING = 5000;
export const DEFAULT_LUCK_MIN_PLAYERS = 500;

export type LuckReport =
  | {
      status: "ok";
      eligiblePlayers: number;
      samePath: number;
      ceiling: number;
      minPlayers: number;
    }
  | { status: "no_session" }
  | { status: "not_eligible"; reason: "admin" | "incomplete_history" }
  | { status: "unsupported" };

/** Rarity as "1 in N": everyone ÷ everyone who took the same path. */
export function luckRarity(eligiblePlayers: number, samePath: number): number | null {
  if (!(eligiblePlayers > 0) || !(samePath > 0) || samePath > eligiblePlayers) return null;
  return eligiblePlayers / samePath;
}

/** The Luck Score for a rarity, 0–100. */
export function computeLuckScore(rarity: number, ceiling = DEFAULT_LUCK_CEILING): number {
  if (!(rarity >= 1) || !(ceiling > 1)) return 0;
  const raw = Math.round((100 * Math.log10(rarity)) / Math.log10(ceiling));
  return Math.min(100, Math.max(0, raw));
}

/** "1 in N" wording: one decimal below 10 (1 in 2.5), whole numbers above. */
export function formatOneIn(rarity: number): string {
  if (rarity < 10) {
    const r = Math.round(rarity * 10) / 10;
    return Number.isInteger(r) ? String(r) : r.toFixed(1);
  }
  return Math.round(rarity).toLocaleString("en-US");
}

/** One plain sentence about how often the player's path was taken. */
export function pathSentence(eligiblePlayers: number, samePath: number): string | null {
  const rarity = luckRarity(eligiblePlayers, samePath);
  if (rarity === null) return null;
  if (eligiblePlayers === 1) return "You're the first player counted.";
  if (samePath === eligiblePlayers) return `All ${eligiblePlayers.toLocaleString("en-US")} players took your path.`;
  if (samePath === 1) return `Nobody else took your exact path — 1 in ${formatOneIn(rarity)}.`;
  return `1 in ${formatOneIn(rarity)} players took your path.`;
}

export type LuckView =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "not_counted"; message: string }
  | { kind: "collecting"; eligiblePlayers: number; minPlayers: number; sentence: string | null }
  | { kind: "score"; score: number; eligiblePlayers: number; samePath: number; ceiling: number; sentence: string };

/**
 * What the card and report should say, given the fetch state. `report` is
 * undefined while loading and null when the fetch failed.
 */
export function luckView(report: LuckReport | null | undefined): LuckView {
  if (report === undefined) return { kind: "loading" };
  if (report === null || report.status === "unsupported") return { kind: "unavailable" };
  if (report.status === "no_session") {
    return { kind: "not_counted", message: "Luck Score only counts a saved first attempt." };
  }
  if (report.status === "not_eligible") {
    return {
      kind: "not_counted",
      message:
        report.reason === "admin"
          ? "Admin plays aren't counted in Luck Score."
          : "Lucky Bot couldn't read your full path for this game.",
    };
  }
  const { eligiblePlayers, samePath, ceiling, minPlayers } = report;
  const sentence = pathSentence(eligiblePlayers, samePath);
  const rarity = luckRarity(eligiblePlayers, samePath);
  if (eligiblePlayers < minPlayers || rarity === null || sentence === null) {
    return { kind: "collecting", eligiblePlayers, minPlayers, sentence };
  }
  return {
    kind: "score",
    score: computeLuckScore(rarity, ceiling),
    eligiblePlayers,
    samePath,
    ceiling,
    sentence,
  };
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Parses get_luck_report's JSON; null for anything unrecognised. */
export function parseLuckReport(data: unknown): LuckReport | null {
  if (!data || typeof data !== "object") return null;
  const raw = data as Record<string, unknown>;
  switch (raw.status) {
    case "ok":
      return {
        status: "ok",
        eligiblePlayers: num(raw.eligible_players),
        samePath: num(raw.same_path),
        ceiling: num(raw.ceiling, DEFAULT_LUCK_CEILING),
        minPlayers: num(raw.min_players, DEFAULT_LUCK_MIN_PLAYERS),
      };
    case "no_session":
      return { status: "no_session" };
    case "not_eligible":
      return { status: "not_eligible", reason: raw.reason === "admin" ? "admin" : "incomplete_history" };
    case "unsupported":
      return { status: "unsupported" };
    default:
      return null;
  }
}

/** The caller's own Luck numbers for a Full puzzle, or null on any error. */
export async function fetchLuckReport(puzzleId: string): Promise<LuckReport | null> {
  try {
    const { deviceId, deviceToken } = await getIdentity();
    const { data, error } = await supabase.rpc("get_luck_report", {
      _puzzle_id: puzzleId,
      _device_id: deviceId,
      _device_token: deviceToken ?? undefined,
    });
    if (error) return null;
    return parseLuckReport(data);
  } catch {
    return null;
  }
}
