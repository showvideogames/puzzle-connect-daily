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
  is_rainbow_attempt?: boolean;
  // Real submission time captured client-side at guess time (see
  // GuessAttempt.guessedAt in types.ts). null on guessHistory entries saved
  // before this field existed — saveGameStats below falls back to the save
  // time for those, which is NOT historically accurate; see its comment.
  guessed_at?: string | null;
}

interface SaveGameStatsParams {
  puzzleId: string;
  won: boolean;
  mistakes: number;
  activeTimeSeconds: number;
  foundRainbow: boolean;
  // How many categories were already solved when the Rainbow was found
  // (0-4), or null if it wasn't found this game — see the doc comment on
  // game_sessions.rainbow_solve_index in the migration file. Never
  // recalculated here; passed straight through from useGame.ts's
  // authoritative GameState.rainbowSolveIndex.
  rainbowSolveIndex: number | null;
  solveOrder: string[];
  guessHistory: GuessEvent[];
  skipStreak?: boolean;
  hintsUsed?: boolean;
  shareGrid?: string;
}

// Flips found_rainbow to true on an already-saved session — used when the
// rainbow is spotted via the post-completion bonus prompt, after
// saveGameStats already inserted the row with found_rainbow: false.
export async function markRainbowFoundInSession(puzzleId: string): Promise<void> {
  try {
    const deviceId = getDeviceId();
    const { data: { user } } = await supabase.auth.getUser();
    const userId = user?.id ?? null;
    const query = userId
      ? supabase.from("game_sessions").update({ found_rainbow: true }).eq("puzzle_id", puzzleId).or(`user_id.eq.${userId},device_id.eq.${deviceId}`)
      : supabase.from("game_sessions").update({ found_rainbow: true }).eq("puzzle_id", puzzleId).eq("device_id", deviceId);
    const { error } = await query;
    if (error) console.error("Failed to mark rainbow found:", error);

    // Best-effort, isolated from the update above: the bonus "Spot the
    // Rainbow" prompt only ever appears after all 4 categories are solved,
    // so a find via this path is always at position 4 — not recalculated,
    // just the one value this path can ever produce. Kept as a separate
    // call so a not-yet-migrated database (missing rainbow_solve_index)
    // can never affect the found_rainbow flip above.
    const rsiQuery = userId
      ? supabase.from("game_sessions").update({ rainbow_solve_index: 4 }).eq("puzzle_id", puzzleId).or(`user_id.eq.${userId},device_id.eq.${deviceId}`)
      : supabase.from("game_sessions").update({ rainbow_solve_index: 4 }).eq("puzzle_id", puzzleId).eq("device_id", deviceId);
    const { error: rsiError } = await rsiQuery;
    if (rsiError) console.error("Failed to record rainbow_solve_index (has the migration been applied?):", rsiError);
  } catch (err) {
    console.error("markRainbowFoundInSession error:", err);
  }
}

