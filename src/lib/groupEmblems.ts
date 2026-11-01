/**
 * The approved group pictures. The color belongs to the group, never to the
 * picture, so one emblem works with any accent.
 */
export const GROUP_EMBLEMS = [
  { id: "campfire", name: "Campfire" },
  { id: "cabin", name: "Cottage" },
  { id: "mountains", name: "Mountains" },
  { id: "cards-dice", name: "Game night" },
  { id: "coffee", name: "Coffee mugs" },
  { id: "book", name: "Book club" },
  { id: "picnic", name: "Picnic" },
  { id: "flowers", name: "Flowers" },
  { id: "moon", name: "Moon and stars" },
] as const;

export type GroupEmblemId = (typeof GROUP_EMBLEMS)[number]["id"];

export const groupEmblemSrc = (id: GroupEmblemId): string => `/shared-assets/groups/${id}.webp`;
