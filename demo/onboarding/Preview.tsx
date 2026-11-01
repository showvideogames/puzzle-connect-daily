import { useState } from "react";
import type { User as AuthUser } from "@supabase/supabase-js";
import { AddFriendScreen } from "@/components/account/AddFriendScreen";
import { DisplayNameGate } from "@/components/account/DisplayNameGate";
import { FriendInviteCard } from "@/components/account/FriendInviteCard";
import { FriendsHome } from "@/components/account/FriendsHome";
import { GamePicker } from "@/components/account/GamePicker";
import { GroupEmblem } from "@/components/account/GroupEmblem";
import { GroupInviteCard } from "@/components/account/GroupInviteCard";
import { GroupsTab, type GroupSummary } from "@/components/account/GroupsTab";
import { ProfileForm } from "@/components/account/ProfileForm";
import { SetupScreen } from "@/components/account/SetupScreen";
import { accountPanel, primaryAction, secondaryAction } from "@/components/account/accountStyles";
import { SettingsModal } from "@/components/SettingsModal";
import {
  clearPendingInvite,
  forgetSetupLater,
  joinProblem,
  nextAccountStep,
  pendingInviteCode,
  rememberSetupLater,
  setupLaterChosen,
} from "@/lib/accountFlow";
import { gameCatalog, type CatalogGame } from "@/lib/gameCatalog";
import { loadSettings, type GameSettings } from "@/lib/settings";
import { hasDisplayName, newProfile, type SharedProfile } from "@/lib/sharedProfile";
import { GameCover } from "./GameCover";
import {
  FICTIONAL_FRIEND,
  FICTIONAL_PLAYER,
  OWN_FRIEND_CODE,
  PREVIEW_ACCOUNT,
  SAMPLE_GROUPS,
  SCENARIOS,
  findFriend,
  friendResults,
  joinGroup,
  previewInvite,
  saveProfile,
  saveSimulation,
  startSimulation,
  type Simulation,
} from "./simulation";

const params = new URLSearchParams(window.location.search);
const scenarioParam = params.get("state");
const firstSimulation = startSimulation(scenarioParam);
const renderCover = (game: CatalogGame) => <GameCover game={game} />;

// Only for the real Settings menu. No session exists behind it.
const fictionalUser = { id: PREVIEW_ACCOUNT, email: "alex@example.test" } as AuthUser;

const showBanner = params.get("banner") !== "off";

function SimulatedSignIn({ invitationName, onContinue }: { invitationName?: string; onContinue: (who: "new" | "existing" | "returning") => void }) {
  return (
    <main className={`${accountPanel} preview-signin`} data-testid="simulated-sign-in">
      <p className="preview-tag">Simulated page</p>
      <h1 className="font-tile text-2xl font-extrabold tracking-tight text-foreground">The shared sign-in page goes here</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The real game leaves for the shared sign-in page at this point. This stand-in asks for nothing and no account exists behind it.
      </p>
      {invitationName && (
        <p className="mt-3 text-sm font-semibold text-foreground">Your invitation to {invitationName} is being kept for you.</p>
      )}
      <button type="button" onClick={() => onContinue("new")} className={`${primaryAction} mt-5 h-12 w-full text-base`}>
        Continue as a new player
      </button>
      <button type="button" onClick={() => onContinue("existing")} className={`${secondaryAction} mt-2.5 h-12 w-full text-sm`}>
        Continue as an existing player with no profile
      </button>
      <button type="button" onClick={() => onContinue("returning")} className={`${secondaryAction} mt-2.5 h-12 w-full text-sm`}>
        Continue as a returning player
      </button>
    </main>
  );
}

/** Whatever page the player came from. The real app returns them to it, exactly as today. */
function PreviousPage({ onOpenMenu, playing }: { onOpenMenu: () => void; playing: boolean }) {
  return (
    <main className={`${accountPanel} preview-previous`} data-testid="previous-page">
      <p className="preview-tag">Stand-in for the page they came from</p>
      <h1 className="font-tile text-2xl font-extrabold tracking-tight text-foreground">
        {playing ? "Their puzzle, carrying on" : "Rainbow Categories"}
      </h1>
      <div className="preview-previous-tiles" aria-hidden="true">
        {Array.from({ length: 8 }, (_, index) => <span key={index} />)}
      </div>
      <button type="button" onClick={onOpenMenu} className={`${secondaryAction} h-11 text-sm`}>Open the menu</button>
    </main>
  );
}

