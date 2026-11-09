import { useEffect, useRef } from 'react';
import type { GroupMemberView } from '@/lib/socialView';
import type { GroupView } from './GroupPage';
import { quietText, rowMeta, rowName } from './accountStyles';
import { groupPanel } from './groupStyles';
import { BackLink } from './BackLink';
import { InlineConfirm } from './InlineConfirm';
import { ProfileAvatar } from './ProfileAvatar';

interface Props {
  group: GroupView;
  members: readonly GroupMemberView[] | null;
  problem?: string | null;
  note?: string | null;
  onBack: () => void;
  grantedInviters?: readonly string[];
  invitationProblem?: string | null;
  onInvitePermission?: (member: GroupMemberView, allowed: boolean) => Promise<string | void>;
  onTransfer?: (member: GroupMemberView) => Promise<string | void>;
  onRemove: (member: GroupMemberView) => Promise<string | void>;
}

/** The membership roster stays separate from result sorting and never shows puzzle details. */
export function GroupMembers({ group, members, problem, note, onBack, onRemove, onTransfer, grantedInviters, onInvitePermission, invitationProblem }: Props) {
  // Opened from the group's settings dialog, so focus lands on the heading rather than dropping to the page.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return <main className={`${groupPanel} pb-5 pt-2 sm:px-8`}>
    <BackLink onClick={onBack} />
    <h1 ref={heading} tabIndex={-1} className="mt-2 rounded-md text-3xl font-black leading-none tracking-tight text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(258_90%_52%)] sm:text-4xl">Members</h1>
    <p className={`mt-2 text-base ${quietText} break-words`}>{group.name}</p>
    {invitationProblem && <p role="alert" className="mt-3 text-destructive">{invitationProblem}</p>}
    {note && <p role="status" className="mt-3 text-base">{note}</p>}
    {!members && (problem ? <p role="alert" className="mt-3 text-destructive">{problem}</p> : <p role="status" className="mt-3">Loading members…</p>)}
    {members && <ul className="mt-3 divide-y divide-border" aria-label="Group members">
      {members.map(member => <li key={member.memberRef} className="py-3">
        <div className="flex items-center gap-3">
          <ProfileAvatar animalId={member.animalId} backgroundColor={member.backgroundColor} size={44} />
          <div className="min-w-0 flex-1">
            <p className={`${rowName} break-words`}>{member.name}{member.isMe ? ' (you)' : ''}</p>
            {member.isOwner && <p className={rowMeta}>Owner</p>}
          </div>
        </div>
        {group.isOwner && !member.isMe && !member.isOwner && <div className="mt-2 [&_button]:min-h-11 [&_button]:h-auto">
          {onInvitePermission && grantedInviters && <InlineConfirm
            tone={grantedInviters.includes(member.memberRef) ? "danger" : "primary"}
            label={`${grantedInviters.includes(member.memberRef) ? "Stop" : "Allow"} invitations for ${member.name}`}
            question={grantedInviters.includes(member.memberRef) ? `Stop ${member.name} from getting the invitation link? Existing shared links will keep working.` : `Allow ${member.name} to use this group's invitation link?`}
            confirmLabel={grantedInviters.includes(member.memberRef) ? "Stop invitations" : "Allow invitations"}
            onConfirm={() => onInvitePermission(member, !grantedInviters.includes(member.memberRef))} />}
          {onTransfer && <InlineConfirm label={`Make ${member.name} owner`} question={`Make ${member.name} the owner of ${group.name}? You will remain a member and lose owner controls.`} confirmLabel="Transfer ownership" onConfirm={() => onTransfer(member)} />}
          <InlineConfirm label={`Remove ${member.name}`} question={`Remove ${member.name} from ${group.name}? They will lose access to this group.`} confirmLabel="Remove member" onConfirm={() => onRemove(member)} />
        </div>}
      </li>)}
    </ul>}
  </main>;
}
