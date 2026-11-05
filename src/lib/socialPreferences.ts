import type { FriendPreference } from '@/social/contract';
import type { FriendResult } from './friendResults';
/** Enable only after the shared SQL and gateway operations are available. */
export const socialPreferencesEnabled = () => import.meta.env.VITE_SOCIAL_PREFERENCES === 'true';
export function applyFriendPreferences(results: FriendResult[], preferences: FriendPreference[]): FriendResult[] {
  const byRef = new Map(preferences.map(p => [p.friendRef, p]));
  const rows = results.map(row => {
    const preference = !row.isYou && byRef.get(row.id);
    return preference ? { ...row, favorite: preference.favorite, nickname: preference.nickname } : row;
  });
  return [...rows.filter(row => !row.isYou && row.favorite), ...rows.filter(row => row.isYou || !row.favorite)];
}
