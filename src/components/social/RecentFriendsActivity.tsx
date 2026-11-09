import { useEffect, useState } from "react";
import type { FriendResult } from "@/lib/friendResults";
import { resultSummary } from "@/lib/friendResults";
import { ProfileAvatar } from "@/components/account/ProfileAvatar";
import { ActivityDate } from "@/components/account/ActivityDate";
import { purpleText, rowMeta, rowName } from "@/components/account/accountStyles";
import { readRecentActivity, type RecentActivity } from "./friendWeekData";
import { localPuzzleDate } from "@/lib/socialWeek";
import type { SocialApi } from "./socialApi";
export function RecentFriendsActivity({
  api,
  friends,
  onOpen,
}: {
  api: SocialApi;
  friends: readonly FriendResult[];
  onOpen: (friend: FriendResult) => void;
}) {
  const [revision, setRevision] = useState(0);
  const [date, setDate] = useState(() => localPuzzleDate(api.today()));
  const identity = friends
    .filter((f) => !f.isYou)
    .map((f) => f.id)
    .sort()
    .join("/");
  const key = `${identity}/${date}/${revision}`;
  const [read, setRead] = useState<{
    api: SocialApi;
    key: string;
    rows?: RecentActivity[];
    failed?: boolean;
  } | null>(null);
  useEffect(() => {
    const refresh = () => {
      setDate(localPuzzleDate(api.today()));
      setRevision((n) => n + 1);
    };
    const timer = window.setInterval(
      () => setDate(localPuzzleDate(api.today())),
      30000,
    );
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [api]);
  useEffect(() => {
    let active = true;
    void readRecentActivity(api, friends, new Date(`${date}T12:00:00`)).then(
      (rows) => {
        if (active) setRead({ api, key, rows });
      },
      () => {
        if (active) setRead({ api, key, failed: true });
      },
    );
    return () => {
      active = false;
    };
    // Current names and preferences are applied below without re-reading historical results.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, key]);
  const current = read?.api === api && read.key === key ? read : null;
  if (!current)
    return (
      <p role="status" className="py-2 text-sm font-medium text-slate">
        Loading activity…
      </p>
    );
  if (current.failed)
    return (
      <p role="status" className="text-base">
        Activity couldn't be loaded.{" "}
        <button
          className={`min-h-11 rounded-lg px-1 font-bold underline underline-offset-4 ${purpleText} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(258_90%_52%)]`}
          onClick={() => setRevision((n) => n + 1)}
        >
          Try again
        </button>
      </p>
    );
  if (!current.rows?.length)
    return (
      <p className="py-2 text-base text-slate">No recent activity</p>
    );
  return (
    <ul className="-mx-2 divide-y divide-border">
      {current.rows
        .slice(0, 6)
        .map(({ date, result, puzzleId, puzzleTitle }) => {
          const friend = friends.find((f) => f.id === result.id);
          if (!friend) return null;
          return (
            <li key={`${puzzleId}/${friend.id}`}>
              <button
                onClick={() => onOpen(friend)}
                className="flex min-h-[4.5rem] w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(258_90%_52%)]"
              >
                <ProfileAvatar
                  animalId={friend.animalId}
                  backgroundColor={friend.backgroundColor}
                  size={48}
                />
                <span className="min-w-0 flex-1">
                  <strong className={`line-clamp-2 break-words ${rowName}`}>
                    {friend.nickname || friend.name}
                  </strong>
                  <span className={`block ${rowMeta}`}>
                    {resultSummary(result)}
                  </span>
                  {puzzleTitle && (
                    <span className="block text-xs font-medium text-slate">
                      Puzzle {puzzleTitle}
                    </span>
                  )}
                </span>
                <ActivityDate date={date} />
              </button>
            </li>
          );
        })}
    </ul>
  );
}
