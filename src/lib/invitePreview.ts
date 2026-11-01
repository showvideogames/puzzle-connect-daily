import type { AvatarId, ProfileColor } from "./sharedProfile";

/**
 * What an invitation may say about a group's members, to anyone holding a valid
 * link, signed in or not: a few avatars, one Display Name and a count. This is
 * the whole shape, so an email, a result or a puzzle detail has nowhere to go.
 */
export interface MemberFace {
  animalId: AvatarId;
  backgroundColor: ProfileColor;
}

export interface InviteMemberPreview {
  faces: MemberFace[];
  leadName: string;
  memberCount: number;
}

const FACES_SHOWN = 3;

/** Keeps only what the preview allows, however much is known about a member. */
export function inviteMemberPreview(
  members: readonly (MemberFace & { name: string })[],
  memberCount: number,
): InviteMemberPreview {
  return {
    faces: members.slice(0, FACES_SHOWN).map(({ animalId, backgroundColor }) => ({ animalId, backgroundColor })),
    leadName: members[0]?.name ?? "",
    memberCount,
  };
}

export function memberLine({ leadName, memberCount }: Pick<InviteMemberPreview, "leadName" | "memberCount">): string {
  const others = memberCount - 1;
  if (others < 1) return `Join ${leadName}.`;
  return `Join ${leadName} and ${others} ${others === 1 ? "friend" : "friends"}.`;
}
