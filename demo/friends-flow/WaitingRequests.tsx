import { useRef, useState, type ReactNode } from "react";
import { FriendInviteCard } from "@/components/account/FriendInviteCard";
import { SHARING_NOTICE_VERSION } from "@/lib/sharingNotice";
import { acceptProblem, friendRequest, type FriendCard } from "@/lib/socialView";
import type { FriendRequestRow } from "@/social/contract";
import type { Preview } from "./preview";
import { useLive } from "./useLive";

interface WaitingRequestsProps {
  preview: Preview;
  incoming: readonly FriendRequestRow[];
  displayName: string | undefined;
  onNote: (note: string) => void;
  onReload: () => Promise<void>;
  /** What shows once nothing is waiting. */
  children: ReactNode;
}

/**
 * Requests waiting for this person, one at a time. The card has no decline, so
 * Not now only moves on for this visit, and the request stays pending.
 */
export function WaitingRequests({ preview, incoming, displayName, onNote, onReload, children }: WaitingRequestsProps) {
  const live = useLive();
  const accepting = useRef(false);
  const [notNow, setNotNow] = useState<string[]>([]);
  /** Keeps its ref, because the reload after an accept takes the request out of `incoming`. */
  const [accepted, setAccepted] = useState<{ requestRef: string; card: FriendCard } | null>(null);

  const waiting = incoming.find((row) => !notNow.includes(row.requestRef));

  /** The card showed the notice, so its version is sent from here. */
  const accept = async (row: FriendRequestRow) => {
    if (accepting.current) return;
    accepting.current = true;
    onNote("");
    const answer = await preview.client.call("acceptFriendRequest", { requestRef: row.requestRef, noticeVersion: SHARING_NOTICE_VERSION });
    accepting.current = false;
    if (!live.current) return;
    if (answer.ok === false) {
      onNote(acceptProblem(answer.outcome));
      return;
    }
    setAccepted({ requestRef: row.requestRef, card: friendRequest(row) });
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
      onSignIn={() => undefined}
      onChooseName={() => undefined}
      onAdd={() => void accept(waiting)}
      onContinue={() => {
        if (accepted) setAccepted(null);
        else setNotNow((list) => [...list, waiting.requestRef]);
      }}
    />
  );
}
