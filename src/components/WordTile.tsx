interface WordTileProps {
  word: string;
  isSelected: boolean;
  onClick: () => void;
  disabled?: boolean;
  isRainbow?: boolean;
}

export function WordTile({ word, isSelected, onClick, disabled, isRainbow }: WordTileProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`tile-base h-16 text-xs sm:text-sm font-semibold rounded-lg transition-all duration-150 ease-out
        ${isRainbow
          ? `rainbow-tile text-white shadow-md ${isSelected ? "ring-[3px] ring-foreground ring-offset-2 ring-offset-background scale-[0.97]" : ""}`
          : isSelected
            ? "bg-tile-selected text-tile-selected-fg shadow-md scale-[0.97]"
            : "bg-tile hover:shadow-sm active:scale-95"
        }
        ${disabled ? "opacity-50 cursor-default" : ""}
      `}
    >
      {word}
    </button>
  );
}
