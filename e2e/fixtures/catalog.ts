/**
 * The deterministic fixture set the E2E environment is seeded with.
 *
 * Everything a test asserts against lives here, as data. Two rules make the
 * suite independent of the real calendar and of production content:
 *
 *   1. Every date is FIXED (see {@link FIXTURE_TODAY}). The browser's clock
 *      is pinned to the same instant by the Playwright fixture, so "today's
 *      puzzle" means the same row every run, forever.
 *   2. Nothing is generated at random. Words, categories, titles and
 *      Rainbow sets are literals; the only values the harness does not
 *      choose are the ids Postgres mints, which the seed records in
 *      e2e/.artifacts/seed-manifest.json for the tests to read.
 *
 * The puzzles are seeded through the application's OWN RPCs
 * (`admin_save_puzzle`, `create_custom_puzzle`), not by inserting rows, so a
 * fixture that would be impossible to author in the real Admin builder
 * cannot exist — `validate_puzzle_content` rejects it at seed time and the
 * seed fails loudly.
 */

import type { Difficulty, PuzzleFormatId } from "../../src/lib/puzzleFormat.ts";

/**
 * The day the browser believes it is, for every test.
 *
 * Chosen in the past relative to any plausible run date so the archive
 * calendar's "only past days are playable" rule holds, and on the 15th so
 * the archive fixtures (the 12th) sit in the SAME month — no month
 * navigation is needed to reach them, and none is accidentally depended on.
 *
 * Midday UTC with the browser pinned to UTC: far enough from either midnight
 * that a timezone slip would be a visible failure, not a flake.
 */
export const FIXTURE_TODAY = "2026-06-15";
export const FIXTURE_CLOCK_ISO = `${FIXTURE_TODAY}T12:00:00.000Z`;
/** The date every archive fixture uses. Same month as FIXTURE_TODAY. */
export const FIXTURE_ARCHIVE_DATE = "2026-06-12";

export interface FixtureGroup {
  category: string;
  categoryEmoji: string | null;
  /** Uppercase, exactly as the builder normalises them. */
  words: string[];
  hintWord: string | null;
  difficulty: Difficulty;
}

export interface OfficialPuzzleFixture {
  /** Stable handle the tests and the seed manifest use. */
  key: string;
  format: PuzzleFormatId;
  date: string;
  title: string;
  designerName: string;
  isPublished: boolean;
  groups: FixtureGroup[];
  /** Fixed starting board order — all tiles, so the board never shuffles. */
  wordOrder: string[];
  /** One word per category, or null for a Classic puzzle. */
  rainbowHerring: string[] | null;
  rainbowCategoryName: string | null;
  rainbowCategoryEmoji: string | null;
  rainbowHintWord: string | null;
  alphabetizeCompleted: boolean;
}

export interface CustomPuzzleFixture {
  key: string;
  format: PuzzleFormatId;
  title: string;
  creatorName: string;
  visibility: "public" | "private";
  mode: "classic" | "rainbow";
  groups: Omit<FixtureGroup, "difficulty">[];
  wordOrder: string[];
  rainbowHerring: string[] | null;
  rainbowCategoryName: string | null;
  rainbowCategoryEmoji: string | null;
  rainbowHintWord: string | null;
  alphabetizeCompleted: boolean;
}

export interface AccountFixture {
  key: string;
  email: string;
  password: string;
  isAdmin: boolean;
}

/**
 * Accounts. Passwords are fixture constants for a throwaway local database
 * and are meaningless anywhere else; they are in git on purpose so a clean
 * checkout can run the suite with no extra setup.
 */
export const ACCOUNTS = {
  admin: {
    key: "admin",
    email: "e2e-admin@rainbow.test",
    password: "e2e-admin-password",
    isAdmin: true,
  },
  player: {
    key: "player",
    email: "e2e-player@rainbow.test",
    password: "e2e-player-password",
    isAdmin: false,
  },
} as const satisfies Record<string, AccountFixture>;

// ── Full 4×4 ────────────────────────────────────────────────────────────────

/**
 * Today's Full puzzle: a Rainbow board.
 *
 * The Rainbow is "___ Board": SURF, CARD, SNOW and DASH each belong to one
 * ordinary category AND all precede the same word. Selecting exactly those
 * four and submitting is the real in-game discovery path — the same one a
 * player takes — which is what the Full Rainbow test exercises.
 */
