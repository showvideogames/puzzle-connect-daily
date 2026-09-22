/**
 * What the seed recorded about the fixtures it created.
 *
 * Almost everything about a fixture is a literal in catalog.ts. The two
 * things that cannot be are the ids the database mints: official puzzle uuids
 * (`admin_save_puzzle` generates them) and a custom puzzle's share id and
 * short code (`create_custom_puzzle` generates those server-side and refuses
 * a client-supplied one — deliberately).
 *
 * Rather than guess or hardcode them, the seed writes them here and the tests
 * read them. The file is a build artifact, never committed.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SEED_MANIFEST_FILE } from "../env.ts";

export interface SeededOfficialPuzzle {
  key: string;
  id: string;
  format: "full" | "mini";
  date: string;
  title: string;
}

export interface SeededCustomPuzzle {
  key: string;
  puzzleId: string;
  shareId: string;
  shortCode: string | null;
  title: string;
}

export interface SeededAccount {
  key: string;
  id: string;
  email: string;
  password: string;
  isAdmin: boolean;
}

export interface SeedManifest {
  /** ISO timestamp of the seed run — purely diagnostic. */
  seededAt: string;
  /** The Supabase API URL the seed wrote to, for a sanity check in tests. */
  apiUrl: string;
  official: Record<string, SeededOfficialPuzzle>;
  custom: Record<string, SeededCustomPuzzle>;
  accounts: Record<string, SeededAccount>;
}

export function writeSeedManifest(manifest: SeedManifest): void {
  mkdirSync(path.dirname(SEED_MANIFEST_FILE), { recursive: true });
  writeFileSync(SEED_MANIFEST_FILE, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export function readSeedManifest(): SeedManifest {
  let raw: string;
  try {
    raw = readFileSync(SEED_MANIFEST_FILE, "utf8");
  } catch {
    throw new Error(
      `No seed manifest at ${SEED_MANIFEST_FILE}.\n` +
        "Run `npm run e2e:reset` first — it applies the schema and seeds the fixtures."
    );
  }
  return JSON.parse(raw) as SeedManifest;
}
