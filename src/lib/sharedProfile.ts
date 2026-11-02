/**
 * The shared profile: one shape, the same on every site, never keyed by game
 * or email. The ids, colors and version come from the approved shared-profile
 * prototype (SharedProfile v1). They are stored values, so an id here must
 * never be renamed or reused.
 *
 * This file only describes a profile. Nothing here reads or writes one:
 * Rainbow has no profile storage yet (see docs/shared-profile/INTEGRATION-PLAN.md).
 */

export const AVATAR_IDS = [
  "bear", "owl", "fox", "frog", "cat", "saint-bernard", "rabbit", "raccoon", "penguin", "koala",
  "red-panda", "otter", "hedgehog", "panda", "tiger", "lion", "elephant", "giraffe", "mouse", "squirrel",
  "sloth", "deer", "basketball", "football", "soccer", "baseball-bat", "pizza", "hamburger", "ghost", "frankenstein",
] as const;

export type AvatarId = (typeof AVATAR_IDS)[number];

/** The picker's short list; the rest are one tap away. */
export const FEATURED_AVATARS: readonly AvatarId[] = ["fox", "bear", "owl", "frog", "rabbit", "otter"];

/** Display order from the approved layout. The stored value is the hex. */
export const PROFILE_COLORS = [
  { name: "Lilac", hex: "#DED1F2" },
  { name: "Rose", hex: "#F1CDDA" },
  { name: "Peach", hex: "#F8D0BD" },
  { name: "Butter", hex: "#F8E4A0" },
  { name: "Mint", hex: "#CCE6CA" },
  { name: "Sky", hex: "#CCE1F1" },
] as const;

export type ProfileColor = (typeof PROFILE_COLORS)[number]["hex"];

/** The contract's limit for a display name or a name in a group. */
export const DISPLAY_NAME_MAX = 24;

export interface SharedProfile {
  version: 1;
  displayName?: string;
  animalId: AvatarId;
  backgroundColor: ProfileColor;
}

/** What setup starts from: a default already chosen, only the name left to fill in. */
export function newProfile(): SharedProfile {
  return { version: 1, animalId: "fox", backgroundColor: "#DED1F2" };
}

export function validDisplayName(name: unknown): boolean {
  if (typeof name !== "string") return false;
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= DISPLAY_NAME_MAX;
}

export function validProfile(value: unknown): value is SharedProfile {
  const profile = value as SharedProfile | null;
  return !!profile
    && profile.version === 1
    && AVATAR_IDS.includes(profile.animalId)
    && PROFILE_COLORS.some((color) => color.hex === profile.backgroundColor)
    && (profile.displayName === undefined || validDisplayName(profile.displayName));
}

/** Complete means a valid profile that has a display name: setup has nothing left to ask. */
export function profileIsComplete(profile: SharedProfile | null | undefined): boolean {
  return validProfile(profile) && profile.displayName !== undefined;
}

/** What Friends and Groups need before anyone can use them. Games need nothing. */
export function hasDisplayName(profile: SharedProfile | null | undefined): boolean {
  return profileIsComplete(profile);
}
