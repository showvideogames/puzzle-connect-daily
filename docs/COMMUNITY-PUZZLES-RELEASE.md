# Community Puzzles release runbook (Arcade Shelf + emoji covers)

What this release ships, in order, and how to undo it. It needs no new
account, permission, hosting setting, feature flag or paid resource. Nothing
here puts fixture data in production.

## What ships

* **Database:** five additive migrations, `0004`–`0008`:
  * `0004` explicit opt-in Community listing;
  * `0005` creator discovery, one-way Follow, Following, card lookups for Favorites;
  * `0006` admin-only curation (one Featured, up to six Editor's Picks) and keyset Newest;
  * `0007` the curator fix;
  * `0008` creator covers: one emoji key (an allowlist of 1,898 keys from
    the pinned `emojibase-data@16.0.3`) plus one of 24 preset backgrounds,
    owner-only.
* **App:**
  * `/community`: Explore, Following and Favorites;
  * the Community Puzzles menu row;
  * List in Community and the optional Make A Cover step in `/create`;
  * the owner's list/unlist and Edit cover controls on the puzzle page;
  * cover display on cards and puzzle pages;
  * the private `/admin/community` curation page.

  All of it is on by default.
* **Unchanged:**
  * every existing puzzle, link, play and favourite. Nothing is listed or given a
    cover automatically; old puzzles show the standard cover;
  * Editor's Picks keep their hand-illustrated art, chosen only through admin
    curation;
  * Daily, Mini and archives.
* **Dev-only, not deployed:** the showcase tooling (`vite.showcase.config.ts`,
  `src/showcase/`, `scripts/build-showcase.mjs`), e2e specs and evidence. The
  production build doesn't import them, and `emojibase-data` is a
  devDependency read only by `npm run covers:emoji`.

## Order (database first, then the app)

The new app calls the new functions, and the current live app never calls
them. So apply the migrations first (safe for the live app), then merge.

### 1. Review and CI

The PR must be approved and green (typecheck, PGlite schema and seed, beta reset
rehearsal, manifest check, browser suite). These local checks passed on this branch:

```bash
npm run e2e:db:release
```

```bash
npm run e2e:db:covers
```

### 2. Check the production migration ledger (read-only)

From the repository root (its `supabase/` is linked to the production
project), signed in with your own Supabase CLI login:

```bash
npx supabase migration list --linked
```

The README records `0001` and `0002` as applied and `0003` (the No-Hint Streak,
PR 90) as prepared but not applied. Note whether `0003` shows as applied.

### 3. Apply exactly `0004`–`0008`

* **If `0003` is already applied:** `db push` will offer exactly 0004–0008. Confirm
  only if it lists those five and nothing else:

  ```bash
  npx supabase db push --linked
  ```

* **If `0003` is not applied:** `db push` would apply it too, which is outside this
  release. Apply the five files instead, in order, in the dashboard SQL editor
  (each file is one transaction):
  `supabase/migrations/0004_community_listing.sql`, `0005_community_follows.sql`,
  `0006_community_curation.sql`, `0007_community_curation_keep_hidden.sql`,
  `0008_community_covers.sql`. Then record them:

  ```bash
  npx supabase migration repair --status applied 0004 0005 0006 0007 0008 --linked
  ```

  `npm run e2e:db:release` proves 0004–0008 apply cleanly with and without 0003.

### 4. Verify the database (read-only SQL, SQL editor)

```sql
select count(*) from public.community_cover_emoji;            -- 1898
select count(*) from public.custom_puzzles
 where community_listed or cover_emoji is not null;          -- 0: nothing auto-listed or covered
select count(*) from public.community_curation;              -- 0: no editorial shells
```

The live app is unaffected at this point.

### 5. Merge the PR

Vercel deploys `main` to production as usual. With no `VITE_COMMUNITY_PUZZLES`
set, Community is on.

### 6. Check the live site

* **Guest:**
  * `/community` loads Explore with Newest and "No Community puzzles yet.", and
    no Featured or Picks shells (nothing is curated yet);
  * the menu has Community Puzzles;
  * `/create` shows Make A Cover (disabled with "Sign in to give your puzzle a cover.");
  * an existing `/p/…` link plays as before.
* **Signed in (your own real puzzle; no fixture data):**
  1. In `/create`, tick List in Community.
  2. Pick an emoji and a background, then Create Game.
  3. The success screen shows the cover and "Cover saved.".
  4. `/community` shows it first in Newest with that cover.
  5. Its page shows the same cover above the title.
  6. Edit cover → Save Cover updates both.

  You can unlist it afterwards from the same page; its link keeps working.
* **Admin:** `/admin/community` loads; Featured and Picks are empty until you
  choose some.

## Rollback

* **Fastest, frontend only:** in Vercel, promote the previous production
  deployment (Instant Rollback), or set `VITE_COMMUNITY_PUZZLES=off` for
  Production and redeploy. Either removes the route, menu row and every new
  control, and touches no data. Reverting the merge commit does the same
  through git.
* **Database:** none needed for an incident. 0004–0008 are additive and the old
  app never calls them. For a deliberate full removal only:
  `supabase/ops/community-release/rollback-0004-0010.sql`, after a backup. It
  deletes listing flags, follows, curation and covers, and keeps puzzles, links,
  plays and favourites. Then record it:

  ```bash
  npx supabase migration repair --status reverted 0008 0007 0006 0005 0004 --linked
  ```

  `npm run e2e:db:release` proves it restores the exact pre-release schema.

## Known risks, accepted for this release

* **No player report flow yet.** The admin hide
  (`admin_set_custom_puzzle_status`) removes a puzzle from Community at once,
  and creators can unlist. Covers can't carry text, links or uploads.
* **Preview builds use production configuration**, so a Vercel preview of this
  PR made before step 3 shows Community errors there only. Merge only after step 3.
* **Emoji look depends on the device's own emoji font** (Apple, Google,
  Microsoft). The stored cover is the same everywhere. The 8 Emoji 16.0
  additions are left out because many phones still draw them as empty boxes.
