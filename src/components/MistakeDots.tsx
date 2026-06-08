interface MistakeDotsProps {
  mistakes: number;
  max: number;
}

// All segments use the same neutral grey, regardless of mistake count
const SEGMENT_COLORS = [
  "bg-gray-400",
  "bg-gray-400",
  "bg-gray-400",
  "bg-gray-400",
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
