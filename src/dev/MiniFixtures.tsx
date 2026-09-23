/**
 * DEV-ONLY fixtures for the Mini 3×3 board (routed only when
 * import.meta.env.DEV — not part of the production bundle, and it writes
 * nothing to any database).
 *
 * It exists because no Mini puzzle has been published: the Mini migration is
 * written but deliberately not applied, so /mini correctly shows its
 * unavailable state and there is no real 3×3 board to look at. This renders
 * the REAL GameBoard with the REAL Mini format on deterministic content, so
 * the responsive grid, tile sizing, controls and share grid can be checked at
 * any width.
 *
 *   /__fixtures/mini             a Classic Mini 3×3 board
 *   /__fixtures/mini?rainbow=1   a Rainbow Mini — one answer per category
 *   /__fixtures/mini?format=full the same fixture as a Full 4×4, for comparison
 *   /__fixtures/mini?long=1      the longest answers the tiles must survive
 *   /__fixtures/mini?emoji=1     every category carries a Category Emoji
 *   /__fixtures/mini?hintonly=1  the same, but the last category's visual is
 *                                Hint Only: shown in the Full Hint, withheld
 *                                from its solved bar (implies ?emoji=1)
 *   /__fixtures/mini?hint=1      opens the Full Hint straight away, so the
 *                                two places a visual can appear are visible
 *                                on one screen
 *
 * Combinable: ?rainbow=1&long=1 is the worst case for the bonus card, whose
 * solved-answers row has to hold three long words on a 320px screen, and
 * ?rainbow=1&hintonly=1 shows Hint Only on both kinds of solved bar at once.
 */
import { useSearchParams } from "react-router-dom";
import { GameBoard } from "@/components/GameBoard";
import { GameHeader } from "@/components/GameHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { loadSettings } from "@/lib/settings";
import { getFormat } from "@/lib/puzzleFormat";
import type { Puzzle } from "@/lib/types";

const MINI_WORDS = [
  ["HOOD", "TIRE", "TRUNK"],
  ["MARS", "MERCURY", "SWIFT"],
  ["BIRD", "DOG", "WHITE"],
];
const MINI_WORDS_LONG = [
  ["WINDSCREEN", "SUSPENSION", "TRANSMISSION"],
  ["SPRINGSTEEN", "MORISSETTE", "BEYONCÉ"],
  ["GINGERBREAD", "LIGHTHOUSE", "GREENHOUSE"],
];

const FULL_WORDS = [
  ["BLUE", "GREEN", "RED", "YELLOW"],
  ["BATTERY", "HOOD", "TIRE", "TRUNK"],
  ["HOUSTON", "MARS", "MERCURY", "SWIFT"],
  ["BIRD", "DOG", "TREE", "WHITE"],
];

const CATEGORIES = ["Car Parts", "Singers", "___ House"];

// One visual per category, in the same order as CATEGORIES. The last is the
// case Hint Only exists for: "___ 💬" reads as a clue to "___ House" but as
// noise appended to the solved answer.
const MINI_EMOJI = ["🚘", "🎤", "___ 💬"];
const FULL_EMOJI = ["🎨", "🚘", "🎤", "___ 💬"];

function fixturePuzzle(
  formatId: "full" | "mini",
  long: boolean,
  rainbow: boolean,
  emoji: boolean,
  hintOnly: boolean
): Puzzle {
  const format = getFormat(formatId);
  const words = formatId === "mini" ? (long ? MINI_WORDS_LONG : MINI_WORDS) : FULL_WORDS;
  const categories = formatId === "mini" ? CATEGORIES : ["Colors", "Car Parts", "Singers", "___ House"];
  // The FIRST answer of each category — one per category, which is exactly
  // what a Rainbow is on either format. Built from the same `words` the board
  // is, so it can never name a tile the board does not have.
  const herring = rainbow ? words.map((w) => w[0]) : null;
  const emojis = formatId === "mini" ? MINI_EMOJI : FULL_EMOJI;
  return {
    // Distinct per variant: the fixtures share the real progress layer, so
    // two different boards under one id would resume each other's saved game.
    id: `fixture-${formatId}${long ? "-long" : ""}${rainbow ? "-rainbow" : ""}${emoji ? "-emoji" : ""}${hintOnly ? "-hintonly" : ""}`,
    format: formatId,
    date: "2026-09-21",
    title: "#1",
    designerName: "Sam West",
    groups: words.map((w, i) => ({
      category: categories[i],
      words: w,
      // Straight from the format, so the fixture cannot drift from the real
      // colour ladder.
      difficulty: format.difficultyOrder[i],
      hintWord: null,
      categoryEmoji: emoji ? emojis[i] : null,
      // Only the last category — so one board shows both behaviours side by
      // side: the others append their visual, this one does not.
      categoryEmojiHintOnly: hintOnly && i === words.length - 1,
    })),
    wordOrder: words.flat(),
    rainbowHerring: herring,
    rainbowCategoryName: rainbow ? "Hidden Trio" : null,
    rainbowHintWord: rainbow ? "SECRET" : null,
    rainbowCategoryEmoji: rainbow && emoji ? "___ 💬" : null,
    rainbowCategoryEmojiHintOnly: rainbow && hintOnly,
    isEmojiPuzzle: false,
    theme: null,
    alphabetizeCompleted: true,
    versionId: null,
  };
}

export default function MiniFixtures() {
  const [params] = useSearchParams();
  const formatId = params.get("format") === "full" ? "full" : "mini";
  const long = params.get("long") === "1";
  const rainbow = params.get("rainbow") === "1";
  // Hint Only needs a visual to withhold, so it implies ?emoji=1.
  const hintOnly = params.get("hintonly") === "1";
  const emoji = hintOnly || params.get("emoji") === "1";
  const hint = params.get("hint") === "1";
  const puzzle = fixturePuzzle(formatId, long, rainbow, emoji, hintOnly);
  const format = getFormat(formatId);

  return (
    <div className="min-h-screen flex flex-col items-center pt-2 pb-12">
      <GameHeader showHint user={null} onSignOut={() => {}} variant="minimal" format={format} />
      <div className="w-full max-w-[840px] border-b border-divider mb-2" />
      <p className="text-xs text-muted-foreground mb-2">
        DEV FIXTURE — {format.name} {format.sizeLabel}
        {rainbow ? " Rainbow" : " Classic"}
        {long ? " (long answers)" : ""}
        {emoji ? (hintOnly ? " · Category Emoji, last one Hint Only" : " · Category Emoji") : ""}
      </p>
      <GameBoard
        key={`${formatId}-${long}-${rainbow}-${emoji}-${hintOnly}-${hint}`}
        puzzle={puzzle}
        settings={loadSettings()}
        variant="dailyHomepage"
        showModeBadge={false}
        fullHintUsed={hint}
      />
      <SiteFooter />
    </div>
  );
}
