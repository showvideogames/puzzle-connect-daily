import { FavoriteStar } from "@/components/account/FavoriteStar";
import { RecentFriendsActivity } from "./RecentFriendsActivity";
import { FriendWeek } from "./FriendWeek";
import { FriendProfile } from "@/components/account/FriendProfile";
import { FriendPreferences } from "@/components/account/FriendPreferences";
import { socialPreferencesEnabled } from "@/lib/socialPreferences";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { DisplayNameGate } from "@/components/account/DisplayNameGate";
import { FriendActions } from "@/components/account/FriendActions";
import { FriendsHome, type FriendsTab } from "@/components/account/FriendsHome";
import { ProfileForm } from "@/components/account/ProfileForm";
import { accountPanel, dangerFill, primaryAction, secondaryAction } from "@/components/account/accountStyles";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import type { FriendResult } from "@/lib/friendResults";
import { hasDisplayName, newProfile, type SharedProfile } from "@/lib/sharedProfile";
import { NO_RESULTS_NOTE, friendChangeProblem, isBackgroundCheck, profileFromMe, socialProblem } from "@/lib/socialView";
import type { Result } from "@/social/contract";
import { AddFriendFlow } from "./AddFriendFlow";
import { BlockedPeople } from "./BlockedPeople";
import { GroupFlow } from "./GroupFlow";
import { FriendLinkCard, GroupLinkCard } from "./LinkCards";
import { MyGroups } from "./MyGroups";
import type { MadeLink, SocialApi } from "./socialApi";
import { RETRY_MS, readLink, readPerson, type LinkView, type PersonData } from "./socialData";
import { useLive } from "./useLive";
import { WaitingRequests } from "./WaitingRequests";

import { HEADER_REFRESH } from "./socialHeaderEvents";

const GAME_NAME = "Rainbow Categories";

interface Loaded extends Partial<PersonData> {
  link: LinkView | null;
}

interface SocialScreensProps {
  api: SocialApi;
  signedIn: boolean;
  /** The invitation being answered, if there is one. */
  code: string | null;
  /** Moves when something outside this person's screens changed. */
  refresh?: number;
  tab: FriendsTab;
  onTab: (tab: FriendsTab) => void;
  onNote: (note: string) => void;
  onLink?: (link: MadeLink) => void;
  onLeaveLink: (tab?: FriendsTab) => void;
  onSignIn: () => void;
  signingIn?: boolean;
  /** Not now, at the Display Name gate. */
  onNameLater: () => void;
  /** What a guest sees with no invitation. */
  guest: ReactNode;
  /** What shows until the first answer. */
  waiting: ReactNode;
  editorClassName?: string;
  /** Opens straight into the profile editor, as Edit profile in Settings does. */
  startEditingProfile?: boolean;
  /** Opens straight into Add a friend, as Add friends in the results popup does. */
  startAddingFriend?: boolean;
  /** Leaves the profile form for the Friends home, as Friends & Groups in the menus does. Asks first only if changes would be lost. */
  startFriendsHome?: boolean;
}

/**
 * Everything one person can see. Whoever renders this gives it a new key for
 * every person and link, so all of it goes at once, and an answer from before
 * that has nowhere to paint.
 */
