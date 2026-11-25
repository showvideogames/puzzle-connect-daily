import { Link } from "react-router-dom";
import type { CommunityCreator } from "@/lib/customPuzzles";
import { CreatorAvatar } from "./CreatorAvatar";
import { FollowButton } from "./FollowButton";
import { communityLink } from "@/components/CommunityPuzzleCard";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A creator in the Creators search: avatar, public name (to their page), aggregate counts, Follow. */
export function CommunityCreatorCard({ creator, signedIn, onChange }: {
  creator: CommunityCreator;
  signedIn: boolean | undefined;
  onChange: (next: CommunityCreator) => void;
}) {
  return (
    <li className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-card p-4" data-testid="creator-card">
      <CreatorAvatar name={creator.displayName} slug={creator.publicSlug} size={48} />
      <div className="min-w-0 flex-1">
        <Link to={`/creator/${creator.publicSlug}?view=community`} className={`${communityLink} block break-words text-base rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}>
          {creator.displayName}
        </Link>
        <p className="text-xs text-muted-foreground tabular-nums">
          {plural(creator.listedCount, "puzzle", "puzzles")} in Community · {plural(creator.followerCount, "follower", "followers")}
        </p>
      </div>
      {!creator.isMe && (
        <FollowButton
          compact
          slug={creator.publicSlug}
          name={creator.displayName}
          following={creator.followedByMe}
          signedIn={signedIn}
          onChange={(s) => onChange({ ...creator, followedByMe: s.following, followerCount: s.followerCount })}
        />
      )}
    </li>
  );
}
