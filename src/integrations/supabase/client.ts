import { temporaryAuthRefusals } from '@/lib/authTransport';
import { renewingFetch } from '@/lib/renewingFetch';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

// The ONLY place the Supabase project is named: two environment values.
// Moving Rainbow to another project means changing them and nothing else.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

let authEpoch = 0;
const storedIdentity = (): string | null => {
  try { return JSON.parse(localStorage.getItem('rc-auth') ?? 'null')?.user?.id ?? null; }
  catch { return null; }
};
export const supabase: SupabaseClient<Database> = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
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
  },
  global: {
    fetch: renewingFetch(async () => {
      if (!storedIdentity()) return null;
      const { data } = await supabase.auth.refreshSession();
      // The SDK handles terminal refresh errors. Never revoke a newer session here.
      return data.session?.access_token ?? null;
    }, temporaryAuthRefusals((input, init) => fetch(input, init)), storedIdentity, () => authEpoch),
  },
});
let lastIdentity = storedIdentity();
supabase.auth.onAuthStateChange((event, session) => {
  const next = session?.user.id ?? null;
  if (event === 'SIGNED_OUT' || next !== lastIdentity) authEpoch++;
  lastIdentity = next;
});