export const FULL_RAINBOW: OfficialPuzzleFixture = {
  key: "fullRainbow",
  format: "full",
  date: FIXTURE_TODAY,
  title: "#902",
  designerName: "E2E Fixture",
  isPublished: true,
  groups: [
    {
      difficulty: 1,
      category: "Ocean Activities",
      categoryEmoji: "🌊",
      words: ["DIVE", "FISH", "SAIL", "SURF"],
      hintWord: "SNORKEL",
    },
    {
      difficulty: 2,
      category: "Things in a Wallet",
      categoryEmoji: "💳",
      words: ["CARD", "CASH", "COUPON", "LICENSE"],
      hintWord: "RECEIPT",
    },
    {
      difficulty: 3,
      category: "Winter Weather",
      categoryEmoji: "❄️",
      words: ["FROST", "HAIL", "SLEET", "SNOW"],
      hintWord: "BLIZZARD",
    },
    {
      difficulty: 4,
      category: "Move Quickly",
      categoryEmoji: "🏃",
      words: ["BOLT", "DART", "DASH", "SCURRY"],
      hintWord: "SPRINT",
    },
  ],
  wordOrder: [
    "SURF", "CASH", "HAIL", "SCURRY",
    "DIVE", "CARD", "SNOW", "BOLT",
    "FISH", "LICENSE", "FROST", "DASH",
    "SAIL", "COUPON", "SLEET", "DART",
  ],
  rainbowHerring: ["SURF", "CARD", "SNOW", "DASH"],
  rainbowCategoryName: "___ Board",
  rainbowCategoryEmoji: "🛹",
  rainbowHintWord: "SKATE",
  alphabetizeCompleted: true,
};

/** An older Full puzzle with no Rainbow — the archive target. */
export const FULL_CLASSIC: OfficialPuzzleFixture = {
  key: "fullClassic",
  format: "full",
  date: FIXTURE_ARCHIVE_DATE,
  title: "#901",
  designerName: "E2E Fixture",
  isPublished: true,
  groups: [
    {
      difficulty: 1,
      category: "Citrus Fruits",
      categoryEmoji: "🍊",
      words: ["GRAPEFRUIT", "LEMON", "LIME", "ORANGE"],
      hintWord: "CLEMENTINE",
    },
    {
      difficulty: 2,
      category: "Chess Pieces",
      categoryEmoji: "♟️",
      words: ["BISHOP", "KNIGHT", "PAWN", "ROOK"],
      hintWord: "QUEEN",
    },
    {
      difficulty: 3,
      category: "Desert Features",
      categoryEmoji: "🏜️",
      words: ["CACTUS", "DUNE", "MIRAGE", "OASIS"],
      hintWord: "SCORPION",
    },
    {
      difficulty: 4,
      category: "Famous Bridges",
      categoryEmoji: "🌉",
      words: ["BROOKLYN", "GOLDEN", "RIALTO", "TOWER"],
      hintWord: "MILLENNIUM",
    },
  ],
  wordOrder: [
    "LEMON", "ROOK", "OASIS", "TOWER",
    "ORANGE", "PAWN", "DUNE", "GOLDEN",
    "LIME", "BISHOP", "CACTUS", "RIALTO",
    "GRAPEFRUIT", "KNIGHT", "MIRAGE", "BROOKLYN",
  ],
  rainbowHerring: null,
  rainbowCategoryName: null,
  rainbowCategoryEmoji: null,
  rainbowHintWord: null,
  alphabetizeCompleted: true,
};

// ── Mini 3×3 ────────────────────────────────────────────────────────────────

/**
 * Today's Mini: a Rainbow board with THREE Rainbow answers, one per
 * category — the size rule that `rainbowHerringFor` enforces.
 * The Rainbow is "Baseball Words": STRIKE, DIAMOND, PITCHER.
 */
