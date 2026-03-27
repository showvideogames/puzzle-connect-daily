import { useState, useCallback, useMemo, useEffect } from "react";
import { Puzzle, GameState, GuessAttempt } from "@/lib/types";
import { hasPlayedToday, markPlayed, recordGameResult } from "@/lib/stats";
import confetti from "canvas-confetti";
import { supabase } from "@/integrations/supabase/client";

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function useGame(puzzle: Puzzle) {
  const MAX_MISTAKES = 4;

  const allWords = useMemo(
    () => puzzle.groups.flatMap((g) => g.words),
    [puzzle]
  );

  const [shuffledWords, setShuffledWords] = useState(() =>
    puzzle.wordOrder && puzzle.wordOrder.length === 16 ? puzzle.wordOrder : shuffleArray(allWords)
  );
  const [state, setState] = useState<GameState>(() => ({
    puzzleId: puzzle.id,
    solvedGroups: [],
    mistakes: 0,
    maxMistakes: MAX_MISTAKES,
    selectedWords: [],
    isComplete: hasPlayedToday(puzzle.id),
    isWon: false,
    guessHistory: [],
    gotRainbow: false,
  }));
  const [shaking, setShaking] = useState(false);
  const [lastRevealedGroup, setLastRevealedGroup] = useState<number | null>(null);
  const [oneAway, setOneAway] = useState(false);
  const [rainbowWords, setRainbowWords] = useState<string[]>([]);
  const [showRainbowPopup, setShowRainbowPopup] = useState(false);
  const [matchedWords, setMatchedWords] = useState<string[]>([]);

  const saveResultToDb = useCallback(async (won: boolean, mistakes: number) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("game_results").upsert({
      user_id: user.id,
      puzzle_id: puzzle.id,
      won,
      mistakes,
    }, { onConflict: "user_id,puzzle_id" });
  }, [puzzle.id]);

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
      confetti({
        particleCount: 3,
        angle: 60,
        spread: 55,
        origin: { x: 0, y: 0.7 },
        colors: ['#4CAF50', '#FF9800', '#2196F3', '#E91E63'],
      });
      confetti({
        particleCount: 3,
        angle: 120,
        spread: 55,
        origin: { x: 1, y: 0.7 },
        colors: ['#4CAF50', '#FF9800', '#2196F3', '#E91E63'],
      });
      if (Date.now() < end) requestAnimationFrame(frame);
    };
    frame();
    playCelebrationSound();
  }, [playCelebrationSound]);

  const submitGuess = useCallback(() => {
    if (state.selectedWords.length !== 4 || state.isComplete) return;

    const guessGroupIndices = state.selectedWords.map((w) => getWordGroupIndex(w));

    // Check for Rainbow Herring before normal logic
    if (
      puzzle.rainbowHerring &&
      puzzle.rainbowHerring.length === 4 &&
      rainbowWords.length === 0 // only trigger once
    ) {
      const selected = [...state.selectedWords].sort();
      const herring = [...puzzle.rainbowHerring].sort();
      if (selected.every((w, i) => w === herring[i])) {
        setRainbowWords(state.selectedWords);
        setShowRainbowPopup(true);
        setTimeout(() => setShowRainbowPopup(false), 3000);
        const attempt: GuessAttempt = {
          words: [...state.selectedWords],
          groupIndices: guessGroupIndices,
          isCorrect: false,
          isRainbow: true,
        };
        setState((s) => ({ ...s, selectedWords: [], gotRainbow: true, guessHistory: [...s.guessHistory, attempt] }));
        return;
      }
    }

    const matchedGroupIndex = puzzle.groups.findIndex(
      (g) =>
        !state.solvedGroups.includes(puzzle.groups.indexOf(g)) &&
        g.words.every((w) => state.selectedWords.includes(w))
    );

    if (matchedGroupIndex !== -1) {
      const groupIdx = matchedGroupIndex;
      const solvedWords = puzzle.groups[groupIdx].words;
      const attempt: GuessAttempt = {
        words: [...state.selectedWords],
        groupIndices: guessGroupIndices,
        isCorrect: true,
      };

      // Phase 1: Mark matched words (wiggle animation)
      setMatchedWords(solvedWords);
      setState((s) => ({ ...s, selectedWords: [], guessHistory: [...s.guessHistory, attempt] }));

      // Phase 2: After wiggle, collapse and reveal solved group
      setTimeout(() => {
        setMatchedWords([]);
        setLastRevealedGroup(groupIdx);
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
          markPlayed(puzzle.id);
          recordGameResult(true, state.mistakes);
          saveResultToDb(true, state.mistakes);
          fireConfetti();
        }
      }, 700);

      return;
    } else {
      const attempt: GuessAttempt = {
        words: [...state.selectedWords],
        groupIndices: guessGroupIndices,
        isCorrect: false,
      };

      // Check for "one away" — 3 of 4 words match a single unsolved group
      const isOneAway = puzzle.groups.some(
        (g, idx) =>
          !state.solvedGroups.includes(idx) &&
          g.words.filter((w) => state.selectedWords.includes(w)).length === 3
      );

      setShaking(true);
      setTimeout(() => setShaking(false), 400);

      if (isOneAway) {
        setOneAway(true);
        setTimeout(() => setOneAway(false), 2000);
      }

      const newMistakes = state.mistakes + 1;
      const isLost = newMistakes >= MAX_MISTAKES;

      setState((s) => ({
        ...s,
        mistakes: newMistakes,
        selectedWords: [],
        isComplete: isLost,
        isWon: false,
        guessHistory: [...s.guessHistory, attempt],
      }));

      if (isLost) {
        markPlayed(puzzle.id);
        recordGameResult(false, newMistakes);
        saveResultToDb(false, newMistakes);
        setTimeout(() => {
          setState((s) => ({
            ...s,
            solvedGroups: [0, 1, 2, 3],
          }));
          setShuffledWords([]);
        }, 600);
      }
    }
  }, [state, puzzle, saveResultToDb, rainbowWords, getWordGroupIndex, fireConfetti]);

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
    rainbowWords,
    showRainbowPopup,
    matchedWords,
  };
}
