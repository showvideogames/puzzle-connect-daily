import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { AddFriendScreen, type FoundPerson } from "@/components/account/AddFriendScreen";
import { SHARING_NOTICE_VERSION } from "@/lib/sharingNotice";
import { findProblem, foundPerson, friendLinkProblem, sendProblem } from "@/lib/socialView";
import type { Preview, PreviewLink } from "./preview";
import { useLive } from "./useLive";

const FRIEND_PICTURE = "/shared-assets/friends/bear-frog-heart.webp";

const linkUrl = (code: string) => `${location.origin}/?invite=${encodeURIComponent(code)}`;

interface AddFriendFlowProps {
  preview: Preview;
  displayName: string | undefined;
  onNote: (note: string) => void;
  onLink: (link: PreviewLink) => void;
  onBack: () => void;
}

/** The real screen, through the real client. The requestRef stays here: the screen never holds it. */
export function AddFriendFlow({ preview, displayName, onNote, onLink, onBack }: AddFriendFlowProps) {
  const { client } = preview;
  const live = useLive();
  const lookupRef = useRef<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // The screen shows "sent" and "Done." whenever its handler returns, and a
  // throw would leave it stuck on "Sending…". So a failure replaces the screen
  // before the handler returns, and the reason goes in the bar.
  const startOver = (problem: string) => {
    flushSync(() => setAttempt((count) => count + 1));
    onNote(problem);
  };

  const find = async (friendCode: string): Promise<FoundPerson | "self" | null> => {
    onNote("");
    const answer = await client.call("findFriendByCode", { friendCode });
    if (!live.current) return null;
    if (answer.ok === false) {
      // The screen can say only these two. Anything else also goes in the bar.
      if (answer.outcome === "own_code") return "self";
      if (answer.outcome !== "not_found") onNote(findProblem(answer.outcome));
      return null;
    }
    lookupRef.current = answer.data.requestRef;
    return foundPerson(answer.data);
  };

  /** The found step showed the notice, so this is the one place its version is sent from. */
  const send = async () => {
    const answer = await client.call("sendFriendRequest", { requestRef: lookupRef.current ?? "", noticeVersion: SHARING_NOTICE_VERSION });
    if (!live.current) return;
    if (answer.ok === false) startOver(sendProblem(answer.outcome));
  };

  /** The invitation card shows the notice above both link buttons, so this is the one place its version is sent from. */
  const makeLink = async (): Promise<string | null> => {
    onNote("");
    const answer = await client.call("createFriendInvite", { noticeVersion: SHARING_NOTICE_VERSION });
    if (!live.current) return null;
    if (answer.ok === false) {
      startOver(friendLinkProblem(answer.outcome));
      return null;
    }
    const url = linkUrl(answer.data.code);
    onLink({ label: `Friend link from ${displayName}`, code: answer.data.code });
    onNote(`Link ready: ${url}. Open it from the bar: a reload empties this preview.`);
    return url;
  };

  const copyLink = async () => {
    const url = await makeLink();
    if (url === null) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      if (live.current) onNote(`We couldn't copy that. The link is in the bar: ${url}`);
    }
  };

  return (
    <AddFriendScreen
      key={attempt}
      pictureSrc={FRIEND_PICTURE}
      onBack={onBack}
      onShareLink={async () => {
        await makeLink();
      }}
      onCopyLink={copyLink}
      onFind={find}
      onSendRequest={send}
    />
  );
}
