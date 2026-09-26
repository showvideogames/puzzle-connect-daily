/**
 * Lucky Bot — the post-game report card and its full-report modal.
 *
 * The card sits under the Share row on the result screen and answers the
 * question players actually have after finishing: "how well did I do, and
 * did everyone else fall for that too?"
 *
 * FULL game: two scores, Skill above Luck, kept clearly apart.
 *   Skill (lib/skillScore.ts) is about the player's own game only.
 *   Luck (lib/luckScore.ts, public.get_luck_report) is how unusual the
 *   player's exact order of guesses was among everyone's first official
 *   attempt at the same puzzle — no number until 500 players have finished.
 *
 * MINI: unchanged — one skill score and "better than X% of players", until
 * Mini's own rules are designed.
 *
 * "Full Report" opens the breakdown: score lines, the most common wrong
 * guesses with which categories they came from, where players started, and
 * how the Rainbow went (from public.get_puzzle_report).
 *
 * Only rendered for an official daily puzzle. Beta and custom puzzles have
 * no official sessions to compare against, exactly like Global Stats.
 */

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { GameState, Puzzle } from "@/lib/types";
import {
  DIFFICULTY_COLOR_NAME,
  SOLVE_ORDER_NAME,
  formatOf,
  type Difficulty,
} from "@/lib/puzzleFormat";
import { skillScoreForGame, MAX_SKILL_SCORE, FULL_SKILL_SCORE_CAP } from "@/lib/skillScore";
import {
  fetchPuzzleReport,
  scoreStanding,
  wrongGuessSentence,
  categoryForSolveKey,
  type PuzzleReport,
} from "@/lib/puzzleReport";
import { fetchLuckReport, luckView, type LuckReport, type LuckView } from "@/lib/luckScore";
import { trackEvent } from "@/lib/analytics";

interface LuckyBotProps {
  puzzle: Puzzle;
  state: GameState;
  /**
   * The post-game "Spot the Rainbow" prompt's latest result on this page
   * (null until answered). A submission changes the player's saved path —
   * right or wrong — so the Luck numbers are fetched again when it changes.
   */
  rainbowPromptResult?: boolean | null;
  /**
   * Where the two reports come from. Defaults to the real database calls;
   * the dev-only preview page (src/dev/LuckyBotFixtures.tsx) passes canned
   * answers so the card can be looked at without touching any database.
   */
  dataSource?: LuckyBotDataSource;
}

const SWATCH: Record<Difficulty, string> = {
  1: "bg-group-1",
  2: "bg-group-2",
  3: "bg-group-3",
  4: "bg-group-4",
};

// How long to wait before reading anything back. The player's own finalize
// (and any post-game Rainbow write) is fire-and-forget and races the card,
// so a short delay lets it land before the first read.
const FIRST_READ_DELAY_MS = 1200;
// A second Luck read when the first found no saved attempt yet — a slow
// finalize, not a missing one, in the common case.
const LUCK_RETRY_DELAY_MS = 4000;

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export interface LuckyBotDataSource {
  report: (puzzleId: string) => Promise<PuzzleReport | null>;
  luck: (puzzleId: string) => Promise<LuckReport | null>;
}

const LIVE_DATA: LuckyBotDataSource = { report: fetchPuzzleReport, luck: fetchLuckReport };

export function LuckyBot(props: LuckyBotProps) {
  return formatOf(props.puzzle).id === "mini" ? <MiniLuckyBot {...props} /> : <FullLuckyBot {...props} />;
}

/** Fetches the crowd report once per completed puzzle, plus on demand. */
function usePuzzleReport(puzzleId: string, isComplete: boolean, source: LuckyBotDataSource) {
  const [report, setReport] = useState<PuzzleReport | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!isComplete) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      source.report(puzzleId).then((r) => {
        if (cancelled) return;
        setReport(r);
        setLoaded(true);
      });
    }, FIRST_READ_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [puzzleId, isComplete, source]);

  const refresh = () => {
    source.report(puzzleId).then((r) => {
      if (r) setReport(r);
    });
  };

  return { report, loaded, refresh };
}

// ─── Full ────────────────────────────────────────────────────────────────

