interface MistakeDotsProps {
  mistakes: number;
  max: number;
  playing: boolean;
}

export function MistakeDots({ mistakes, max, playing }: MistakeDotsProps) {
  const remaining = Math.max(0, max - mistakes);
  return (
    <div className="mx-auto flex h-6 w-fit items-center justify-center gap-3">
      {/* The board's feedback live region announces losses. This static
          description keeps the count available without announcing it twice. */}
      <span className="sr-only" data-testid="lives-remaining">
        {remaining} of {max} lives remaining
      </span>
      <div aria-hidden="true" className="contents">
        {playing && remaining === 1 && (
          <span className="whitespace-nowrap text-sm font-bold text-[#6d38b5] dark:text-[#c9a7ff]">
            Last Life
          </span>
        )}
        <div className="flex items-center gap-1.5">
          {Array.from({ length: max }, (_, i) => (
            <span
              key={i}
              data-life={i < remaining ? "filled" : "spent"}
              className={`h-2 w-[23px] rounded-full border transition-colors duration-200 motion-reduce:transition-none ${
                i < remaining
                  ? "border-[#6d38b5] bg-[#6d38b5] dark:border-[#c9a7ff] dark:bg-[#c9a7ff]"
                  : "border-[#8c7c9e] dark:border-[#ab99bd]"
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
