interface MistakeDotsProps {
  mistakes: number;
  max: number;
}

// Left to right — matches the category color order used elsewhere in the game
const SEGMENT_COLORS = [
  "bg-orange-400",
  "bg-green-500",
  "bg-blue-500",
  "bg-red-500",
];

export function MistakeDots({ mistakes, max }: MistakeDotsProps) {
  return (
    <div className="flex items-center gap-1.5 justify-center">
      <span className="text-xs text-muted-foreground mr-1">Mistakes remaining:</span>
      {Array.from({ length: max }).map((_, i) => (
        <div
          key={i}
          className={`w-6 h-2.5 rounded-full transition-colors duration-300 ${
            i < max - mistakes ? SEGMENT_COLORS[i] ?? "bg-foreground" : "bg-muted"
          }`}
        />
      ))}
    </div>
  );
}
