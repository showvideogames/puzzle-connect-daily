import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

/** INITIAL_SESSION and subsequent events share one ordered source of truth. */
export function useCopyAccount() {
  const [user, setUser] = useState<User | null | undefined>();
  const current = useRef<string | null>(null);
  const isCurrent = useCallback((id: string) => current.current === id, []);
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      current.current = session?.user.id ?? null;
      setUser(session?.user ?? null);
    });
    return () => { current.current = null; subscription.unsubscribe(); };
  }, []);
  return { user, isCurrent };
}
