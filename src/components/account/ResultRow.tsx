import { useId, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { canOpenResult, resultSummary, type FriendResult } from "@/lib/friendResults";
import { quietText } from "./accountStyles";
import { ProfileAvatar } from "./ProfileAvatar";
import { ResultDetail } from "./ResultDetail";

interface ResultRowProps {
  result: FriendResult;
  open: boolean;
  onToggle: () => void;
  /** Shown when the row is open, and makes a row with no result openable too. */
  actions?: ReactNode;
}

/** One person's result today, for Friends and for a group alike. */
export function ResultRow({ result, open, onToggle, actions }: ResultRowProps) {
  const panel = useId();
  const person = (
    <>
      <ProfileAvatar animalId={result.animalId} backgroundColor={result.backgroundColor} size={56} />
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-lg font-bold leading-tight text-foreground">{result.isYou ? "You" : result.name}</span>
        <span className={`block text-base leading-snug ${quietText}`}>{resultSummary(result)}</span>
      </span>
    </>
  );
  return (
    <li className="border-t border-border first:border-t-0" data-testid="result-row" data-person={result.id}>
      {canOpenResult(result) || actions ? (
        <>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panel}
            onClick={onToggle}
            className="flex min-h-[4.5rem] w-full items-center gap-3 rounded-lg py-2 hover:bg-secondary/60
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(258_46%_52%)]"
          >
            {person}
            <span className="flex shrink-0 items-center gap-0.5 text-base font-semibold text-[hsl(258_46%_42%)] dark:text-[hsl(258_80%_82%)]">
              {open ? "Hide" : "Details"}
              {open
                ? <ChevronUp aria-hidden="true" className="h-5 w-5" />
                : <ChevronDown aria-hidden="true" className="h-5 w-5" />}
            </span>
          </button>
          {open && (
            <div id={panel} className="px-1 pb-3 pt-1">
              {canOpenResult(result) && <ResultDetail result={result} />}
              {actions}
            </div>
          )}
        </>
      ) : (
        <div className="flex min-h-[4.5rem] items-center gap-3 py-2">{person}</div>
      )}
    </li>
  );
}

/** The heading over a list of today's results. */
export function TodayHeading({ today }: { today: Date }) {
  const date = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(today);
  return (
    <div className="mt-3 flex items-baseline justify-between gap-3">
      <h2 className="font-tile text-xl font-bold text-foreground">Today</h2>
      <p className={`text-base ${quietText}`}>{date}</p>
    </div>
  );
}
