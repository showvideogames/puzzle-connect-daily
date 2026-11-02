import { useRef } from "react";
import { AddFriendScreen, type FoundPerson } from "@/components/account/AddFriendScreen";
import { SHARING_NOTICE_VERSION } from "@/lib/sharingNotice";
import { findProblem, foundPerson, friendLinkProblem, requestChangeProblem, sendProblem, sentRequest } from "@/lib/socialView";
import type { FriendRequestRow } from "@/social/contract";
import { copyLink, linkAnswer, type Delivery, type MadeLink, type SocialApi } from "./socialApi";
import { useLive } from "./useLive";

const FRIEND_PICTURE = "/shared-assets/friends/bear-frog-heart.webp";

interface AddFriendFlowProps {
  api: SocialApi;
  displayName: string | undefined;
  outgoing: readonly FriendRequestRow[];
  onNote: (note: string) => void;
  onLink?: (link: MadeLink) => void;
  onReload: () => Promise<void>;
  onBack: () => void;
}

/** The screen, through the client. The requestRef from a lookup stays here: the screen never holds it. */
export function AddFriendFlow({ api, displayName, outgoing, onNote, onLink, onReload, onBack }: AddFriendFlowProps) {
  const { client } = api;
  const live = useLive();
  const lookupRef = useRef<string | null>(null);

  const find = async (friendCode: string): Promise<FoundPerson | "self" | null | { problem: string }> => {
    onNote("");
    const answer = await client.call("findFriendByCode", { friendCode });
    if (!live.current) return null;
    if (answer.ok === false) {
      if (answer.outcome === "own_code") return "self";
      return answer.outcome === "not_found" ? null : { problem: findProblem(answer.outcome) };
    }
    lookupRef.current = answer.data.requestRef;
    return foundPerson(answer.data);
  };

  /** The found step showed the notice, so this is the one place its version is sent from. */
  const send = async () => {
    const answer = await client.call("sendFriendRequest", { requestRef: lookupRef.current ?? "", noticeVersion: SHARING_NOTICE_VERSION });
    return answer.ok === false ? sendProblem(answer.outcome) : undefined;
  };

  const cancel = async (requestRef: string) => {
    const answer = await client.call("cancelFriendRequest", { requestRef });
    if (!live.current) return undefined;
    if (answer.ok === false) return requestChangeProblem(answer.outcome);
    await onReload();
    return undefined;
  };

  /** The invitation card shows the notice above both link buttons, so this is the one place its version is sent from. */
  const handOver = async (deliver: (url: string) => Promise<Delivery>) => {
    onNote("");
    const answer = await client.call("createFriendInvite", { noticeVersion: SHARING_NOTICE_VERSION });
    if (!live.current) return false;
    if (answer.ok === false) return friendLinkProblem(answer.outcome);
    const url = api.linkUrl(answer.data.code);
    onLink?.({ label: `Friend link from ${displayName}`, code: answer.data.code, url });
    return linkAnswer(await deliver(url), url);
  };

  return (
    <AddFriendScreen
      pictureSrc={FRIEND_PICTURE}
      onBack={onBack}
      onShareLink={() => handOver((url) => api.share(url))}
      onCopyLink={() => handOver(copyLink)}
      onFind={find}
      onSendRequest={send}
      sentRequests={outgoing.map(sentRequest)}
      onCancelRequest={cancel}
    />
  );
}
