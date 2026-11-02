import { blockQuestion, removeFriendQuestion } from "@/lib/socialView";
import { InlineConfirm } from "./InlineConfirm";

interface FriendActionsProps {
  name: string;
  /** Each answers with a sentence when it was refused. */
  onRemove: () => Promise<string | void>;
  onBlock: () => Promise<string | void>;
}

/** Inside an opened friend, out of the way of their result. */
export function FriendActions({ name, onRemove, onBlock }: FriendActionsProps) {
  return (
    <div className="mt-2 flex flex-wrap items-start gap-x-3 gap-y-2" data-testid="friend-actions">
      <InlineConfirm label="Remove friend" question={removeFriendQuestion(name)} confirmLabel="Remove" onConfirm={onRemove} />
      <InlineConfirm label="Block" question={blockQuestion(name)} confirmLabel="Block" onConfirm={onBlock} />
    </div>
  );
}
