import { useState, type ReactNode } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import type { FriendResult } from "@/lib/friendResults";
import { accountPanel, outlineAction, primaryAction, quietText } from "./accountStyles";
import { ResultRow, TodayHeading } from "./ResultRow";

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
  /** What an opened row offers. Null for a row with nothing to offer. */
  rowActions?: (result: FriendResult) => ReactNode;
  /** Opens the profile editor, from the top of both tabs. */
  onEditProfile?: () => void;
  /** Shown at the end of the Friends tab, such as the people this person has blocked. */
  friendsFooter?: ReactNode;
}

const tabButton =
  "h-12 flex-1 rounded-lg text-base font-semibold text-foreground transition-colors " +
  "data-[state=active]:bg-[hsl(258_46%_52%)] data-[state=active]:text-white " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(258_46%_52%)] focus-visible:ring-offset-2 focus-visible:ring-offset-card";

/**
 * Today's results first, with Friends and Groups side by side. People who have
 * played can be opened, and so can anyone with actions. A friend code is there
 * to read out or copy.
 */
export function FriendsHome({ gameName, results, friendCode, tab, onTabChange, onAddFriend, groups, today = new Date(), rowActions, onEditProfile, friendsFooter }: FriendsHomeProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);

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
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-tile text-[2rem] font-extrabold leading-[1.1] tracking-tight text-foreground sm:text-[2.5rem]">Friends</h1>
          <p className={`mt-0.5 text-base ${quietText}`}>{gameName}</p>
        </div>
        {onEditProfile && (
          <button type="button" onClick={onEditProfile} className={`${outlineAction} mt-1 h-11 shrink-0 px-4 text-base`}>Edit profile</button>
        )}
      </div>

      <Tabs.Root value={tab} onValueChange={(value) => onTabChange(value as FriendsTab)} className="mt-3">
        <Tabs.List aria-label="Friends and groups" className="flex gap-1 rounded-xl bg-secondary p-1">
          <Tabs.Trigger value="friends" className={tabButton}>Friends</Tabs.Trigger>
          <Tabs.Trigger value="groups" className={tabButton}>Groups</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="friends" className="focus-visible:outline-none">
          <TodayHeading today={today} />
          <ul className="mt-1">
            {results.map((result) => (
              <ResultRow
                key={result.id}
                result={result}
                open={openId === result.id}
                onToggle={() => setOpenId(openId === result.id ? null : result.id)}
                actions={rowActions?.(result)}
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
          {friendsFooter}
        </Tabs.Content>

        <Tabs.Content value="groups" className="mt-4 focus-visible:outline-none">{groups}</Tabs.Content>
      </Tabs.Root>
    </main>
  );
}
