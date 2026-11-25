import { creatorColor, creatorInitials } from "@/lib/creatorAvatar";

/**
 * A creator's avatar: their public name's initials on one of the approved
 * profile colours, picked from the public slug so it is stable everywhere.
 * Rainbow stores no profile pictures (see lib/sharedProfile.ts), so this draws
 * only from the public identity that already exists. Decorative: the name is
 * always shown beside it.
 */
export function CreatorAvatar({ name, slug, size = 48 }: { name: string; slug: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      data-testid="creator-avatar"
      className="inline-flex shrink-0 select-none items-center justify-center rounded-full border border-black/5 font-extrabold text-[#2b2620]"
      style={{ width: size, height: size, backgroundColor: creatorColor(slug), fontSize: Math.round(size * 0.38) }}
    >
      {creatorInitials(name)}
    </span>
  );
}
