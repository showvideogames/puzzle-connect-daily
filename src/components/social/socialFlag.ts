/**
 * Whether the Friends and Groups beta is on: the one check in the main chunk.
 *
 * It says what socialMode() === "beta" says, and a test holds them together. It
 * can't simply call socialMode: that lives in the Rainbow adapter, and importing
 * the adapter from App or the Settings menu would put the shared social code in
 * every player's main chunk, flag or no flag.
 */
export function socialBetaOn(flag: unknown = import.meta.env.VITE_SHARED_SOCIAL): boolean {
  return flag === "beta";
}
