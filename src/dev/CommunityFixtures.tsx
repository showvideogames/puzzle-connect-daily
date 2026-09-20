/**
 * DEV-ONLY visual fixtures for the custom-puzzle community layer (routed only
 * when import.meta.env.DEV; not part of the production bundle). Renders the
 * real components with static data so layouts can be checked at any width
 * without production data or database writes.
 *
 *   /__fixtures/community?view=custom&mode=classic|rainbow&creator=1&fav=1&long=1
 *   /__fixtures/community?view=creator[&empty=1]
 *   /__fixtures/community?view=favorites
 */
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { GameBoard } from "@/components/GameBoard";
import { GameHeader } from "@/components/GameHeader";
import { CustomPuzzleHeader } from "@/components/CustomPuzzleHeader";
import { CustomPuzzleCta } from "@/components/CustomPuzzleCta";
import { getSupportUrl } from "@/lib/supportUrl";
import { CommunityPuzzleCard } from "@/components/CommunityPuzzleCard";
import { SiteFooter } from "@/components/SiteFooter";
import { CreatorProfileView } from "@/pages/CreatorProfile";
import type { CreatorProfile, CreatorSort } from "@/lib/customPuzzles";
import type { Puzzle } from "@/lib/types";
import { loadSettings } from "@/lib/settings";

const fixturePuzzle = (rainbow: boolean, long: boolean): Puzzle => ({
  id: "fixture-share-id",
  date: "",
  title: long ? "An Unreasonably Long Puzzle Title About Golf Things" : "Golf Words",
  designerName: long ? "Bartholomew-Alexander Wolfeschlegelsteinhausenbergerdorff" : "Sam West",
  groups: [
    { category: "Colors", words: ["BLUE", "GREEN", "RED", "YELLOW"], difficulty: 1, hintWord: null },
    { category: "Car Parts", words: ["BATTERY", "HOOD", "TIRE", "TRUNK"], difficulty: 2, hintWord: null },
    { category: "Singers", words: ["HOUSTON", "MARS", "MERCURY", "SWIFT"], difficulty: 3, hintWord: null },
    { category: "___ House", words: ["BIRD", "DOG", "TREE", "WHITE"], difficulty: 4, hintWord: null },
  ],
  wordOrder: null,
  rainbowHerring: rainbow ? ["BLUE", "TIRE", "SWIFT", "TREE"] : null,
  rainbowCategoryName: rainbow ? "Mixed Bag" : null,
  isEmojiPuzzle: false,
  theme: null,
  alphabetizeCompleted: true,
  versionId: null,
  shortCode: "7Km2Qx8LpA",
});

const profile = (empty: boolean, sort: CreatorSort): CreatorProfile => {
  const all = [
    { title: "Golf Words", mode: "classic" as const, shortCode: "7Km2Qx8LpA", finishedPlays: 12, favoriteCount: 3, createdAt: "2026-09-19" },
    { title: "Puzzle 😈", mode: "rainbow" as const, shortCode: "Hn4Vt9WqEz", finishedPlays: 41, favoriteCount: 9, createdAt: "2026-09-18" },
    { title: "Things With Wings and a Very Long Descriptive Title", mode: "classic" as const, shortCode: "Bd3Rk6TuYa", finishedPlays: 5, favoriteCount: 0, createdAt: "2026-09-17" },
  ];
  const sorted = [...all].sort((a, b) =>
    sort === "plays" ? b.finishedPlays - a.finishedPlays : sort === "favorites" ? b.favoriteCount - a.favoriteCount : b.createdAt.localeCompare(a.createdAt)
  );
  return {
    displayName: "Sam West",
    publicSlug: "sam-west-k7m2",
    puzzleCount: empty ? 0 : all.length,
    totalPlays: empty ? 0 : 58,
    totalFavorites: empty ? 0 : 12,
    puzzles: empty ? [] : sorted,
  };
};

export default function CommunityFixtures() {
  const [params] = useSearchParams();
  const view = params.get("view") ?? "custom";
  const [sort, setSort] = useState<CreatorSort>("newest");
  const [favorited, setFavorited] = useState(params.get("fav") === "1");
  const [statsOpen, setStatsOpen] = useState(false);
  const rainbow = params.get("mode") === "rainbow";
  const long = params.get("long") === "1";
  const puzzle = fixturePuzzle(rainbow, long);

  return (
    <div className="min-h-screen flex flex-col items-center pt-2 pb-12">
      <GameHeader
        onStatsClick={() => {}}
        onHowToPlayClick={() => {}}
        onSettingsClick={() => {}}
        onHintClick={() => {}}
        showHint={view === "custom"}
        user={null}
        onSignOut={() => {}}
        simplifiedIcons
        wideHeader
      />
      <div className="w-full max-w-[840px] border-b border-border mb-3" />

      {view === "custom" && (
        <>
          <CustomPuzzleHeader
            title={puzzle.title!}
            designerName={puzzle.designerName}
            creatorSlug={params.get("creator") === "1" ? "sam-west-k7m2" : null}
            isRainbow={rainbow}
            onBack={() => {}}
            onOpenPuzzleStats={() => setStatsOpen(true)}
            favorite={{
              favorited,
              count: params.get("count") ? Number(params.get("count")) : favorited ? 4 : 3,
              onToggle: () => setFavorited((f) => !f),
              note: params.get("note") === "1" ? "Saved on this device" : null,
            }}
          />
          <GameBoard puzzle={puzzle} settings={loadSettings()} user={null} wideBoard showModeBadge={false} customMode statsOpen={statsOpen} onStatsOpenChange={setStatsOpen} />
          <CustomPuzzleCta supportUrl={getSupportUrl()} />
        </>
      )}
      {view === "creator" && (
        <CreatorProfileView
          profile={profile(params.get("empty") === "1", sort)}
          loading={false}
          notFound={false}
          sort={sort}
          onSort={setSort}
        />
      )}
      {view === "favorites" && (
        <main className="w-full max-w-[840px] px-4 flex-1">
          <h1 className="font-tile font-extrabold tracking-tight text-foreground text-3xl">Favorites</h1>
          <ul className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <CommunityPuzzleCard title="Golf Words" shortCode="7Km2Qx8LpA" mode="classic" designerName="Sam West" creatorSlug="sam-west-k7m2" favoriteCount={3} />
            <CommunityPuzzleCard title="Puzzle 😈" shortCode="Hn4Vt9WqEz" mode="rainbow" designerName="Anon Designer" creatorSlug={null} favoriteCount={9} />
          </ul>
        </main>
      )}
      <SiteFooter />
    </div>
  );
}
