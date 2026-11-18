import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { signOutOfRainbow } from "@/lib/platformSignIn";
import type { User, Session } from "@supabase/supabase-js";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authUnavailable, setAuthUnavailable] = useState(false);
  const [adminLoading, setAdminLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  // Tracks the last user ID that triggered an admin check. When Supabase fires
  // TOKEN_REFRESHED on tab-focus the user ID is unchanged, so we must NOT reset
  // adminLoading — otherwise the second useEffect (keyed on user?.id) never
  // re-runs and adminLoading stays true forever, locking the UI on the spinner.
  const lastCheckedUserIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    let isMounted = true;
    let revision = 0;

    const applySession = (nextSession: Session | null) => {
      if (!isMounted) return;

      const nextUser = nextSession?.user ?? null;
      setAuthUnavailable(false);
      setSession(nextSession);
      setUser(nextUser);
      setAuthLoading(false);

      // Only reset admin state when the user identity actually changes
      // (fresh login, logout, or a different account). Token-refresh events for
      // the same user must leave adminLoading / isAdmin untouched.
      if (nextUser?.id !== lastCheckedUserIdRef.current) {
        lastCheckedUserIdRef.current = nextUser?.id;
        setIsAdmin(false);
        setAdminLoading(!!nextUser);
      }
    };

    const initializeAuth = async () => {
      const mine = ++revision;
      try {
        const { data, error } = await supabase.auth.getSession();
        if (!isMounted || mine !== revision) return;
        if (error) {
          // No credential or player-data changes for a failed check. The SDK
          // emits SIGNED_OUT when a refresh credential is actually rejected.
          setAuthUnavailable(true);
          setAuthLoading(false);
          return;
        }
        applySession(data.session ?? null);
      } catch {
        if (isMounted && mine === revision) {
          setAuthUnavailable(true);
          setAuthLoading(false);
        }
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      revision++;
      applySession(nextSession);
    });
    const onOnline = () => { void initializeAuth(); };
    const onVisible = () => { if (document.visibilityState === 'visible') void initializeAuth(); };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    void initializeAuth();

    return () => {
      isMounted = false;
      revision++;
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    if (!user) {
      setIsAdmin(false);
      setAdminLoading(false);
      return () => {
        isMounted = false;
      };
    }

    setAdminLoading(true);

    const loadAdminRole = async () => {
      // has_role answers for a RAINBOW account only (rainbow_uid inside), so
      // an auth user without a Rainbow account is never an admin here.
      const { data, error } = await supabase.rpc("has_role", {
        _user_id: user.id,
        _role: "admin",
      });

      if (!isMounted) return;

      if (error) {
        console.error("Failed to check admin role:", error);
        setIsAdmin(false);
      } else {
        setIsAdmin(!!data);
      }

      setAdminLoading(false);
    };

    void loadAdminRole();

    return () => {
      isMounted = false;
      setAdminLoading(false);
    };
  }, [user?.id]);

  return {
    user,
    session,
    loading: authLoading || adminLoading,
    isAdmin,
    authUnavailable,
    signOut: signOutOfRainbow,
  };
}
