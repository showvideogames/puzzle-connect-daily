import { useRef, useState } from "react";
import type { FriendsTab } from "@/components/account/FriendsHome";
import { FriendInviteCard } from "@/components/account/FriendInviteCard";
import { GroupInviteCard, type GroupInvitePreview } from "@/components/account/GroupInviteCard";
import { joinProblem } from "@/lib/accountFlow";
import { SHARING_NOTICE_VERSION } from "@/lib/sharingNotice";
import { acceptProblem, type FriendCard } from "@/lib/socialView";
import type { Preview } from "./preview";
import { useLive } from "./useLive";

/** The two cards a link can open. Each card shows the notice, so each sends its version from here. */

interface LinkCardProps {
  preview: Preview;
  code: string;
  signedIn: boolean;
  displayName: string | undefined;
  onSignIn: () => void;
  onChooseName: () => void;
  onLeave: (tab?: FriendsTab) => void;
}

export function FriendLinkCard({ preview, code, card, signedIn, displayName, onNote, onSignIn, onChooseName, onLeave }: LinkCardProps & { card: FriendCard; onNote: (note: string) => void }) {
  const live = useLive();
  const accepting = useRef(false);
  const [added, setAdded] = useState(false);

  const accept = async () => {
    if (accepting.current) return;
    accepting.current = true;
    onNote("");
    const answer = await preview.client.call("acceptFriendInvite", { code, noticeVersion: SHARING_NOTICE_VERSION });
    accepting.current = false;
    if (!live.current) return;
    if (answer.ok === false) onNote(acceptProblem(answer.outcome));
    else setAdded(true);
  };

  return (
    <FriendInviteCard
      {...card}
      signedIn={signedIn}
      displayName={displayName}
      added={added}
      onSignIn={onSignIn}
      onChooseName={onChooseName}
      onAdd={() => void accept()}
      onContinue={() => onLeave()}
    />
  );
}

export function GroupLinkCard({ preview, code, invite, signedIn, displayName, onSignIn, onChooseName, onLeave }: LinkCardProps & { invite: GroupInvitePreview | null }) {
  const live = useLive();
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    setJoining(true);
    setError(null);
    const answer = await preview.client.call("joinGroup", { code, myName: displayName ?? "", noticeVersion: SHARING_NOTICE_VERSION });
    if (!live.current) return;
    setJoining(false);
    if (answer.ok === false) setError(joinProblem(answer.outcome));
    else setJoined(true);
  };

  return (
    <GroupInviteCard
      invite={invite}
      signedIn={signedIn}
      displayName={displayName}
      joined={joined}
      busy={joining}
      error={error}
      onSignIn={onSignIn}
      onChooseName={onChooseName}
      onJoin={() => void join()}
      onContinue={() => onLeave(joined || invite?.isMember ? "groups" : undefined)}
      onBack={() => onLeave()}
    />
  );
}
