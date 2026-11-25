/**
 * Fictional data for the Arcade Shelf showcase (see src/showcase/README.md).
 * Every person, puzzle and number here is invented. Nothing is read from or
 * written to any database.
 */

export interface ShowcaseCreator {
  userId: string;
  slug: string;
  name: string;
  followers: number;
}

export interface ShowcasePuzzle {
  key: string;
  title: string;
  creator: ShowcaseCreator;
  shortCode: string;
  shareId: string;
  mode: "classic" | "rainbow";
  /** Display order: Yellow, Green, Blue, Purple. */
  groups: { category: string; words: string[] }[];
  wordOrder: string[];
  rainbow?: { name: string; herring: string[] };
  listedAt: string;
  plays: number;
  favorites: number;
}

const wren: ShowcaseCreator = { userId: "fixture-wren", slug: "wren-halloway-k4m2", name: "Wren Halloway", followers: 18 };
const odie: ShowcaseCreator = { userId: "fixture-odie", slug: "odie-marsh-p7q3", name: "Odie Marsh", followers: 9 };
const pia: ShowcaseCreator = { userId: "fixture-pia", slug: "pia-lindqvist-r2t8", name: "Pia Lindqvist", followers: 25 };
const quin: ShowcaseCreator = { userId: "fixture-quin", slug: "quin-ferro-v5w9", name: "Quin Ferro", followers: 3 };
export const CREATORS = [wren, odie, pia, quin];

/** A fixed, readable starting board: one word from each group in turn. */
function interleave(groups: { words: string[] }[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < 4; i++) for (const [g, group] of groups.entries()) out.push(group.words[(i + g) % 4]);
  return out;
}

function puzzle(p: Omit<ShowcasePuzzle, "wordOrder" | "shareId">): ShowcasePuzzle {
  return { ...p, shareId: `showcase${p.shortCode.toLowerCase()}000000000000000000`, wordOrder: interleave(p.groups) };
}

export const PUZZLES: ShowcasePuzzle[] = [
  puzzle({
    key: "pantry", title: "Pantry Raid", creator: wren, shortCode: "PantryRd2k", mode: "classic",
    groups: [
      { category: "Herbs & Spices", words: ["BASIL", "CUMIN", "NUTMEG", "THYME"] },
      { category: "Grains", words: ["BARLEY", "OATS", "RICE", "RYE"] },
      { category: "Baking Staples", words: ["FLOUR", "SALT", "SUGAR", "YEAST"] },
      { category: "Often Pickled", words: ["BEET", "CAPER", "GHERKIN", "OLIVE"] },
    ],
    listedAt: "2026-11-18T10:00:00Z", plays: 42, favorites: 11,
  }),
  puzzle({
    key: "tides", title: "Turn Of The Tides", creator: odie, shortCode: "TidesTrn4x", mode: "classic",
    groups: [
      { category: "Sea Creatures", words: ["CLAM", "CRAB", "EEL", "SQUID"] },
      { category: "Parts Of A Boat", words: ["DECK", "HULL", "KEEL", "MAST"] },
      { category: "Beach Bag", words: ["BUCKET", "SPADE", "SUNHAT", "TOWEL"] },
      { category: "Moving Water", words: ["RIPPLE", "SURGE", "SWELL", "WAVE"] },
    ],
    listedAt: "2026-11-20T09:30:00Z", plays: 27, favorites: 6,
  }),
  puzzle({
    key: "air", title: "Something In The Air", creator: pia, shortCode: "AirSmthg8z", mode: "classic",
    groups: [
      { category: "Winds", words: ["BREEZE", "DRAFT", "GUST", "ZEPHYR"] },
      { category: "Flying Toys", words: ["BALLOON", "FRISBEE", "GLIDER", "KITE"] },
      { category: "Clouds", words: ["CIRRUS", "CUMULUS", "NIMBUS", "STRATUS"] },
      { category: "Birds Of Prey", words: ["EAGLE", "FALCON", "HAWK", "OSPREY"] },
    ],
    listedAt: "2026-11-16T15:00:00Z", plays: 64, favorites: 19,
  }),
  puzzle({
    key: "offbeat", title: "A Little Offbeat", creator: wren, shortCode: "OffbeatL3m", mode: "rainbow",
    groups: [
      { category: "Weapons", words: ["AXE", "BOW", "SPEAR", "SWORD"] },
      { category: "Night Sky", words: ["COMET", "MOON", "PLANET", "STAR"] },
      { category: "Pets", words: ["CAT", "DOG", "HAMSTER", "PARROT"] },
      { category: "Spread On Toast", words: ["BUTTER", "HONEY", "JAM", "JELLY"] },
    ],
    rainbow: { name: "___fish", herring: ["SWORD", "STAR", "CAT", "JELLY"] },
    listedAt: "2026-11-12T12:00:00Z", plays: 88, favorites: 23,
  }),
  puzzle({
    key: "usual", title: "The Usual Suspects", creator: odie, shortCode: "UsualSus6p", mode: "classic",
    groups: [
      { category: "Detective Work", words: ["ALIBI", "CLUE", "MOTIVE", "WITNESS"] },
      { category: "Household Staff", words: ["BUTLER", "CHEF", "GARDENER", "MAID"] },
      { category: "Rooms Of A Manor", words: ["ATTIC", "CELLAR", "LIBRARY", "STUDY"] },
      { category: "Mystery Weapons", words: ["CANDLESTICK", "PIPE", "ROPE", "WRENCH"] },
    ],
    listedAt: "2026-11-10T08:00:00Z", plays: 51, favorites: 14,
  }),
  // In Newest only: never featured or picked.
  puzzle({
    key: "owls", title: "Night Owls", creator: quin, shortCode: "NightOwl9h", mode: "classic",
    groups: [
      { category: "Out After Dark", words: ["BADGER", "BAT", "MOTH", "OWL"] },
      { category: "Seen Overhead", words: ["AURORA", "COMET", "METEOR", "SATELLITE"] },
      { category: "Bedtime", words: ["BLANKET", "LULLABY", "PILLOW", "SLIPPERS"] },
      { category: "Very Dark", words: ["EBONY", "INK", "JET", "ONYX"] },
    ],
    listedAt: "2026-11-24T19:00:00Z", plays: 3, favorites: 1,
  }),
  puzzle({
    key: "garden", title: "Garden Party", creator: pia, shortCode: "GardenPt5r", mode: "classic",
    groups: [
      { category: "Flowers", words: ["DAISY", "LILY", "ROSE", "TULIP"] },
      { category: "Garden Tools", words: ["HOE", "RAKE", "SHEARS", "TROWEL"] },
      { category: "Afternoon Tea", words: ["CAKE", "SANDWICH", "SCONE", "TEAPOT"] },
      { category: "Lawn Games", words: ["BOULES", "CROQUET", "QUOITS", "SKITTLES"] },
    ],
    listedAt: "2026-11-22T14:00:00Z", plays: 0, favorites: 0,
  }),
];

/** Human-chosen curation, as an admin would set it. */
export const CURATION = { featured: "pantry", picks: ["tides", "air", "offbeat", "usual"] };
