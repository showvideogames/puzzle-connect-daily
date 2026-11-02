import { useRef, useState, type ReactNode } from "react";
import { FriendInviteCard } from "@/components/account/FriendInviteCard";
import { SHARING_NOTICE_VERSION } from "@/lib/sharingNotice";
import { acceptProblem, friendRequest, requestChangeProblem, type FriendCard } from "@/lib/socialView";
import type { FriendRequestRow } from "@/social/contract";
import type { SocialApi } from "./socialApi";
import { useLive } from "./useLive";

interface WaitingRequestsProps {
  api: SocialApi;
  incoming: readonly FriendRequestRow[];
  displayName: string | undefined;
  onReload: () => Promise<void>;
  /** What shows once nothing is waiting. */
  children: ReactNode;
}

/** Requests waiting for this person, one at a time. Not now only moves on for this visit, and the request stays pending. */
export function WaitingRequests({ api, incoming, displayName, onReload, children }: WaitingRequestsProps) {
  const live = useLive();
  const answering = useRef(false);
  const [notNow, setNotNow] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** Keeps its ref, because the reload after an accept takes the request out of `incoming`. */
  const [accepted, setAccepted] = useState<{ requestRef: string; card: FriendCard } | null>(null);

  const waiting = incoming.find((row) => !notNow.includes(row.requestRef));

  const moveOn = (row: FriendRequestRow) => {
    setError(null);
    setNotNow((list) => [...list, row.requestRef]);
  };

  /** The card showed the notice, so its version is sent from here. */
  const accept = async (row: FriendRequestRow) => {
    if (answering.current) return;
    answering.current = true;
    setError(null);
    const answer = await api.client.call("acceptFriendRequest", { requestRef: row.requestRef, noticeVersion: SHARING_NOTICE_VERSION });
    answering.current = false;
    if (!live.current) return;
    if (answer.ok === false) {
      setError(acceptProblem(answer.outcome));
      return;
    }
    setAccepted({ requestRef: row.requestRef, card: friendRequest(row) });
    await onReload();
  };

  const decline = async (row: FriendRequestRow) => {
    if (answering.current) return;
    answering.current = true;
    setError(null);
    const answer = await api.client.call("declineFriendRequest", { requestRef: row.requestRef });
    answering.current = false;
    if (!live.current) return;
    if (answer.ok === false) {
      setError(requestChangeProblem(answer.outcome));
      return;
    }
    moveOn(row);
    await onReload();
  };

  if (!accepted && !waiting) return <>{children}</>;

  return (
    <FriendInviteCard
      key={accepted?.requestRef ?? waiting?.requestRef}
      {...(accepted?.card ?? friendRequest(waiting))}
      acceptLabel="Accept"
      signedIn
      displayName={displayName}
      added={accepted !== null}
      error={error}
      onSignIn={() => undefined}
      onChooseName={() => undefined}
      onAdd={() => void accept(waiting)}
      onDecline={() => void decline(waiting)}
      onContinue={() => {
        if (accepted) setAccepted(null);
        else moveOn(waiting);
      }}
    />
  );
}
