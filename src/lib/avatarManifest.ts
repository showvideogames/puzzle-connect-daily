import type { AvatarId } from "./sharedProfile";

/**
 * How each transparent avatar sits inside its circle. The numbers are the
 * approved prototype's, tuned one avatar at a time against the original art,
 * so they are copied as they are rather than recalculated. The circle's color
 * belongs to the profile, never to the picture.
 */
export interface AvatarFraming {
  scale: number;
  /** Percent of the circle. */
  y: number;
  x?: number;
}

export const AVATAR_FRAMING: Record<AvatarId, AvatarFraming> = {
  bear: { scale: 0.92, y: 4.2 },
  owl: { scale: 0.95, y: 4 },
  fox: { scale: 0.94, y: 3.2 },
  frog: { scale: 0.94, y: 6 },
  cat: { scale: 0.96, y: 6 },
  "saint-bernard": { scale: 1, y: 3.5 },
  rabbit: { scale: 1.15, y: 7.5 },
  raccoon: { scale: 1, y: 1.4 },
  penguin: { scale: 1, y: 2 },
  koala: { scale: 400 / 377, y: -50 / 377 },
  "red-panda": { scale: 1, y: 2.4 },
  otter: { scale: 400 / 379, y: 50 / 379 },
  hedgehog: { scale: 400 / 378, y: 0 },
  panda: { scale: 400 / 388, y: 0 },
  tiger: { scale: 400 / 388, y: 0 },
  lion: { scale: 400 / 388, y: 0 },
  elephant: { scale: 400 / 381, y: 50 / 381 },
  giraffe: { scale: 400 / 381, y: 50 / 381 },
  mouse: { scale: 400 / 381, y: 50 / 381 },
  squirrel: { scale: 400 / 380, y: 0 },
  sloth: { scale: 400 / 380, y: 0 },
  deer: { scale: 400 / 380, y: 0 },
  basketball: { scale: 1.14014251781, y: -0.118764845606, x: -2.61282660333 },
  football: { scale: 1.12676056338, y: 0.234741784038, x: 2.23004694836 },
  soccer: { scale: 1.11888111888, y: 1.51515151515, x: -1.6317016317 },
  "baseball-bat": { scale: 1.12676056338, y: 0.704225352113, x: 0.821596244131 },
  pizza: { scale: 1.07382550336, y: 1.67785234899, x: 0.335570469799 },
  hamburger: { scale: 1.07382550336, y: 1.67785234899, x: 0.335570469799 },
  ghost: { scale: 1.07142857143, y: 0, x: 0 },
  frankenstein: { scale: 1.06666666667, y: 0, x: -0.333333333333 },
};

/** Where the avatar files are served from. A shared location is still to be chosen. */
export const AVATAR_BASE = "/shared-assets/avatars";

export const avatarSrc = (id: AvatarId): string => `${AVATAR_BASE}/${id}.webp`;

export function avatarLabel(id: AvatarId): string {
  return id.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
}
