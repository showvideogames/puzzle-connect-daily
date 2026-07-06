import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Puzzle, GameState, GuessAttempt } from "@/lib/types";
import { vibrateSuccess, vibrateError, vibrateCelebration } from "@/lib/haptics";
import confetti from "canvas-confetti";
import { supabase } from "@/integrations/supabase/client";
import { saveGameStats, hasExistingSession } from "@/lib/gameStats";
import { playRainbowSound } from "@/lib/sounds";
import { trackEvent } from "@/lib/analytics";

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface SavedProgress {
  solvedGroups: number[];
  mistakes: number;
  guessHistory: GuessAttempt[];
  gotRainbow: boolean;
  shuffledWords: string[];
  rainbowWords: string[];
  isComplete?: boolean;
  isWon?: boolean;
  finalSolvedGroups?: number[];
  tileColors?: Record<string, string | null>;
  rainbowSolveIndex?: number | null;
}

export function progressKey(puzzleId: string) {
  return `connections-progress-${puzzleId}`;
}

export function hasInProgressGame(puzzleId: string): boolean {
  try {
    return localStorage.getItem(progressKey(puzzleId)) !== null;
  } catch {
    return false;
  }
}

function saveProgress(puzzleId: string, data: SavedProgress) {
  try {
    localStorage.setItem(progressKey(puzzleId), JSON.stringify(data));
  } catch {}
}

function loadProgress(puzzleId: string): SavedProgress | null {
  try {
    const raw = localStorage.getItem(progressKey(puzzleId));
    if (!raw) return null;
    return JSON.parse(raw) as SavedProgress;
  } catch {
    return null;
  }
}

function clearProgress(puzzleId: string) {
  try {
    localStorage.removeItem(progressKey(puzzleId));
  } catch {}
}

const DIFFICULTY_SQUARE: Record<number, string> = {
  1: "🟨",
  2: "🟩",
  3: "🟦",
  4: "🟥",
};

function buildShareGrid(guessHistory: GuessAttempt[], puzzle: Puzzle): string {
  const lines: string[] = [];
  for (const attempt of guessHistory) {
    if (attempt.isHintMarker) {
      const emoji = attempt.hintType === "small" ? "💡" : "🔦";
      const last = lines[lines.length - 1];
      if (last === "💡" || last === "🔦" || last === "💡🔦" || last === "🔦💡") {
        lines[lines.length - 1] = last + emoji;
      } else {
        lines.push(emoji);
      }
    } else if (attempt.isRainbow) {
      lines.push("🌈🌈🌈🌈");
    } else {
      const row = attempt.groupIndices
        .map((gi) => {
          const diff = puzzle.groups[gi]?.difficulty;
          return DIFFICULTY_SQUARE[diff] || "⬜";
        })
        .join("");
      lines.push(row);
    }
  }
  return lines.join("\n");
}