export function Preview() {
  const [simulation, setSimulation] = useState<Simulation>(firstSimulation);
  const [inviteCode, setInviteCode] = useState(pendingInviteCode);
  const [draft, setDraft] = useState<SharedProfile>(simulation.profile ?? newProfile());
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [settings, setSettings] = useState<GameSettings>(loadSettings);
  const [friendAdded, setFriendAdded] = useState(false);
  const [groups, setGroups] = useState<GroupSummary[]>(SAMPLE_GROUPS);

  const update = (changes: Partial<Simulation>) => {
    setSimulation((current) => {
      const next = { ...current, ...changes };
      saveSimulation(next);
      return next;
    });
  };

  const { signedIn, profile, showPicker, isNewAccount, onGameplayPage, view, joined, viewerFinished, friendsTab, note } = simulation;
  const setupLater = simulation.setupLater || setupLaterChosen(PREVIEW_ACCOUNT);
  const invite = previewInvite(inviteCode, signedIn);
  const step = nextAccountStep({ signedIn, profile, pendingInvite: inviteCode, showPicker, isNewAccount, setupLater, onGameplayPage });
  const named = hasDisplayName(profile);

  const leaveInvitation = () => {
    clearPendingInvite();
    setInviteCode(null);
    update({ showPicker: true, joined: false });
  };

  const join = async () => {
    setJoining(true);
    setJoinError(null);
    const result = await joinGroup(inviteCode, profile.displayName);
    setJoining(false);
    if (result.ok) update({ joined: true, note: "Simulated: no real group was joined." });
    else setJoinError(joinProblem(result.outcome));
  };

  const finishSignIn = (who: "new" | "existing" | "returning") => {
    saveSimulation({
      ...simulation,
      signedIn: true,
      view: "flow",
      isNewAccount: who === "new",
      profile: who === "returning" ? FICTIONAL_PLAYER : null,
      note: who === "returning" ? "Returning player: setup skipped." : "Setup is offered, with Later.",
    });
    // A full page load, like the real return from the sign-in page, so the
    // invitation has to survive in storage to be seen again.
    window.location.assign("?state=live");
  };

  const finishSetup = async (saved: SharedProfile) => {
    await saveProfile(saved);
    forgetSetupLater(PREVIEW_ACCOUNT);
    update({ profile: saved, setupLater: false, showPicker: isNewAccount, note: "Saved in this tab only. Nothing reached a real account." });
  };

  const chooseLater = () => {
    rememberSetupLater(PREVIEW_ACCOUNT);
    update({
      setupLater: true,
      showPicker: isNewAccount,
      note: isNewAccount
        ? "Later chosen: every game is still open. Friends and Groups will ask for a Display Name."
        : "Later chosen: back on their previous page. Friends and Groups will ask for a Display Name.",
    });
  };

  const openMenu = () => update({ view: "settings" });

  const picker = (
    <main className="preview-page">
      <GamePicker games={gameCatalog} profile={profile} renderCover={renderCover} onOpenProfile={signedIn ? openMenu : undefined} />
    </main>
  );

  const nameForm = (
    <main className={`${accountPanel} preview-editor`}>
      <ProfileForm
        mode="setup"
        initial={profile ?? newProfile()}
        onCancel={() => update({ view: "flow" })}
        onSave={async (saved) => {
          await saveProfile(saved);
          update({ profile: saved, view: "friends", note: "Saved in this tab only. Friends and Groups are open now." });
        }}
      />
    </main>
  );

  const friends = named ? (
    <FriendsHome
      gameName="Rainbow Categories"
      results={friendResults(profile, viewerFinished)}
      friendCode={OWN_FRIEND_CODE}
      tab={friendsTab}
      onTabChange={(tab) => update({ friendsTab: tab })}
      onAddFriend={() => update({ view: "add-friend" })}
      groups={
        <GroupsTab
          groups={groups}
          onCreate={async (group) => {
            await saveProfile(FICTIONAL_PLAYER);
            setGroups((current) => [{ ...group, memberCount: 1 }, ...current]);
            update({ note: "Fictional group, kept in this tab only. Nothing was sent." });
          }}
        />
      }
    />
  ) : (
    <DisplayNameGate onChooseName={() => update({ view: "name-form" })} onNotNow={() => update({ view: "flow" })} />
  );

  let screen;
  if (view === "sign-in") {
    screen = <SimulatedSignIn invitationName={invite?.name} onContinue={finishSignIn} />;
  } else if (view === "edit-profile") {
    screen = (
      <main className={`${accountPanel} preview-editor`}>
        <ProfileForm
          mode="edit"
          initial={profile ?? newProfile()}
          onCancel={() => update({ view: "flow" })}
          onSave={async (saved) => {
            await saveProfile(saved);
            update({ profile: saved, view: "flow", note: "Saved in this tab only. Nothing reached a real account." });
          }}
        />
      </main>
    );
  } else if (view === "games") {
    screen = picker;
  } else if (view === "friends") {
    screen = friends;
  } else if (view === "add-friend") {
    screen = (
      <AddFriendScreen
        pictureSrc="/shared-assets/friends/bear-frog-heart.webp"
        onBack={() => update({ view: "friends" })}
        onShareLink={() => update({ note: "Share invite link pressed. No link was created and nothing was sent." })}
        onCopyLink={() => update({ note: "Copy link pressed. No link was created and nothing was copied." })}
        onFind={findFriend}
        onSendRequest={() => update({ note: "Simulated: no request was sent, and nobody was told." })}
      />
    );
  } else if (view === "name-form") {
    screen = nameForm;
  } else if (view === "friend-invite" || view === "friend-request") {
    screen = (
      <FriendInviteCard
        inviterName={FICTIONAL_FRIEND.displayName}
        inviter={FICTIONAL_FRIEND}
        acceptLabel={view === "friend-request" ? "Accept" : "Add friend"}
        signedIn={signedIn}
        displayName={profile?.displayName}
        added={friendAdded}
        onSignIn={() => update({ view: "sign-in" })}
        onChooseName={() => update({ view: "name-form" })}
        onAdd={() => setFriendAdded(true)}
        onContinue={() => update({ view: "friends" })}
      />
    );
  } else if (step === "profile-setup") {
    screen = (
      <SetupScreen
        form={
          <ProfileForm
            mode="setup"
            initial={newProfile()}
            onDraftChange={setDraft}
            onLater={chooseLater}
            notice={invite && (
              <p className="flex items-center gap-3 rounded-xl bg-secondary px-3 py-2 text-sm font-semibold text-foreground" data-testid="invite-waiting">
                <GroupEmblem emblemId={invite.emblemId} photo={invite.photo} color={invite.accentColor} size={36} />
                Next: your invitation to {invite.name}
              </p>
            )}
            onSave={finishSetup}
          />
        }
        picker={<GamePicker games={gameCatalog} profile={draft} renderCover={renderCover} embedded />}
      />
    );
  } else if (step === "invite-preview" || step === "invite-join") {
    screen = (
      <GroupInviteCard
        invite={invite}
        signedIn={signedIn}
        displayName={profile?.displayName}
        joined={joined}
        busy={joining}
        error={joinError}
        onSignIn={() => update({ view: "sign-in" })}
        onChooseName={() => {
          forgetSetupLater(PREVIEW_ACCOUNT);
          update({ setupLater: false });
        }}
        onJoin={() => void join()}
        onContinue={leaveInvitation}
        onBack={leaveInvitation}
      />
    );
  } else if (step === "return") {
    screen = <PreviousPage onOpenMenu={openMenu} playing={onGameplayPage} />;
  } else {
    screen = picker;
  }

  return (
    <div className="preview-root">
      {showBanner && (
        <header className="preview-bar">
          <p className="preview-bar-title"><strong>Preview.</strong> Accounts and invitations are simulated.</p>
          <label className="preview-bar-select">
            <span className="sr-only">Choose a state</span>
            <select
              value={scenarioParam === "live" ? "" : scenarioParam ?? SCENARIOS[0].id}
              onChange={(event) => window.location.assign(`?state=${event.target.value}`)}
            >
              {scenarioParam === "live" && <option value="">Following the flow…</option>}
              {SCENARIOS.map((scenario) => (
                <option key={scenario.id} value={scenario.id}>{scenario.label}</option>
              ))}
            </select>
          </label>
          <p className="preview-bar-note" data-testid="simulation-note">{note}</p>
        </header>
      )}
      <div className="preview-body">
        {view === "settings" ? (
          <>
            {step === "return" ? <PreviousPage onOpenMenu={openMenu} playing={onGameplayPage} /> : picker}
            <SettingsModal
              open
              onClose={() => update({ view: "flow" })}
              settings={settings}
              onSettingsChange={setSettings}
              showMenuLinks
              user={signedIn ? fictionalUser : null}
              onEditProfile={() => update({ view: "edit-profile" })}
              onOpenGames={() => update({ view: "games" })}
              onOpenSocial={() => update({ view: "friends" })}
            />
          </>
        ) : screen}
      </div>
    </div>
  );
}
