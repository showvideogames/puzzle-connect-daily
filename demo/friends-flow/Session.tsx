import { useCallback, useEffect, useRef, useState } from "react";
import { DisplayNameGate } from "@/components/account/DisplayNameGate";
import { FriendsHome, type FriendsTab } from "@/components/account/FriendsHome";
import { ProfileForm } from "@/components/account/ProfileForm";
import { accountPanel } from "@/components/account/accountStyles";
import { hasDisplayName, newProfile, type SharedProfile } from "@/lib/sharedProfile";
import { profileFromMe, socialProblem } from "@/lib/socialView";
import { AddFriendFlow } from "./AddFriendFlow";
import { readLink, readPerson, type LinkView, type PersonData } from "./flowData";
import { GuestPanel, Waiting } from "./flowPanels";
import { FriendLinkCard, GroupLinkCard } from "./LinkCards";
import { MyGroups } from "./MyGroups";
import type { Preview, PreviewLink } from "./preview";
import { useLive } from "./useLive";
import { WaitingRequests } from "./WaitingRequests";

const GAME_NAME = "Rainbow Categories";
const SIGN_IN_NOTE = "This preview has no sign-in page. Choose a person in the bar. This invitation stays open.";

interface Loaded extends Partial<PersonData> {
  link: LinkView | null;
}

interface SessionProps {
  preview: Preview;
  signedIn: boolean;
  /** The invitation in the address, if there is one. */
  code: string | null;
  /** Moves when something outside this person's screens changed. */
  refresh: number;
  tab: FriendsTab;
  onTab: (tab: FriendsTab) => void;
  onNote: (note: string) => void;
  onLink: (link: PreviewLink) => void;
  onLeaveLink: (tab?: FriendsTab) => void;
}

/**
 * Everything one person can see. FriendsFlow gives it a new key for every
 * person, day and link, so all of this goes at once, and an answer from before
 * that has nowhere to paint.
 */
export function Session({ preview, signedIn, code, refresh, tab, onTab, onNote, onLink, onLeaveLink }: SessionProps) {
  const live = useLive();
  const loadNo = useRef(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [addingFriend, setAddingFriend] = useState(false);
  const [choosingName, setChoosingName] = useState(false);

  /** Only the newest read paints, and only while this person is still here. */
  const load = useCallback(async () => {
    loadNo.current += 1;
    const thisLoad = loadNo.current;
    const wanted = () => live.current && thisLoad === loadNo.current;

    const read = code === null ? { link: null, problem: null } : await readLink(preview, code);
    if (!wanted()) return;
    if (!signedIn) {
      setLoaded({ link: read.link });
      if (read.problem) onNote(read.problem);
      return;
    }

    const person = await readPerson(preview);
    if (!wanted()) return;
    if ("outcome" in person) {
      onNote(socialProblem(person.outcome));
      return;
    }
    setLoaded({ ...person, link: read.link });
    if (read.problem) onNote(read.problem);
  }, [code, live, onNote, preview, signedIn]);

  useEffect(() => {
    void load();
  }, [load, refresh]);

  if (loaded === null) return <Waiting label="Loading" />;

  const profile = loaded.me ? profileFromMe(loaded.me) : null;
  const displayName = profile?.displayName;
  const askToSignIn = () => onNote(SIGN_IN_NOTE);
  const chooseName = () => setChoosingName(true);

  const saveProfile = async (saved: SharedProfile) => {
    const answer = await preview.client.call("setProfile", { displayName: saved.displayName ?? "", animalId: saved.animalId, backgroundColor: saved.backgroundColor });
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
      <main className={`${accountPanel} preview-editor`}>
        <ProfileForm mode="setup" initial={profile ?? newProfile()} onCancel={() => setChoosingName(false)} onSave={saveProfile} />
      </main>
    );
  }

  const { link } = loaded;
  const linkProps = { preview, code: code ?? "", signedIn, displayName, onSignIn: askToSignIn, onChooseName: chooseName, onLeave: onLeaveLink };

  if (link?.kind === "friend") return <FriendLinkCard {...linkProps} card={link.card} onNote={onNote} />;
  if (link?.kind === "group") return <GroupLinkCard {...linkProps} invite={link.invite} />;

  if (!signedIn) return <GuestPanel />;

  if (!hasDisplayName(profile)) {
    return <DisplayNameGate onChooseName={chooseName} onNotNow={() => onNote("Friends and Groups wait for a Display Name. Your games don't need one.")} />;
  }

  return (
    <WaitingRequests preview={preview} incoming={loaded.incoming ?? []} displayName={displayName} onNote={onNote} onReload={load}>
      {addingFriend ? (
        <AddFriendFlow
          preview={preview}
          displayName={displayName}
          onNote={onNote}
          onLink={onLink}
          onBack={() => {
            setAddingFriend(false);
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
          groups={<MyGroups preview={preview} groups={loaded.groups ?? []} displayName={displayName} onNote={onNote} onLink={onLink} onReload={load} />}
          today={preview.today()}
        />
      )}
    </WaitingRequests>
  );
}
