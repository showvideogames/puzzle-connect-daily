import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { FriendsTab } from "@/components/account/FriendsHome";
import { accountPanel, primaryAction, quietText } from "@/components/account/accountStyles";
import { clearPendingInvite, pendingInviteCode, rememberPendingInvite } from "@/lib/accountFlow";
import { CHECKING_NOTE, GUEST_HEADING, GUEST_NOTE, LOADING_NOTE } from "@/lib/socialView";
import type { AppSocial } from "./appSocial";
import { SocialScreens } from "./SocialScreens";
import { sessionKey, useSocialSession } from "./useSocialSession";
import { useLive } from "./useLive";

const panel = `${accountPanel} mx-auto w-full max-w-[28rem] px-6 py-8 text-center sm:px-8`;

function WaitingPanel({ label }: { label: string }) {
  return (
    <main className={panel} data-testid="social-waiting">
      <p role="status" className={`text-base ${quietText}`}>{label}</p>
    </main>
  );
}

function GuestPanel({ busy, onSignIn }: { busy: boolean; onSignIn: () => void }) {
  return (
    <main className={panel} data-testid="social-guest">
      <h1 className="font-tile text-2xl font-extrabold tracking-tight text-foreground">{GUEST_HEADING}</h1>
      <p className={`mt-3 text-base ${quietText}`}>{GUEST_NOTE}</p>
      <button type="button" onClick={onSignIn} disabled={busy} className={`${primaryAction} mt-6 h-12 w-full text-base`}>
        {busy ? "Opening sign-in…" : "Sign in"}
      </button>
    </main>
  );
}

interface VisitProps {
  social: AppSocial;
  code: string | null;
  signedIn: boolean;
}

/** One person's visit. It gets a new key for every person, so its note and tab go with them. */
function SocialVisit({ social, code, signedIn }: VisitProps) {
  const navigate = useNavigate();
  const { state } = useLocation();
  const live = useLive();
  const [tab, setTab] = useState<FriendsTab>((state as { tab?: FriendsTab } | null)?.tab === "groups" ? "groups" : "friends");
  // Settings' Edit profile and the results popup's Add friends each ask once. The ask leaves the history entry, so a reload or Back doesn't reopen it.
  const [editProfile] = useState((state as { editProfile?: boolean } | null)?.editProfile === true);
  const [addFriend] = useState((state as { addFriend?: boolean } | null)?.addFriend === true);
  useEffect(() => {
    if (editProfile || addFriend) navigate(".", { replace: true, state: null });
  }, [editProfile, addFriend, navigate]);
  const [note, setNote] = useState("");
  const [signingIn, setSigningIn] = useState(false);

  // Back from a sign-in that finished somewhere else, with an invitation waiting.
  useEffect(() => {
    if (!signedIn || code !== null) return;
    const pending = pendingInviteCode();
    if (pending) navigate(`/join/${pending}`, { replace: true });
  }, [code, navigate, signedIn]);

  /** The invitation is kept first, because a sign-up can finish in another tab. */
  const signIn = async () => {
    if (code) rememberPendingInvite(code);
    setNote("");
    setSigningIn(true);
    const problem = await social.signIn();
    if (!live.current || problem === null) return;
    setSigningIn(false);
    setNote(problem);
  };

  const leaveLink = (nextTab?: FriendsTab) => {
    clearPendingInvite();
    navigate(signedIn ? "/friends" : "/", { state: nextTab ? { tab: nextTab } : null });
  };

  return (
    <>
      {note && <p role="status" className={`mx-auto mb-3 max-w-[32rem] text-center text-base [overflow-wrap:anywhere] ${quietText}`} data-testid="social-note">{note}</p>}
      <SocialScreens
        api={social.api}
        signedIn={signedIn}
        code={code}
        tab={tab}
        onTab={setTab}
        onNote={setNote}
        onLeaveLink={leaveLink}
        onSignIn={() => void signIn()}
        signingIn={signingIn}
        onNameLater={() => navigate("/")}
        guest={<GuestPanel busy={signingIn} onSignIn={() => void signIn()} />}
        waiting={<WaitingPanel label={LOADING_NOTE} />}
        startEditingProfile={editProfile}
        startAddingFriend={addFriend}
      />
    </>
  );
}

/**
 * The Friends and Groups pages. What shows follows the session and nothing else,
 * and a change of who that is replaces the whole visit. Rendered inside
 * OnboardingGate, which runs the account checks: nothing here starts one.
 */
export function SocialPage({ social, code }: { social: AppSocial; code: string | null }) {
  const session = useSocialSession(social.source);
  const key = sessionKey(session);

  useEffect(() => () => social.api.client.forget(), [key, social]);

  if (session.kind === "checking") return <WaitingPanel label={CHECKING_NOTE} />;
  return <SocialVisit key={`${key}:${code ?? ""}`} social={social} code={code} signedIn={session.kind === "signed-in"} />;
}
