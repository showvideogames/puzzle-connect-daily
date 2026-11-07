import { useEffect, useRef, useState } from "react";
import { Ban, MoreVertical, UserMinus } from "lucide-react";
import { blockQuestion, removeFriendQuestion } from "@/lib/socialView";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { dangerFill, dangerText, iconButton, purpleText, secondaryAction } from "./accountStyles";

interface FriendMenuProps {
  /** The name the viewer sees on the profile: their private nickname, if they gave one. */
  name: string;
  /** Given when `name` is a nickname, so a choice also says who it really is. */
  publicName?: string;
  /** Each answers with a sentence when it was refused, as FriendActions' do. */
  onRemove: () => Promise<string | void>;
  onBlock: () => Promise<string | void>;
  /** After a Remove or Block went through: this menu is about to go, so whatever shows next takes focus. */
  onDone?: () => void;
}

type Choice = "remove" | "block";

/**
 * The ⋯ at the top right of a friend's profile. Each choice asks first, with the
 * same question and confirm label FriendActions uses, and a refusal stays in the
 * question. Escape or Cancel puts focus back on ⋯.
 */
export function FriendMenu({ name, publicName, onRemove, onBlock, onDone }: FriendMenuProps) {
  /** "Pal (Jordan)" in the choices and questions when there is a nickname, "Jordan" when there isn't. */
  const who = publicName && publicName !== name ? `${name} (${publicName})` : name;
  const trigger = useRef<HTMLButtonElement>(null);
  const opening = useRef(false);
  const done = useRef(false);
  const mounted = useRef(true);
  const [asking, setAsking] = useState<Choice | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const choose = (choice: Choice) => {
    opening.current = true;
    setProblem(null);
    setAsking(choice);
  };

  const close = () => {
    setAsking(null);
    setProblem(null);
  };

  const confirm = async () => {
    if (!asking || busy) return;
    setBusy(true);
    setProblem(null);
    const refused = await (asking === "remove" ? onRemove() : onBlock());
    // With somewhere else to put focus, it goes there; otherwise it comes back to ⋯.
    if (!refused && onDone) {
      done.current = true;
      onDone();
    }
    // A friend who was removed or blocked takes this profile with them.
    if (!mounted.current) return;
    setBusy(false);
    if (refused) setProblem(refused);
    else close();
  };

  const remove = asking === "remove";
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button ref={trigger} type="button" aria-label={`Manage friendship with ${name}`} className={`${iconButton} -mr-2 ${purpleText}`}>
            <MoreVertical aria-hidden="true" className="h-7 w-7" strokeWidth={2.5} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={4}
          collisionPadding={12}
          className="w-60 max-w-[calc(100vw-24px)] rounded-2xl p-2 shadow-lg"
          onCloseAutoFocus={(event) => {
            // The question takes focus instead, and hands it back to ⋯ when it closes.
            if (opening.current) event.preventDefault();
            opening.current = false;
          }}
        >
          <DropdownMenuItem onSelect={() => choose("remove")} className="min-h-11 gap-3 rounded-lg px-3 text-base font-semibold">
            <UserMinus aria-hidden="true" className="h-5 w-5 shrink-0" />
            Remove friend
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => choose("block")} className={cn("min-h-11 gap-3 rounded-lg px-3 text-base font-semibold", dangerText, "focus:text-destructive dark:focus:text-red-400")}>
            <Ban aria-hidden="true" className="h-5 w-5 shrink-0" />
            <span className="min-w-0 break-words">Block {who}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog
        open={asking !== null}
        onOpenChange={(open) => {
          if (!open && !busy) close();
        }}
      >
        <AlertDialogContent
          className="social-design w-[calc(100vw-2rem)] max-w-md rounded-3xl sm:rounded-3xl"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            // After a change went through, focus has already moved on; don't pull it back.
            if (!done.current) trigger.current?.focus();
            done.current = false;
          }}
        >
          <AlertDialogHeader className="text-left sm:text-left">
            <AlertDialogTitle className="break-words text-xl font-extrabold">
              {remove ? "Remove friend" : `Block ${who}`}
            </AlertDialogTitle>
            <AlertDialogDescription className="break-words text-base text-foreground">
              {remove ? removeFriendQuestion(who) : blockQuestion(who)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {problem && (
            <p role="alert" className="text-base font-medium text-destructive">
              {problem}
            </p>
          )}
          <AlertDialogFooter className="gap-2.5 sm:space-x-0">
            <AlertDialogCancel disabled={busy} className={`${secondaryAction} mt-0 h-11 text-base`}>
              Cancel
            </AlertDialogCancel>
            <button type="button" onClick={() => void confirm()} disabled={busy} className={cn(secondaryAction, "h-11 border-transparent text-base", dangerFill)}>
              {remove ? "Remove" : "Block"}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
