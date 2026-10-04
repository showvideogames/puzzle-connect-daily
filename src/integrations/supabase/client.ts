import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

// The ONLY place the Supabase project is named: two environment values.
// Moving Rainbow to another project means changing them and nothing else.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
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
