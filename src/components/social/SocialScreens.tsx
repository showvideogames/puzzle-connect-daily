import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { DisplayNameGate } from "@/components/account/DisplayNameGate";
import { FriendActions } from "@/components/account/FriendActions";
import { FriendsHome, type FriendsTab } from "@/components/account/FriendsHome";
import { ProfileForm } from "@/components/account/ProfileForm";
import { accountPanel } from "@/components/account/accountStyles";
import type { FriendResult } from "@/lib/friendResults";
import { hasDisplayName, newProfile, type SharedProfile } from "@/lib/sharedProfile";
import { NO_RESULTS_NOTE, friendChangeProblem, isBackgroundCheck, profileFromMe, socialProblem } from "@/lib/socialView";
import type { Result } from "@/social/contract";
import { AddFriendFlow } from "./AddFriendFlow";
import { GroupFlow } from "./GroupFlow";
import { FriendLinkCard, GroupLinkCard } from "./LinkCards";
import { MyGroups } from "./MyGroups";
import type { MadeLink, SocialApi } from "./socialApi";
import { RETRY_MS, readLink, readPerson, type LinkView, type PersonData } from "./socialData";
import { useLive } from "./useLive";
import { WaitingRequests } from "./WaitingRequests";

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
}: SocialScreensProps) {
  const live = useLive();
  const loadNo = useRef(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [addingFriend, setAddingFriend] = useState(false);
  const [choosingName, setChoosingName] = useState(false);
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);

  /** Only the newest read paints, and only while this person is still here. */
  const load = useCallback(
    async function again(): Promise<void> {
      loadNo.current += 1;
      const thisLoad = loadNo.current;
      const wanted = () => live.current && thisLoad === loadNo.current;
      const later = () => {
        setTimeout(() => {
          if (wanted()) void again();
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

      const person = await readPerson(api);
      if (!wanted()) return;
      if ("outcome" in person) {
        if (isBackgroundCheck(person.outcome)) {
          later();
          return;
        }
        setFailed(true);
        onNote(socialProblem(person.outcome));
        return;
      }
      setLoaded({ ...person, link: read.link });
      if (read.problem) onNote(read.problem);
      else if (person.noResults) onNote(NO_RESULTS_NOTE);
    },
    [api, code, live, onNote, signedIn],
  );

  useEffect(() => {
    void load();
  }, [load, refresh]);

  if (loaded === null) return <>{failed ? null : waiting}</>;

  const profile = loaded.me ? profileFromMe(loaded.me) : null;
  const displayName = profile?.displayName;
  const chooseName = () => setChoosingName(true);

  const saveProfile = async (saved: SharedProfile) => {
    const answer = await api.client.call("setProfile", { displayName: saved.displayName ?? "", animalId: saved.animalId, backgroundColor: saved.backgroundColor });
    if (!live.current) return;
    if (answer.ok === false) {
      onNote(socialProblem(answer.outcome));
      throw new Error(answer.outcome);
    }
    await load();
    if (live.current) setChoosingName(false);
  };

  if (choosingName) {
    return (
      <main className={`${accountPanel} ${editorClassName}`}>
        <ProfileForm mode="setup" initial={profile ?? newProfile()} onCancel={() => setChoosingName(false)} onSave={saveProfile} />
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

  /** A friend's id is their friendRef. Nothing can be done to your own row. */
  const friendActions = (result: FriendResult) =>
    result.isYou ? null : (
      <FriendActions
        name={result.name}
        onRemove={async () => afterChange(await api.client.call("removeFriend", { friendRef: result.id }))}
        onBlock={async () => afterChange(await api.client.call("block", { ref: result.id }))}
      />
    );

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
      ) : openGroup ? (
        <GroupFlow
          key={openGroup.groupId}
          api={api}
          group={openGroup}
          onBack={() => setOpenGroupId(null)}
          onLeft={(note) => {
            setOpenGroupId(null);
            onNote(note);
            void load();
          }}
        />
      ) : (
        <FriendsHome
          gameName={GAME_NAME}
          results={loaded.results ?? []}
          friendCode={loaded.me?.friendCode ?? ""}
          tab={tab}
          onTabChange={onTab}
          onAddFriend={() => setAddingFriend(true)}
          groups={<MyGroups api={api} groups={loaded.groups ?? []} displayName={displayName} onNote={onNote} onLink={onLink} onReload={load} onOpen={setOpenGroupId} />}
          today={api.today()}
          rowActions={friendActions}
        />
      )}
    </WaitingRequests>
  );
}
