import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [adminLoading, setAdminLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const applySession = (nextSession: Session | null) => {
      if (!isMounted) return;

      const nextUser = nextSession?.user ?? null;
      setSession(nextSession);
      setUser(nextUser);
      setIsAdmin(false);
      setAdminLoading(!!nextUser);
      setAuthLoading(false);
    };

    const initializeAuth = async () => {
      const { data, error } = await supabase.auth.getSession();

      if (error) {
        console.error("Failed to restore auth session:", error);

        if (error.code === "refresh_token_not_found") {
          void supabase.auth.signOut({ scope: "local" });
        }

        applySession(null);
        return;
      }

      applySession(data.session ?? null);
    };

    void initializeAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      applySession(nextSession);
    });

    return () => {
      isMounted = false;
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
    };
  }, [user?.id]);

  const signIn = (email: string, password: string) =>
    supabase.auth.signInWithPassword({ email, password });

  const signOut = () => supabase.auth.signOut({ scope: "local" });

  return {
    user,
    session,
    loading: authLoading || adminLoading,
    isAdmin,
    signIn,
    signOut,
  };
}
