interface MistakeDotsProps {
  mistakes: number;
  max: number;
}

export function MistakeDots({ mistakes, max }: MistakeDotsProps) {
  return (
    <div className="flex items-center gap-1.5 justify-center">
      <span className="text-xs text-muted-foreground mr-1">Mistakes remaining:</span>
      {Array.from({ length: max }).map((_, i) => (
        <div
          key={i}
          className={`w-3 h-3 rounded-full transition-all duration-300 ${
            i < max - mistakes ? "bg-foreground" : "bg-border"
          }`}
        />
      ))}
    </div>
  );
}
