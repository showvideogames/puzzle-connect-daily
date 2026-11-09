import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ProfileMenu } from "@/components/account/ProfileMenu";
import type { SharedProfile } from "@/lib/sharedProfile";
import { isBackgroundCheck, profileFromMe } from "@/lib/socialView";
import { appSocial, type AppSocial } from "./appSocial";
import { sessionKey, useSocialSession } from "./useSocialSession";

import { HEADER_REFRESH } from "./socialHeaderEvents";

function SignedInMenu({ social, onAccount }: { social: AppSocial; onAccount: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [profile, setProfile] = useState<SharedProfile | null>(null);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const newest = useRef(0);
  const mounted = useRef(false);
  const retry = useRef<ReturnType<typeof setTimeout>>();

  const refresh = useCallback(async function reload() {
    if (!mounted.current) return;
    clearTimeout(retry.current);
    const request = ++newest.current;
    // Only identity and incoming requests. Never fetch gameplay or results for a header.
    const [me, requests] = await Promise.all([
      social.api.client.call("getMe", {}),
      social.api.client.call("listFriendRequests", {}),
    ]);
    if (!mounted.current || request !== newest.current) return;
    if ((me.ok === false && isBackgroundCheck(me.outcome)) || (requests.ok === false && isBackgroundCheck(requests.outcome))) {
      // Focus commonly starts an account re-check. Keep this same-session view
      // while it runs; the outer session guard clears it if confirmation fails.
      retry.current = setTimeout(() => { if (request === newest.current) void reload(); }, 1000);
      return;
    }
    setProfile(me.ok ? profileFromMe(me.data) : null);
    setPendingCount(requests.ok ? requests.data.incoming.length : null);
  }, [social]);

  useEffect(() => {
    mounted.current = true;
    const refreshVisible = () => { if (document.visibilityState !== "hidden") void refresh(); };
    refreshVisible();
    const timer = setInterval(refreshVisible, 60_000);
    addEventListener("focus", refreshVisible);
    addEventListener("online", refreshVisible);
    addEventListener(HEADER_REFRESH, refreshVisible);
    const invalidate = () => { ++newest.current; clearTimeout(retry.current); };
    return () => {
      mounted.current = false;
      invalidate();
      clearInterval(timer);
      removeEventListener("focus", refreshVisible);
      removeEventListener("online", refreshVisible);
      removeEventListener(HEADER_REFRESH, refreshVisible);
    };
  }, [refresh, location.key]);

  return <ProfileMenu profile={profile} pendingCount={pendingCount}
    onOpenChange={open => { if (open) void refresh(); }}
    onProfile={() => navigate("/friends", { state: { editProfile: true } })}
    onFriends={() => navigate("/friends", { state: { friendsHome: true } })}
    onAccount={onAccount} />;
}

/** The session key discards identity and late responses on sign-out or account change. */
export function SocialHeaderMenu({ social, onAccount }: { social: AppSocial; onAccount: () => void }) {
  const session = useSocialSession(social.source);
  const navigate = useNavigate();
  if (session.kind !== "signed-in") return <ProfileMenu profile={null} pendingCount={null}
    onProfile={() => navigate("/friends", { state: { editProfile: true } })}
    onFriends={() => navigate("/friends", { state: { friendsHome: true } })} onAccount={onAccount} />;
  return <SignedInMenu key={sessionKey(session)} social={social} onAccount={onAccount} />;
}

export default function AppHeaderMenu({ onAccount }: { onAccount: () => void }) {
  return <SocialHeaderMenu social={appSocial()} onAccount={onAccount} />;
}