export const MINI_RAINBOW: OfficialPuzzleFixture = {
  key: "miniRainbow",
  format: "mini",
  date: FIXTURE_TODAY,
  title: "Mini #12",
  designerName: "E2E Fixture",
  isPublished: true,
  groups: [
    {
      difficulty: 2,
      category: "Bowling Terms",
      categoryEmoji: "🎳",
      words: ["SPARE", "STRIKE", "TURKEY"],
      hintWord: "GUTTER",
    },
    {
      difficulty: 3,
      category: "Card Suits",
      categoryEmoji: "♠️",
      words: ["CLUBS", "DIAMOND", "HEARTS"],
      hintWord: "JOKER",
    },
    {
      difficulty: 4,
      category: "Seen in a Diner",
      categoryEmoji: "🍳",
      words: ["BOOTH", "COUNTER", "PITCHER"],
      hintWord: "JUKEBOX",
    },
  ],
  wordOrder: [
    "STRIKE", "HEARTS", "BOOTH",
    "TURKEY", "DIAMOND", "COUNTER",
    "SPARE", "CLUBS", "PITCHER",
  ],
  rainbowHerring: ["STRIKE", "DIAMOND", "PITCHER"],
  rainbowCategoryName: "Baseball Words",
  rainbowCategoryEmoji: "⚾",
  rainbowHintWord: "OUTFIELD",
  alphabetizeCompleted: true,
};

/** An older Classic Mini — the Mini archive target. */
export const MINI_CLASSIC: OfficialPuzzleFixture = {
  key: "miniClassic",
  format: "mini",
  date: FIXTURE_ARCHIVE_DATE,
  title: "Mini #11",
  designerName: "E2E Fixture",
  isPublished: true,
  groups: [
    {
      difficulty: 2,
      category: "Shades of Blue",
      categoryEmoji: "🔵",
      words: ["AZURE", "COBALT", "NAVY"],
      hintWord: "TEAL",
    },
    {
      difficulty: 3,
      category: "Pizza Toppings",
      categoryEmoji: "🍕",
      words: ["OLIVE", "PEPPERONI", "SAUSAGE"],
      hintWord: "ANCHOVY",
    },
    {
      difficulty: 4,
      category: "Dance Styles",
      categoryEmoji: "💃",
      words: ["SALSA", "TANGO", "WALTZ"],
      hintWord: "FOXTROT",
    },
  ],
  wordOrder: [
    "NAVY", "OLIVE", "TANGO",
    "AZURE", "SAUSAGE", "WALTZ",
    "COBALT", "PEPPERONI", "SALSA",
  ],
  rainbowHerring: null,
  rainbowCategoryName: null,
  rainbowCategoryEmoji: null,
  rainbowHintWord: null,
  alphabetizeCompleted: true,
};

// ── Custom ──────────────────────────────────────────────────────────────────

/**
 * One public custom puzzle, created anonymously — the ordinary case for a
 * shared community link, and the one whose page the smoke test drives.
 */
export const CUSTOM_PUBLIC: CustomPuzzleFixture = {
  key: "customPublic",
  format: "full",
  title: "E2E Community Classic",
  creatorName: "E2E Fixture Creator",
  visibility: "public",
  mode: "classic",
  groups: [
    {
      category: "Breakfast Foods",
      categoryEmoji: "🥞",
      words: ["BACON", "OATMEAL", "TOAST", "WAFFLE"],
      hintWord: "GRANOLA",
    },
    {
      category: "Musical Instruments",
      categoryEmoji: "🎺",
      words: ["CELLO", "FLUTE", "OBOE", "TUBA"],
      hintWord: "HARP",
    },
    {
      category: "Planets",
      categoryEmoji: "🪐",
      words: ["MARS", "NEPTUNE", "SATURN", "VENUS"],
      hintWord: "MERCURY",
    },
    {
      category: "Knots",
      categoryEmoji: "🪢",
      words: ["BOWLINE", "CLOVE", "SHEEPSHANK", "WINDSOR"],
      hintWord: "HITCH",
    },
  ],
  wordOrder: [
    "TOAST", "OBOE", "VENUS", "WINDSOR",
    "WAFFLE", "TUBA", "MARS", "CLOVE",
    "BACON", "CELLO", "SATURN", "BOWLINE",
    "OATMEAL", "FLUTE", "NEPTUNE", "SHEEPSHANK",
  ],
  rainbowHerring: null,
  rainbowCategoryName: null,
  rainbowCategoryEmoji: null,
  rainbowHintWord: null,
  alphabetizeCompleted: true,
};

/**
 * A Draft Full puzzle that exists only so the Admin versioning test has
 * something it may freely edit.
 *
 * Isolation, made explicit: the versioning journey has to re-save a puzzle
 * and then change it, which mutates whatever it is pointed at. Pointing it
 * at the Daily fixture would make the public tests depend on whether the
 * Admin test had run yet. Unpublished, so it never appears on a public page
 * or in either archive.
 */
