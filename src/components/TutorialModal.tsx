import { useState, useCallback } from "react";
import { X, Send, Shuffle } from "lucide-react";
import { FULL_FORMAT, difficultyLabels, oneAwayThreshold, type PuzzleFormat } from "@/lib/puzzleFormat";

// ─── Tutorial puzzle data ───────────────────────────────────────────────────

const RAINBOW_WORDS = ["BLUE", "GREEN", "ORANGE", "RED"];

const TUTORIAL_GROUPS = [
{
    category: "Feeling Down",
     words: ["BLUE", "GLOOMY", "MELANCHOLY", "SAD"],
    difficulty: 1,
    color: "bg-amber-500",
  },
  {
    category: "Things That Are Round",
    words: ["BASEBALL", "GLOBE", "ORANGE", "WHEEL"],
    difficulty: 2,
    color: "bg-green-600",
  },
  {
    category: "Characteristics Of Elmo",
    words: ["FUZZY", "RED", "PUPPET", "TICKLISH"],
    difficulty: 3,
    color: "bg-blue-500",
  },
  {
    category: "Words Before 'Day'",
    words: ["DOOMS", "GREEN", "SNOW", "VALENTINE'S"],
    difficulty: 4,
    color: "bg-red-500",
  },
];

// Synthetic teaching examples only: each retained group has exactly one Rainbow word.
const MINI_TUTORIAL_GROUPS = [
  { ...TUTORIAL_GROUPS[0], words: ["BLUE", "GLOOMY", "SAD"], difficulty: 2, color: "bg-green-600" },
  { ...TUTORIAL_GROUPS[1], words: ["BASEBALL", "ORANGE", "WHEEL"], difficulty: 3, color: "bg-blue-500" },
  { ...TUTORIAL_GROUPS[2], words: ["FUZZY", "RED", "PUPPET"], difficulty: 4, color: "bg-red-500" },
];
const MINI_RAINBOW_WORDS = ["BLUE", "ORANGE", "RED"];

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

type Phase = "welcome" | "practice" | "bonus" | "complete";

// ─── Sub-components ─────────────────────────────────────────────────────────

// Returns the largest font size that keeps the word on one line inside a 4-col grid tile.
// Calibrated against the modal's max-w-md container (≈80px usable text width per tile).
function tileFontSize(word: string): string {
  const len = word.replace(/'/g, "").length;
  if (len <= 6)  return "12px";
  if (len <= 8)  return "11px";
  if (len <= 10) return "9.5px";
  return "8.5px";
}

function WordTile({
  word,
  isSelected,
  isRainbow,
  onClick,
  disabled,
}: {
  word: string;
  isSelected: boolean;
  isRainbow: boolean;
  onClick: () => void;
  disabled: boolean;
}) {
  const rainbowStyle = isSelected && isRainbow
    ? { outline: "3px solid white", outlineOffset: "3px", boxShadow: "0 0 0 6px black" }
    : {};

  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-pressed={isSelected}
      aria-label={isRainbow ? `${word} (Rainbow word)` : word}
      className={`
        relative w-full rounded-lg py-3 px-2 font-bold uppercase tracking-wide
        whitespace-nowrap flex items-center justify-center
        transition-all duration-150 select-none cursor-pointer
        ${isRainbow
          ? "rainbow-tile text-white"
          : isSelected
          ? "bg-foreground text-background scale-95 shadow-inner"
          : "bg-secondary text-foreground hover:bg-secondary/80 active:scale-95"}
        ${disabled ? "opacity-60" : ""}
      `}
      style={{ fontSize: tileFontSize(word), ...rainbowStyle }}
    >
      {word}
    </button>
  );
}

