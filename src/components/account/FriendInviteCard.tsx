import type { AvatarId, ProfileColor } from "@/lib/sharedProfile";
import { accountPanel, outlineAction, primaryAction } from "./accountStyles";
import { ProfileAvatar } from "./ProfileAvatar";
import { SharingNotice } from "./SharingNotice";

interface FriendInviteCardProps {
  inviterName: string;
  /** The person's avatar, when it is known. */
  inviter?: { animalId: AvatarId; backgroundColor: ProfileColor };
  signedIn: boolean;
  displayName?: string;
  added?: boolean;
  /** "Add friend" for a link, "Accept" for a request someone sent. */
  acceptLabel?: string;
  onSignIn: () => void;
  onChooseName: () => void;
  onAdd: () => void;
  onContinue: () => void;
  /** Only a request can be declined. Left out, there is no Decline. */
  onDecline?: () => void;
  /** Why the last answer was refused. */
  error?: string | null;
}

/** A friend invitation or request. Like a group, it says what is shared first and only a button accepts it. */
export function FriendInviteCard({ inviterName, inviter, signedIn, displayName, added = false, acceptLabel = "Add friend", onSignIn, onChooseName, onAdd, onContinue, onDecline, error }: FriendInviteCardProps) {
  const notNow = <button type="button" onClick={onContinue} className={`${outlineAction} mt-3 h-12 ${onDecline ? "flex-1" : "w-full"} text-base`}>Not now</button>;
  return (
    <main className={`${accountPanel} mx-auto w-full max-w-[32rem] px-5 py-6 text-center sm:px-10 sm:py-10`} data-testid="friend-invite">
      {inviter && <ProfileAvatar animalId={inviter.animalId} backgroundColor={inviter.backgroundColor} size={88} className="mb-3" />}
      <h1 className="font-tile text-[1.75rem] font-extrabold leading-[1.15] tracking-tight text-foreground [overflow-wrap:anywhere] [text-wrap:balance] sm:text-4xl">
        {added ? <>You and {inviterName} are friends</> : <>{inviterName} wants to be friends</>}
      </h1>
      {added ? (
        <button type="button" onClick={onContinue} className={`${primaryAction} mt-6 h-14 w-full text-lg`}>Continue</button>
      ) : (
        <>
          <SharingNotice audience="friend" />
          {error && <p role="alert" className="mt-3 text-base font-medium text-destructive">{error}</p>}
          {!signedIn ? (
            <button type="button" onClick={onSignIn} className={`${primaryAction} mt-5 h-14 w-full text-lg`}>Sign in to add {inviterName}</button>
          ) : !displayName ? (
            <button type="button" onClick={onChooseName} className={`${primaryAction} mt-5 min-h-14 w-full py-2 text-lg`}>Choose a Display Name to add {inviterName}</button>
          ) : (
            <button type="button" onClick={onAdd} className={`${primaryAction} mt-5 h-14 w-full text-lg`}>{acceptLabel}</button>
          )}
          {onDecline ? (
            <div className="flex gap-2.5">
              {notNow}
              <button type="button" onClick={onDecline} className={`${outlineAction} mt-3 h-12 flex-1 text-base`}>Decline</button>
            </div>
          ) : notNow}
        </>
      )}
    </main>
  );
}
