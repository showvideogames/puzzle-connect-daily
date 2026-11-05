import { UserRound, UsersRound, Settings } from "lucide-react";
import type { SharedProfile } from "@/lib/sharedProfile";
import { ProfileAvatar } from "./ProfileAvatar";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuLabel, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

interface ProfileMenuProps {
  profile: SharedProfile;
  /** Null means still loading or unavailable, never an invented zero. */
  pendingCount: number | null;
  onProfile: () => void;
  onFriends: () => void;
  onAccount: () => void;
}

/** Presentational only: the session owner supplies identity and pending requests. */
export function ProfileMenu({ profile, pendingCount, onProfile, onFriends, onAccount }: ProfileMenuProps) {
  const count = pendingCount !== null && Number.isFinite(pendingCount) ? Math.max(0, Math.floor(pendingCount)) : 0;
  const notice = count > 0 ? `${count} pending ${count === 1 ? "notification" : "notifications"}` : "";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Profile menu${notice ? `, ${notice}` : ""}`}
          className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <ProfileAvatar animalId={profile.animalId} backgroundColor={profile.backgroundColor} size={40} />
          {count > 0 && <span aria-hidden="true" data-testid="profile-notification" className="absolute right-0 top-0 h-3 w-3 rounded-full border-2 border-background bg-yellow-400 ring-1 ring-yellow-700/40" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} collisionPadding={12} className="w-60 max-w-[calc(100vw-24px)] rounded-2xl p-2 shadow-lg">
        <DropdownMenuLabel className="truncate px-3 py-2">{profile.displayName || "Your account"}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onProfile} className="min-h-11 gap-3 rounded-lg px-3">
          <UserRound aria-hidden="true" className="h-5 w-5" />My profile
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onFriends} className="min-h-11 gap-3 rounded-lg px-3">
          <UsersRound aria-hidden="true" className="h-5 w-5" />Friends &amp; Groups
          {count > 0 && <span aria-label={notice} className="ml-auto rounded-full bg-yellow-400 px-2 py-0.5 text-xs font-bold text-slate-950">{count > 99 ? "99+" : count}</span>}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onAccount} className="min-h-11 gap-3 rounded-lg px-3">
          <Settings aria-hidden="true" className="h-5 w-5" />Account options
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
