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

type Phase = "welcome" | "rainbow-hunt" | "rainbow-revealed" | "solve-groups" | "complete";

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
  isShaking,
  onClick,
  disabled,
}: {
  word: string;
  isSelected: boolean;
  isRainbow: boolean;
  isShaking: boolean;
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
        ${isShaking ? "animate-shake" : ""}
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
  // All example words, shuffled. Never removed during rainbow hunt — rainbow words stay on board.
  const [boardWords, setBoardWords] = useState<string[]>(() => shuffle(allWords));
  const [selected, setSelected] = useState<string[]>([]);
  const [shakingWord, setShakingWord] = useState<string | null>(null);
  const [nudgeMessage, setNudgeMessage] = useState<string | null>(null);
  const [solvedGroups, setSolvedGroups] = useState<typeof TUTORIAL_GROUPS>([]);
  // Tracks words to hide after each group is solved (including that group's rainbow word)
  const [solvedGroupWords, setSolvedGroupWords] = useState<string[]>([]);
  const [oneAway, setOneAway] = useState(false);
  const [mistakes, setMistakes] = useState(0);
  const [shakingBoard, setShakingBoard] = useState(false);

  const reset = useCallback(() => {
    setPhase("welcome");
    setBoardWords(shuffle(groups.flatMap((group) => group.words)));
    setSelected([]);
    setShakingWord(null);
    setNudgeMessage(null);
    setSolvedGroups([]);
    setSolvedGroupWords([]);
    setOneAway(false);
    setMistakes(0);
    setShakingBoard(false);
  }, [groups]);

  const handleClose = useCallback(() => {
    onClose();
    // Reset immediately — delayed reset was causing state bleed into next open
    reset();
  }, [onClose, reset]);

  // ── Rainbow hunt: only rainbow words can be selected ──
  const handleRainbowWordClick = useCallback((word: string) => {
    if (selected.includes(word)) {
      setSelected((s) => s.filter((w) => w !== word));
      return;
    }
    if (selected.length >= format.answersPerCategory) return;

    if (!rainbowWords.includes(word)) {
      setShakingWord(word);
      setNudgeMessage("That one belongs to a different group — look for the Rainbow! 🌈");
      setTimeout(() => setShakingWord(null), 400);
      setTimeout(() => setNudgeMessage(null), 2500);
      return;
    }

    setSelected((s) => [...s, word]);
  }, [selected, format, rainbowWords]);

  const handleRainbowSubmit = useCallback(() => {
    if (selected.length !== format.answersPerCategory) return;
    if (selected.every((w) => rainbowWords.includes(w))) {
      // Rainbow words STAY on the board — they show with rainbow styling and are locked
      setSelected([]);
      setPhase("rainbow-revealed");
    }
  }, [selected, format, rainbowWords]);

  // ── Solve groups: all words clickable, rainbow words just look different ──
  const handleGroupWordClick = useCallback((word: string) => {
    if (selected.includes(word)) {
      setSelected((s) => s.filter((w) => w !== word));
      return;
    }
    if (selected.length >= format.answersPerCategory) return;
    setSelected((s) => [...s, word]);
  }, [selected, format]);

  const handleGroupSubmit = useCallback(() => {
    if (selected.length !== format.answersPerCategory) return;

    const matchedGroup = groups.find(
      (g) => !solvedGroups.includes(g) && g.words.every((w) => selected.includes(w))
    );

    if (matchedGroup) {
      const newSolvedGroups = [...solvedGroups, matchedGroup];
      // Remove ALL of this group's words from the board (including its rainbow word)
      setSolvedGroupWords((prev) => [...prev, ...matchedGroup.words]);
      setSolvedGroups(newSolvedGroups);
      setSelected([]);

      if (newSolvedGroups.length === groups.length) {
        setTimeout(() => setPhase("complete"), 600);
      }
    } else {
      const isOneAway = groups.some(
        (g) =>
          !solvedGroups.includes(g) &&
          g.words.filter((w) => selected.includes(w)).length === oneAwayThreshold(format)
      );

      setShakingBoard(true);
      setTimeout(() => setShakingBoard(false), 400);
      setMistakes((m) => m + 1);
      setSelected([]);

      if (isOneAway) {
        setOneAway(true);
        setTimeout(() => setOneAway(false), 2500);
      }
    }
  }, [selected, solvedGroups, format, groups]);

  if (!open) return null;

  // Words shown on the board = all boardWords minus words from solved groups
  const visibleWords = boardWords.filter((w) => !solvedGroupWords.includes(w));

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
                  Some puzzles include an extra hidden category — the <strong>Rainbow</strong>. One word from each of the {countWord} groups shares a secret connection. Find and submit all {countWord} Rainbow words before solving the main groups. Classic puzzles have no Rainbow.
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
                  You have <strong>{format.maxMistakes} mistakes</strong> before the puzzle ends. If your {format.answersPerCategory}-word guess contains {oneAwayThreshold(format)} words from the same group, you'll get a <strong>"One Away"</strong> hint.
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
              <div className="text-5xl">🌈</div>
              <div>
                <h3 className="text-lg font-bold mb-2">Welcome to Rainbow Categories!</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Find <strong>{countWord} groups of {countWord} words</strong>. Some puzzles also have a hidden{" "}
                  <strong>Rainbow</strong>; Classic puzzles do not. This practice example includes a Rainbow.
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed mt-2">
                  The Rainbow is <strong>one word from each category</strong> that share a secret
                  connection. Can you spot the Rainbow?
                </p>
              </div>
              <button
                onClick={() => setPhase("rainbow-hunt")}
                className="w-full py-3 rounded-full bg-primary text-primary-foreground font-semibold text-sm
                  hover:opacity-90 transition-all active:scale-95"
              >
                Let's try it →
              </button>
            </div>
          )}

          {/* ── RAINBOW HUNT ── */}
          {phase === "rainbow-hunt" && (
            <div className="flex flex-col gap-3">
              <div className="rounded-xl p-3 text-center" style={{ background: "hsl(var(--secondary))" }}>
                <p className="text-sm font-semibold">🌈 Find the {format.categoryCount} Rainbow words and select them</p>
                <p className="text-xs text-muted-foreground mt-1">One from each group shares a hidden connection</p>
              </div>

              <div style={{ minHeight: "1.5rem" }} className="text-center">
                {nudgeMessage && (
                  <p className="text-xs text-amber-500 font-medium">{nudgeMessage}</p>
                )}
              </div>

              <div className={`grid ${gridColumns} gap-2`}>
                {boardWords.map((word) => (
                  <WordTile
                    key={word}
                    word={word}
                    isSelected={selected.includes(word)}
                    isRainbow={false}
                    isShaking={shakingWord === word}
                    onClick={() => handleRainbowWordClick(word)}
                    disabled={false}
                  />
                ))}
              </div>

              <p className="text-center text-xs text-muted-foreground">{selected.length} / {format.answersPerCategory} selected</p>

              <button
                onClick={handleRainbowSubmit}
                disabled={selected.length !== format.answersPerCategory}
                className="w-full py-2.5 rounded-full bg-primary text-primary-foreground font-semibold text-sm
                  hover:opacity-90 transition-all active:scale-95
                  disabled:opacity-40 disabled:cursor-default flex items-center justify-center gap-2"
              >
                <Send className="w-4 h-4" /> Submit Rainbow
              </button>
            </div>
          )}

          {/* ── RAINBOW REVEALED ── */}
          {phase === "rainbow-revealed" && (
            <div className="flex flex-col gap-4">
              <div className="animate-fade-up">
                <SolvedGroupBanner category="Colors of the Rainbow 🌈" words={rainbowWords} isRainbow />
              </div>
              <div className="text-center">
                <p className="text-2xl mb-1">🎉</p>
                <p className="text-sm font-semibold">You spotted the Rainbow!</p>
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                  Now solve the remaining {format.categoryCount} groups. If your {format.answersPerCategory}-word guess contains {oneAwayThreshold(format)} from one of the main groups,
                  the game will give you a <strong>"One Away"</strong> hint.
                </p>
              </div>
              <button
                onClick={() => setPhase("solve-groups")}
                className="w-full py-3 rounded-full bg-primary text-primary-foreground font-semibold text-sm
                  hover:opacity-90 transition-all active:scale-95"
              >
                Solve the groups →
              </button>
            </div>
          )}

          {/* ── SOLVE GROUPS ── */}
          {phase === "solve-groups" && (
            <div className="flex flex-col gap-3">
              <div className="rounded-xl p-3 text-center" style={{ background: "hsl(var(--secondary))" }}>
                <p className="text-sm font-semibold">Find all {format.categoryCount} groups</p>
                <p className="text-xs text-muted-foreground mt-1">Select {format.answersPerCategory} words that share something in common</p>
              </div>

              {oneAway && (
                <div className="flex justify-center animate-fade-up">
                  <div className="bg-foreground text-background px-5 py-2 rounded-full text-sm font-semibold shadow-md">
                    One away…
                  </div>
                </div>
              )}

              <div className="space-y-2">
                {solvedGroups.map((g) => (
                  <SolvedGroupBanner key={g.category} category={g.category} words={g.words} color={g.color} />
                ))}
              </div>

              {visibleWords.length > 0 && (
                <div className={`grid ${gridColumns} gap-2 ${shakingBoard ? "animate-shake" : ""}`}>
                  {visibleWords.map((word) => {
                    const isRainbowWord = rainbowWords.includes(word);
                    return (
                      <WordTile
                        key={word}
                        word={word}
                        isSelected={selected.includes(word)}
                        isRainbow={isRainbowWord}
                        isShaking={false}
                        onClick={() => handleGroupWordClick(word)}
                        disabled={false}
                      />
                    );
                  })}
                </div>
              )}

              {mistakes > 0 && (
                <p className="text-center text-xs text-muted-foreground">Mistakes: {mistakes}</p>
              )}

              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={() => setBoardWords((prev) => shuffle(prev))}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-border text-sm font-medium
                    hover:bg-secondary transition-colors duration-150 active:scale-95"
                >
                  <Shuffle className="w-4 h-4" /> Shuffle
                </button>
                <button
                  onClick={() => setSelected([])}
                  disabled={selected.length === 0}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-full border border-border text-sm font-medium
                    hover:bg-secondary transition-colors duration-150 active:scale-95
                    disabled:opacity-40 disabled:cursor-default"
                >
                  <X className="w-4 h-4" /> Deselect
                </button>
                <button
                  onClick={handleGroupSubmit}
                  disabled={selected.length !== format.answersPerCategory}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-primary text-primary-foreground text-sm font-medium
                    hover:opacity-90 transition-all duration-150 active:scale-95
                    disabled:opacity-40 disabled:cursor-default"
                >
                  <Send className="w-4 h-4" /> Submit
                </button>
              </div>
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
                Play Today's Puzzle →
              </button>
            </div>
          )}

          </>)}

        </div>
      </div>
    </div>
  );
}