export function SocialScreens({
  api,
  signedIn,
  code,
  refresh = 0,
  tab,
  onTab,
  onNote,
  onLink,
  onLeaveLink,
  onSignIn,
  signingIn = false,
  onNameLater,
  guest,
  waiting,
  editorClassName = "mx-auto w-full max-w-[32rem] px-5 py-5 sm:px-8 sm:py-7",
  startEditingProfile = false,
  startAddingFriend = false,
  startFriendsHome = false,
}: SocialScreensProps) {
  const live = useLive();
  const loadNo = useRef(0);
  /** setFriendPreference writes, one at a time, and the last value each friend's row was saved with. */
  const preferenceQueue = useRef<Promise<unknown>>(Promise.resolve());
  const savedPreference = useRef(new Map<string, { favorite: boolean; nickname: string | null }>());
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [addingFriend, setAddingFriend] = useState(startAddingFriend);
  useEffect(() => { if (startAddingFriend) setAddingFriend(true); }, [startAddingFriend]);
  const [choosingName, setChoosingName] = useState(false);
  const [editingProfile, setEditingProfile] = useState(startEditingProfile);
  useEffect(() => { if (startEditingProfile) setEditingProfile(true); }, [startEditingProfile]);
  /** Whether the open profile form differs from the saved profile. */
  const unsavedProfile = useRef(false);
  const markUnsaved = useCallback((dirty: boolean) => { unsavedProfile.current = dirty; }, []);
  const [askingToLeave, setAskingToLeave] = useState(false);
  /** A sent save can't be called back, so while one is out the question offers to go once it lands. */
  const [savingProfile, setSavingProfile] = useState(false);
  const leaveAfterSave = useRef(false);
  const editor = useRef<HTMLElement>(null);
  const closeProfileForm = useCallback(() => {
    setAskingToLeave(false);
    setChoosingName(false);
    setEditingProfile(false);
  }, []);
  useEffect(() => {
    if (!startFriendsHome) return;
    if (unsavedProfile.current) {
      leaveAfterSave.current = false;
      setAskingToLeave(true);
    } else closeProfileForm();
  }, [startFriendsHome, closeProfileForm]);
  const [blockVersion, setBlockVersion] = useState(0);
  const [profileFriendId, setProfileFriendId] = useState<string | null>(null);
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  /** After a Remove or Block from a profile, focus lands on the Friends heading instead of the page. */
  const [focusHomeTitle, setFocusHomeTitle] = useState(false);
  const homeTitleFocused = useCallback(() => setFocusHomeTitle(false), []);

  /** Only the newest read paints, and only while this person is still here. */
  const load = useCallback(
    async function again(refreshHeader = true): Promise<void> {
      loadNo.current += 1;
      const thisLoad = loadNo.current;
      const wanted = () => live.current && thisLoad === loadNo.current;
      const later = () => {
        setTimeout(() => {
          if (wanted()) void again(refreshHeader);
        }, RETRY_MS);
      };

      const read = code === null ? { link: null, problem: null } : await readLink(api, code);
      if (!wanted()) return;
      if ("retry" in read && read.retry) {
        later();
        return;
      }
      if (!signedIn) {
        setLoaded({ link: read.link });
        if (read.problem) onNote(read.problem);
        return;
      }

      const person = await readPerson(api, partial => {
        if (wanted()) setLoaded(previous => previous ?? { ...partial, link: read.link });
      });
      if (!wanted()) return;
      if ("outcome" in person) {
        if (isBackgroundCheck(person.outcome)) {
          later();
          return;
        }
        setLoaded(previous => previous ? { ...previous, results: [], resultsPending: false, noResults: true } : null);
        setFailed(true);
        onNote(socialProblem(person.outcome));
        return;
      }
      setLoaded({ ...person, link: read.link });
      if (refreshHeader) dispatchEvent(new Event(HEADER_REFRESH));
      if (read.problem) onNote(read.problem);
      else if (person.noResults) onNote(NO_RESULTS_NOTE);
    },
    [api, code, live, onNote, signedIn],
  );

  useEffect(() => {
    void load(false);
  }, [load, refresh]);

  if (loaded === null) return <>{failed ? null : waiting}</>;

  const profile = loaded.me ? profileFromMe(loaded.me) : null;
  const displayName = profile?.displayName;
  const chooseName = () => setChoosingName(true);

  const saveProfile = async (saved: SharedProfile) => {
    setSavingProfile(true);
    try {
      const answer = await api.client.call("setProfile", { displayName: saved.displayName ?? "", animalId: saved.animalId, backgroundColor: saved.backgroundColor });
      if (!live.current) return;
      if (answer.ok === false) {
        onNote(socialProblem(answer.outcome));
        throw new Error(answer.outcome);
      }
      await load();
      if (!live.current) return;
      if (leaveAfterSave.current && editingProfile) setFocusHomeTitle(true);
      closeProfileForm();
      onNote("Profile saved.");
    } catch (error) {
      // The changes are still unsaved and still in the form. Someone waiting to go is asked
      // the plain discard question; an open "still saving" question closes, back to the form.
      if (live.current) setAskingToLeave(leaveAfterSave.current);
      throw error;
    } finally {
      leaveAfterSave.current = false;
      if (live.current) setSavingProfile(false);
    }
  };

  // Friends & Groups while the profile form has changes: stay, or discard them and go.
  // While a save is out nothing can be discarded, so the choice is to go once it lands.
  const leavePrompt = (
    <AlertDialog open={askingToLeave} onOpenChange={(open) => { if (!open) setAskingToLeave(false); }}>
      <AlertDialogContent
        className="social-design w-[calc(100vw-2rem)] max-w-md rounded-3xl sm:rounded-3xl"
        onCloseAutoFocus={(event) => {
          // No Radix trigger opened this. Staying or waiting goes back to the Display Name;
          // discarding has already sent focus to the Friends heading.
          event.preventDefault();
          editor.current?.querySelector("input")?.focus();
        }}
      >
        <AlertDialogHeader className="text-left sm:text-left">
          <AlertDialogTitle className="text-xl font-extrabold">{savingProfile ? "Still saving your profile" : "Discard profile changes?"}</AlertDialogTitle>
          <AlertDialogDescription className="text-base text-foreground">
            {savingProfile ? "Your changes are being saved. Stay here, or go to Friends once they're saved." : "Your profile changes haven't been saved."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2.5 sm:space-x-0">
          <AlertDialogCancel className={`${secondaryAction} mt-0 h-11 text-base`}>Stay</AlertDialogCancel>
          {savingProfile ? (
            <button
              key="after-save"
              type="button"
              onClick={() => {
                leaveAfterSave.current = true;
                setAskingToLeave(false);
              }}
              className={`${primaryAction} h-11 text-base`}
            >
              Go when saved
            </button>
          ) : (
            <button
              key="discard"
              type="button"
              onClick={() => {
                if (editingProfile) setFocusHomeTitle(true);
                closeProfileForm();
              }}
              className={cn(secondaryAction, "h-11 border-transparent text-base", dangerFill)}
            >
              Discard changes
            </button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  if (choosingName) {
    return (
      <main ref={editor} className={`${accountPanel} ${editorClassName}`}>
        <ProfileForm mode="setup" initial={profile ?? newProfile()} onCancel={() => setChoosingName(false)} onSave={saveProfile} onDirtyChange={markUnsaved} />
        {leavePrompt}
      </main>
    );
  }

  // Someone with no Display Name yet gets the setup form below instead.
  if (editingProfile && signedIn && hasDisplayName(profile)) {
    return (
      <main ref={editor} className={`${accountPanel} ${editorClassName}`}>
        <ProfileForm mode="edit" initial={profile ?? newProfile()} onCancel={() => setEditingProfile(false)} onSave={saveProfile} onDirtyChange={markUnsaved} />
        {leavePrompt}
      </main>
    );
  }

  const { link } = loaded;
  const linkProps = { api, code: code ?? "", signedIn, displayName, onSignIn, onChooseName: chooseName, onLeave: onLeaveLink };

  if (link?.kind === "friend") return <FriendLinkCard {...linkProps} card={link.card} />;
  if (link?.kind === "group") return <GroupLinkCard {...linkProps} signingIn={signingIn} invite={link.invite} />;

  if (!signedIn) return <>{guest}</>;

  if (!hasDisplayName(profile)) return <DisplayNameGate onChooseName={chooseName} onNotNow={onNameLater} />;

  /** A refusal stays beside the action, and a change reloads the list it came from. */
  const afterChange = async (answer: Result<unknown>) => {
    if (!live.current) return undefined;
    if (answer.ok === false) return friendChangeProblem(answer.outcome);
    await load();
    return undefined;
  };

  /** A friend's id is their friendRef. Each answers with a sentence when it was refused. */
  const removeFriend = (result: FriendResult) => async () => afterChange(await api.client.call("removeFriend", { friendRef: result.id }));
  const blockFriend = (result: FriendResult) => async () => {
    const answer = await api.client.call("block", { ref: result.id });
    const problem = await afterChange(answer);
    if (answer.ok) setBlockVersion((version) => version + 1);
    return problem;
  };

  /** Nothing can be done to your own row. */
  const friendActions = (result: FriendResult) =>
    result.isYou ? null : (
      <div>
      <FriendActions name={result.name} onRemove={removeFriend(result)} onBlock={blockFriend(result)} />
      </div>
    );

  /**
   * The operation replaces the whole row, so each write waits for the one before
   * and lays its change over the newest row known: the last one saved here, or
   * else what was loaded. A star and a nickname saved close together can't undo
   * each other.
   */
  const savePreference = (friend: FriendResult, patch: { favorite: boolean } | { nickname: string | null }) => {
    const write = async () => {
      const row = { ...(savedPreference.current.get(friend.id) ?? { favorite: !!friend.favorite, nickname: friend.nickname ?? null }), ...patch };
      const answer = await api.client.call("setFriendPreference", { friendRef: friend.id, ...row });
      if (answer.ok) savedPreference.current.set(friend.id, row);
      return answer;
    };
    const written = preferenceQueue.current.then(write, write);
    preferenceQueue.current = written.catch(() => undefined);
    return written;
  };

  const preferences = (result:FriendResult) => socialPreferencesEnabled() && <FriendPreferences friend={result} onSave={async patch => {
        const answer = await savePreference(result, patch);
        if (!live.current) return;
        if (answer.ok === false) return answer.outcome === "bad_name" ? "Please use a nickname of 24 characters or fewer." : "We couldn't save those preferences. Please try again.";
        await load();
      }} />;

  const favoriteStar = (friend: FriendResult, size?: "title") => <FavoriteStar size={size} name={friend.nickname || friend.name} favorite={!!friend.favorite} onSave={async () => {
    const answer = await savePreference(friend, { favorite: !friend.favorite });
    if (!live.current) return;
    if (!answer.ok) return "Couldn't save favorite. Try again.";
    await load();
  }}/>;
  /** Left out entirely while preferences are off, so nothing offers a star that isn't there. */
  const favoriteAction = socialPreferencesEnabled() ? (friend: FriendResult) => favoriteStar(friend) : undefined;

  const profileFriend = loaded.results?.find(result => !result.isYou && result.id === profileFriendId);
  const openGroup = loaded.groups?.find((group) => group.groupId === openGroupId);

  return (
    <WaitingRequests api={api} incoming={loaded.incoming ?? []} displayName={displayName} onReload={load}>
      {addingFriend ? (
        <AddFriendFlow
          api={api}
          displayName={displayName}
          outgoing={loaded.outgoing ?? []}
          onNote={onNote}
          onLink={onLink}
          onReload={load}
          onBack={() => {
            setAddingFriend(false);
            void load();
          }}
        />
      ) : profileFriend ? (
        <FriendProfile preferences={preferences(profileFriend)} favoriteAction={socialPreferencesEnabled() ? favoriteStar(profileFriend, "title") : null} friend={profileFriend} viewer={loaded.results?.find(result => result.isYou)} today={api.today()} resultsAvailable={!loaded.noResults} onRemove={removeFriend(profileFriend)} onBlock={blockFriend(profileFriend)} activity={api.recentActivity || api.weekPuzzles ? <FriendWeek key={profileFriend.id} api={api} friend={profileFriend} /> : undefined} onBack={() => setProfileFriendId(null)} onManaged={() => setFocusHomeTitle(true)} />
      ) : openGroup ? (
        <GroupFlow
          key={openGroup.groupId}
          api={api}
          group={openGroup}
          onReload={load}
          onBack={() => setOpenGroupId(null)}
          onLeft={(note) => {
            setOpenGroupId(null);
            onNote(note);
            void load();
          }}
        />
      ) : (
        <FriendsHome
          favoriteAction={favoriteAction}
          displayName={displayName}
          // With recent completions off (as in production), nothing is passed and the card shows today's results.
          activity={!api.recentActivity ? undefined : loaded.resultsPending || loaded.noResults ? null : <RecentFriendsActivity api={api} friends={loaded.results ?? []} onOpen={friend=>setProfileFriendId(friend.id)} />}
          gameName={GAME_NAME}
          results={loaded.results ?? []}
          resultsNotice={loaded.resultsPending ? <p role="status" className="py-2 text-sm font-medium text-slate">Loading results…</p> : loaded.noResults ? <p role="status">Results are unavailable. <button className="min-h-11 rounded-lg px-1 font-bold underline underline-offset-4" onClick={() => void load(false)}>Try again</button></p> : undefined}
          friendCode={loaded.me?.friendCode ?? ""}
          tab={tab}
          onTabChange={onTab}
          onAddFriend={() => setAddingFriend(true)}
          groupsPreview={<MyGroups compact api={api} groups={loaded.groups ?? []} displayName={displayName} onNote={onNote} onLink={onLink} onReload={load} onOpen={setOpenGroupId} />}
          groups={<MyGroups api={api} groups={loaded.groups ?? []} displayName={displayName} onNote={onNote} onLink={onLink} onReload={load} onOpen={setOpenGroupId} />}
          today={api.today()}
          onFriendProfile={friend => setProfileFriendId(friend.id)}
          rowActions={friendActions}
          onEditProfile={() => setEditingProfile(true)}
          friendsFooter={<BlockedPeople api={api} version={blockVersion} />}
          focusTitle={focusHomeTitle}
          onTitleFocused={homeTitleFocused}
        />
      )}
    </WaitingRequests>
  );
}