export const FULL_VERSION_SANDBOX: OfficialPuzzleFixture = {
  key: "fullVersionSandbox",
  format: "full",
  date: "2026-06-10",
  title: "#900 Version Sandbox",
  designerName: "E2E Fixture",
  isPublished: false,
  groups: [
    {
      difficulty: 1,
      category: "Sandbox One",
      categoryEmoji: "1️⃣",
      words: ["ALPHA", "BRAVO", "CHARLIE", "DELTA"],
      hintWord: "ECHO",
    },
    {
      difficulty: 2,
      category: "Sandbox Two",
      categoryEmoji: "2️⃣",
      words: ["FOXTROT", "GOLF", "HOTEL", "INDIA"],
      hintWord: "JULIET",
    },
    {
      difficulty: 3,
      category: "Sandbox Three",
      categoryEmoji: "3️⃣",
      words: ["KILO", "LIMA", "MIKE", "NOVEMBER"],
      hintWord: "OSCAR",
    },
    {
      difficulty: 4,
      category: "Sandbox Four",
      categoryEmoji: "4️⃣",
      words: ["PAPA", "QUEBEC", "ROMEO", "SIERRA"],
      hintWord: "TANGO",
    },
  ],
  wordOrder: [
    "ALPHA", "FOXTROT", "KILO", "PAPA",
    "BRAVO", "GOLF", "LIMA", "QUEBEC",
    "CHARLIE", "HOTEL", "MIKE", "ROMEO",
    "DELTA", "INDIA", "NOVEMBER", "SIERRA",
  ],
  rainbowHerring: null,
  rainbowCategoryName: null,
  rainbowCategoryEmoji: null,
  rainbowHintWord: null,
  alphabetizeCompleted: true,
};

export const OFFICIAL_PUZZLES: OfficialPuzzleFixture[] = [
  FULL_VERSION_SANDBOX,
  FULL_CLASSIC,
  FULL_RAINBOW,
  MINI_CLASSIC,
  MINI_RAINBOW,
];

export const CUSTOM_PUZZLES: CustomPuzzleFixture[] = [CUSTOM_PUBLIC];

/**
 * Words the Admin test types. Kept beside the other fixtures because the
 * hyphenated answer is a REGRESSION GUARD, not a decoration: answers must
 * save uppercase, and `JACK-IN-THE-BOX` is the shape that would break a
 * naive split-on-punctuation normaliser.
 */
export const ADMIN_AUTHORING = {
  full: {
    date: "2026-06-20",
    title: "#903 E2E Authored",
    categories: [
      { name: "Toy Box", emoji: "🧸", answers: "Jack-in-the-box, Yo-yo, Marbles, Slinky", hint: "Kite" },
      { name: "Soup Kinds", emoji: "🍲", answers: "Borscht, Chowder, Gazpacho, Miso", hint: "Ramen" },
      { name: "Shoe Parts", emoji: "👟", answers: "Heel, Lace, Sole, Tongue", hint: "Eyelet" },
      { name: "Volcano Words", emoji: "🌋", answers: "Ash, Crater, Lava, Magma", hint: "Caldera" },
    ],
    /** Uppercased forms the database must have stored. */
    expectedFirstCategoryWords: ["JACK-IN-THE-BOX", "YO-YO", "MARBLES", "SLINKY"],
  },
  mini: {
    date: "2026-06-21",
    title: "Mini #13 E2E Authored",
    categories: [
      { name: "Body Parts", emoji: "🦴", answers: "Brain, Elbow, Spine", hint: "Rib" },
      { name: "Cleaning Words", emoji: "🧹", answers: "Dust, Mop, Scrub", hint: "Polish" },
      { name: "Winter Words", emoji: "❄️", answers: "Mitten, Sled, Snow", hint: "Icicle" },
    ],
    rainbow: {
      /**
       * One answer per category, in category order, spelled as the AUTHOR
       * TYPES THEM. The builder's Rainbow pickers list each answer in the
       * casing it was entered in — `normalizeWord` only runs at save time —
       * so this is what the option labels actually say. The uppercase form
       * the database must end up storing is asserted separately.
       */
      picks: ["Brain", "Dust", "Snow"],
      name: "___ Storm",
      emoji: "⛈️",
      hint: "FIRE",
    },
  },
} as const;
