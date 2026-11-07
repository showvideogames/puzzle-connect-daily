import { useId, type ReactNode } from "react";
import { ChevronDown, ChevronRight, ChevronUp } from "lucide-react";
import { canOpenResult, resultSummary, type FriendResult } from "@/lib/friendResults";
import { purpleText, rowMeta, rowName, sectionTitle } from "./accountStyles";
import { ProfileAvatar } from "./ProfileAvatar";
import { ResultDetail } from "./ResultDetail";

interface ResultRowProps {
  result: FriendResult;
  open: boolean;
  onToggle: () => void;
  /** Shown when the row is open, and makes a row with no result openable too. */
  actions?: ReactNode;
  navigation?: boolean;
  /** The animal picture's size; the group page uses a larger one. */
  avatarSize?: number;
}

/** One person's result today, for Friends and for a group alike. Name big and bold, the rest small. */
export function ResultRow({ result, open, onToggle, actions, navigation = false, avatarSize = 48 }: ResultRowProps) {
  const panel = useId();
  const person = (
    <>
      <ProfileAvatar animalId={result.animalId} backgroundColor={result.backgroundColor} size={avatarSize} />
      <span className="min-w-0 flex-1 text-left">
        <span className={`line-clamp-2 break-words ${rowName}`}>{result.isYou ? "You" : result.nickname || result.name}</span>
        {!result.isYou && result.favorite && <span className="block text-xs font-semibold text-slate">★ Favorite</span>}
        {!result.isYou && result.nickname && <span className="block truncate text-xs font-medium text-slate">{result.name}</span>}
        <span className={`block leading-snug ${rowMeta}`}>{resultSummary(result)}</span>
      </span>
    </>
  );
  return (
    <li className="border-t border-border first:border-t-0" data-testid="result-row" data-person={result.id}>
      {canOpenResult(result) || actions || navigation ? (
        <>
          <button
            type="button"
            aria-expanded={navigation ? undefined : open}
            aria-controls={navigation ? undefined : panel}
            onClick={onToggle}
            className="flex min-h-[4.5rem] w-full items-center gap-3 rounded-xl py-2 hover:bg-secondary/60
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(258_90%_52%)]"
          >
            {person}
            <span className={`flex shrink-0 items-center gap-0.5 text-sm font-bold ${purpleText}`}>
              {navigation ? <span className="sr-only">Profile</span> : open ? "Hide" : "Details"}
              {navigation ? <ChevronRight aria-hidden="true" className="h-5 w-5" /> : open
                ? <ChevronUp aria-hidden="true" className="h-5 w-5" />
                : <ChevronDown aria-hidden="true" className="h-5 w-5" />}
            </span>
          </button>
          {open && !navigation && (
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

/** The heading over a list of today's results, with the date small at the top right. */
export function TodayHeading({ today }: { today: Date }) {
  const date = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(today);
  return (
    <div className="flex items-start justify-between gap-3">
      <h2 className={sectionTitle}>Today</h2>
      <p className="shrink-0 pt-1 text-sm leading-5 text-slate">{date}</p>
    </div>
  );
}
