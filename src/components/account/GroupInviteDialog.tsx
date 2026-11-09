import { UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { quietText, tintedOutlineAction } from "./accountStyles";
import { groupDialogBox, groupDialogTitle } from "./groupStyles";
import { InviteLinkButtons, type LinkAnswer } from "./InviteLinkButtons";

interface GroupInviteDialogProps {
  groupName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Shown inside while it is open, since the page behind is covered. */
  problem?: string | null;
  onShare: () => Promise<LinkAnswer> | LinkAnswer;
  onCopy: () => Promise<LinkAnswer> | LinkAnswer;
}

/** The outlined Invite at the top of a group, holding the same Share and Copy the invitation card had. */
export function GroupInviteDialog({ groupName, open, onOpenChange, problem, onShare, onCopy }: GroupInviteDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <button type="button" className={cn(tintedOutlineAction, "h-11 shrink-0 gap-1.5 px-4 text-base")}>
          <UserPlus aria-hidden="true" className="h-5 w-5" />
          Invite
        </button>
      </DialogTrigger>
      <DialogContent className={groupDialogBox} data-testid="group-invite-dialog">
        <div>
          <DialogTitle className={groupDialogTitle}>Send an invitation</DialogTitle>
          <DialogDescription className={`mt-1 text-base ${quietText} break-words`}>Share a link to join {groupName}.</DialogDescription>
        </div>
        {problem && <p role="alert" className="text-base font-medium text-destructive">{problem}</p>}
        <div className="-mt-3">
          <InviteLinkButtons onShare={onShare} onCopy={onCopy} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