// Records one Rainbow-attempt guess event for the post-completion "Spot the
// Rainbow" bonus modal — success or failure — since that flow happens after
// saveGameStats' one-time guessHistory bulk insert already ran, so it has no
// other way to reach guess_events. Looks up the already-saved session the
// same way markRainbowFoundInSession does.
// guessedAt should be the real submission time captured by the caller at the
// moment the bonus modal was actually submitted (see GameBoard's
// handleSpotResult). The default here only covers a caller that omits it —
// it evaluates at call time, not historically accurate for that case.
export async function recordRainbowAttempt(
  puzzleId: string,
  words: string[],
  correct: boolean,
  guessedAt: string = new Date().toISOString()
): Promise<void> {
  try {
    const deviceId = getDeviceId();
    const { data: { user } } = await supabase.auth.getUser();
    const userId = user?.id ?? null;
    const sessionQuery = userId
      ? supabase.from("game_sessions").select("id").eq("puzzle_id", puzzleId).or(`user_id.eq.${userId},device_id.eq.${deviceId}`).limit(1).maybeSingle()
      : supabase.from("game_sessions").select("id").eq("puzzle_id", puzzleId).eq("device_id", deviceId).limit(1).maybeSingle();
    const { data: session } = await sessionQuery;
    if (!session) return;

    const { count } = await supabase
      .from("guess_events")
      .select("id", { count: "exact", head: true })
      .eq("game_session_id", session.id);

    const { error } = await supabase.from("guess_events").insert({
      game_session_id: session.id,
      guess_number: (count ?? 0) + 1,
      words,
      correct,
      group_name: null,
      is_rainbow_attempt: true,
      guessed_at: guessedAt,
    });
    if (error) console.error("Failed to record rainbow attempt (has the migration been applied?):", error);
  } catch (err) {
    console.error("recordRainbowAttempt error:", err);
  }
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
    rainbowSolveIndex,
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

    // 1.5. Best-effort, isolated from the insert above: record Rainbow solve
    // position. Deliberately NOT part of the main insert payload — that way
    // a database that hasn't run the rainbow_solve_index migration yet still
    // saves every game session normally, just without this one extra field.
    if (rainbowSolveIndex !== null) {
      const { error: rsiError } = await supabase
        .from("game_sessions")
        .update({ rainbow_solve_index: rainbowSolveIndex })
        .eq("id", session.id);
      if (rsiError) console.error("Failed to record rainbow_solve_index (has the migration been applied?):", rsiError);
    }

    // 2. Save individual guess events
    if (guessHistory.length > 0) {
      // Legacy fallback: guess.guessed_at is only absent for guessHistory
      // entries carried over in localStorage from before GuessAttempt had a
      // guessedAt field (a game already in progress at deploy time). There is
      // no reliable way to recover their real submission time, so they fall
      // back to this save-time timestamp — the same "now" the DB default
      // used to produce for every row, just explicit and scoped to only the
      // rows that actually lack one. This is NOT historically accurate for
      // those rows; it is a defensive fallback, not a reconstruction.
      const fallbackGuessedAt = new Date().toISOString();
      const guessRows = guessHistory.map((guess, index) => ({
        game_session_id: session.id,
        guess_number: index + 1,
        words: guess.words,
        correct: guess.correct,
        group_name: guess.group_name,
        is_rainbow_attempt: guess.is_rainbow_attempt ?? false,
        guessed_at: guess.guessed_at ?? fallbackGuessedAt,
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
      await updateStreak(userId, deviceId, won);
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
    perfectGamesCount: 0,
    noHintsUsedCount: 0,
    inOrderCount: 0,
    reverseRainbowCount: 0,
    averageMistakes: 0,
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
      ? supabase.from("game_sessions").select("puzzle_id, won, mistakes, found_rainbow, solve_order, hints_used, rainbow_solve_index").or(`user_id.eq.${userId},device_id.eq.${deviceId}`)
      : supabase.from("game_sessions").select("puzzle_id, won, mistakes, found_rainbow, solve_order, hints_used, rainbow_solve_index").eq("device_id", deviceId);
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

    // Ascending/descending-difficulty solve order ("Yellow -> Green -> Blue
    // -> Red" and its reverse, in player-facing terms). getSolveOrder()
    // (useGame.ts) names difficulty-1 "orange" internally — an existing
    // naming quirk, not something this file invents — so these are the
    // literal arrays it writes when the 4 categories are solved in order.
    const ASCENDING_ORDER = ["orange", "green", "blue", "red"];
    const DESCENDING_ORDER = ["red", "blue", "green", "orange"];

    const arraysEqual = (a: unknown, b: string[]): boolean =>
      Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);

    const guessDistribution: number[] = [0, 0, 0, 0, 0];
    let gamesWon = 0;
    let rainbowEligible = 0;
    let rainbowFound = 0;
    let hardestFirstCount = 0;
    let perfectGamesCount = 0;
    let noHintsUsedCount = 0;
    let inOrderCount = 0;
    let reverseRainbowCount = 0;
    let totalMistakes = 0;
    // Denominator for Average Mistakes — counts only rows that actually
    // contributed to totalMistakes below, NOT rows.length. A row with a
    // null/undefined/non-integer/out-of-range mistakes value means
    // "unknown," not "zero mistakes," so it must be excluded from both the
    // numerator and this denominator rather than silently averaged in as a
    // 0 (the previous `?? 0` behavior did exactly that, understating the
    // average). This has no effect on Played — gamesPlayed below still
    // counts every row in `rows` regardless of its mistakes value.
    let mistakesKnownCount = 0;
    for (const r of rows) {
      if (Number.isInteger(r.mistakes) && (r.mistakes as number) >= 0 && (r.mistakes as number) <= 4) {
        totalMistakes += r.mistakes as number;
        mistakesKnownCount++;
      }
      const isRainbowEligible = !!r.puzzle_id && rainbowPuzzleIds.has(r.puzzle_id);

      // Mistake Distribution: every completed official session (win OR
      // formal loss — game_sessions rows only ever exist for one of those
      // two outcomes; there is no "abandoned" row today), bucketed by its
      // own mistake count. A formal loss always has mistakes === 4 (the
      // game ends the instant the 4th mistake is made — see MAX_MISTAKES in
      // useGame.ts), so this is what actually lets bucket 4 populate.
      // Previously this increment lived inside the `if (r.won)` block below,
      // which made bucket 4 structurally impossible: a win can never reach
      // 4 mistakes (that's a loss), so every loss — the only rows that ever
      // have mistakes === 4 — was silently excluded from the distribution
      // entirely.
      //
      // A row with a null/undefined/non-integer/out-of-range mistakes value
      // is deliberately EXCLUDED from the distribution rather than folded
      // into bucket 0 — unknown is not the same fact as zero, and treating
      // it as zero would misrepresent a genuine "no mistakes" game. This
      // row is still counted everywhere else (Played, totalMistakes for
      // Average Mistakes, etc. below) exactly as before; only this one
      // bucketing decision excludes it.
      if (Number.isInteger(r.mistakes) && (r.mistakes as number) >= 0 && (r.mistakes as number) <= 4) {
        guessDistribution[r.mistakes as number]++;
      }

      if (r.won) {
        gamesWon++;
        if ((r.mistakes ?? 0) === 0) perfectGamesCount++;
        if (r.hints_used === false) noHintsUsedCount++;

        // "In Order" / "Reverse Rainbow" — see the doc comments on
        // GameStats.inOrderCount/reverseRainbowCount in types.ts.
        // rainbow_solve_index is only ever 0 or 4 here to count as "at one
        // end"; null (unknown/historical) or 1-3 (found in the middle)
        // never qualify — never guessed at, never treated as a known miss.
        const rsi = (r as { rainbow_solve_index?: number | null }).rainbow_solve_index ?? null;
        const rainbowAtEnd = rsi === 0 || rsi === 4;
        if (isRainbowEligible) {
          if (arraysEqual(r.solve_order, ASCENDING_ORDER) && rainbowAtEnd) inOrderCount++;
          if (arraysEqual(r.solve_order, DESCENDING_ORDER) && rainbowAtEnd) reverseRainbowCount++;
        } else if (arraysEqual(r.solve_order, ASCENDING_ORDER)) {
          inOrderCount++;
        }
      }
      if (isRainbowEligible) {
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
      perfectGamesCount,
      noHintsUsedCount,
      inOrderCount,
      reverseRainbowCount,
      averageMistakes: mistakesKnownCount > 0 ? totalMistakes / mistakesKnownCount : 0,
    };
  } catch (err) {
    console.error("loadStatsFromSupabase error:", err);
    return empty;
  }
}

async function updateStreak(userId: string | null, deviceId: string, won: boolean): Promise<void> {
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

    if (lastPlayed === today) return;
    const newStreak = won
      ? (lastPlayed === yesterdayStr ? existing.current_streak + 1 : 1)
      : 0;

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
