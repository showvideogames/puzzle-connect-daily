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
  /** The creator's cover keys (one emoji, one preset background), or none. */
  cover?: { emojis: string[]; background: string };
  /** Made by the fictional signed-in Demo Player (shown in their My Puzzles). */
  ownedByDemo?: boolean;
  visibility?: "public" | "private";
  /** Not listed in Community (a link-only or private puzzle). */
  unlisted?: boolean;
  /** When it was made, if not when it was listed. */
  createdAt?: string;
  /** Set once the visitor first lists it in this visit. */
  listedAtSet?: boolean;
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

export function puzzle(p: Omit<ShowcasePuzzle, "wordOrder" | "shareId">): ShowcasePuzzle {
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
    listedAt: "2026-11-21T10:00:00Z", plays: 42, favorites: 31,
    cover: { emojis: ["1F37F"], background: "apricot-stripes" },
  }),
  puzzle({
    key: "tides", title: "Turn Of The Tides", creator: odie, shortCode: "TidesTrn4x", mode: "classic",
    groups: [
      { category: "Sea Creatures", words: ["CLAM", "CRAB", "EEL", "SQUID"] },
      { category: "Parts Of A Boat", words: ["DECK", "HULL", "KEEL", "MAST"] },
      { category: "Beach Bag", words: ["BUCKET", "SPADE", "SUNHAT", "TOWEL"] },
      { category: "Moving Water", words: ["RIPPLE", "SURGE", "SWELL", "WAVE"] },
    ],
    listedAt: "2026-11-19T09:30:00Z", plays: 27, favorites: 6,
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
    cover: { emojis: ["1F989"], background: "indigo-stars" },
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
    cover: { emojis: ["1F438", "1F337"], background: "lime-checks" },
  }),
  puzzle({
    key: "orbit", title: "Out of Orbit", creator: odie, shortCode: "OrbitOut7k", mode: "classic",
    groups: [
      { category: "Planets", words: ["JUPITER", "MARS", "SATURN", "VENUS"] },
      { category: "Spacecraft", words: ["LANDER", "PROBE", "ROCKET", "SHUTTLE"] },
      { category: "Constellations", words: ["CYGNUS", "DRACO", "LYRA", "ORION"] },
      { category: "In Orbit", words: ["DEBRIS", "MOON", "SATELLITE", "STATION"] },
    ],
    listedAt: "2026-11-20T12:00:00Z", plays: 12, favorites: 4,
    cover: { emojis: ["1FA90", "1F680", "2B50-FE0F"], background: "lilac-dots" },
  }),
];

/** The fictional Demo Player's own puzzles: what My Puzzles shows them. */
export const DEMO_PLAYER: ShowcaseCreator = { userId: "fixture-demo-player", slug: "demo-player-d3m0", name: "Demo Player", followers: 2 };
export const DEMO_OWNED: ShowcasePuzzle[] = [
  // An older puzzle from before covers and Community: link only, no cover.
  puzzle({
    key: "mixtape", title: "Mixtape Memories", creator: DEMO_PLAYER, shortCode: "MixtapeM3m", mode: "classic",
    groups: [
      { category: "Voice Parts", words: ["ALTO", "BASS", "SOPRANO", "TENOR"] },
      { category: "Songs", words: ["BALLAD", "HYMN", "LULLABY", "SHANTY"] },
      { category: "Formats", words: ["CASSETTE", "RECORD", "REEL", "VINYL"] },
      { category: "On The Road", words: ["ENCORE", "GIG", "SETLIST", "TOUR"] },
    ],
    listedAt: "2025-03-14T10:00:00Z", createdAt: "2025-03-14T10:00:00Z", plays: 3, favorites: 0, ownedByDemo: true, unlisted: true,
  }),
  puzzle({
    key: "lanterns", title: "Lantern Festival", creator: DEMO_PLAYER, shortCode: "LanternF7s", mode: "rainbow",
    groups: [
      { category: "Light Sources", words: ["CANDLE", "LAMP", "LANTERN", "TORCH"] },
      { category: "Paper Crafts", words: ["CRANE", "FAN", "KITE", "STAR"] },
      { category: "Night Sounds", words: ["CRICKET", "HOOT", "RUSTLE", "WHISPER"] },
      { category: "Sweet Treats", words: ["MOCHI", "NOUGAT", "TAFFY", "TOFFEE"] },
    ],
    rainbow: { name: "Things that glow", herring: ["LANTERN", "STAR", "CRICKET", "TOFFEE"] },
    listedAt: "2026-11-15T18:00:00Z", createdAt: "2026-11-15T17:30:00Z", plays: 9, favorites: 2, ownedByDemo: true,
    cover: { emojis: ["1F3EE"], background: "dusk-gradient" },
  }),
  puzzle({
    key: "swap", title: "Secret Santa Swap", creator: DEMO_PLAYER, shortCode: "SantaSwp4q", mode: "classic",
    groups: [
      { category: "Wrapping", words: ["BOW", "PAPER", "RIBBON", "TAPE"] },
      { category: "Stocking Fillers", words: ["CANDY", "SOCKS", "TOY", "YOYO"] },
      { category: "Reindeer", words: ["COMET", "CUPID", "DANCER", "VIXEN"] },
      { category: "Winter Drinks", words: ["CIDER", "COCOA", "EGGNOG", "PUNCH"] },
    ],
    listedAt: "2026-11-23T09:00:00Z", createdAt: "2026-11-23T09:00:00Z", plays: 4, favorites: 0, ownedByDemo: true, unlisted: true, visibility: "private",
  }),
];

/** The board every showcase demo puzzle uses (the real builder makes you write your own). */
export const DEMO_GROUPS = [
  { category: "Colors", words: ["BLUE", "GREEN", "PINK", "RED"] },
  { category: "Fruit", words: ["APPLE", "KIWI", "PEAR", "PLUM"] },
  { category: "Weather", words: ["FOG", "HAIL", "RAIN", "SNOW"] },
  { category: "Shapes", words: ["CIRCLE", "OVAL", "SQUARE", "TRIANGLE"] },
];

/** Human-chosen curation, as an admin would set it. */
export const CURATION = { featured: "pantry", picks: ["tides", "air", "offbeat", "usual"] };
