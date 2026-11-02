/**
 * Stands in for the real Supabase client in the preview. The account menu
 * imports modules that import the client, so something has to be here, and
 * this makes certain nothing can be sent: every call throws.
 */
function refuse(): never {
  throw new Error("The onboarding preview has no backend.");
}

export const supabase = new Proxy({}, { get: () => new Proxy(refuse, { get: () => refuse }) }) as never;
