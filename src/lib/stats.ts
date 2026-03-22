import { GameStats } from "./types";

const STATS_KEY = "connections-stats";
const PLAYED_KEY = "connections-played";

function getDefaultStats(): GameStats {
  return {
    gamesPlayed: 0,
    gamesWon: 0,
    currentStreak: 0,
    maxStreak: 0,
    lastPlayedDate: null,
    guessDistribution: [0, 0, 0, 0, 0],
  };
}

export function loadStats(): GameStats {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return getDefaultStats();
}

export function saveStats(stats: GameStats) {
  localStorage.setItem(STATS_KEY, JSON.stringify(stats));
}

export function hasPlayedToday(puzzleId: string): boolean {
  try {
    const played = JSON.parse(localStorage.getItem(PLAYED_KEY) || "[]");
    return played.includes(puzzleId);
  } catch {
    return false;
  }
}

export function markPlayed(puzzleId: string) {
  try {
    const played = JSON.parse(localStorage.getItem(PLAYED_KEY) || "[]");
    if (!played.includes(puzzleId)) {
      played.push(puzzleId);
      localStorage.setItem(PLAYED_KEY, JSON.stringify(played));
    }
  } catch {}
}

export function recordGameResult(won: boolean, mistakes: number) {
  const stats = loadStats();
  const today = new Date().toISOString().split("T")[0];

  stats.gamesPlayed++;
  if (won) {
    stats.gamesWon++;
    stats.guessDistribution[Math.min(mistakes, 4)]++;

    // Streak logic
    if (stats.lastPlayedDate) {
      const last = new Date(stats.lastPlayedDate);
      const now = new Date(today);
      const diffDays = Math.floor((now.getTime() - last.getTime()) / 86400000);
      if (diffDays === 1) {
        stats.currentStreak++;
      } else if (diffDays > 1) {
        stats.currentStreak = 1;
      }
    } else {
      stats.currentStreak = 1;
    }
    stats.maxStreak = Math.max(stats.maxStreak, stats.currentStreak);
  } else {
    stats.currentStreak = 0;
  }

  stats.lastPlayedDate = today;
  saveStats(stats);
  return stats;
}
