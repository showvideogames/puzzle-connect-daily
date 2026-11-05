import type { GroupMemberView } from '@/lib/socialView';
import type { GroupView } from './GroupPage';
import { accountPanel, quietText } from './accountStyles';
import { BackLink } from './BackLink';
import { InlineConfirm } from './InlineConfirm';
import { ProfileAvatar } from './ProfileAvatar';

interface Props {
  group: GroupView;
  members: readonly GroupMemberView[] | null;
  problem?: string | null;
  note?: string | null;
  onBack: () => void;
  onTransfer?: (member: GroupMemberView) => Promise<string | void>;
  onRemove: (member: GroupMemberView) => Promise<string | void>;
}

/** The membership roster stays separate from result sorting and never shows puzzle details. */
export function GroupMembers({ group, members, problem, note, onBack, onRemove, onTransfer }: Props) {
  return <main className={`${accountPanel} mx-auto w-full max-w-[32rem] px-5 pb-5 pt-2 sm:px-8`}>
    <BackLink onClick={onBack} />
    <h1 className="font-tile text-2xl font-bold">Members</h1>
    <p className={`${quietText} break-words`}>{group.name}</p>
    {note && <p role="status" className="mt-3 text-base">{note}</p>}
    {!members && (problem ? <p role="alert" className="mt-3 text-destructive">{problem}</p> : <p role="status" className="mt-3">Loading members…</p>)}
    {members && <ul className="mt-3 divide-y divide-border" aria-label="Group members">
      {members.map(member => <li key={member.memberRef} className="py-3">
        <div className="flex items-center gap-3">
          <ProfileAvatar animalId={member.animalId} backgroundColor={member.backgroundColor} />
          <div className="min-w-0 flex-1">
            <p className="break-words font-semibold">{member.name}{member.isMe ? ' (you)' : ''}</p>
            {member.isOwner && <p className={`text-sm ${quietText}`}>Owner</p>}
          </div>
        </div>
        {group.isOwner && !member.isMe && !member.isOwner && <div className="mt-2 [&_button]:min-h-11">
          {onTransfer && <InlineConfirm label={`Make ${member.name} owner`} question={`Make ${member.name} the owner of ${group.name}? You will remain a member and lose owner controls.`} confirmLabel="Transfer ownership" onConfirm={() => onTransfer(member)} />}
          <InlineConfirm label={`Remove ${member.name}`} question={`Remove ${member.name} from ${group.name}? They will lose access to this group.`} confirmLabel="Remove member" onConfirm={() => onRemove(member)} />
        </div>}
      </li>)}
    </ul>}
  </main>;
}
