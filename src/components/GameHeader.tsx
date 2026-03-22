import { BarChart3, HelpCircle } from "lucide-react";

interface GameHeaderProps {
  onStatsClick: () => void;
  onHowToPlayClick: () => void;
}

export function GameHeader({ onStatsClick, onHowToPlayClick }: GameHeaderProps) {
  return (
    <header className="flex items-center justify-between w-full max-w-lg mx-auto py-4 px-2">
      <h1 className="text-2xl font-bold tracking-tight">Connections</h1>
      <div className="flex items-center gap-2">
        <button
          onClick={onHowToPlayClick}
          className="p-2 rounded-lg hover:bg-secondary transition-colors duration-150 active:scale-95"
          aria-label="How to play"
        >
          <HelpCircle className="w-5 h-5 text-muted-foreground" />
        </button>
        <button
          onClick={onStatsClick}
          className="p-2 rounded-lg hover:bg-secondary transition-colors duration-150 active:scale-95"
          aria-label="Stats"
        >
          <BarChart3 className="w-5 h-5 text-muted-foreground" />
        </button>
      </div>
    </header>
  );
}
