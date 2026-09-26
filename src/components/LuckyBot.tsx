/**
 * Lucky Bot — the post-game report card and its full-report modal.
 *
 * The card sits under the Share row on the result screen and answers the
 * question players actually have after finishing: "how well did I do, and
 * did everyone else fall for that too?" It shows the player's skill score
 * (computed locally, see lib/skillScore.ts) and where that score sits among
 * everyone who finished the same puzzle (from public.get_puzzle_report).
 * "Full report" opens the breakdown: score lines, the most common wrong
 * guesses with which categories they came from, where players started,
 * and how the Rainbow went.
 *
 * Only rendered for an official daily puzzle. Beta and custom puzzles have
 * no official sessions to compare against, exactly like Global Stats.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { GameState, Puzzle } from "@/lib/types";
import {
  DIFFICULTY_COLOR_NAME,
  SOLVE_ORDER_NAME,
  formatOf,
  type Difficulty,
} from "@/lib/puzzleFormat";
import { skillScoreForGame, MAX_SKILL_SCORE } from "@/lib/skillScore";
import {
  fetchPuzzleReport,
  scoreStanding,
  wrongGuessSentence,
  categoryForSolveKey,
  type PuzzleReport,
} from "@/lib/puzzleReport";
import { trackEvent } from "@/lib/analytics";

interface LuckyBotProps {
  puzzle: Puzzle;
  state: GameState;
}

const SWATCH: Record<Difficulty, string> = {
  1: "bg-group-1",
  2: "bg-group-2",
  3: "bg-group-3",
  4: "bg-group-4",
};

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function LuckyBot({ puzzle, state }: LuckyBotProps) {
  const [report, setReport] = useState<PuzzleReport | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);

  const { score, lines } = skillScoreForGame(state, puzzle);

  // Fetch once per completed puzzle. The report counts finished sessions,
  // and this player's own finalize write races the mount, so a short
  // delay lets it land before the first read; a second read on opening the
  // modal picks up anything that arrived in between.
  useEffect(() => {
    if (!state.isComplete) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      fetchPuzzleReport(puzzle.id).then((r) => {
        if (cancelled) return;
        setReport(r);
        setLoaded(true);
      });
    }, 1200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [puzzle.id, state.isComplete]);

  useEffect(() => {
    if (!open) return;
    fetchPuzzleReport(puzzle.id).then((r) => {
      if (r) setReport(r);
    });
  }, [open, puzzle.id]);

  if (!state.isComplete) return null;

  const standing = report ? scoreStanding(report.score_counts, score) : null;

  // These "no comparison" cases are worded apart on purpose. A missing
  // report (the RPC errored, or is not deployed yet — fetchPuzzleReport
  // returns null on any error rather than throwing) says nothing about who
  // else has played; claiming "you're first" there would often just be
  // wrong. Only a report that loaded fine and genuinely counted zero other
  // finished sessions earns that claim.
  let standingLine: string;
  if (!loaded) standingLine = "Comparing with today's players…";
  else if (!report) standingLine = "Comparison isn't available right now.";
  else if (!standing || standing.others === 0) standingLine = "No comparison yet — check back once others have played.";
  else if (standing.betterThanPct === null) standingLine = `${standing.others + 1} players so far.`;
  else standingLine = `Better than ${standing.betterThanPct}% of ${standing.others} other player${standing.others === 1 ? "" : "s"}`;

  return (
    <>
      <div
        data-testid="lucky-bot-card"
        className="mx-auto max-w-sm rounded-xl border border-border bg-card px-4 py-3 text-left shadow-sm"
      >
        <div className="flex items-center gap-3">
          {/* Container grew from 40px to 48px alongside the 32px→40px icon
              bump below, so the ring of background around Lucky Bot's face
              stays the same 4px on every side rather than shrinking to
              nothing as the icon got bigger. public/lucky-bot.png is a
              pre-cropped, pre-compressed 160x160 transparent PNG (see the
              crop/optimize notes in git history for this file); never swap
              it for a larger source image without re-cropping and
              re-compressing the same way, or this becomes another entry in
              the oversized-image findings from the performance audit. */}
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-secondary">
            <img src="/lucky-bot.png" alt="" aria-hidden="true" className="h-10 w-10 object-contain" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Lucky Bot</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold tabular-nums" data-testid="skill-score">{score}</span>
              <span className="text-xs text-muted-foreground">/ {MAX_SKILL_SCORE} skill score</span>
            </div>
            <p className="text-xs text-muted-foreground" data-testid="skill-standing">{standingLine}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(true);
              trackEvent("bot_report_opened", { puzzle_id: puzzle.id });
            }}
            className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:bg-secondary transition-colors active:scale-95"
          >
            Full report
          </button>
        </div>
      </div>

      {open && (
        <ReportModal
          puzzle={puzzle}
          score={score}
          lines={lines}
          report={report}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

interface ReportModalProps {
  puzzle: Puzzle;
  score: number;
  lines: { label: string; points: number }[];
  report: PuzzleReport | null;
  onClose: () => void;
}

function ReportModal({ puzzle, score, lines, report, onClose }: ReportModalProps) {
  const format = formatOf(puzzle);
  const players = report?.total_players ?? 0;
  const standing = report ? scoreStanding(report.score_counts, score) : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-foreground/20 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="lucky-bot-title"
        className="relative bg-card rounded-xl shadow-2xl p-6 w-full max-w-md mx-4 max-h-[85vh] overflow-y-auto animate-pop"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close report"
          className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-secondary transition-colors active:scale-95"
        >
          <X className="w-4 h-4" />
        </button>

        <h2 id="lucky-bot-title" className="text-lg font-bold text-center mb-1 flex items-center justify-center gap-2">
          <img src="/lucky-bot.png" alt="" aria-hidden="true" className="w-[30px] h-[30px] object-contain" /> Lucky Bot
        </h2>
        <p className="text-center text-xs text-muted-foreground mb-5">
          {!report
            ? "Comparison isn't available right now."
            : players === 0
              ? "No one else has finished this puzzle yet."
              : `${players} player${players === 1 ? "" : "s"} finished this puzzle so far.`}
        </p>

        {/* Your score */}
        <section className="mb-5">
          <div className="flex items-baseline justify-center gap-1 mb-2">
            <span className="text-4xl font-bold tabular-nums">{score}</span>
            <span className="text-sm text-muted-foreground">/ {MAX_SKILL_SCORE}</span>
          </div>
          <ul className="space-y-1 text-sm">
            {lines.map((l, i) => (
              <li key={i} className="flex items-center justify-between rounded-md bg-secondary/50 px-3 py-1.5">
                <span>{l.label}</span>
                <span className="font-semibold tabular-nums">{l.points > 0 && i > 0 ? "+" : ""}{l.points}</span>
              </li>
            ))}
          </ul>
          {standing && standing.others > 0 && (
            <p className="mt-2 text-center text-xs text-muted-foreground">
              {standing.betterThanPct !== null && `Better than ${standing.betterThanPct}% of other players. `}
              {standing.average !== null && `Average score today: ${standing.average}.`}
            </p>
          )}
        </section>

        {report && players > 0 && (
          <>
            {/* Most common wrong guesses */}
            <section className="mb-5">
              <h3 className="text-sm font-semibold mb-2">Most common wrong guess{report.common_wrong_guesses.length === 1 ? "" : "es"}</h3>
              {report.common_wrong_guesses.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nobody has made a wrong guess yet. {pct(report.perfect, players)}% of players were perfect.
                </p>
              ) : (
                <ul className="space-y-2" data-testid="wrong-guess-list">
                  {report.common_wrong_guesses.map((g, i) => (
                    <li key={i} className="rounded-lg border border-border p-3">
                      <div className="flex flex-wrap gap-1 mb-1.5">
                        {g.words.map((w) => (
                          <span key={w} className="rounded-md bg-secondary px-2 py-0.5 text-xs font-semibold">{w}</span>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">{wrongGuessSentence(g, puzzle)}</p>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                {pct(report.players_with_wrong_guess, players)}% of players made at least one wrong guess.
                {" "}{pct(report.perfect, players)}% were perfect.
              </p>
            </section>

            {/* Where players started */}
            <section className="mb-5">
              <h3 className="text-sm font-semibold mb-2">First category solved</h3>
              <div className="space-y-1.5">
                {format.difficultyOrder.map((d) => {
                  const key = SOLVE_ORDER_NAME[d];
                  const n = report.first_solved[key] ?? 0;
                  const group = categoryForSolveKey(key, puzzle);
                  const width = pct(n, players);
                  return (
                    <div key={d} className="flex items-center gap-2 text-xs">
                      <span className={`h-3 w-3 shrink-0 rounded-sm ${SWATCH[d]}`} aria-hidden="true" />
                      <span className="w-28 truncate" title={group?.category ?? capitalise(DIFFICULTY_COLOR_NAME[d])}>
                        {group?.category ?? capitalise(DIFFICULTY_COLOR_NAME[d])}
                      </span>
                      <div className="flex-1 h-4 bg-secondary rounded overflow-hidden">
                        <div className={`h-full ${SWATCH[d]}`} style={{ width: `${width}%` }} />
                      </div>
                      <span className="w-10 text-right tabular-nums text-muted-foreground">{width}%</span>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* The Rainbow */}
            {puzzle.rainbowHerring && puzzle.rainbowHerring.length > 0 && (
              <section>
                <h3 className="text-sm font-semibold mb-2">The Rainbow 🌈</h3>
                <p className="text-sm text-muted-foreground">
                  {pct(report.rainbow_in_game, players)}% spotted it mid-game
                  {report.rainbow_post_game > 0 && <>, and another {pct(report.rainbow_post_game, players)}% found it afterwards</>}.
                </p>
              </section>
            )}
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
