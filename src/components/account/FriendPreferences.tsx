import { useEffect, useId, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import type { FriendResult } from "@/lib/friendResults";
import { DISPLAY_NAME_MAX } from "@/lib/sharedProfile";
import { outlineAction, primaryAction, quietText } from "./accountStyles";

interface Props {
  friend: FriendResult;
  /** Only the nickname: whoever saves it keeps the favorite as it is. */
  onSave: (patch: { nickname: string | null }) => Promise<string | void>;
}
export function FriendPreferences({ friend, onSave }: Props) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [nickname, setNickname] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const pill = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const opened = useRef(false);
  // Focus follows the editor: into the field when it opens, back to the pill when it closes.
  useEffect(() => {
    if (editing) field.current?.focus();
    else if (opened.current) pill.current?.focus();
    opened.current = editing || opened.current;
  }, [editing]);
  return (
    <div className="w-full">
      {!editing ? (
        <button
          ref={pill}
          type="button"
          className="inline-flex min-h-11 items-center justify-center gap-2.5 rounded-full bg-[hsl(258_100%_95%)] px-6 text-base font-bold text-[hsl(258_90%_45%)] transition-colors hover:bg-[hsl(258_100%_91%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(258_90%_52%)] focus-visible:ring-offset-2 focus-visible:ring-offset-background dark:bg-[hsl(258_55%_20%)] dark:text-[hsl(258_100%_86%)] dark:hover:bg-[hsl(258_55%_26%)]"
          onClick={() => {
            setNickname(friend.nickname ?? "");
            setProblem(null);
            setEditing(true);
          }}
        >
          <Pencil aria-hidden="true" className="h-5 w-5" />
          Private nickname
        </button>
      ) : (
        <form
          className="space-y-3 rounded-2xl border border-border bg-background/60 p-4 text-left"
          onSubmit={async (event) => {
            event.preventDefault();
            if (saving.current) return;
            saving.current = true;
            setBusy(true);
            setProblem(null);
            try {
              const error = await onSave({
                nickname: nickname.trim() || null,
              });
              if (error) setProblem(error);
              else setEditing(false);
            } catch {
              setProblem("We couldn't save that. Please try again.");
            } finally {
              saving.current = false;
              setBusy(false);
            }
          }}
        >
          <p className={`text-sm ${quietText}`}>
            Only you can see these preferences. Their public profile stays the
            same.
          </p>
          <div>
            <label htmlFor={id} className="block font-bold">
              Private nickname
            </label>
            <input
              ref={field}
              id={id}
              value={nickname}
              maxLength={DISPLAY_NAME_MAX}
              disabled={busy}
              onChange={(e) => setNickname(e.target.value)}
              className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(258_90%_52%)]"
            />
            <p className={`mt-1 text-sm ${quietText}`}>
              Leave blank to use {friend.name}'s public name.
            </p>
          </div>
          {problem && (
            <p role="alert" className="text-destructive">
              {problem}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              disabled={busy}
              className={`${primaryAction} min-h-11`}
              type="submit"
            >
              {busy ? "Saving…" : "Save preferences"}
            </button>
            <button
              disabled={busy}
              className={`${outlineAction} min-h-11`}
              type="button"
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
