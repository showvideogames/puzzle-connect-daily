import { useRef, useState } from "react";
import type { FriendsTab } from "@/components/account/FriendsHome";
import { FriendInviteCard } from "@/components/account/FriendInviteCard";
import { GroupInviteCard, type GroupInvitePreview } from "@/components/account/GroupInviteCard";
import { joinProblem } from "@/lib/accountFlow";
import { SHARING_NOTICE_VERSION } from "@/lib/sharingNotice";
import { acceptProblem, type FriendCard } from "@/lib/socialView";
import type { SocialApi } from "./socialApi";
import { useLive } from "./useLive";

/** The two cards a link can open. Each card shows the notice, so each sends its version from here. */

interface LinkCardProps {
  api: SocialApi;
  code: string;
  signedIn: boolean;
  displayName: string | undefined;
  onSignIn: () => void;
  onChooseName: () => void;
  onLeave: (tab?: FriendsTab) => void;
}

export function FriendLinkCard({ api, code, card, signedIn, displayName, onSignIn, onChooseName, onLeave }: LinkCardProps & { card: FriendCard }) {
  const live = useLive();
  const accepting = useRef(false);
  const [added, setAdded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async () => {
    if (accepting.current) return;
    accepting.current = true;
    setError(null);
    const answer = await api.client.call("acceptFriendInvite", { code, noticeVersion: SHARING_NOTICE_VERSION });
    accepting.current = false;
    if (!live.current) return;
    if (answer.ok === false) setError(acceptProblem(answer.outcome));
    else setAdded(true);
  };

  return (
    <FriendInviteCard
      {...card}
      signedIn={signedIn}
      displayName={displayName}
      added={added}
      error={error}
      onSignIn={onSignIn}
      onChooseName={onChooseName}
      onAdd={() => void accept()}
      onContinue={() => onLeave()}
    />
  );
}

interface GroupLinkCardProps extends LinkCardProps {
  invite: GroupInvitePreview | null;
  signingIn: boolean;
}

export function GroupLinkCard({ api, code, invite, signedIn, signingIn, displayName, onSignIn, onChooseName, onLeave }: GroupLinkCardProps) {
  const live = useLive();
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    setJoining(true);
    setError(null);
    const answer = await api.client.call("joinGroup", { code, myName: displayName ?? "", noticeVersion: SHARING_NOTICE_VERSION });
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
      busy={joining || signingIn}
      error={error}
      onSignIn={onSignIn}
      onChooseName={onChooseName}
      onJoin={() => void join()}
      onContinue={() => onLeave(joined || invite?.isMember ? "groups" : undefined)}
      onBack={() => onLeave()}
    />
  );
}