export function useGame(
  puzzle: Puzzle,
  {
    isArchive = false,
    smallHintUsed = false,
    fullHintUsed = false,
  }: { isArchive?: boolean; smallHintUsed?: boolean; fullHintUsed?: boolean } = {}
) {
  const MAX_MISTAKES = 4;
  // Correct guess: how long the tile shake/wiggle plays before GameBoard's
  // fly-up-and-merge overlay takes over (must match .animate-tile-matched's
  // duration in index.css).
  const MATCH_SHAKE_MS = 350;
  // Incorrect guess: shake, then a brief suspense pause, before the mistake
  // count/tooltip/loss cascade actually reveal the result.
  const WRONG_SHAKE_MS = 400;
  const WRONG_REVEAL_PAUSE_MS = 300;

  const allWords = useMemo(
    () => puzzle.groups.flatMap((g) => g.words),
    [puzzle]
  );

  const saved = useMemo(() => {
    return loadProgress(puzzle.id);
  }, [puzzle.id]);

  const [shuffledWords, setShuffledWords] = useState(() => {
    if (saved) return saved.shuffledWords;
    if (puzzle.wordOrder && puzzle.wordOrder.length > 0) {
      const wordSet = new Set(allWords);
      const isValid = puzzle.wordOrder.every(w => wordSet.has(w));
      if (isValid) return puzzle.wordOrder;
    }
    return shuffleArray(allWords);
  });

  const [tileColors, setTileColors] = useState<Record<string, string | null>>(() => {
    return saved?.tileColors ?? {};
  });

  const [state, setState] = useState<GameState>(() => {
    if (saved) {
      const solvedGroups = saved.finalSolvedGroups ?? saved.solvedGroups;
      return {
        puzzleId: puzzle.id,
        solvedGroups,
        mistakes: saved.mistakes,
        maxMistakes: MAX_MISTAKES,
        selectedWords: [],
        isComplete: saved.isComplete ?? false,
        isWon: saved.isWon ?? false,
        guessHistory: saved.guessHistory,
        gotRainbow: saved.gotRainbow,
        rainbowSolveIndex: saved.rainbowSolveIndex ?? null,
      };
    }

    return {
      puzzleId: puzzle.id,
      solvedGroups: [],
      mistakes: 0,
      maxMistakes: MAX_MISTAKES,
      selectedWords: [],
      isComplete: false,
      isWon: false,
      guessHistory: [],
      gotRainbow: false,
      rainbowSolveIndex: null,
    };
  });

  useEffect(() => {
    if (saved) return;
    let cancelled = false;
    hasExistingSession(puzzle.id).then((played) => {
      if (!cancelled && played) {
        setState((s) => ({ ...s, isComplete: true }));
      }
    });
    return () => { cancelled = true; };
  }, [puzzle.id, saved]);

  const [shaking, setShaking] = useState(false);
  const [lastRevealedGroup, setLastRevealedGroup] = useState<number | null>(null);
  const [oneAway, setOneAway] = useState(false);
  const [almostRainbow, setAlmostRainbow] = useState(false);
  const [alreadyGuessed, setAlreadyGuessed] = useState<"plain" | "oneaway" | null>(null);
  const [rainbowWords, setRainbowWords] = useState<string[]>(saved?.rainbowWords ?? []);
  const [showRainbowPopup, setShowRainbowPopup] = useState(false);
  const [matchedWords, setMatchedWords] = useState<string[]>([]);
  const [draggedWord, setDraggedWord] = useState<string | null>(null);

  const activeSecondsRef = useRef<number>(0);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isVisibleRef = useRef<boolean>(true);

  useEffect(() => {
    if (state.isComplete) {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      return;
    }

    const handleVisibilityChange = () => {
      isVisibleRef.current = !document.hidden;
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    timerIntervalRef.current = setInterval(() => {
      if (isVisibleRef.current) {
        activeSecondsRef.current += 1;
      }
    }, 1000);

    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [state.isComplete]);

  // --- Hint marker injection ---
  // Track previous hint-boolean values so we can detect the false→true transition
  // and insert a synthetic marker into guessHistory at the right position.
  const prevSmallHintRef = useRef(smallHintUsed);
  const prevFullHintRef = useRef(fullHintUsed);

  const addHintMarker = useCallback((type: "small" | "full") => {
    setState((s) => ({
      ...s,
      guessHistory: [
        ...s.guessHistory,
        { words: [], groupIndices: [], isCorrect: false, isHintMarker: true, hintType: type },
      ],
    }));
  }, []);

  useEffect(() => {
    if (smallHintUsed && !prevSmallHintRef.current) {
      addHintMarker("small");
    }
    prevSmallHintRef.current = smallHintUsed;
  }, [smallHintUsed, addHintMarker]);

  useEffect(() => {
    if (fullHintUsed && !prevFullHintRef.current) {
      addHintMarker("full");
    }
    prevFullHintRef.current = fullHintUsed;
  }, [fullHintUsed, addHintMarker]);

  useEffect(() => {
    if (oneAway) setOneAway(false);
    if (almostRainbow) setAlmostRainbow(false);
  }, [state.selectedWords]);

  useEffect(() => {
    if (state.solvedGroups.length > 0 || state.mistakes > 0 || state.guessHistory.length > 0) {
      saveProgress(puzzle.id, {
        solvedGroups: state.solvedGroups,
        mistakes: state.mistakes,
        guessHistory: state.guessHistory,
        gotRainbow: state.gotRainbow,
        rainbowSolveIndex: state.rainbowSolveIndex,
        shuffledWords,
        rainbowWords,
        isComplete: state.isComplete,
        isWon: state.isWon,
        tileColors,
      });
    }
  }, [state, shuffledWords, rainbowWords, tileColors, puzzle.id]);

  useEffect(() => {
    const existing = loadProgress(puzzle.id);
    saveProgress(puzzle.id, {
      solvedGroups: state.solvedGroups,
      mistakes: state.mistakes,
      guessHistory: state.guessHistory,
      gotRainbow: state.gotRainbow,
      rainbowSolveIndex: state.rainbowSolveIndex,
      shuffledWords,
      rainbowWords,
      isComplete: state.isComplete,
      isWon: state.isWon,
      tileColors,
      ...(existing?.finalSolvedGroups ? { finalSolvedGroups: existing.finalSolvedGroups } : {}),
    });
  }, [tileColors]);

  const saveResultToDb = useCallback(async (won: boolean, mistakes: number) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { error } = await supabase.from("game_results").upsert({
        user_id: user.id,
        puzzle_id: puzzle.id,
        won,
        mistakes,
      }, { onConflict: "user_id,puzzle_id" });
      if (error) throw error;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error("saveResultToDb error:", err);
      trackEvent("save_stats_failed", { reason });
    }
  }, [puzzle.id]);

  const setTileColor = useCallback((word: string, color: string | null) => {
    setTileColors((prev) => ({ ...prev, [word]: color }));
  }, []);

  // Marks the rainbow as found after the puzzle is already complete (the
  // "Spot the Rainbow?" bonus prompt). Records a guessHistory entry and solve
  // position just like the mid-game find does, so the board and share grid
  // read from the same source of truth regardless of which path found it.
  const markRainbowFound = useCallback((words: string[]) => {
    setRainbowWords(words);
    setState((s) => {
      if (s.gotRainbow) return s;
      const attempt: GuessAttempt = {
        words: [...words],
        groupIndices: [],
        isCorrect: false,
        isRainbow: true,
      };
      return {
        ...s,
        gotRainbow: true,
        rainbowSolveIndex: s.solvedGroups.length,
        guessHistory: [...s.guessHistory, attempt],
      };
    });
  }, []);

  const clearAllColors = useCallback(() => {
    setTileColors({});
  }, []);

  const hasAnyColor = useMemo(() => {
    return Object.values(tileColors).some(Boolean);
  }, [tileColors]);

  const handleDragStart = useCallback((word: string) => {
    setDraggedWord(word);
  }, []);

  const handleDragOver = useCallback((targetWord: string) => {
    if (!draggedWord || draggedWord === targetWord) return;
    setShuffledWords((prev) => {
      const result = [...prev];
      const fromIdx = result.indexOf(draggedWord);
      const toIdx = result.indexOf(targetWord);
      if (fromIdx === -1 || toIdx === -1) return prev;
      result.splice(fromIdx, 1);
      result.splice(toIdx, 0, draggedWord);
      return result;
    });
  }, [draggedWord]);

  const handleDrop = useCallback(() => {
    setDraggedWord(null);
  }, []);

  const handleTouchDragMove = useCallback((x: number, y: number) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return;
    const tileEl = el.closest("[data-word]") as HTMLElement | null;
    if (!tileEl) return;
    const targetWord = tileEl.dataset.word;
    if (!targetWord || !draggedWord || targetWord === draggedWord) return;
    setShuffledWords((prev) => {
      const result = [...prev];
      const fromIdx = result.indexOf(draggedWord);
      const toIdx = result.indexOf(targetWord);
      if (fromIdx === -1 || toIdx === -1) return prev;
      result.splice(fromIdx, 1);
      result.splice(toIdx, 0, draggedWord);
      return result;
    });
  }, [draggedWord]);

  const handleTouchDragEnd = useCallback(() => {
    setDraggedWord(null);
  }, []);

  const toggleWord = useCallback((word: string) => {
    if (state.isComplete) return;
    setState((s) => {
      if (s.selectedWords.includes(word)) {
        return { ...s, selectedWords: s.selectedWords.filter((w) => w !== word) };
      }
      if (s.selectedWords.length >= 4) return s;
      return { ...s, selectedWords: [...s.selectedWords, word] };
    });
  }, [state.isComplete]);

  const deselectAll = useCallback(() => {
    setState((s) => ({ ...s, selectedWords: [] }));
  }, []);

  const shuffle = useCallback(() => {
    setShuffledWords((prev) => shuffleArray(prev));
  }, []);

  const getWordGroupIndex = useCallback((word: string): number => {
    for (let i = 0; i < puzzle.groups.length; i++) {
      if (puzzle.groups[i].words.includes(word)) return i;
    }
    return -1;
  }, [puzzle]);

  const playCelebrationSound = useCallback(() => {
    try {
      const settings = JSON.parse(localStorage.getItem("connections-settings") || "{}");
      if (settings.soundEnabled === false) return;
      const ctx = new AudioContext();
      const notes = [523.25, 659.25, 783.99, 1046.50];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.15, ctx.currentTime + i * 0.15);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.15);
        osc.stop(ctx.currentTime + i * 0.15 + 0.5);
      });
    } catch {}
  }, []);

  const fireConfetti = useCallback(() => {
    const duration = 2000;
    const end = Date.now() + duration;
    const frame = () => {
      confetti({ particleCount: 3, angle: 60, spread: 55, origin: { x: 0, y: 0.7 }, colors: ['#4CAF50', '#FF9800', '#2196F3', '#E91E63'] });
      confetti({ particleCount: 3, angle: 120, spread: 55, origin: { x: 1, y: 0.7 }, colors: ['#4CAF50', '#FF9800', '#2196F3', '#E91E63'] });
      if (Date.now() < end) requestAnimationFrame(frame);
    };
    frame();
    playCelebrationSound();
  }, [playCelebrationSound]);

  const getSolveOrder = useCallback((solvedGroups: number[]): string[] => {
    const colorNames = ["orange", "green", "blue", "red"];
    return solvedGroups.map((groupIdx) => {
      const diff = puzzle.groups[groupIdx]?.difficulty;
      return colorNames[diff - 1] ?? "unknown";
    });
  }, [puzzle]);

  const submitGuess = useCallback(() => {
    if (state.selectedWords.length !== 4 || state.isComplete) return;

    const sortedSelected = [...state.selectedWords].sort();
    const isDuplicate = state.guessHistory.some(
      (g) => !g.isRainbow && g.words.length === 4 && [...g.words].sort().every((w, i) => w === sortedSelected[i])
    );
    if (isDuplicate) {
      const isOneAway = puzzle.groups.some(
        (g, idx) => !state.solvedGroups.includes(idx) && g.words.filter((w) => state.selectedWords.includes(w)).length === 3
      );
      setAlreadyGuessed(isOneAway ? "oneaway" : "plain");
      setTimeout(() => setAlreadyGuessed(null), 2000);
      return;
    }

    const guessGroupIndices = state.selectedWords.map((w) => getWordGroupIndex(w));

    // Rainbow herring detection
    if (puzzle.rainbowHerring && puzzle.rainbowHerring.length === 4 && rainbowWords.length === 0) {
      const selected = [...state.selectedWords].sort();
      const herring = [...puzzle.rainbowHerring].sort();
      if (selected.every((w, i) => w === herring[i])) {
        setMatchedWords([...state.selectedWords]);
        setTimeout(() => {
          setMatchedWords([]);
          setRainbowWords(state.selectedWords);
          setShowRainbowPopup(true);
          playRainbowSound();
          setTimeout(() => setShowRainbowPopup(false), 3000);
          const attempt: GuessAttempt = {
            words: [...state.selectedWords],
            groupIndices: guessGroupIndices,
            isCorrect: false,
            isRainbow: true,
          };
          trackEvent("rainbow_found", { source: "in_game" });
          setState((s) => ({
            ...s,
            selectedWords: [],
            gotRainbow: true,
            rainbowSolveIndex: s.solvedGroups.length,
            guessHistory: [...s.guessHistory, attempt],
          }));
        }, 700);
        return;
      }
    }

    const matchedGroupIndex = puzzle.groups.findIndex(
      (g, idx) => !state.solvedGroups.includes(idx) && g.words.every((w) => state.selectedWords.includes(w))
    );

    if (matchedGroupIndex !== -1) {
      const groupIdx = matchedGroupIndex;
      const solvedWords = puzzle.groups[groupIdx].words;
      const attempt: GuessAttempt = {
        words: [...state.selectedWords],
        groupIndices: guessGroupIndices,
        isCorrect: true,
      };

      setMatchedWords(solvedWords);
      vibrateSuccess();
      setState((s) => ({ ...s, selectedWords: [], guessHistory: [...s.guessHistory, attempt] }));

      setTimeout(() => {
        setMatchedWords([]);
        setLastRevealedGroup(groupIdx);
        trackEvent("category_solved", { difficulty: puzzle.groups[groupIdx].difficulty });
        setShuffledWords((prev) => prev.filter((w) => !solvedWords.includes(w)));

        const newSolved = [...state.solvedGroups, groupIdx];
        const isWon = newSolved.length === 4;

        setState((s) => ({
          ...s,
          solvedGroups: newSolved,
          selectedWords: [],
          isComplete: isWon || s.mistakes >= MAX_MISTAKES,
          isWon,
        }));

        if (isWon) {
          fireConfetti();
          vibrateCelebration();

          const fullGuessHistory = [...state.guessHistory, attempt];
          const shareGrid = buildShareGrid(fullGuessHistory, puzzle);

          const winStatsParams = {
            puzzleId: puzzle.id,
            won: true,
            mistakes: state.mistakes,
            activeTimeSeconds: activeSecondsRef.current,
            foundRainbow: state.gotRainbow,
            solveOrder: getSolveOrder(newSolved),
            hintsUsed: smallHintUsed || fullHintUsed,
            shareGrid,
            guessHistory: fullGuessHistory.filter((g) => !g.isHintMarker).map((g) => ({
              words: g.words,
              correct: g.isCorrect,
              group_name: g.isCorrect ? (["orange","green","blue","red"][puzzle.groups[g.groupIndices?.[0]]?.difficulty - 1] ?? null) : null,
            })),
          };

          if (isArchive) {
            void (async () => {
              if (await hasExistingSession(puzzle.id)) return;
              saveResultToDb(true, state.mistakes);
              saveGameStats({ ...winStatsParams, skipStreak: true });
            })();
          } else {
            saveResultToDb(true, state.mistakes);
            saveGameStats(winStatsParams);
          }

          const allGroupIndices = puzzle.groups.map((_, i) => i);
          saveProgress(puzzle.id, {
            solvedGroups: newSolved,
            finalSolvedGroups: allGroupIndices,
            mistakes: state.mistakes,
            guessHistory: fullGuessHistory,
            gotRainbow: state.gotRainbow,
            rainbowSolveIndex: state.rainbowSolveIndex,
            shuffledWords: [],
            rainbowWords,
            isComplete: true,
            isWon: true,
            tileColors,
          });
        }
      }, MATCH_SHAKE_MS);

      return;
    } else {
      const rainbowHerring = puzzle.rainbowHerring ?? [];
      const rainbowHits = state.selectedWords.filter((w) => rainbowHerring.includes(w)).length;
      const isAlmostRainbow =
        rainbowHerring.length === 4 &&
        rainbowWords.length === 0 &&
        rainbowHits === 3;

      const isOneAway = puzzle.groups.some(
        (g, idx) => !state.solvedGroups.includes(idx) && g.words.filter((w) => state.selectedWords.includes(w)).length === 3
      );

      const attempt: GuessAttempt = {
        words: [...state.selectedWords],
        groupIndices: guessGroupIndices,
        isCorrect: false,
        isOneAway: isOneAway && !isAlmostRainbow,
        isAlmostRainbow,
      };

      setShaking(true);
      vibrateError();

      setTimeout(() => {
        setShaking(false);

        // Brief pause after the shake before revealing whether it was right
        // or wrong — a suspense beat, instead of the mistake count/tooltip
        // updating the instant the shake starts.
        setTimeout(() => {
          if (isAlmostRainbow) setAlmostRainbow(true);
          else if (isOneAway) setOneAway(true);

          const newMistakes = state.mistakes + 1;
          const isLost = newMistakes >= MAX_MISTAKES;

          setState((s) => ({
            ...s,
            mistakes: newMistakes,
            isComplete: isLost,
            isWon: false,
            guessHistory: [...s.guessHistory, attempt],
          }));

          if (isLost) {
            const fullGuessHistory = [...state.guessHistory, attempt];
            const shareGrid = buildShareGrid(fullGuessHistory, puzzle);

            const lossStatsParams = {
              puzzleId: puzzle.id,
              won: false,
              mistakes: newMistakes,
              activeTimeSeconds: activeSecondsRef.current,
              foundRainbow: state.gotRainbow,
              solveOrder: getSolveOrder(state.solvedGroups),
              hintsUsed: smallHintUsed || fullHintUsed,
              shareGrid,
              guessHistory: fullGuessHistory.filter((g) => !g.isHintMarker).map((g) => ({
                words: g.words,
                correct: g.isCorrect,
                group_name: g.isCorrect ? (["orange","green","blue","red"][puzzle.groups[g.groupIndices?.[0]]?.difficulty - 1] ?? null) : null,
              })),
            };

            if (isArchive) {
              void (async () => {
                if (await hasExistingSession(puzzle.id)) return;
                saveResultToDb(false, newMistakes);
                saveGameStats({ ...lossStatsParams, skipStreak: true });
              })();
            } else {
              saveResultToDb(false, newMistakes);
              saveGameStats(lossStatsParams);
            }

            const sortedIndices = puzzle.groups
              .map((g, i) => ({ idx: i, diff: g.difficulty }))
              .sort((a, b) => a.diff - b.diff)
              .map((item) => item.idx);

            const unsolvedIndices = sortedIndices.filter((idx) => !state.solvedGroups.includes(idx));
            const finalSolvedGroups = [...state.solvedGroups, ...unsolvedIndices];

            unsolvedIndices.forEach((groupIdx, i) => {
              setTimeout(() => {
                const solvedWords = puzzle.groups[groupIdx].words;
                setLastRevealedGroup(groupIdx);
                setShuffledWords((prev) => prev.filter((w) => !solvedWords.includes(w)));
                setState((s) => ({ ...s, solvedGroups: [...s.solvedGroups, groupIdx] }));

                if (i === unsolvedIndices.length - 1) {
                  saveProgress(puzzle.id, {
                    solvedGroups: finalSolvedGroups,
                    finalSolvedGroups,
                    mistakes: newMistakes,
                    guessHistory: fullGuessHistory,
                    gotRainbow: state.gotRainbow,
                    rainbowSolveIndex: state.rainbowSolveIndex,
                    shuffledWords: [],
                    rainbowWords,
                    isComplete: true,
                    isWon: false,
                    tileColors,
                  });
                }
              }, 800 + i * 1500);
            });
          }
        }, WRONG_REVEAL_PAUSE_MS);
      }, WRONG_SHAKE_MS);
    }
  }, [state, puzzle, saveResultToDb, rainbowWords, getWordGroupIndex, fireConfetti, tileColors, smallHintUsed, fullHintUsed]);

  const remainingWords = useMemo(() => {
    const solvedWords = state.solvedGroups.flatMap((i) => puzzle.groups[i].words);
    return shuffledWords.filter((w) => !solvedWords.includes(w));
  }, [shuffledWords, state.solvedGroups, puzzle]);

  return {
    state,
    remainingWords,
    toggleWord,
    deselectAll,
    shuffle,
    submitGuess,
    shaking,
    lastRevealedGroup,
    oneAway,
    setOneAway,
    almostRainbow,
    setAlmostRainbow,
    rainbowWords,
    showRainbowPopup,
    matchedWords,
    tileColors,
    setTileColor,
    clearAllColors,
    hasAnyColor,
    markRainbowFound,
    handleDragStart,
    handleDragOver,
    handleDrop,
    handleTouchDragMove,
    handleTouchDragEnd,
    alreadyGuessed,
  };
}
