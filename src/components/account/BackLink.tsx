import { ChevronLeft } from "lucide-react";

export function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-ml-2 inline-flex h-12 items-center gap-1 rounded-lg px-2 text-base font-semibold text-[hsl(258_46%_42%)] dark:text-[hsl(258_80%_82%)]
        hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ChevronLeft aria-hidden="true" className="h-5 w-5" />
      Back
    </button>
  );
}
