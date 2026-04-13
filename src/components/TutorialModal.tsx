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

const RAINBOW_GROUP = {
  category: "Colors of the Rainbow",
  color: "bg-gradient-to-r from-red-400 via-yellow-400 via-green-400 to-blue-400",
};

const ALL_WORDS = TUTORIAL_GROUPS.flatMap((g) => g.words);

// Shuffle helper
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── Types ──────────────────────────────────────────────────────────────────

type Phase =
  | "welcome"
  | "rainbow-hunt"
  | "rainbow-revealed"
  | "solve-groups"
  | "complete";

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
        transition-all duration-150 active:scale-95 select-none
        ${isShaking ? "animate-shake" : ""}
        ${isSelected
          ? "bg-foreground text-background scale-95 shadow-inner"
          : isRainbow
          ? "rainbow-tile text-white shadow-md"
          : "bg-secondary text-foreground hover:bg-secondary/80"}
        ${disabled ? "opacity-50 cursor-default" : "cursor-pointer"}
      `}
    >
      {word}
    </button>
  );
}

function SolvedGroupBanner({
  category,
  words,
  color,
  isRainbow,
}: {
  category: string;
  words: string[];
  color: string;
  isRainbow?: boolean;
}) {
  return (
    <div
      className={`w-full rounded-xl py-3 px-4 text-white text-center animate-fade-up ${
        isRainbow
          ? "bg-gradient-to-r from-red-400 via-yellow-400 via-green-400 to-blue-400"
          : color
      }`}
    >
      <p className="text-xs font-bold uppercase tracking-widest opacity-90">
        {category}
      </p>
      <p className="text-sm font-semibold mt-0.5">
        {words.join(" · ")}
      </p>
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
  const [boardWords, setBoardWords] = useState<string[]>(() => shuffle(ALL_WORDS));
  const [selected, setSelected] = useState<string[]>([]);
  const [shakingWord, setShakingWord] = useState<string | null>(null);
  const [nudgeMessage, setNudgeMessage] = useState<string | null>(null);
  const [solvedGroups, setSolvedGroups] = useState<typeof TUTORIAL_GROUPS>([]);
  const [rainbowSolved, setRainbowSolved] = useState(false);
  const [oneAway, setOneAway] = useState(false);
  const [mistakes, setMistakes] = useState(0);
  const [shakingBoard, setShakingBoard] = useState(false);
  const [justSolvedRainbow, setJustSolvedRainbow] = useState(false);

  const reset = useCallback(() => {
    setPhase("welcome");
    setBoardWords(shuffle(ALL_WORDS));
    setSelected([]);
    setShakingWord(null);
    setNudgeMessage(null);
    setSolvedGroups([]);
    setRainbowSolved(false);
    setOneAway(false);
    setMistakes(0);
    setShakingBoard(false);
    setJustSolvedRainbow(false);
  }, []);

  const handleClose = useCallback(() => {
    onClose();
    // Reset after close animation
    setTimeout(reset, 300);
  }, [onClose, reset]);

  // ── Rainbow hunt phase logic ──
  const handleRainbowWordClick = useCallback((word: string) => {
    if (selected.includes(word)) {
      setSelected((s) => s.filter((w) => w !== word));
      return;
    }
    if (selected.length >= 4) return;

    if (!RAINBOW_WORDS.includes(word)) {
      // Nudge — not a rainbow word
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
    const allRainbow = selected.every((w) => RAINBOW_WORDS.includes(w));
    if (allRainbow) {
      setRainbowSolved(true);
      setBoardWords((prev) => prev.filter((w) => !RAINBOW_WORDS.includes(w)));
      setSelected([]);
      setJustSolvedRainbow(true);
      setPhase("rainbow-revealed");
    }
  }, [selected]);

  // ── Solve groups phase logic ──
  const handleGroupWordClick = useCallback((word: string) => {
    if (selected.includes(word)) {
      setSelected((s) => s.filter((w) => w !== word));
      return;
    }
    if (selected.length >= 4) return;
    setSelected((s) => [...s, word]);
  }, [selected]);

  const handleGroupSubmit = useCallback(() => {
    if (selected.length !== 4) return;

    // Find matching group
    const matchedGroup = TUTORIAL_GROUPS.find(
      (g) =>
        !solvedGroups.includes(g) &&
        g.words.every((w) => selected.includes(w))
    );

    if (matchedGroup) {
      setSolvedGroups((s) => [...s, matchedGroup]);
      setBoardWords((prev) => prev.filter((w) => !matchedGroup.words.includes(w)));
      setSelected([]);

      if (solvedGroups.length + 1 === TUTORIAL_GROUPS.length) {
        setTimeout(() => setPhase("complete"), 600);
      }
    } else {
      // Check one away
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

  const remainingWords = boardWords.filter(
    (w) => !solvedGroups.flatMap((g) => g.words).includes(w)
  );

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

        {/* Scrollable content */}
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
              {/* Instruction */}
              <div className="rounded-xl p-3 text-center"
                style={{ background: "hsl(var(--secondary))" }}>
                <p className="text-sm font-semibold">
                  🌈 Find the 4 Rainbow words and select them
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  One from each group shares a hidden connection
                </p>
              </div>

              {/* Nudge message */}
              <div className={`text-center transition-all duration-300 ${nudgeMessage ? "opacity-100 h-8" : "opacity-0 h-0 overflow-hidden"}`}>
                <p className="text-xs text-amber-500 font-medium">{nudgeMessage}</p>
              </div>

              {/* Board */}
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

              {/* Selected count */}
              <p className="text-center text-xs text-muted-foreground">
                {selected.length} / 4 selected
              </p>

              {/* Submit */}
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
              {/* Rainbow banner */}
              <div className="animate-fade-up">
                <SolvedGroupBanner
                  category="Colors of the Rainbow 🌈"
                  words={RAINBOW_WORDS}
                  color=""
                  isRainbow
                />
              </div>

              <div className="text-center">
                <p className="text-2xl mb-1">🎉</p>
                <p className="text-sm font-semibold">You spotted the Rainbow!</p>
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                  Now solve the remaining 4 groups. If you pick 3 from one of the main groups,
                  the game will give you a{" "}
                  <strong>"One Away"</strong> hint.
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
              {/* Instruction */}
              <div className="rounded-xl p-3 text-center"
                style={{ background: "hsl(var(--secondary))" }}>
                <p className="text-sm font-semibold">Find all 4 groups</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Select 4 words that share something in common
                </p>
              </div>

              {/* One away toast */}
              {oneAway && (
                <div className="flex justify-center animate-fade-up">
                  <div className="bg-foreground text-background px-5 py-2 rounded-full text-sm font-semibold shadow-md">
                    One away…
                  </div>
                </div>
              )}

              {/* Solved groups */}
              <div className="space-y-2">
                {solvedGroups.map((g) => (
                  <SolvedGroupBanner
                    key={g.category}
                    category={g.category}
                    words={g.words}
                    color={g.color}
                  />
                ))}
              </div>

              {/* Board */}
              {remainingWords.length > 0 && (
                <div className={`grid grid-cols-4 gap-2 ${shakingBoard ? "animate-shake" : ""}`}>
                  {remainingWords.map((word) => (
                    <WordTile
                      key={word}
                      word={word}
                      isSelected={selected.includes(word)}
                      isRainbow={false}
                      isShaking={false}
                      onClick={() => handleGroupWordClick(word)}
                      disabled={false}
                    />
                  ))}
                </div>
              )}

              {/* Mistakes */}
              {mistakes > 0 && (
                <p className="text-center text-xs text-muted-foreground">
                  Mistakes: {mistakes}
                </p>
              )}

              {/* Controls */}
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
              {/* All solved groups */}
              <div className="w-full space-y-2">
                <SolvedGroupBanner
                  category="Colors of the Rainbow 🌈"
                  words={RAINBOW_WORDS}
                  color=""
                  isRainbow
                />
                {TUTORIAL_GROUPS.map((g) => (
                  <SolvedGroupBanner
                    key={g.category}
                    category={g.category}
                    words={g.words}
                    color={g.color}
                  />
                ))}
              </div>

              <div>
                <p className="text-2xl mb-2">🎓</p>
                <p className="text-lg font-bold">You're ready to play!</p>
                <p className="text-sm text-muted-foreground mt-1">
                  A new puzzle drops every day.
                </p>
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
