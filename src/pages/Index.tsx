import { useState } from "react";
import { GameHeader } from "@/components/GameHeader";
import { GameBoard } from "@/components/GameBoard";
import { StatsModal } from "@/components/StatsModal";
import { HowToPlayModal } from "@/components/HowToPlayModal";
import { getTodaysPuzzle } from "@/lib/puzzles";

export default function Index() {
  const [showStats, setShowStats] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const puzzle = getTodaysPuzzle();

  return (
    <div className="min-h-screen flex flex-col items-center pt-2 pb-12">
      <GameHeader
        onStatsClick={() => setShowStats(true)}
        onHowToPlayClick={() => setShowHelp(true)}
      />
      <div className="w-full max-w-lg border-b border-border mb-4" />
      <GameBoard puzzle={puzzle} />
      <StatsModal open={showStats} onClose={() => setShowStats(false)} />
      <HowToPlayModal open={showHelp} onClose={() => setShowHelp(false)} />
    </div>
  );
}
