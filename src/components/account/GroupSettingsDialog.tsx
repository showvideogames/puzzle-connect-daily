import { useEffect, useRef, useState } from "react";
import { ChevronRight, ImageIcon, Pencil, Settings, UsersRound, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { leaveGroupQuestion } from "@/lib/socialView";
import { dangerText, quietText, tintedOutlineAction } from "./accountStyles";
import { groupDialogBox, groupDialogTitle } from "./groupStyles";
import { InlineConfirm } from "./InlineConfirm";

function SettingButton({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-border bg-background px-3 text-left text-base font-bold text-foreground
        transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(258_90%_52%)]"
    >
      <Icon aria-hidden="true" className="h-5 w-5 shrink-0 text-[hsl(258_90%_50%)] dark:text-[hsl(258_100%_82%)]" />
      <span className="min-w-0 flex-1">{label}</span>
      <ChevronRight aria-hidden="true" className={`h-5 w-5 shrink-0 ${quietText}`} />
    </button>
  );
}

interface GroupSettingsDialogProps {
  groupName: string;
  isOwner: boolean;
  onEditDescription?: () => void;
  onEditPicture?: () => void;
  onMembers?: () => void;
  onDelete?: () => Promise<string | void>;
  onLeave: () => Promise<string | void>;
  /** Set when the page comes back from a screen the dialog opened, so focus lands on the gear again. */
  focusOnMount?: boolean;
}

/**
 * The gear and what used to sit in the page's settings disclosure, under the
 * same conditions: owners get the description, picture and delete; everyone
 * gets the member list and Leave, so every member sees the gear. Leave and
 * Delete keep their second step inside the dialog.
 */
export function GroupSettingsDialog({ groupName, isOwner, onEditDescription, onEditPicture, onMembers, onDelete, onLeave, focusOnMount = false }: GroupSettingsDialogProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  // Only on arrival: the page is new each time it comes back from members or an editor.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (focusOnMount) trigger.current?.focus(); }, []);
  const go = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button ref={trigger} type="button" aria-label="Group settings" className={cn(tintedOutlineAction, "h-11 w-11 shrink-0 px-0")}>
          <Settings aria-hidden="true" className="h-5 w-5" />
        </button>
      </DialogTrigger>
      <DialogContent className={groupDialogBox} data-testid="group-settings">
        <div>
          <DialogTitle className={groupDialogTitle}>Group settings</DialogTitle>
          <DialogDescription className={`mt-1 text-base ${quietText} break-words`}>{groupName}</DialogDescription>
        </div>
        {(isOwner && (onEditDescription || onEditPicture)) || onMembers ? (
          <div className="grid gap-2">
            {isOwner && onEditDescription && <SettingButton icon={Pencil} label="Edit description" onClick={go(onEditDescription)} />}
            {isOwner && onEditPicture && <SettingButton icon={ImageIcon} label="Edit group picture" onClick={go(onEditPicture)} />}
            {onMembers && <SettingButton icon={UsersRound} label="View members" onClick={go(onMembers)} />}
          </div>
        ) : null}
        <div className="grid justify-items-start gap-2 border-t border-border pt-4 [&_button]:h-auto [&_button]:min-h-11 [&_p]:break-words">
          {isOwner && onDelete && (
            <div className={`w-full ${dangerText} [&>button]:text-inherit`}>
              <InlineConfirm label="Delete group" question={`Permanently delete ${groupName} for everyone? Members keep their personal game history.`} confirmLabel="Delete group permanently" onConfirm={onDelete} />
            </div>
          )}
          <InlineConfirm label="Leave group" question={leaveGroupQuestion(groupName)} confirmLabel="Leave" onConfirm={onLeave} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
