import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { renewingFetch, type Renewed } from '@/lib/renewingFetch';

// The ONLY place the Supabase project is named: two environment values.
// Moving Rainbow to another project means changing them and nothing else.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

// An expired sign-in pass is renewed and the request retried once, as the same
// user, so a device with a wrong clock never sees "JWT expired"
// (lib/renewingFetch.ts).
async function renewSession(): Promise<Renewed | null> {
  const { data } = await supabase.auth.refreshSession();
  return data.session ? { token: data.session.access_token, userId: data.session.user?.id ?? null } : null;
}

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  global: { fetch: renewingFetch(renewSession) },
  auth: {
    storage: localStorage,
    // Explicit rather than the library's derived default, so the key is
    // stable across projects and known to platformSignIn.forgetHubTokens.
    storageKey: 'rc-auth',
    persistSession: true,
    autoRefreshToken: true,
    // Authorization code + PKCE: the code is useless without the verifier,
    // which never leaves this browser's storage for this origin.
    flowType: 'pkce',
    // The callback is handled explicitly on /auth/callback (see
    // lib/platformSignIn.ts), so a code appearing on any other page is
    // ignored rather than silently exchanged.
    detectSessionInUrl: false,
  }
});
