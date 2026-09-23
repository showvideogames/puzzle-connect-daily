/**
 * Seeding, expressed once against an interface.
 *
 * The two backends differ only in HOW a statement reaches Postgres:
 *
 *   real stack  accounts through GoTrue's admin API, puzzles through
 *               PostgREST as a signed-in admin — i.e. the exact path the
 *               real Admin page takes.
 *   PGlite      accounts as auth.users rows, puzzles through the same RPC
 *               called in-process with `request.jwt.claims` set — the same
 *               impersonation contract auth.uid() implements.
 *
 * WHAT they do is this file, so the fixtures cannot mean two different
 * things. Nothing here inserts into `puzzles` or `puzzle_groups` directly:
 * every puzzle goes through `admin_save_puzzle` / `create_custom_puzzle`,
 * so `validate_puzzle_content` gets a say and a fixture that the real
 * builder could not produce fails the seed instead of reaching a test.
 */

import { ACCOUNTS, CUSTOM_PUZZLES, OFFICIAL_PUZZLES } from "../../fixtures/catalog.ts";
import { customContent, officialContent, officialMetadata } from "../../fixtures/payloads.ts";
import type { SeedManifest } from "../../fixtures/manifest.ts";

export interface SeedBackend {
  /** Creates a confirmed account and returns its auth user id. */
  createAccount(email: string, password: string): Promise<string>;
  /** Gives an account the `admin` role. */
  grantAdmin(userId: string): Promise<void>;
  /** Calls admin_save_puzzle as `adminUserId`. Returns the puzzle id. */
  saveOfficialPuzzle(
    adminUserId: string,
    metadata: ReturnType<typeof officialMetadata>,
    content: ReturnType<typeof officialContent>
  ): Promise<string>;
  /** Calls create_custom_puzzle as an anonymous visitor. */
  createCustomPuzzle(
    creatorName: string,
    title: string,
    visibility: "public" | "private",
    content: ReturnType<typeof customContent>
  ): Promise<{ puzzleId: string; shareId: string; shortCode: string | null }>;
}

export interface SeedOptions {
  apiUrl: string;
  log?: (message: string) => void;
}

export async function seedFixtures(
  backend: SeedBackend,
  options: SeedOptions
): Promise<SeedManifest> {
  const log = options.log ?? (() => {});

  const manifest: SeedManifest = {
    seededAt: new Date().toISOString(),
    apiUrl: options.apiUrl,
    official: {},
    custom: {},
    accounts: {},
  };

  for (const account of Object.values(ACCOUNTS)) {
    const id = await backend.createAccount(account.email, account.password);
    if (account.isAdmin) await backend.grantAdmin(id);
    manifest.accounts[account.key] = {
      key: account.key,
      id,
      email: account.email,
      password: account.password,
      isAdmin: account.isAdmin,
    };
    log(`account ${account.email}${account.isAdmin ? " (admin)" : ""}`);
  }

  const adminId = manifest.accounts[ACCOUNTS.admin.key]?.id;
  if (!adminId) throw new Error("The admin fixture account was not created; cannot save puzzles.");

  for (const fixture of OFFICIAL_PUZZLES) {
    const id = await backend.saveOfficialPuzzle(
      adminId,
      officialMetadata(fixture),
      officialContent(fixture)
    );
    manifest.official[fixture.key] = {
      key: fixture.key,
      id,
      format: fixture.format as "full" | "mini",
      date: fixture.date,
      title: fixture.title,
    };
    log(`${fixture.format} puzzle "${fixture.title}" (${fixture.date})`);
  }

  for (const fixture of CUSTOM_PUZZLES) {
    const created = await backend.createCustomPuzzle(
      fixture.creatorName,
      fixture.title,
      fixture.visibility,
      customContent(fixture)
    );
    manifest.custom[fixture.key] = {
      key: fixture.key,
      puzzleId: created.puzzleId,
      shareId: created.shareId,
      shortCode: created.shortCode,
      title: fixture.title,
    };
    log(`custom puzzle "${fixture.title}" → /p/${created.shortCode ?? created.shareId}`);
  }

  return manifest;
}