function SolvedGroupBanner({
  category,
  words,
  isRainbow,
  color,
}: {
  category: string;
  words: string[];
  isRainbow?: boolean;
  color?: string;
}) {
  return (
    <div
      className={`w-full rounded-xl py-3 px-4 text-white text-center animate-fade-up ${
        isRainbow
          ? "bg-gradient-to-r from-red-400 via-yellow-400 via-green-400 to-blue-400"
          : color ?? ""
      }`}
    >
      <p className="text-xs font-bold uppercase tracking-widest opacity-90">{category}</p>
      <p className="text-sm font-semibold mt-0.5">{words.join(" · ")}</p>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{
      fontSize: "11px",
      fontWeight: 600,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      color: "hsl(var(--muted-foreground))",
      marginBottom: "6px",
    }}>{children}</p>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

interface TutorialModalProps {
  open: boolean;
  onClose: () => void;
  format?: PuzzleFormat;
}

type Tab = "tutorial" | "rules";

export function TutorialModal({ format = FULL_FORMAT, ...props }: TutorialModalProps) {
  // A route changing format must not retain the other board's practice progress.
  return <FormatTutorialModal key={format.id} {...props} format={format} />;
}

function FormatTutorialModal({ open, onClose, format = FULL_FORMAT }: TutorialModalProps) {
  const groups = format.id === "mini" ? MINI_TUTORIAL_GROUPS : TUTORIAL_GROUPS;
  const rainbowWords = format.id === "mini" ? MINI_RAINBOW_WORDS : RAINBOW_WORDS;
  const allWords = groups.flatMap((group) => group.words);
  const countWord = format.id === "mini" ? "three" : "four";
  const gridColumns = format.columns === 3 ? "grid-cols-3" : "grid-cols-4";
  const [tab, setTab] = useState<Tab>("tutorial");
  const [phase, setPhase] = useState<Phase>("welcome");
  // Keep the same practice board for every guess.
  const [boardWords, setBoardWords] = useState<string[]>(() => shuffle(allWords));
  const [selected, setSelected] = useState<string[]>([]);
  const [rainbowFound, setRainbowFound] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [solvedGroups, setSolvedGroups] = useState<typeof TUTORIAL_GROUPS>([]);
  // Tracks words to hide after each group is solved (including that group's rainbow word)
  const [solvedGroupWords, setSolvedGroupWords] = useState<string[]>([]);

  const [mistakes, setMistakes] = useState(0);
  const [shakingBoard, setShakingBoard] = useState(false);

  const reset = useCallback(() => {
    setPhase("welcome");
    setBoardWords(shuffle(groups.flatMap((group) => group.words)));
    setSelected([]);
    setRainbowFound(false);
    setFeedback("");
    setTab("tutorial");
    setSolvedGroups([]);
    setSolvedGroupWords([]);
    setMistakes(0);
    setShakingBoard(false);
  }, [groups]);

  const handleClose = useCallback(() => {
    onClose();
    // Reset immediately — delayed reset was causing state bleed into next open
    reset();
  }, [onClose, reset]);

  function toggleWord(word: string) {
    setSelected((current) => current.includes(word)
      ? current.filter((item) => item !== word)
      : current.length < format.answersPerCategory ? [...current, word] : current);
  }

  function submit() {
    if (selected.length !== format.answersPerCategory) return;

    if (!rainbowFound && selected.every((word) => rainbowWords.includes(word))) {
      setRainbowFound(true);
      setSelected([]);
      if (phase === "bonus") setPhase("complete");
      else setFeedback("You spotted the Rainbow! These words stay on the board. Each belongs to a different group.");
      return;
    }

    const match = phase === "practice" && groups.find(
      (group) => !solvedGroups.includes(group) && group.words.every((word) => selected.includes(word))
    );

    setSelected([]);
    if (match) {
      const next = [...solvedGroups, match];
      setSolvedGroups(next);
      setSolvedGroupWords((previous) => [...previous, ...match.words]);
      if (next.length === groups.length) {
        setFeedback("");
        setPhase(rainbowFound ? "complete" : "bonus");
      } else if (next.length === 1 && !rainbowFound) {
        setFeedback("That’s a regular group! If you don’t find the Rainbow up front, look for it again at the end.");
      } else {
        setFeedback("That’s a match!");
      }
      return;
    }

    const near = phase === "practice" && groups.find((group) =>
      !solvedGroups.includes(group) &&
      group.words.filter((word) => selected.includes(word)).length === oneAwayThreshold(format)
    );
    setFeedback(near
      ? format.id === "mini" ? `One Away... ${({2: "🟩", 3: "🟦", 4: "🟥"} as Record<number, string>)[near.difficulty] ?? ""}` : "One away…"
      : phase === "bonus" ? "Not quite. Pick one word from each solved group." : "Not quite. Try another connection.");
    setMistakes((previous) => previous + 1);
    setShakingBoard(true);
  }

  if (!open) return null;

  // Words shown on the board = all boardWords minus words from solved groups
  const visibleWords = phase === "bonus" ? groups.flatMap((group) => group.words) : boardWords.filter((w) => !solvedGroupWords.includes(w));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
    >
      <div
        className="relative w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{
          background: "hsl(var(--card))",
          border: "1px solid hsl(var(--border))",
          maxHeight: "90vh",
        }}
      >
        {/* Header */}
        <div className="shrink-0 px-5 pt-5 pb-0">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold tracking-tight">How to Play</h2>
            <button
              onClick={handleClose}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
              aria-label="Skip tutorial"
            >
              Skip
            </button>
          </div>
          {/* Tab pills */}
          <div className="flex gap-1 p-1 rounded-lg mb-3" style={{ background: "hsl(var(--secondary))" }}>
            <button
              onClick={() => setTab("tutorial")}
              className="flex-1 py-1.5 text-xs font-semibold rounded-md transition-all duration-150"
              style={{
                background: tab === "tutorial" ? "hsl(var(--card))" : "transparent",
                color: tab === "tutorial" ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
                boxShadow: tab === "tutorial" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
              }}
            >
              Tutorial
            </button>
            <button
              onClick={() => setTab("rules")}
              className="flex-1 py-1.5 text-xs font-semibold rounded-md transition-all duration-150"
              style={{
                background: tab === "rules" ? "hsl(var(--card))" : "transparent",
                color: tab === "rules" ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))",
                boxShadow: tab === "rules" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
              }}
            >
              How to Play
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 px-5 pb-6">

          {/* ── RULES TAB ── */}
          {tab === "rules" && (
            <div className="py-4 space-y-5">
              <section>
                <SectionLabel>The Goal</SectionLabel>
                <p className="text-sm leading-relaxed">
                  Find {countWord} groups of {countWord} words that share something in common. Each word belongs to exactly one group.
                </p>
              </section>

              <div style={{ height: "1px", background: "hsl(var(--border))" }} />

              <section>
                <SectionLabel>The Categories</SectionLabel>
                <p className="text-sm leading-relaxed mb-3">
                  There are {countWord} difficulty levels, color-coded from easiest to hardest:
                </p>
                <div className="space-y-2">
                  {groups.map((group, index) => ({
                    color: group.color,
                    label: (format.id === "mini" ? difficultyLabels(format) : ["Easiest", "Medium", "Hard", "Hardest"])[index],
                  })).map(({ color, label }) => (
                    <div key={label} className="flex items-center gap-3">
                      <div className={`w-8 h-5 rounded ${color} shrink-0`} />
                      <span className="text-sm">{label}</span>
                    </div>
                  ))}
                </div>
              </section>

              <div style={{ height: "1px", background: "hsl(var(--border))" }} />

              <section>
                <SectionLabel>The Rainbow</SectionLabel>
                <p className="text-sm leading-relaxed">
                  Some puzzles include an extra hidden category — the <strong>Rainbow</strong>. One word from each of the {countWord} groups shares a secret connection. Use the same Submit button for either kind of connection. You can find the Rainbow before solving a regular group, or in the bonus at the end. Classic puzzles have no Rainbow.
                </p>
                <div className="mt-3 rounded-lg px-4 py-3 text-sm font-medium text-white text-center"
                  style={{ background: "linear-gradient(to right, #f87171, #facc15, #4ade80, #60a5fa)" }}>
                  🌈 Rainbow Spotted!
                </div>
              </section>

              <div style={{ height: "1px", background: "hsl(var(--border))" }} />

              <section>
                <SectionLabel>Mistakes</SectionLabel>
                <p className="text-sm leading-relaxed">
                  You have <strong>{format.maxMistakes} mistakes</strong> before the puzzle ends. If your {format.answersPerCategory}-word guess contains {oneAwayThreshold(format)} words from the same group, you'll get a <strong>"One Away"</strong> hint.{format.id === "mini" && <> The hint also shows the category color, for example <strong>One Away... 🟥</strong>. Previously started games keep their original four mistakes.</>}
                </p>
              </section>

              <div style={{ height: "1px", background: "hsl(var(--border))" }} />

              <section>
                <SectionLabel>New Puzzles</SectionLabel>
                <p className="text-sm leading-relaxed">
                  A new puzzle drops every day. Past puzzles are available in the archive.
                </p>
              </section>
            </div>
          )}

          {/* ── TUTORIAL TAB ── */}
          {tab === "tutorial" && (<>
          {phase === "welcome" && (
            <div className="flex flex-col items-center text-center gap-5 py-4">
              <div className="text-5xl" aria-hidden="true">🌈</div>
              <div>
                <h3 className="text-xl font-bold mb-2">
                  {format.tileCount} words. {format.categoryCount + 1} connections.
                </h3>
                <p className="text-sm text-foreground leading-relaxed">
                  On a Rainbow puzzle, one word from each regular group also fits a hidden category: <strong>the Rainbow</strong>.
                </p>
                <p className="text-sm text-foreground leading-relaxed mt-2">
                  See {countWord} words that go together? Select them and hit <strong>Submit</strong>.
                </p>
              </div>
              <button onClick={() => setPhase("practice")} className="w-full py-3 rounded-full bg-primary text-primary-foreground font-semibold text-sm">
                Let’s Try It
              </button>
            </div>
          )}

          {(phase === "practice" || phase === "bonus") && (
            <div className="flex flex-col gap-3">
              <div className="rounded-xl bg-secondary p-3 text-center">
                <p className="text-sm font-semibold">
                  {phase === "bonus" ? "Spot the Rainbow" : `Find ${countWord} words that go together.`}
                </p>
                {phase === "bonus" && <p className="text-sm mt-1">Pick one word from each solved group.</p>}
              </div>

              {phase === "practice" && (
                <div className="space-y-2">
                  {solvedGroups.map((g) => (
                    <SolvedGroupBanner key={g.category} category={g.category} words={g.words} color={g.color} />
                  ))}
                </div>
              )}

              <div onAnimationEnd={() => setShakingBoard(false)} className={`grid ${gridColumns} gap-2 ${shakingBoard ? "animate-shake" : ""}`}>
                {visibleWords.map((word) => (
                  <WordTile
                    key={word}
                    word={word}
                    isSelected={selected.includes(word)}
                    isRainbow={rainbowFound && rainbowWords.includes(word)}
                    onClick={() => toggleWord(word)}
                    disabled={false}
                  />
                ))}
              </div>

              <p role="status" className="text-center text-sm leading-snug min-h-5">{feedback}</p>
              {mistakes > 0 && <p className="text-center text-xs text-muted-foreground">Mistakes: {mistakes}</p>}
              <div className="flex flex-wrap items-center justify-center gap-2">
                {phase === "practice" && (
                  <button onClick={() => setBoardWords((previous) => shuffle(previous))} className="flex items-center gap-1.5 px-3 py-2.5 rounded-full border border-border text-sm font-medium">
                    <Shuffle className="w-4 h-4" /> Shuffle
                  </button>
                )}
                <button onClick={() => setSelected([])} disabled={selected.length === 0} className="flex items-center gap-1.5 px-3 py-2.5 rounded-full border border-border text-sm font-medium disabled:opacity-40">
                  <X className="w-4 h-4" /> Deselect
                </button>
                <button onClick={submit} disabled={selected.length !== format.answersPerCategory} className="flex items-center gap-1.5 px-3 py-2.5 rounded-full bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40">
                  <Send className="w-4 h-4" /> Submit
                </button>
              </div>
              {phase === "bonus" && (
                <button onClick={handleClose} className="self-center underline underline-offset-2 text-sm">
                  Play Today’s Puzzle
                </button>
              )}
            </div>
          )}

          {/* ── COMPLETE ── */}
          {phase === "complete" && (
            <div className="flex flex-col items-center text-center gap-5 py-4">
              <div className="w-full space-y-2">
                <SolvedGroupBanner category="Colors of the Rainbow 🌈" words={rainbowWords} isRainbow />
                {groups.map((g) => (
                  <SolvedGroupBanner key={g.category} category={g.category} words={g.words} color={g.color} />
                ))}
              </div>
              <div>
                <p className="text-2xl mb-2">🎓</p>
                <p className="text-lg font-bold">You're ready to play!</p>
                <p className="text-sm text-muted-foreground mt-1">A new puzzle drops every day.</p>
              </div>
              <button
                onClick={handleClose}
                className="w-full py-3 rounded-full bg-primary text-primary-foreground font-semibold text-sm
                  hover:opacity-90 transition-all active:scale-95"
              >
                Play Today’s Puzzle
              </button>
            </div>
          )}

          </>)}

        </div>
      </div>
    </div>
  );
}
