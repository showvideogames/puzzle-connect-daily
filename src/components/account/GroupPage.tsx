import { useEffect, useState, type ReactNode } from "react";
import type { FriendResult } from "@/lib/friendResults";
import { memberWords } from "@/lib/socialView";
import { accountCard, quietText } from "./accountStyles";
import { BackLink } from "./BackLink";
import { GroupEmblem } from "./GroupEmblem";
import { GroupInviteDialog } from "./GroupInviteDialog";
import { GroupSettingsDialog } from "./GroupSettingsDialog";
import { groupPanel } from "./groupStyles";
import type { GroupSummary } from "./GroupsTab";
import type { LinkAnswer } from "./InviteLinkButtons";
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
  standings?: ReactNode;
  canInvite?: boolean;
  invitationProblem?: string | null;
  onDelete?: () => Promise<string | void>;
  onEditPicture?: () => void;
  onMembers?: () => void;
  description?: string | null;
  descriptionProblem?: string | null;
  onEditDescription?: () => void;
  onShare: () => Promise<LinkAnswer> | LinkAnswer;
  onCopy: () => Promise<LinkAnswer> | LinkAnswer;
  /** Answers with a sentence when leaving was refused. */
  onLeave: () => Promise<string | void>;
  /** True when the page is coming back from members or an editor the settings opened, so focus returns to the gear. */
  returnToSettings?: boolean;
}

/** One group: who is in it, how they did today, and for whoever may invite, the link. */
export function GroupPage({ group, results, problem, today, onBack, onShare, onCopy, onLeave, onEditPicture, onMembers, description, descriptionProblem, onEditDescription, onDelete, canInvite, invitationProblem, standings, returnToSettings }: GroupPageProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const mayInvite = Boolean((canInvite ?? group.isOwner) && group.inviteCode);
  // The Invite button goes away the moment permission does, and must not reopen by itself if it comes back.
  useEffect(() => {
    if (!mayInvite) setInviting(false);
  }, [mayInvite]);
  const inviteOpen = mayInvite && inviting;

  return (
    <main className={`${groupPanel} pb-5 pt-2 sm:px-8 sm:pb-8 sm:pt-4`} data-testid="group-page">
      <div className="flex min-h-12 items-center justify-between gap-2">
        <BackLink onClick={onBack} />
        <div className="flex shrink-0 items-center gap-2">
          {mayInvite && (
            <GroupInviteDialog groupName={group.name} open={inviteOpen} onOpenChange={setInviting} problem={invitationProblem} onShare={onShare} onCopy={onCopy} />
          )}
          <GroupSettingsDialog
            groupName={group.name}
            isOwner={group.isOwner}
            onEditDescription={onEditDescription}
            onEditPicture={onEditPicture}
            onMembers={onMembers}
            onDelete={onDelete}
            onLeave={onLeave}
            focusOnMount={returnToSettings}
          />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-4 sm:gap-5 max-[359px]:flex-col max-[359px]:items-start">
        <GroupEmblem
          emblemId={group.emblemId}
          photo={group.photo}
          color={group.accentColor}
          size={112}
          className="!rounded-[1.75rem] shadow-sm max-sm:!h-[88px] max-sm:!w-[88px] max-sm:!rounded-3xl"
        />
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-black leading-[1.08] tracking-tight text-foreground break-words [text-wrap:balance] sm:text-4xl">{group.name}</h1>
          <p className={`mt-1 text-lg ${quietText}`}>{memberWords(group.memberCount)}</p>
        </div>
      </div>

      {description && <p className="mt-4 whitespace-pre-wrap break-words text-base text-foreground" data-testid="group-description">{description}</p>}
      {invitationProblem && !inviteOpen && <p role="alert" className="mt-3 text-destructive">{invitationProblem}</p>}
      {descriptionProblem && <p role="alert" className="mt-3 text-destructive">{descriptionProblem}</p>}

      <section className={`${accountCard} mt-5`}>
        <TodayHeading today={today} />
        {problem && <p role="alert" className="mt-2 text-base font-medium text-destructive">{problem}</p>}
        {results && (
          <ul className="mt-1">
            {results.filter(result=>result.status!=='not-played').map((result) => (
              <ResultRow
                key={result.id}
                result={result}
                open={openId === result.id}
                onToggle={() => setOpenId(openId === result.id ? null : result.id)}
                avatarSize={56}
              />
            ))}
          </ul>
        )}

        {results && !problem && !results.some(result=>result.status!=='not-played') && <p className="mt-3 text-slate">No recent activity</p>}
      </section>
      {standings}
    </main>
  );
}
