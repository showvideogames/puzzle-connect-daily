import { useEffect, useState } from "react";
import { Puzzle } from "lucide-react";
import { ActivityDate } from "@/components/account/ActivityDate";
import { shortDate } from "@/components/account/activityDates";
import { accountCard, purpleText, quietText, sectionTitle } from "@/components/account/accountStyles";
import { ResultDetail } from "@/components/account/ResultDetail";
import { resultSummary, type FriendResult } from "@/lib/friendResults";
import { readFriendWeek, type DayResult } from "./friendWeekData";
import { localPuzzleDate } from "@/lib/socialWeek";
import type { SocialApi } from "./socialApi";

export function FriendWeek({
  api,
  friend,
}: {
  api: SocialApi;
  friend: FriendResult;
}) {
  const [revision, setRevision] = useState(0);
  const [date, setDate] = useState(() => localPuzzleDate(api.today()));
  const [read, setRead] = useState<{
    api: SocialApi;
    key: string;
    days?: DayResult[];
    failed?: boolean;
  } | null>(null);
  const key = `${friend.id}/${date}/${revision}`;
  useEffect(() => {
    const refresh = () => {
      setDate(localPuzzleDate(api.today()));
      setRevision((value) => value + 1);
    };
    const timer = window.setInterval(
      () => setDate(localPuzzleDate(api.today())),
      30_000,
    );
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [api]);
  useEffect(() => {
    let active = true;
    void readFriendWeek(api, friend, new Date(`${date}T12:00:00`)).then(
      (days) => {
        if (active) setRead({ api, key, days });
      },
      () => {
        if (active) setRead({ api, key, failed: true });
      },
    );
    return () => {
      active = false;
    };
    // Identity, day and explicit refresh determine this read, not today's result object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, key]);
  const current = read?.api === api && read.key === key ? read : null;
  // Recent completions know when someone finished; the weekly reader only knows which day's puzzle it was.
  const recent = !!api.recentActivity;
  return (
    <section className={`${accountCard} mt-6`} aria-label="Recent activity">
      <h2 className={sectionTitle}>Recent activity</h2>
      <p className={`mt-0.5 text-sm font-medium ${quietText}`}>{recent ? "Last 7 days · first completions" : "Last 7 days"}</p>
      {!current ? (
        <p role="status" className="mt-3 text-sm font-medium text-slate">Loading weekly activity…</p>
      ) : current.failed ? (
        <div role="status" className="mt-3">
          <p>Weekly activity couldn't be loaded.</p>
          <button
            className={`min-h-11 rounded-lg px-1 font-bold underline underline-offset-4 ${purpleText} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(258_90%_52%)]`}
            onClick={() => setRevision((value) => value + 1)}
          >
            Try again
          </button>
        </div>
      ) : !current.days?.some(
          (day) => day.result && day.result.status !== "not-played",
        ) ? (
        <p className="mt-3 text-slate">{recent ? "No recent activity" : "No puzzles played in the last 7 days."}</p>
      ) : (
        <ol className="mt-2 divide-y divide-border" aria-label={recent ? "Latest 25 completions" : "Puzzles played in the last 7 days"}>
          {current.days
            .filter((day) => day.result && day.result.status !== "not-played")
            .slice()
            .map((day) => {
              const result = day.result!;
              return (
                <li key={day.puzzleId} className="py-3">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[hsl(258_100%_95%)] text-[hsl(258_90%_50%)] dark:bg-[hsl(258_55%_20%)] dark:text-[hsl(258_100%_86%)]">
                      <Puzzle aria-hidden="true" className="h-6 w-6" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-bold text-foreground">{resultSummary(result)}</p>
                      <p className="break-words text-sm text-slate">
                        {day.puzzleTitle
                          ? `Puzzle ${day.puzzleTitle}`
                          : "Daily puzzle"}
                        {day.puzzleDate && day.puzzleDate !== day.date ? ` · Published ${shortDate(day.puzzleDate)}` : ""}
                      </p>
                    </div>
                    <ActivityDate date={day.date} prefix={recent ? "Played" : "Puzzle for"} />
                  </div>
                  {result.detail === null ? (
                    <p className={`${quietText} mt-1 pl-14 text-sm`}>
                      Finish this same puzzle to see their details.
                    </p>
                  ) : (
                    <details className="mt-1 pl-14">
                      <summary className={`min-h-11 cursor-pointer py-2.5 text-sm font-bold ${purpleText}`}>
                        View details
                      </summary>
                      <ResultDetail result={result} />
                    </details>
                  )}
                </li>
              );
            })}
        </ol>
      )}
    </section>
  );
}
