import { BarChart3, Lock, LogOut, type LucideIcon } from "lucide-react";
import { FRIEND_SHARING_NOTICE, GROUP_SHARING_NOTICE, noticeLines } from "@/lib/sharingNotice";
import { quietText } from "./accountStyles";

const icons: LucideIcon[] = [BarChart3, Lock, LogOut];

/**
 * What automatic sharing means, said before anyone agrees to it. Shown wherever
 * a player can join a group, accept a friend, or make a friend link or a group,
 * signed in or not, so nobody finds out afterwards. One sentence to a line, with
 * the wording unchanged. The rules behind it are enforced by the server, never by this text
 * (docs/shared-profile/CROSSPUNS-LEAD-HANDOFF.md).
 */
export function SharingNotice({ audience }: { audience: "group" | "friend" }) {
  const lines = noticeLines(audience === "group" ? GROUP_SHARING_NOTICE : FRIEND_SHARING_NOTICE);
  return (
    <ul className={`mt-4 space-y-2 text-left text-base leading-snug ${quietText}`} data-testid="sharing-notice">
      {lines.map((line, index) => {
        const Icon = icons[index] ?? BarChart3;
        return (
          <li key={line} className="flex items-start gap-3">
            <Icon aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-foreground" />
            <span>{line}</span>
          </li>
        );
      })}
    </ul>
  );
}
