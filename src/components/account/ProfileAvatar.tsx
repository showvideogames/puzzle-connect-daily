import { AVATAR_FRAMING, avatarLabel, avatarSrc } from "@/lib/avatarManifest";
import type { AvatarId } from "@/lib/sharedProfile";

interface ProfileAvatarProps {
  animalId: AvatarId;
  /** The circle's color. Left out, the picture sits on whatever is behind it, as the picker's choices do. */
  backgroundColor?: string;
  size?: number;
  /** The name always sits beside an avatar in the app, so by default it is decorative. */
  label?: boolean;
  className?: string;
}

/** A player's avatar: a transparent picture framed inside a circle of their color. */
export function ProfileAvatar({ animalId, backgroundColor, size = 48, label = false, className = "" }: ProfileAvatarProps) {
  const { scale, x = 0, y } = AVATAR_FRAMING[animalId];
  return (
    <span
      className={`relative inline-flex shrink-0 overflow-hidden rounded-full align-middle ${backgroundColor ? "border-2 border-white" : ""} ${className}`}
      style={{ width: size, height: size, background: backgroundColor }}
    >
      <img
        src={avatarSrc(animalId)}
        alt={label ? avatarLabel(animalId) : ""}
        width={size}
        height={size}
        decoding="async"
        draggable={false}
        className="h-full w-full object-contain"
        style={{ transform: `translate(${x}%, ${y}%) scale(${scale})` }}
      />
    </span>
  );
}
