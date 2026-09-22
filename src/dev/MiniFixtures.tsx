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
 *
 * Combinable: ?rainbow=1&long=1 is the worst case for the bonus card, whose
 * solved-answers row has to hold three long words on a 320px screen.
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

function fixturePuzzle(formatId: "full" | "mini", long: boolean, rainbow: boolean): Puzzle {
  const format = getFormat(formatId);
  const words = formatId === "mini" ? (long ? MINI_WORDS_LONG : MINI_WORDS) : FULL_WORDS;
  const categories = formatId === "mini" ? CATEGORIES : ["Colors", "Car Parts", "Singers", "___ House"];
  // The FIRST answer of each category — one per category, which is exactly
  // what a Rainbow is on either format. Built from the same `words` the board
  // is, so it can never name a tile the board does not have.
  const herring = rainbow ? words.map((w) => w[0]) : null;
  return {
    // Distinct per variant: the fixtures share the real progress layer, so
    // two different boards under one id would resume each other's saved game.
    id: `fixture-${formatId}${long ? "-long" : ""}${rainbow ? "-rainbow" : ""}`,
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
      categoryEmoji: null,
    })),
    wordOrder: words.flat(),
    rainbowHerring: herring,
    rainbowCategoryName: rainbow ? "Hidden Trio" : null,
    rainbowHintWord: rainbow ? "SECRET" : null,
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
  const puzzle = fixturePuzzle(formatId, long, rainbow);
  const format = getFormat(formatId);

  return (
    <div className="min-h-screen flex flex-col items-center pt-2 pb-12">
      <GameHeader showHint user={null} onSignOut={() => {}} variant="minimal" format={format} />
      <div className="w-full max-w-[840px] border-b border-divider mb-2" />
      <p className="text-xs text-muted-foreground mb-2">
        DEV FIXTURE — {format.name} {format.sizeLabel}
        {rainbow ? " Rainbow" : " Classic"}
        {long ? " (long answers)" : ""}
      </p>
      <GameBoard
        key={`${formatId}-${long}-${rainbow}`}
        puzzle={puzzle}
        settings={loadSettings()}
        variant="dailyHomepage"
        showModeBadge={false}
      />
      <SiteFooter />
    </div>
  );
}
