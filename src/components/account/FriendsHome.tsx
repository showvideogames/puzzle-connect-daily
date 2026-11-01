import { useId, useState, type ReactNode } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { ChevronDown, ChevronUp } from "lucide-react";
import { canOpenResult, resultSummary, type FriendResult } from "@/lib/friendResults";
import { accountPanel, outlineAction, primaryAction, quietText } from "./accountStyles";
import { ProfileAvatar } from "./ProfileAvatar";
import { ResultDetail } from "./ResultDetail";

export type FriendsTab = "friends" | "groups";

interface FriendsHomeProps {
  /** The game these results are from. */
  gameName: string;
  results: readonly FriendResult[];
  friendCode: string;
  tab: FriendsTab;
  onTabChange: (tab: FriendsTab) => void;
  onAddFriend: () => void;
  /** What the Groups tab shows. */
  groups: ReactNode;
  /** Used by tests. In the app this is simply today on this device. */
  today?: Date;
}

const tabButton =
  "h-12 flex-1 rounded-lg text-base font-semibold text-foreground transition-colors " +
  "data-[state=active]:bg-[hsl(258_46%_52%)] data-[state=active]:text-white " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(258_46%_52%)] focus-visible:ring-offset-2 focus-visible:ring-offset-card";

function ResultRow({ result, open, onToggle }: { result: FriendResult; open: boolean; onToggle: () => void }) {
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
      {canOpenResult(result) ? (
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
              <ResultDetail result={result} />
            </div>
          )}
        </>
      ) : (
        <div className="flex min-h-[4.5rem] items-center gap-3 py-2">{person}</div>
      )}
    </li>
  );
}

/**
 * Today's results first, with Friends and Groups side by side. Only people who
 * have played can be opened. A friend code is there to read out or copy.
 */
export function FriendsHome({ gameName, results, friendCode, tab, onTabChange, onAddFriend, groups, today = new Date() }: FriendsHomeProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  const date = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(today);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(friendCode);
      setCopied("yes");
    } catch {
      setCopied("no");
    }
  };

  return (
    <main className={`${accountPanel} mx-auto w-full max-w-[32rem] px-5 py-5 sm:px-8 sm:py-7`} data-testid="friends-home">
      <h1 className="font-tile text-[2rem] font-extrabold leading-[1.1] tracking-tight text-foreground sm:text-[2.5rem]">Friends</h1>
      <p className={`mt-0.5 text-base ${quietText}`}>{gameName}</p>

      <Tabs.Root value={tab} onValueChange={(value) => onTabChange(value as FriendsTab)} className="mt-3">
        <Tabs.List aria-label="Friends and groups" className="flex gap-1 rounded-xl bg-secondary p-1">
          <Tabs.Trigger value="friends" className={tabButton}>Friends</Tabs.Trigger>
          <Tabs.Trigger value="groups" className={tabButton}>Groups</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="friends" className="focus-visible:outline-none">
          <div className="mt-3 flex items-baseline justify-between gap-3">
            <h2 className="font-tile text-xl font-bold text-foreground">Today</h2>
            <p className={`text-base ${quietText}`}>{date}</p>
          </div>
          <ul className="mt-1">
            {results.map((result) => (
              <ResultRow
                key={result.id}
                result={result}
                open={openId === result.id}
                onToggle={() => setOpenId(openId === result.id ? null : result.id)}
              />
            ))}
          </ul>
          <button type="button" onClick={onAddFriend} className={`${primaryAction} mt-2 h-14 w-full text-lg`}>Add a friend</button>
          <p className="mt-3 text-center text-base text-foreground">
            Your friend code: <strong className="font-bold tracking-wide">{friendCode}</strong>
          </p>
          <button type="button" onClick={() => void copyCode()} className={`${outlineAction} mt-2 h-12 w-full text-base`}>Copy code</button>
          <p role="status" className={`mt-1 min-h-6 text-center text-base ${quietText}`}>
            {copied === "yes" ? "Copied." : copied === "no" ? "We couldn't copy that. You can read it out instead." : ""}
          </p>
        </Tabs.Content>

        <Tabs.Content value="groups" className="mt-4 focus-visible:outline-none">{groups}</Tabs.Content>
      </Tabs.Root>
    </main>
  );
}
