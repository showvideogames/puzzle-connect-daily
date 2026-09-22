/**
 * The seed backend for the real local Supabase stack.
 *
 * Everything here goes over HTTP, through GoTrue and PostgREST, exactly as
 * the browser does:
 *
 *   * accounts are created with GoTrue's admin API (already confirmed, so a
 *     browser sign-in in a test needs no mail round trip);
 *   * puzzles are saved by SIGNING IN as the fixture admin and calling
 *     `admin_save_puzzle` with that session — so the RPC's own
 *     `has_role(auth.uid(), 'admin')` check is genuinely exercised at seed
 *     time, and a broken admin gate fails the seed rather than silently
 *     passing the Admin tests;
 *   * the custom puzzle is created by a client with only the anon key and no
 *     session, which is what a visitor to /create actually is.
 *
 * The service-role key is used for two things only: creating accounts and
 * writing the `user_roles` row that makes one an admin. Both are setup a
 * real deployment does out-of-band too.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { E2eConfig } from "../../env.ts";
import type { SeedBackend } from "./seed-core.ts";

function client(url: string, key: string): SupabaseClient {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function createSupabaseSeedBackend(config: E2eConfig): SeedBackend {
  const admin = client(config.apiUrl, config.serviceRoleKey);
  const anon = client(config.apiUrl, config.anonKey);
  /** One signed-in client per admin account, reused across puzzles. */
  const sessions = new Map<string, SupabaseClient>();

  return {
    async createAccount(email, password) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error || !data.user) {
        throw new Error(`Could not create ${email}: ${error?.message ?? "no user returned"}`);
      }
      return data.user.id;
    },

    async grantAdmin(userId) {
      const { error } = await admin
        .from("user_roles")
        .upsert({ user_id: userId, role: "admin" }, { onConflict: "user_id,role" });
      if (error) throw new Error(`Could not grant admin to ${userId}: ${error.message}`);
    },

    async saveOfficialPuzzle(adminUserId, metadata, content) {
      let signedIn = sessions.get(adminUserId);
      if (!signedIn) {
        // Look the account's credentials up from the fixtures rather than
        // minting a token: signing in with the real password is what proves
        // the account the Admin tests will use actually works.
        const { ACCOUNTS } = await import("../../fixtures/catalog.ts");
        const account = Object.values(ACCOUNTS).find((a) => a.isAdmin);
        if (!account) throw new Error("No admin account fixture is defined.");
        const scoped = client(config.apiUrl, config.anonKey);
        const { error } = await scoped.auth.signInWithPassword({
          email: account.email,
          password: account.password,
        });
        if (error) throw new Error(`Admin sign-in failed during seeding: ${error.message}`);
        signedIn = scoped;
        sessions.set(adminUserId, scoped);
      }

      const { data, error } = await signedIn.rpc("admin_save_puzzle", {
        _puzzle_id: null,
        _metadata: metadata,
        _content: content,
      });
      if (error) {
        throw new Error(`admin_save_puzzle failed for ${metadata.date}: ${error.message}`);
      }
      const row = (data ?? {}) as { puzzle_id?: string };
      if (!row.puzzle_id) throw new Error(`admin_save_puzzle returned no puzzle id for ${metadata.date}`);
      return row.puzzle_id;
    },

    async createCustomPuzzle(creatorName, title, visibility, content) {
      const { data, error } = await anon.rpc("create_custom_puzzle", {
        _creator_name: creatorName,
        _title: title,
        _visibility: visibility,
        _content: content,
      });
      if (error) throw new Error(`create_custom_puzzle failed for "${title}": ${error.message}`);
      const row = (data ?? {}) as { puzzle_id?: string; share_id?: string; short_code?: string };
      if (!row.puzzle_id || !row.share_id) {
        throw new Error(`create_custom_puzzle returned no ids for "${title}"`);
      }
      return { puzzleId: row.puzzle_id, shareId: row.share_id, shortCode: row.short_code ?? null };
    },
  };
}
