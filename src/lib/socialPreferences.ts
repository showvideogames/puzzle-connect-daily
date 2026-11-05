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

export const groupOrderEnabled = () => import.meta.env.VITE_GROUP_ORDER === 'true';
export function applyGroupOrder<T extends { groupId?: string }>(groups: T[], ids: string[]): T[] {
  const positions = new Map(ids.map((id, i) => [id, i]));
  return [...groups].sort((a,b) => (positions.get(a.groupId ?? '') ?? Infinity) - (positions.get(b.groupId ?? '') ?? Infinity));
}

export const groupDescriptionsEnabled = () => import.meta.env.VITE_GROUP_DESCRIPTIONS === 'true';