function FullLuckyBot({ puzzle, state, rainbowPromptResult = null, dataSource = LIVE_DATA }: LuckyBotProps) {
  const { report, refresh } = usePuzzleReport(puzzle.id, state.isComplete, dataSource);
  // undefined = still loading, null = the fetch failed.
  const [luck, setLuck] = useState<LuckReport | null | undefined>(undefined);
  const [open, setOpen] = useState(false);

  // Recomputed from the board every render, so a Rainbow found through the
  // post-game prompt adds its point here the moment the share grid updates.
  const { score, lines } = skillScoreForGame(state, puzzle);

  // Luck: read once the game is over, again if the first read found no
  // saved attempt yet, and again after every post-game Rainbow submission
  // (which extends the saved path). gotRainbow and rainbowPromptResult are
  // both keys so a find restored on reload and a fresh one both refresh it.
  useEffect(() => {
    if (!state.isComplete) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const read = (retry: boolean) => {
      dataSource.luck(puzzle.id).then((r) => {
        if (cancelled) return;
        setLuck(r);
        if (retry && r?.status === "no_session") {
          timers.push(setTimeout(() => read(false), LUCK_RETRY_DELAY_MS));
        }
      });
    };
    timers.push(setTimeout(() => read(true), FIRST_READ_DELAY_MS));
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [puzzle.id, state.isComplete, state.gotRainbow, rainbowPromptResult, dataSource]);

  if (!state.isComplete) return null;

  const view = luckView(luck);

  return (
    <>
      <div
        data-testid="lucky-bot-card"
        className="relative mx-auto max-w-xs rounded-xl border border-border bg-card px-4 py-3 text-left shadow-sm"
      >
        {/* Top-right corner, out of the icon+text row's flow, so the card
            stays as short as its own content. */}
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            refresh();
            trackEvent("bot_report_opened", { puzzle_id: puzzle.id });
          }}
          className="absolute top-3 right-3 shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:bg-secondary transition-colors active:scale-95"
        >
          Full Report
        </button>

        {/* public/lucky-bot.png is a pre-cropped, pre-compressed 160x160
            transparent PNG; never swap it for a larger source image without
            re-cropping and re-compressing it the same way. */}
        <div className="flex items-center gap-3">
          <img src="/lucky-bot.png" alt="" aria-hidden="true" className="h-20 w-20 shrink-0 object-contain" />
          <div className="min-w-0 flex-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Lucky Bot</span>
            <div className="flex items-baseline gap-1" data-testid="skill-row">
              <SkillNumber score={score} className="text-2xl" />
              <span className="text-xs text-muted-foreground">/ {MAX_SKILL_SCORE} skill</span>
            </div>
            <div className="flex items-baseline gap-1" data-testid="luck-row">
              {/* Violet, so Luck never reads as a second Skill number. A
                  standard Tailwind shade with a lighter dark-mode partner,
                  for the same contrast reason as Skill's green. */}
              {/* A dash, not "?", until there is a number: the line under
                  the card says why, and "?" read as a missing score. Screen
                  readers get words instead of "dash". */}
              <span
                className="text-2xl font-bold tabular-nums text-violet-700 dark:text-violet-300"
                data-testid="luck-score"
                aria-hidden={view.kind === "score" ? undefined : true}
              >
                {view.kind === "score" ? view.score : "—"}
              </span>
              {view.kind !== "score" && <span className="sr-only">No Luck Score yet</span>}
              <span className="text-xs text-muted-foreground">/ 100 luck</span>
            </div>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground" data-testid="luck-line">
          {luckCardLine(view)}
        </p>
      </div>

      {open && (
        <FullReportModal
          puzzle={puzzle}
          score={score}
          lines={lines}
          report={report}
          luck={view}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** A skill score, with the special rainbow treatment reserved for 100. */
function SkillNumber({ score, className }: { score: number; className: string }) {
  if (score >= FULL_SKILL_SCORE_CAP) {
    return (
      <span
        data-testid="skill-score"
        data-perfect-plus="true"
        title="Off the scale!"
        className={`${className} font-bold tabular-nums bg-gradient-to-r from-rose-600 via-violet-600 to-sky-600 dark:from-rose-400 dark:via-violet-400 dark:to-sky-400 bg-clip-text text-transparent`}
      >
        {score}
      </span>
    );
  }
  return (
    <span data-testid="skill-score" className={`${className} font-bold tabular-nums text-green-700 dark:text-green-400`}>
      {score}
    </span>
  );
}

function luckCardLine(view: LuckView): string {
  switch (view.kind) {
    case "loading":
      return "Lucky Bot is checking your path…";
    case "unavailable":
      return "Luck Score isn't available right now.";
    case "not_counted":
      return view.message;
    case "collecting":
      return view.sentence
        ? `Lucky Bot is still collecting results. So far, ${lowerFirst(view.sentence)}`
        : "Lucky Bot is still collecting results.";
    case "score":
      return view.sentence;
  }
}

function lowerFirst(s: string): string {
  // "1 in 3 players…" stays as-is; "Nobody else…" / "All 12…" / "You're…"
  // read naturally after "So far, " in lower case.
  return /^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

interface FullReportModalProps {
  puzzle: Puzzle;
  score: number;
  lines: { label: string; points: number }[];
  report: PuzzleReport | null;
  luck: LuckView;
  onClose: () => void;
}

function FullReportModal({ puzzle, score, lines, report, luck, onClose }: FullReportModalProps) {
  const players = report?.total_players ?? 0;
  const standing = report ? scoreStanding(report.score_counts, score) : null;

  return (
    <ModalShell onClose={onClose}>
      <p className="text-center text-xs text-muted-foreground mb-5">
        {!report
          ? "Comparison isn't available right now."
          : players === 0
            ? "No one else has finished this puzzle yet."
            : `${players} player${players === 1 ? "" : "s"} finished this puzzle so far.`}
      </p>

      {/* Skill — the player's own game only */}
      <section className="mb-5" data-testid="report-skill">
        <h3 className="text-sm font-semibold mb-1 text-center">Skill Score</h3>
        <div className="flex items-baseline justify-center gap-1 mb-1">
          <SkillNumber score={score} className="text-4xl" />
          <span className="text-sm text-muted-foreground">/ {MAX_SKILL_SCORE}</span>
        </div>
        <p className="text-center text-xs text-muted-foreground mb-2">
          {score >= FULL_SKILL_SCORE_CAP
            ? "Off the scale — a perfect reverse-order solve with the Rainbow."
            : "Based only on how you played."}
        </p>
        <ScoreLines lines={lines} />
        {standing && standing.others > 0 && (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            {standing.betterThanPct !== null && `Higher than ${standing.betterThanPct}% of other players' Skill Scores. `}
            {standing.average !== null && `Average today: ${standing.average}.`}
          </p>
        )}
      </section>

      {/* Luck — how unusual the path was */}
      <section className="mb-5" data-testid="report-luck">
        <h3 className="text-sm font-semibold mb-1 text-center">Luck Score</h3>
        {luck.kind === "score" ? (
          <div className="flex items-baseline justify-center gap-1 mb-1">
            <span className="text-4xl font-bold tabular-nums text-violet-700 dark:text-violet-300">{luck.score}</span>
            <span className="text-sm text-muted-foreground">/ 100</span>
          </div>
        ) : null}
        <p className="text-center text-sm">{luckReportHeadline(luck)}</p>
        {luck.kind === "collecting" && (
          <p className="mt-1 text-center text-xs text-muted-foreground">
            A number appears once {luck.minPlayers.toLocaleString("en-US")} players have finished.{" "}
            {luck.eligiblePlayers.toLocaleString("en-US")} so far.
          </p>
        )}
        {luck.kind === "score" && (
          <p className="mt-1 text-center text-xs text-muted-foreground">
            {luck.samePath.toLocaleString("en-US")} of {luck.eligiblePlayers.toLocaleString("en-US")} players took this
            path. 1 in {luck.ceiling.toLocaleString("en-US")} or rarer scores 100.
          </p>
        )}
        <p className="mt-2 rounded-md bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
          Luck Score compares your exact order of guesses — right, wrong, One Away and Rainbow — with
          everyone's first try at this puzzle. It shows how unusual your path was, not how well you
          played, and it can change as more players finish.
        </p>
      </section>

      <CrowdSections puzzle={puzzle} report={report} />
    </ModalShell>
  );
}

function luckReportHeadline(view: LuckView): string {
  switch (view.kind) {
    case "loading":
      return "Lucky Bot is checking your path…";
    case "unavailable":
      return "Luck Score isn't available right now.";
    case "not_counted":
      return view.message;
    case "collecting":
      return view.sentence
        ? `Lucky Bot is still collecting results. So far, ${lowerFirst(view.sentence)}`
        : "Lucky Bot is still collecting results.";
    case "score":
      return view.sentence;
  }
}

// ─── Mini (unchanged presentation) ──────────────────────────────────────

function MiniLuckyBot({ puzzle, state, dataSource = LIVE_DATA }: LuckyBotProps) {
  const { report, loaded, refresh } = usePuzzleReport(puzzle.id, state.isComplete, dataSource);
  const [open, setOpen] = useState(false);

  const { score, lines } = skillScoreForGame(state, puzzle);

  if (!state.isComplete) return null;

  const standing = report ? scoreStanding(report.score_counts, score) : null;

  // These "no comparison" cases are worded apart on purpose. A missing
  // report (the RPC errored, or is not deployed yet — fetchPuzzleReport
  // returns null on any error rather than throwing) says nothing about who
  // else has played; claiming "you're first" there would often just be
  // wrong. Only a report that loaded fine and genuinely counted zero other
  // finished sessions earns that claim.
  // The line break in the "unavailable" message is deliberate (rendered via
  // whitespace-pre-line below), not left to wrap on its own: at this card's
  // width the natural wrap point falls after "right", stranding "now." alone
  // on its own line, which reads worse than breaking after "available".
  let standingLine: string;
  if (!loaded) standingLine = "Comparing with today's players…";
  else if (!report) standingLine = "Comparison isn't available\nright now.";
  else if (!standing || standing.others === 0) standingLine = "No comparison yet — check back once others have played.";
  else if (standing.betterThanPct === null) standingLine = `${standing.others + 1} players so far.`;
  else standingLine = `Better than ${standing.betterThanPct}% of ${standing.others} other player${standing.others === 1 ? "" : "s"}`;

  return (
    <>
      <div
        data-testid="lucky-bot-card"
        className="relative mx-auto max-w-xs rounded-xl border border-border bg-card px-4 py-3 text-left shadow-sm"
      >
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            refresh();
            trackEvent("bot_report_opened", { puzzle_id: puzzle.id });
          }}
          className="absolute top-3 right-3 shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:bg-secondary transition-colors active:scale-95"
        >
          Full Report
        </button>

        <div className="flex items-center gap-3">
          <img src="/lucky-bot.png" alt="" aria-hidden="true" className="h-20 w-20 shrink-0 object-contain" />
          <div className="min-w-0 flex-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Lucky Bot</span>
            <div className="flex items-baseline gap-1">
              {/* Green to match Lucky Bot, not the puzzle's own pastel
                  --group-2 green: that token is a light tile FILL meant to
                  sit under dark ink, and reads at only ~1.8:1 contrast as
                  text on this card's light background — a standard Tailwind
                  green (with a lighter dark-mode shade) stays legible in
                  both themes instead. */}
              <span className="text-2xl font-bold tabular-nums text-green-700 dark:text-green-400" data-testid="skill-score">{score}</span>
              <span className="text-xs text-muted-foreground">/ {MAX_SKILL_SCORE} skill score</span>
            </div>
            <p className="text-xs text-muted-foreground whitespace-pre-line" data-testid="skill-standing">{standingLine}</p>
          </div>
        </div>
      </div>

      {open && (
        <MiniReportModal
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

interface MiniReportModalProps {
  puzzle: Puzzle;
  score: number;
  lines: { label: string; points: number }[];
  report: PuzzleReport | null;
  onClose: () => void;
}

function MiniReportModal({ puzzle, score, lines, report, onClose }: MiniReportModalProps) {
  const players = report?.total_players ?? 0;
  const standing = report ? scoreStanding(report.score_counts, score) : null;

  return (
    <ModalShell onClose={onClose}>
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
        <ScoreLines lines={lines} />
        {standing && standing.others > 0 && (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            {standing.betterThanPct !== null && `Better than ${standing.betterThanPct}% of other players. `}
            {standing.average !== null && `Average score today: ${standing.average}.`}
          </p>
        )}
      </section>

      <CrowdSections puzzle={puzzle} report={report} />
    </ModalShell>
  );
}

// ─── Shared pieces ──────────────────────────────────────────────────────

function ModalShell({ onClose, children }: { onClose: () => void; children: ReactNode }) {
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
        {children}
      </div>
    </div>,
    document.body
  );
}

function ScoreLines({ lines }: { lines: { label: string; points: number }[] }) {
  return (
    <ul className="space-y-1 text-sm">
      {lines.map((l, i) => (
        <li key={i} className="flex items-center justify-between rounded-md bg-secondary/50 px-3 py-1.5">
          <span>{l.label}</span>
          <span className="font-semibold tabular-nums">{l.points >= 0 && i > 0 ? "+" : ""}{l.points}</span>
        </li>
      ))}
    </ul>
  );
}

/** Wrong guesses, where players started, and how the Rainbow went. */
function CrowdSections({ puzzle, report }: { puzzle: Puzzle; report: PuzzleReport | null }) {
  const format = formatOf(puzzle);
  const players = report?.total_players ?? 0;
  if (!report || players === 0) return null;

  return (
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
  );
}
