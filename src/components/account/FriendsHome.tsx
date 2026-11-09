import { ProfileAvatar } from "./ProfileAvatar";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Copy, UserPlus, ChevronRight, Plus, UserRound } from "lucide-react";
import type { FriendResult } from "@/lib/friendResults";
import { cn } from "@/lib/utils";
import {
  accountCard,
  accountPanelFromSm,
  iconButton,
  pageTitle,
  primaryAction,
  purpleFocusRing,
  purpleText,
  quietText,
  sectionTitle,
  seeAllAction,
} from "./accountStyles";
import { ResultRow } from "./ResultRow";
import { SocialToast } from "./SocialToast";
export type FriendsTab = "friends" | "groups";
interface FriendsHomeProps {
  gameName: string;
  results: readonly FriendResult[];
  resultsNotice?: ReactNode;
  friendCode: string;
  tab: FriendsTab;
  onTabChange: (tab: FriendsTab) => void;
  onAddFriend: () => void;
  groups: ReactNode;
  groupsPreview?: ReactNode;
  today?: Date;
  /** The viewer's own Display Name, for the greeting. Left out, it says "Hi there!". */
  displayName?: string;
  onFriendProfile?: (friend: FriendResult) => void;
  rowActions?: (friend: FriendResult) => ReactNode;
  onEditProfile?: () => void;
  friendsFooter?: ReactNode;
  /** Moves focus to the "Friends" heading, as after a friend was removed or blocked. Answered with onTitleFocused. */
  focusTitle?: boolean;
  onTitleFocused?: () => void;
  /** The star beside each friend. Left out, there is no Favorite friends card. */
  favoriteAction?: (friend: FriendResult) => ReactNode;
  /** The recent-completions list. Left out, the card shows today's results instead, titled Today. */
  activity?: ReactNode;
}

/** One half of the Home / Groups switch. */
const segment = (current: boolean) =>
  cn(
    "min-h-11 min-w-[5.5rem] rounded-full px-5 text-sm font-bold transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(258_90%_52%)] focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    current ? "bg-[hsl(258_90%_52%)] text-white shadow-sm" : "text-foreground hover:bg-background/70",
  );

