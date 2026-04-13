import { useState, useCallback } from "react";
import { X, Send, Shuffle } from "lucide-react";

// ─── Tutorial puzzle data ───────────────────────────────────────────────────

const RAINBOW_WORDS = ["ORANGE", "GREEN", "BLUE", "RED"];

const TUTORIAL_GROUPS = [
  {
    category: "Things That Are Round",
    words: ["ORANGE", "BASEBALL", "GLOBE", "WHEEL"],
    difficulty: 1,
    color: "bg-amber-500",
  },
  {
    category: "Feeling Down",
    words: ["BLUE", "SAD", "GLOOMY", "MELANCHOLY"],
    difficulty: 2,
    color: "bg-green-600",
  },
  {
    category: "Characteristics of Elmo",
    words: ["RED", "FUZZY", "PUPPET", "TICKLISH"],
    difficulty: 3,
    color: "bg-blue-500",
  },
  {
    category: "Words Before 'Day'",
    words: ["GREEN", "SUN", "SNOW", "VALENTINE'S"],
    difficulty: 4,
    color: "bg-red-500",
  },
];

const ALL_WORDS = TUTORIAL_GROUPS.flatMap((g) => g.words);

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
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        relative rounded-lg py-3 px-1 text-xs font-bold uppercase tracking-wide
        transition-all duration-150 select-none
        ${isShaking ? "animate-shake" : ""}
        ${isSelected
          ? "bg-foreground text-background scale-95 shadow-inner"
          : isRainbow
          ? "rainbow-tile text-white shadow-md"
          : "bg-secondary text-foreground hover:bg-secondary/80 active:scale-95"}
        ${disabled && !isRainbow ? "opacity-50 cursor-default" : ""}
        ${isRainbow ? "cursor-default" : "cursor-pointer"}
      `}
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

// ─── Main component ──────────────────────────────────────────────────────────

interface TutorialModalProps {
  open: boolean;
  onClose: () => void;
}

export function TutorialModal({ open, onClose }: TutorialModalProps) {
  const [phase, setPhase] = useState<Phase>("welcome");
  // All 16 words, shuffled. Never removed during rainbow hunt — rainbow words stay on board.
  const [boardWords, setBoardWords] = useState<string[]>(() => shuffle(ALL_WORDS));
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
    setBoardWords(shuffle(ALL_WORDS));
    setSelected([]);
    setShakingWord(null);
    setNudgeMessage(null);
    setSolvedGroups([]);
    setSolvedGroupWords([]);
    setOneAway(false);
    setMistakes(0);
    setShakingBoard(false);
  }, []);

  const handleClose = useCallback(() => {
    onClose();
    setTimeout(reset, 300);
  }, [onClose, reset]);

  // ── Rainbow hunt: only rainbow words can be selected ──
  const handleRainbowWordClick = useCallback((word: string) => {
    if (selected.includes(word)) {
      setSelected((s) => s.filter((w) => w !== word));
      return;
    }
    if (selected.length >= 4) return;

    if (!RAINBOW_WORDS.includes(word)) {
      setShakingWord(word);
      setNudgeMessage("That one belongs to a different group — look for the Rainbow! 🌈");
      setTimeout(() => setShakingWord(null), 400);
      setTimeout(() => setNudgeMessage(null), 2500);
      return;
    }

    setSelected((s) => [...s, word]);
  }, [selected]);

  const handleRainbowSubmit = useCallback(() => {
    if (selected.length !== 4) return;
    if (selected.every((w) => RAINBOW_WORDS.includes(w))) {
      // Rainbow words STAY on the board — they show with rainbow styling and are locked
      setSelected([]);
      setPhase("rainbow-revealed");
    }
  }, [selected]);

  // ── Solve groups: rainbow words are locked ──
  const handleGroupWordClick = useCallback((word: string) => {
    if (RAINBOW_WORDS.includes(word)) return;
    if (selected.includes(word)) {
      setSelected((s) => s.filter((w) => w !== word));
      return;
    }
    if (selected.length >= 4) return;
    setSelected((s) => [...s, word]);
  }, [selected]);

  const handleGroupSubmit = useCallback(() => {
    if (selected.length !== 4) return;

    const matchedGroup = TUTORIAL_GROUPS.find(
      (g) => !solvedGroups.includes(g) && g.words.every((w) => selected.includes(w))
    );

    if (matchedGroup) {
      const newSolvedGroups = [...solvedGroups, matchedGroup];
      // Remove ALL of this group's words from the board (including its rainbow word)
      setSolvedGroupWords((prev) => [...prev, ...matchedGroup.words]);
      setSolvedGroups(newSolvedGroups);
      setSelected([]);

      if (newSolvedGroups.length === TUTORIAL_GROUPS.length) {
        setTimeout(() => setPhase("complete"), 600);
      }
    } else {
      const isOneAway = TUTORIAL_GROUPS.some(
        (g) =>
          !solvedGroups.includes(g) &&
          g.words.filter((w) => selected.includes(w)).length === 3
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
  }, [selected, solvedGroups]);

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
        <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
          <h2 className="text-base font-bold tracking-tight">How to Play</h2>
          <button
            onClick={handleClose}
            className="rounded-full p-1 hover:bg-secondary transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 pb-6">

          {/* ── WELCOME ── */}
          {phase === "welcome" && (
            <div className="flex flex-col items-center text-center gap-5 py-4">
              <div className="text-5xl">🌈</div>
              <div>
                <h3 className="text-lg font-bold mb-2">Welcome to Rainbow Categories!</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Every puzzle has <strong>5 categories</strong> — 4 normal ones, and a hidden{" "}
                  <strong>Rainbow</strong>.
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed mt-2">
                  The Rainbow is <strong>one word from each group</strong> that share a secret
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
                <p className="text-sm font-semibold">🌈 Find the 4 Rainbow words and select them</p>
                <p className="text-xs text-muted-foreground mt-1">One from each group shares a hidden connection</p>
              </div>

              <div style={{ minHeight: "1.5rem" }} className="text-center">
                {nudgeMessage && (
                  <p className="text-xs text-amber-500 font-medium">{nudgeMessage}</p>
                )}
              </div>

              <div className="grid grid-cols-4 gap-2">
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

              <p className="text-center text-xs text-muted-foreground">{selected.length} / 4 selected</p>

              <button
                onClick={handleRainbowSubmit}
                disabled={selected.length !== 4}
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
                <SolvedGroupBanner category="Colors of the Rainbow 🌈" words={RAINBOW_WORDS} isRainbow />
              </div>
              <div className="text-center">
                <p className="text-2xl mb-1">🎉</p>
                <p className="text-sm font-semibold">You spotted the Rainbow!</p>
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                  Now solve the remaining 4 groups. If you pick 3 from one of the main groups,
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
                <p className="text-sm font-semibold">Find all 4 groups</p>
                <p className="text-xs text-muted-foreground mt-1">Select 4 words that share something in common</p>
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
                <div className={`grid grid-cols-4 gap-2 ${shakingBoard ? "animate-shake" : ""}`}>
                  {visibleWords.map((word) => {
                    const isRainbowWord = RAINBOW_WORDS.includes(word);
                    return (
                      <WordTile
                        key={word}
                        word={word}
                        isSelected={selected.includes(word)}
                        isRainbow={isRainbowWord}
                        isShaking={false}
                        onClick={() => handleGroupWordClick(word)}
                        disabled={isRainbowWord}
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
                  disabled={selected.length !== 4}
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
                <SolvedGroupBanner category="Colors of the Rainbow 🌈" words={RAINBOW_WORDS} isRainbow />
                {TUTORIAL_GROUPS.map((g) => (
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

        </div>
      </div>
    </div>
  );
}
