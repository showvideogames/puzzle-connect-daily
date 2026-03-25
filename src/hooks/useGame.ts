import { useState, useCallback, useMemo } from "react";
import { Puzzle, GameState } from "@/lib/types";
import { hasPlayedToday, markPlayed, recordGameResult } from "@/lib/stats";
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

  const submitGuess = useCallback(() => {
    if (state.selectedWords.length !== 4 || state.isComplete) return;

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
        setState((s) => ({ ...s, selectedWords: [] }));
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
      setLastRevealedGroup(groupIdx);

      const newSolved = [...state.solvedGroups, groupIdx];
      const isWon = newSolved.length === 4;

      const solvedWords = puzzle.groups[groupIdx].words;
      setShuffledWords((prev) => prev.filter((w) => !solvedWords.includes(w)));

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
      }
    } else {
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
  }, [state, puzzle, saveResultToDb]);

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
  };
}
