import { groupEmblemSrc, type GroupEmblemId } from "@/lib/groupEmblems";

interface GroupEmblemProps {
  emblemId: GroupEmblemId;
  /** An uploaded picture, shown instead of the emblem. */
  photo?: string | null;
  color: string;
  size?: number;
  className?: string;
}

/**
 * A group's picture on the group's own color. An emblem sits on the color; an
 * uploaded picture fills the frame and the color shows as its border, so both
 * kinds carry the color the group chose. Decorative: the name is always beside it.
 */
export function GroupEmblem({ emblemId, photo, color, size = 112, className = "" }: GroupEmblemProps) {
  const radius = size * 0.22;
  return (
    <span
      className={`inline-grid shrink-0 place-items-center overflow-hidden ${className}`}
      style={{ width: size, height: size, background: color, borderRadius: radius }}
    >
      {photo ? (
        <img src={photo} alt="" className="h-[86%] w-[86%] object-cover" style={{ borderRadius: radius * 0.72 }} />
      ) : (
        <img src={groupEmblemSrc(emblemId)} alt="" decoding="async" className="h-[88%] w-[88%] object-contain" />
      )}
    </span>
  );
}
