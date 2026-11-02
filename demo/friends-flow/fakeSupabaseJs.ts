/**
 * MOCK ONLY. Stands in for @supabase/supabase-js in the Friends and Groups
 * preview, so a real client can't exist here.
 */

/** Counted so the test can show nothing ever tried. */
export const createClientCalls = { count: 0 };

export function createClient(): never {
  createClientCalls.count += 1;
  throw new Error("The Friends and Groups preview is synthetic: no real Supabase client can exist here.");
}
