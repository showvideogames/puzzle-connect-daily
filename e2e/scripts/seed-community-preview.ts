/**
 * Adds FICTIONAL Community Puzzles data to the disposable local E2E stack, for
 * the private preview and its browser checks.
 *
 * `npm run e2e:seed:community`   (after `e2e:up` and `e2e:reset`)
 *
 * Refuses to run unless assertDisposableTarget() passes (loopback-only, no
 * hosted credentials), exactly like reset/seed. Never applies migrations.
 * Every account, name and puzzle below is invented; nothing comes from real
 * player records. Accounts are created through GoTrue's admin API and the real
 * ensure_account(); puzzles through the real create_custom_puzzle and
 * set_custom_puzzle_community_listing RPCs, signed in as their creator.
 *
 * Writes e2e/.artifacts/community-preview.json (git-ignored) with the share
 * codes and fixture credentials the browser checks need.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { guardContext, loadE2eConfig } from "../env.ts";
import { assertDisposableTarget, UnsafeTargetError } from "../safety.ts";
import { createSupabaseSeedBackend } from "./lib/seed-supabase.ts";
import { fixtureGlobalUserId } from "./lib/seed-core.ts";

const PASSWORD = "community-preview-only-1";
export const COMMUNITY_ACCOUNTS = {
  wren: { email: "e2e-wren@rainbow.test", name: "Wren Halloway" },
  odie: { email: "e2e-odie@rainbow.test", name: "Odie Marsh" },
  pia: { email: "e2e-pia@rainbow.test", name: "Pia Lindqvist" },
} as const;
type AccountKey = keyof typeof COMMUNITY_ACCOUNTS;

interface PuzzleSpec {
  key: string;
  owner: AccountKey | null;
  title: string;
  visibility: "public" | "private";
  mode: "classic" | "rainbow";
  list: boolean;
  plays: number;
  words: string[][];
}

const W = (s: string) => s.split(" ");
const PUZZLES: PuzzleSpec[] = [
  { key: "offbeat", owner: "wren", title: "A Little Offbeat", visibility: "public", mode: "rainbow", list: true, plays: 12,
    words: [W("BONGO CONGA SNARE TABLA"), W("BREVE CLEF REST STAFF"), W("CHORD RIFF SCALE TRILL"), W("LUTE LYRE OUD SITAR")] },
  { key: "usual", owner: "odie", title: "The Usual Suspects", visibility: "public", mode: "classic", list: true, plays: 31,
    words: [W("ALIBI CLUE MOTIVE WITNESS"), W("BUTLER CHEF GARDENER MAID"), W("ATTIC CELLAR LIBRARY STUDY"), W("CANDLE PIPE ROPE WRENCH")] },
  { key: "air", owner: "pia", title: "Something In The Air", visibility: "public", mode: "rainbow", list: true, plays: 4,
    words: [W("BREEZE DRAFT GUST ZEPHYR"), W("BLIMP GLIDER KITE ROCKET"), W("CIRRUS CUMULUS NIMBUS STRATUS"), W("EAGLE HAWK OSPREY RAVEN")] },
  { key: "pantry", owner: "wren", title: "Pantry Raid", visibility: "public", mode: "classic", list: true, plays: 7,
    words: [W("BASIL CUMIN NUTMEG THYME"), W("BARLEY OATS RICE RYE"), W("HONEY JAM MOLASSES SYRUP"), W("CAPER OLIVE PICKLE RELISH")] },
  { key: "tides", owner: "odie", title: "Turn Of The Tides", visibility: "public", mode: "rainbow", list: true, plays: 0,
    words: [W("CORAL KELP REEF SHOAL"), W("BUOY DOCK PIER WHARF"), W("CLAM MUSSEL OYSTER SCALLOP"), W("EBB FLOW SURGE SWELL")] },
  // Never listed: link-only public, private, and anonymous puzzles.
  { key: "linkOnly", owner: "pia", title: "Link Only Lighthouse", visibility: "public", mode: "classic", list: false, plays: 50,
    words: [W("BEACON FLARE LAMP TORCH"), W("CAPE COVE INLET SPIT"), W("ANCHOR CHAIN HULL MAST"), W("GULL PELICAN PUFFIN TERN")] },
  { key: "private", owner: "wren", title: "Private Parlour Games", visibility: "private", mode: "classic", list: false, plays: 60,
    words: [W("CHARADES BINGO DOMINO SNAP"), W("ACE JACK KING QUEEN"), W("BISHOP KNIGHT PAWN ROOK"), W("DICE MARBLE TOKEN SPINNER")] },
  { key: "anon", owner: null, title: "Anonymous Airship", visibility: "public", mode: "classic", list: false, plays: 70,
    words: [W("BALLAST GONDOLA RUDDER RIGGING"), W("ALTITUDE CEILING DRIFT LIFT"), W("COMPASS SEXTANT CHART LOG"), W("HELIUM HYDROGEN NEON ARGON")] },
];

function client(url: string, key: string): SupabaseClient {
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

function content(spec: PuzzleSpec) {
  return {
    mode: spec.mode,
    groups: spec.words.map((words, i) => ({ category: `${spec.title} group ${i + 1}`, words, hint_word: null, category_emoji: null })),
    word_order: spec.words.flat(),
    rainbow_herring: spec.mode === "rainbow" ? spec.words.map((g) => g[0]) : null,
    rainbow_category_name: spec.mode === "rainbow" ? "Fictional first words" : null,
    rainbow_hint_word: null,
    rainbow_category_emoji: null,
    alphabetize_completed: true,
  };
}

async function main(): Promise<number> {
  const config = loadE2eConfig();
  try {
    assertDisposableTarget("e2e:seed:community", config, guardContext());
  } catch (error) {
    if (error instanceof UnsafeTargetError) {
      console.error(`\n${error.message}\n`);
      return 2;
    }
    throw error;
  }

  const backend = createSupabaseSeedBackend(config);
  const sessions = {} as Record<AccountKey, SupabaseClient>;
  const ids = {} as Record<AccountKey, string>;
  for (const [key, a] of Object.entries(COMMUNITY_ACCOUNTS) as [AccountKey, (typeof COMMUNITY_ACCOUNTS)[AccountKey]][]) {
    ids[key] = await backend.createAccount(a.email, PASSWORD, fixtureGlobalUserId(`community${key}`));
    const c = client(config.apiUrl, config.anonKey);
    const { error } = await c.auth.signInWithPassword({ email: a.email, password: PASSWORD });
    if (error) throw new Error(`sign-in failed for ${a.email}: ${error.message}`);
    sessions[key] = c;
    console.log(`  account ${a.email}`);
  }

  const anon = client(config.apiUrl, config.anonKey);
  const out: Record<string, { title: string; shareId: string; shortCode: string; listed: boolean; visibility: string; owner: string | null }> = {};
  for (const spec of PUZZLES) {
    const c = spec.owner ? sessions[spec.owner] : anon;
    const creatorName = spec.owner ? COMMUNITY_ACCOUNTS[spec.owner].name : "Guest Puzzler";
    const { data, error } = await c.rpc("create_custom_puzzle", {
      _creator_name: creatorName, _title: spec.title, _visibility: spec.visibility, _content: content(spec),
    });
    if (error) throw new Error(`create_custom_puzzle failed for "${spec.title}": ${error.message}`);
    const row = data as { share_id: string; short_code: string };
    if (spec.list) {
      const listed = await c.rpc("set_custom_puzzle_community_listing", { _share_id: row.share_id, _listed: true });
      if (listed.error) throw new Error(`listing failed for "${spec.title}": ${listed.error.message}`);
    }
    for (let i = 0; i < spec.plays; i++) {
      const dev = await anon.rpc("create_device_identity");
      const d = (Array.isArray(dev.data) ? dev.data[0] : dev.data) as { device_id: string; device_token: string };
      const r = await anon.rpc("submit_custom_puzzle_result", {
        _share_id: row.share_id, _device_id: d.device_id, _device_token: d.device_token,
        _won: i % 4 !== 0, _total_guesses: 4 + (i % 5), _run_id: crypto.randomUUID(),
      });
      if (r.error) throw new Error(`play failed for "${spec.title}": ${r.error.message}`);
    }
    out[spec.key] = { title: spec.title, shareId: row.share_id, shortCode: row.short_code, listed: spec.list, visibility: spec.visibility, owner: spec.owner };
    console.log(`  ${spec.list ? "listed  " : "unlisted"} ${spec.visibility.padEnd(7)} "${spec.title}" → /p/${row.short_code} (${spec.plays} plays)`);
  }

  const file = path.resolve("e2e/.artifacts/community-preview.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    apiUrl: config.apiUrl,
    password: PASSWORD,
    accounts: Object.fromEntries(Object.entries(COMMUNITY_ACCOUNTS).map(([k, a]) => [k, { ...a, id: ids[k as AccountKey] }])),
    puzzles: out,
  }, null, 2));
  console.log(`\nWrote ${path.relative(process.cwd(), file)}\n`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`\n${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(1);
  }
);
