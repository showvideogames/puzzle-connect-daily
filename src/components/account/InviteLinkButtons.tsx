import { useState } from "react";
import { outlineAction, primaryAction, quietText } from "./accountStyles";

/** A sentence when it was refused, false when nothing happened and nothing needs saying. */
export type LinkAnswer = string | false | void;

type LinkAction = () => Promise<LinkAnswer> | LinkAnswer;

/** Share and Copy, for a friend invitation and a group alike. */
export function InviteLinkButtons({ onShare, onCopy }: { onShare: LinkAction; onCopy: LinkAction }) {
  const [done, setDone] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const run = async (action: LinkAction) => {
    setDone(false);
    setProblem(null);
    const answer = await action();
    if (typeof answer === "string") setProblem(answer);
    else if (answer !== false) setDone(true);
  };

  return (
    <>
      <button type="button" onClick={() => void run(onShare)} className={`${primaryAction} mt-3 h-12 w-full text-base`}>Share invite link</button>
      <button type="button" onClick={() => void run(onCopy)} className={`${outlineAction} mt-2 h-12 w-full text-base`}>Copy link</button>
      {done && <p role="status" className={`mt-2 text-center text-base ${quietText}`}>Done.</p>}
      {problem && <p role="alert" className="mt-2 text-base font-medium text-destructive [overflow-wrap:anywhere]">{problem}</p>}
    </>
  );
}
