import type { ReactNode } from "react";
import type { GroupEmblemId } from "@/lib/groupEmblems";
import type { InviteMemberPreview } from "@/lib/invitePreview";
import { GROUP_VISIBILITY_NOTE } from "@/lib/sharingNotice";
import { accountPanel, outlineAction, primaryAction, quietText } from "./accountStyles";
import { BackLink } from "./BackLink";
import { GroupEmblem } from "./GroupEmblem";
import { MemberPreview } from "./MemberPreview";
import { SharingNotice } from "./SharingNotice";

/** What anyone holding the link may see, signed in or not. */
export interface GroupInvitePreview {
  name: string;
  emblemId: GroupEmblemId;
  /** An uploaded picture, shown instead of the emblem. */
  photo?: string | null;
  accentColor: string;
  isMember: boolean;
  isRemoved: boolean;
  /** The same for everyone holding a valid link, signed in or not. */
  memberPreview: InviteMemberPreview;
}

interface GroupInviteCardProps {
  /** Null when the link is unknown or has been replaced. */
  invite: GroupInvitePreview | null;
  signedIn: boolean;
  /** The name the group will see. */
  displayName?: string;
  joined?: boolean;
  busy?: boolean;
  error?: string | null;
  onSignIn: () => void;
  /** Join needs a Display Name, so a player without one is sent to choose it. */
  onChooseName: () => void;
  onJoin: () => void;
  /** Declines for now, or moves on once there is nothing left to answer. */
  onContinue: () => void;
  /** Leaves the invitation without answering it. Left out, there is no Back. */
  onBack?: () => void;
}

function Shell({ children, onBack }: { children: ReactNode; onBack?: () => void }) {
  return (
    <main className={`${accountPanel} mx-auto w-full max-w-[32rem] px-5 pb-5 pt-2 text-center sm:px-10 sm:pb-8 sm:pt-4`} data-testid="group-invite">
      {onBack && (
        <div className="relative flex items-center">
          <BackLink onClick={onBack} />
          <p className="absolute inset-x-0 text-center text-base font-semibold text-foreground">Group invitation</p>
        </div>
      )}
      {children}
    </main>
  );
}

const fullButton = "mt-3 h-14 w-full text-lg";
const notNowButton = `${outlineAction} mt-3 h-12 w-full text-base`;

/**
 * A group invitation: the group's name and picture first, for anyone with the
 * link, along with what joining shares. Joining is always a button the player
 * presses. Nothing here joins on its own, not on arrival and not on returning
 * from sign-in or setup, and it needs a Display Name.
 */
export function GroupInviteCard({ invite, signedIn, displayName, joined = false, busy = false, error, onSignIn, onChooseName, onJoin, onContinue, onBack }: GroupInviteCardProps) {
  if (!invite) {
    return (
      <Shell onBack={onBack}>
        <h1 className="mt-3 font-tile text-2xl font-extrabold tracking-tight text-foreground">This invitation isn't working</h1>
        <p className={`mt-3 text-base ${quietText}`}>
          The link may be mistyped, or the group may have made a new one. Ask for a fresh link.
        </p>
        <button type="button" onClick={onContinue} className={`${primaryAction} ${fullButton}`}>See our games</button>
      </Shell>
    );
  }

  const member = joined || invite.isMember;
  const removed = signedIn && invite.isRemoved && !member;
  return (
    <Shell onBack={onBack}>
      <div className="mt-1">
        <GroupEmblem emblemId={invite.emblemId} photo={invite.photo} color={invite.accentColor} size={112} className="max-sm:!h-20 max-sm:!w-20 max-[359px]:!h-14 max-[359px]:!w-14" />
      </div>
      <h1 className="mt-2 font-tile font-extrabold leading-[1.15] tracking-tight text-foreground [overflow-wrap:anywhere] [text-wrap:balance]">
        <span className="block text-xl sm:text-2xl">
          {joined ? "You're in!" : invite.isMember ? "You're already a member" : "You're invited!"}
        </span>
        <span className="block text-[1.75rem] sm:text-4xl">{invite.name}</span>
      </h1>

      {member ? (
        <>
          <p className={`mt-3 text-base ${quietText}`}>Your groups travel with you across our games.</p>
          <button type="button" onClick={onContinue} className={`${primaryAction} ${fullButton}`}>Continue</button>
        </>
      ) : removed ? (
        <>
          <p role="status" className="mt-4 text-base text-foreground">
            You were removed from this group, so you can't rejoin. If that's a mistake, ask the person who made it to let you back in.
          </p>
          <button type="button" onClick={onContinue} className={`${primaryAction} ${fullButton}`}>See our games</button>
        </>
      ) : (
        <>
          <MemberPreview preview={invite.memberPreview} />
          {error && <p role="alert" className="mt-2 text-base font-medium text-destructive">{error}</p>}
          {!signedIn ? (
            <>
              <button type="button" onClick={onSignIn} disabled={busy} className={`${primaryAction} ${fullButton}`}>
                {busy ? "Opening sign-in…" : "Sign in to join"}
              </button>
              <p className={`mt-1.5 text-base ${quietText}`}>You'll come straight back here.</p>
            </>
          ) : !displayName ? (
            <>
              <button type="button" onClick={onChooseName} className={`${primaryAction} ${fullButton}`}>Choose a Display Name</button>
              <p className={`mt-1.5 text-base ${quietText}`}>Groups show your Display Name.</p>
            </>
          ) : (
            <>
              <button type="button" onClick={onJoin} disabled={busy} className={`${primaryAction} ${fullButton}`}>
                {busy ? "Joining…" : "Join group"}
              </button>
              <p className={`mt-1.5 text-base ${quietText}`}>
                You'll show as <strong className="font-semibold text-foreground">{displayName}</strong>.
              </p>
            </>
          )}
          <SharingNotice audience="group" />
          <button type="button" onClick={onContinue} disabled={busy} className={notNowButton}>Not now</button>
          <p className={`mt-3 text-sm ${quietText}`}>{GROUP_VISIBILITY_NOTE}</p>
        </>
      )}
    </Shell>
  );
}
