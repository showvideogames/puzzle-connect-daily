import { useEffect, useRef, type ReactNode } from "react";
import {
  canOpenResult,
  resultSummary,
  type FriendResult,
} from "@/lib/friendResults";
import { accountCard, accountPanelFromSm, pageTitle, purpleFocusRing, quietText, sectionTitle } from "./accountStyles";
import { BackLink } from "./BackLink";
import { FriendMenu } from "./FriendMenu";
import { ProfileAvatar } from "./ProfileAvatar";
import { ResultDetail } from "./ResultDetail";

interface Props {
  friend: FriendResult;
  viewer?: FriendResult;
  today: Date;
  resultsAvailable: boolean;
  /** Remove and Block, behind the ⋯ menu. Each answers with a sentence when it was refused. */
  onRemove?: () => Promise<string | void>;
  onBlock?: () => Promise<string | void>;
  /** The favorite star. It sits beside the heading, never inside it. */
  favoriteAction?: ReactNode;
  preferences?: ReactNode;
  activity?: ReactNode;
  onBack: () => void;
  /** After a Remove or Block went through, before this profile goes. */
  onManaged?: () => void;
}
/** A friend's public face and the viewer's private preferences. No level/XP is implied. */
export function FriendProfile({
  friend,
  resultsAvailable,
  onRemove,
  onBlock,
  activity,
  onBack,
  favoriteAction,
  preferences,
  onManaged,
}: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const name = friend.nickname || friend.name;
  return (
    <main
      className={`${accountPanelFromSm} social-design w-full px-0 pb-6 pt-1 sm:px-8 sm:pb-8 sm:pt-3`}
      data-testid="friend-profile"
    >
      <div className="flex min-h-12 items-center justify-between">
        <BackLink onClick={onBack} />
        {onRemove && onBlock && <FriendMenu name={name} publicName={friend.nickname ? friend.name : undefined} onRemove={onRemove} onBlock={onBlock} onDone={onManaged} />}
      </div>
      <div className="flex flex-col items-center text-center">
        <ProfileAvatar
          animalId={friend.animalId}
          backgroundColor={friend.backgroundColor}
          size={144}
          className="max-[359px]:!h-28 max-[359px]:!w-28"
        />
        {/* The star is the heading's sibling, so the heading's name is only the friend's name. */}
        <div className="mt-4 flex max-w-full items-center justify-center gap-1.5 sm:gap-2">
          <h1
            ref={heading}
            tabIndex={-1}
            className={`${pageTitle} min-w-0 break-words rounded-lg py-1 outline-none max-[359px]:text-3xl ${purpleFocusRing}`}
          >
            {name}
          </h1>
          {favoriteAction}
        </div>
        {friend.nickname && (
          <p className={`${quietText} mt-1 break-words text-sm font-medium`}>
            Public name: {friend.name}
          </p>
        )}
      </div>
      {preferences && (
        <div className="mx-auto mt-4 max-w-sm text-center">{preferences}</div>
      )}
      {activity ??
        (resultsAvailable && friend.status !== "not-played" ? (
          <section className={`${accountCard} mt-6`}>
            <h2 className={sectionTitle}>Recent activity</h2>
            <p className="mt-2 text-base font-medium">{resultSummary(friend)}</p>
            {canOpenResult(friend) && <div className="mt-2"><ResultDetail result={friend} /></div>}
          </section>
        ) : (
          <p className={`mt-6 text-center ${quietText}`}>
            {resultsAvailable
              ? "No recent activity"
              : "Today's puzzle results aren't available right now."}
          </p>
        ))}
    </main>
  );
}
