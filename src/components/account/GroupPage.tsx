import { useId, useState } from "react";
import type { FriendResult } from "@/lib/friendResults";
import { leaveGroupQuestion, memberWords } from "@/lib/socialView";
import { accountCard, accountCardTitle, accountPanel, quietText } from "./accountStyles";
import { BackLink } from "./BackLink";
import { GroupEmblem } from "./GroupEmblem";
import type { GroupSummary } from "./GroupsTab";
import { InlineConfirm } from "./InlineConfirm";
import { InviteLinkButtons, type LinkAnswer } from "./InviteLinkButtons";
import { ResultRow, TodayHeading } from "./ResultRow";

export interface GroupView extends GroupSummary {
  isOwner: boolean;
  /** Only ever set for the owner, and it can be null for them too. */
  inviteCode: string | null;
}

interface GroupPageProps {
  group: GroupView;
  /** Everyone in the group, with today's result. Null until it has loaded. */
  results: readonly FriendResult[] | null;
  /** Why the group wouldn't load. */
  problem?: string | null;
  today: Date;
  onBack: () => void;
  onShare: () => Promise<LinkAnswer> | LinkAnswer;
  onCopy: () => Promise<LinkAnswer> | LinkAnswer;
  /** Answers with a sentence when leaving was refused. */
  onLeave: () => Promise<string | void>;
}

/** One group: who is in it, how they did today, and for its owner, the link. */
export function GroupPage({ group, results, problem, today, onBack, onShare, onCopy, onLeave }: GroupPageProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const id = useId();

  return (
    <main className={`${accountPanel} mx-auto w-full max-w-[32rem] px-5 pb-5 pt-2 sm:px-8 sm:pb-8 sm:pt-4`} data-testid="group-page">
      <BackLink onClick={onBack} />
      <div className="text-center">
        <GroupEmblem emblemId={group.emblemId} photo={group.photo} color={group.accentColor} size={112} className="max-sm:!h-20 max-sm:!w-20" />
        <h1 className="mt-2 font-tile text-[1.75rem] font-extrabold leading-[1.15] tracking-tight text-foreground [overflow-wrap:anywhere] [text-wrap:balance] sm:text-4xl">{group.name}</h1>
        <p className={`text-base ${quietText}`}>{memberWords(group.memberCount)}</p>
      </div>

      <TodayHeading today={today} />
      {problem && <p role="alert" className="mt-2 text-base font-medium text-destructive">{problem}</p>}
      {results && (
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
      )}

      {group.isOwner && group.inviteCode && (
        <section className={`${accountCard} mt-3`} aria-labelledby={`${id}-link`}>
          <h2 id={`${id}-link`} className={accountCardTitle}>Send an invitation</h2>
          <p className={`mt-0.5 text-base ${quietText}`}>Share a link with someone you know.</p>
          <InviteLinkButtons onShare={onShare} onCopy={onCopy} />
        </section>
      )}

      <div className="mt-3 flex justify-center">
        <InlineConfirm label="Leave group" question={leaveGroupQuestion(group.name)} confirmLabel="Leave" onConfirm={onLeave} />
      </div>
    </main>
  );
}