export function FriendsHome({
  gameName,
  results,
  resultsNotice,
  friendCode,
  tab,
  onTabChange,
  onAddFriend,
  groups,
  groupsPreview,
  today,
  displayName,
  onFriendProfile,
  rowActions,
  onEditProfile,
  friendsFooter,
  favoriteAction,
  activity,
  focusTitle = false,
  onTitleFocused,
}: FriendsHomeProps) {
  const friends = results.filter((friend) => !friend.isYou),
    favorites = friends.filter((friend) => friend.favorite);
  const [openId, setOpenId] = useState<string | null>(null),
    [toast, setToast] = useState<string | null>(null);
  const [toastVersion, setToastVersion] = useState(0);
  const dismiss = useCallback(() => setToast(null), []);
  const allFriends = useRef<HTMLHeadingElement>(null);
  const recent = activity !== undefined;
  const todayLabel = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(today ?? new Date());
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!focusTitle) return;
    title.current?.focus();
    onTitleFocused?.();
  }, [focusTitle, onTitleFocused]);
  const open = (friend: FriendResult) =>
    onFriendProfile
      ? onFriendProfile(friend)
      : setOpenId(openId === friend.id ? null : friend.id);
  // Favorites are starred in All friends, so + takes you there. It adds no data of its own.
  const showAllFriends = () => {
    allFriends.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
    allFriends.current?.focus({ preventScroll: true });
  };
  const addFavorite = friends.length > 0 && (
    <button
      type="button"
      aria-label="Add a favorite"
      onClick={showAllFriends}
      className="inline-flex size-14 shrink-0 items-center justify-center rounded-full bg-[hsl(258_100%_95%)] text-[hsl(258_90%_50%)] transition-colors hover:bg-[hsl(258_100%_91%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(258_90%_52%)] focus-visible:ring-offset-2 focus-visible:ring-offset-background dark:bg-[hsl(258_55%_20%)] dark:text-[hsl(258_100%_86%)] dark:hover:bg-[hsl(258_55%_26%)]"
    >
      <Plus aria-hidden="true" className="h-7 w-7" strokeWidth={2.5} />
    </button>
  );
  return (
    <main
      className={`${accountPanelFromSm} social-design w-full px-0 py-2 sm:p-8`}
      data-testid="friends-home"
    >
      {/* The toast is fixed to the screen, outside this block, so copying never moves it. */}
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <p className={`break-words text-base font-extrabold sm:text-lg ${purpleText}`}>
            {displayName ? `Hi, ${displayName}!` : "Hi there!"}{" "}
            <span aria-hidden="true">👋</span>
          </p>
          <h1 ref={title} tabIndex={-1} className={`${pageTitle} mt-1 rounded-lg outline-none ${purpleFocusRing}`}>Friends</h1>
          <p className={`mt-3 text-base ${quietText}`}>
            Your game buddies on {gameName}.
          </p>
        </div>
        {friendCode && (
          <button
            type="button"
            aria-label="Copy friend code"
            className="flex min-h-16 shrink-0 items-center gap-4 rounded-2xl border border-[hsl(258_100%_85%)] bg-[hsl(258_100%_97%)] py-2 pl-4 pr-3 text-left transition-colors hover:bg-[hsl(258_100%_95%)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(258_90%_52%)] focus-visible:ring-offset-2 focus-visible:ring-offset-background dark:border-[hsl(258_70%_55%)] dark:bg-[hsl(258_55%_20%)] dark:hover:bg-[hsl(258_55%_20%)]"
            onClick={async () => {
              setToastVersion((n) => n + 1);
              try {
                await navigator.clipboard.writeText(friendCode);
                setToast("Copied to clipboard");
              } catch {
                setToast("Could not copy. Select and copy your code instead.");
              }
            }}
          >
            <span>
              <span className={`block text-sm font-bold ${purpleText}`} data-testid="friend-code-label">
                Friend code
              </span>
              <strong className="block select-text text-xl font-black leading-tight tracking-wide text-foreground">
                {friendCode}
              </strong>
            </span>
            <Copy aria-hidden="true" className={`h-6 w-6 shrink-0 ${purpleText}`} />
          </button>
        )}
      </header>
      <div className="mt-5 flex items-center gap-2">
        <nav aria-label="Friends and groups" className="inline-flex rounded-full bg-secondary p-1">
          <button
            type="button"
            className={segment(tab === "friends")}
            aria-current={tab === "friends" ? "page" : undefined}
            onClick={() => onTabChange("friends")}
          >
            Home
          </button>
          <button
            type="button"
            className={segment(tab === "groups")}
            aria-current={tab === "groups" ? "page" : undefined}
            onClick={() => onTabChange("groups")}
          >
            Groups
          </button>
        </nav>
        {onEditProfile && (
          <button
            type="button"
            className={`${iconButton} ml-auto text-foreground`}
            onClick={onEditProfile}
            aria-label="Edit profile"
          >
            <UserRound aria-hidden size={22} />
          </button>
        )}
      </div>
      {tab === "groups" ? (
        <section aria-label="Your groups" className="mt-5">
          <h2 className="mb-4 text-2xl font-extrabold">Your groups</h2>
          {groups}
        </section>
      ) : (
        <div className="mt-5 space-y-4">
          {/* Without stars (preferences off) there is no way to favorite anyone, so no card. */}
          {favoriteAction && (
          <section className={accountCard} aria-label="Favorite friends">
            <h2 className={sectionTitle}>Favorite friends</h2>
            {favorites.length > 0 ? (
              <ul className="mt-3 flex flex-wrap items-start gap-x-2 gap-y-3 sm:gap-x-4">
                {favorites.map((friend) => (
                  <li key={friend.id}>
                    <button
                      type="button"
                      aria-label={`Open ${friend.nickname || friend.name}'s profile`}
                      onClick={() => open(friend)}
                      className="flex w-[4.75rem] flex-col items-center gap-1.5 rounded-xl p-1 hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(258_90%_52%)]"
                    >
                      <ProfileAvatar
                        animalId={friend.animalId}
                        backgroundColor={friend.backgroundColor}
                        size={64}
                      />
                      <span className="w-full truncate text-center text-sm font-bold text-foreground">
                        {friend.nickname || friend.name}
                      </span>
                    </button>
                  </li>
                ))}
                {addFavorite && <li className="flex h-[4.5rem] items-center px-1">{addFavorite}</li>}
              </ul>
            ) : (
              <div className="mt-3 flex items-center gap-3">
                {addFavorite}
                <p className={`text-sm font-medium ${quietText}`}>
                  Star a friend to keep them close.
                </p>
              </div>
            )}
          </section>
          )}
          <section className={accountCard} aria-label={recent ? "Recent activity" : "Today"}>
            {recent ? (
              <h2 className={sectionTitle}>Recent activity</h2>
            ) : (
              <div className="flex items-baseline justify-between gap-3">
                <h2 className={sectionTitle}>Today</h2>
                <p className="text-sm text-slate">{todayLabel}</p>
              </div>
            )}
            <span className="sr-only">{gameName}</span>
            <div className="mt-2">
              {resultsNotice || activity || (
                <>
                  {!friends.some((friend) => friend.status !== "not-played") ? (
                    <p className={quietText}>No one has played today's puzzle yet.</p>
                  ) : (
                    <ul>
                      {friends
                        .filter((friend) => friend.status !== "not-played")
                        .map((friend) => (
                          <ResultRow
                            key={friend.id}
                            result={friend}
                            open={openId === friend.id}
                            onToggle={() => open(friend)}
                            navigation={!!onFriendProfile}
                            actions={rowActions?.(friend)}
                          />
                        ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          </section>
          <section className={accountCard} aria-label="Your groups">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className={sectionTitle}>Your groups</h2>
              <button type="button" className={`${seeAllAction} -mr-2`} onClick={() => onTabChange("groups")}>
                See all<span className="sr-only"> groups</span>
                <ChevronRight aria-hidden="true" className="h-5 w-5" strokeWidth={2.5} />
              </button>
            </div>
            {groupsPreview ?? groups}
          </section>
          <section className={accountCard} aria-label="All friends">
            <h2
              ref={allFriends}
              tabIndex={-1}
              className={`${sectionTitle} scroll-mt-4 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[hsl(258_90%_52%)]`}
            >
              All friends{" "}
              <span className={`text-base font-semibold ${quietText}`}>
                {friends.length}
              </span>
            </h2>
            {!friends.length && !resultsNotice && (
              <p className={`mt-2 ${quietText}`}>
                Your next puzzle buddy is a friend code away.
              </p>
            )}
            <ul className="mt-2 divide-y divide-border">
              {friends.map((friend) => (
                <li key={friend.id} className="flex items-center gap-1 py-1.5">
                  <button
                    type="button"
                    className="flex min-h-16 min-w-0 flex-1 items-center gap-2.5 rounded-xl text-left sm:gap-3 hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(258_90%_52%)]"
                    onClick={() => open(friend)}
                  >
                    <ProfileAvatar
                      animalId={friend.animalId}
                      backgroundColor={friend.backgroundColor}
                      size={48}
                      className="max-[359px]:!h-10 max-[359px]:!w-10"
                    />
                    {/* A long name wraps to two lines rather than truncating to a few letters. */}
                    <span className="line-clamp-2 min-w-0 flex-1 break-words text-base font-extrabold leading-tight text-foreground sm:text-lg">
                      {friend.nickname || friend.name}
                    </span>
                    <ChevronRight aria-hidden="true" className="hidden h-5 w-5 shrink-0 text-slate min-[360px]:block" />
                  </button>
                  {favoriteAction?.(friend)}
                  {!onFriendProfile &&
                    openId === friend.id &&
                    friend.status === "not-played" &&
                    rowActions?.(friend)}
                </li>
              ))}
            </ul>
          </section>
          <button
            type="button"
            onClick={onAddFriend}
            className={cn(primaryAction, "min-h-14 w-full gap-2.5 rounded-2xl text-lg font-bold")}
          >
            <UserPlus aria-hidden="true" className="h-6 w-6" />
            Add friend
          </button>
          {friendsFooter}
        </div>
      )}
      <SocialToast key={toastVersion} message={toast} onDismiss={dismiss} />
    </main>
  );
}
