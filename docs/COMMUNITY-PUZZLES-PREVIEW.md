# Community Puzzles (private preview)

`/community` is a browse feed of custom puzzles that their creator explicitly
chose to list. It is behind `VITE_COMMUNITY_PUZZLES=preview` and depends on the
additive migration `supabase/migrations/0004_community_listing.sql`, which has
**not** been applied to any hosted database. With the flag unset, which is every
deployed build, the route doesn't exist and no new UI renders.

## What already existed (checked before building)

| Piece | Where | Reused how |
| --- | --- | --- |
| `CommunityPuzzleCard` | `src/components/CommunityPuzzleCard.tsx` | the feed's cards, unchanged (title link to `/p/:shortCode`, mode badge, "by" with profile link, plays, favorites) |
| Custom puzzle create/play | `/create`, `/p/:shortCode`, `/custom/:shareId`, `lib/customPuzzles.ts` | unchanged; listing is a separate call after `create_custom_puzzle` |
| Public/private visibility | `custom_puzzles.visibility`, fixed at creation | unchanged; only Public can be listed, and visibility never implies listing |
| Creator profiles | `creator_profiles`, `get_creator_profile` | the feed shows the profile link when one exists; the profile page is unchanged and still lists every Public puzzle |
| Plays / favorites counters | `custom_puzzle_stats` (wins + losses), `custom_puzzle_favorites` | the same "finished plays" number creator pages show |
| Moderation | `admin_set_custom_puzzle_status(…, 'hidden')` | honoured: hidden puzzles drop out of the feed |
| A public listing RPC | **none existed** | added (below) |
| Player report flow | **none exists** | not built here; this is why the preview stays gated |

## What this adds

**Database (additive, `0004_community_listing.sql`)**

* `custom_puzzles.community_listed boolean not null default false` and
  `community_listed_at`. Every existing row starts unlisted, including Public
  puzzles and old link-only shares. Nothing is backfilled.
* CHECK `custom_puzzles_community_requires_public`: a private row can't be listed.
* `list_community_puzzles(_query, _sort, _limit, _offset)` (anon + authenticated).
  It re-checks eligibility on every read: listed, Public, `moderation_status = 'active'`,
  and still account-owned (`created_by is not null`, so anonymous puzzles and
  deleted accounts are excluded). Sorts are `newest` (first listing time; re-listing
  doesn't bump) and `plays`. The query is a literal substring of the title, the typed
  designer name or the profile display name, capped at 60 characters (`%`/`_` aren't
  wildcards). Each page returns at most 48 rows and the offset is capped at 2000. The
  payload carries card fields only: title, designer name, profile slug, mode, short
  code, finished plays, favorites and listed time. It never includes content, words,
  hints, the internal id, the long share id, `created_by` or any account field.
* `set_custom_puzzle_community_listing(_share_id, _listed)` (authenticated only).
  It sets the listing (no toggling), only for the signed-in creator (403 for anyone
  else). Listing requires Public and active; unlisting is always allowed for the owner.
  It never changes visibility, links or content.
* `get_my_custom_puzzle_listing(_share_id)` (authenticated only). It returns
  `{owned:false}` to everyone except the creator.
* `supabase/rainbow-owned-objects.json` / `RAINBOW-OWNED-OBJECTS.md` were
  regenerated from the disposable stack. The diff contains only the objects above.

**App (all behind the flag)**

* `src/pages/Community.tsx`: the real `GameHeader`/`AppHeader`, site cream canvas
  and dark tokens, Nunito Sans, "Community Puzzles", "Play puzzles made by other
  Rainbow players.", "Create A Puzzle" → `/create`, search (300 ms debounce, kept
  in `?q=`), Newest / Most Played (`?sort=plays`), loading skeleton, error + Retry,
  empty feed, no-matches + Clear search, "Show more puzzles" pagination, and
  `aria-busy`/live status. It uses a 3/2/1-column grid. The 4×4 motif beside the
  title is fixed and decorative (`aria-hidden`), never derived from a puzzle, and
  hidden below 360 px.
* `/create`: a **List in Community** checkbox, off by default on every puzzle and
  not saved in the draft. It's disabled for Private ("Private puzzles are never
  listed") and for guests ("Sign in to list…"). The success screen states the
  outcome. If listing fails, the puzzle still exists, unlisted.
* `/p/…` and `/custom/…`: an owner-only "Your puzzle in Community" card with
  List / Unlist. Nobody else sees it.
* Menu: a **Community Puzzles** row just before "Create a puzzle". All existing
  rows are unchanged. This branch does not touch PR #128 (which rewrites
  `AppMenuDrawer.tsx`); rebasing onto it means re-adding one destination there.

Guests can browse and play. Listing requires an account. No social feed or comments were added.

## Rollout gates (not met, so the flag stays off in production)

1. **A player report flow for custom puzzles.** Only the admin hide exists today. Until a report path, an admin queue for it, and a reviewed takedown time exist, `/community` should stay a private preview.
2. Review and apply `0004_community_listing.sql` to the intended database through the normal migration workflow, separately authorized. No migration was run on any shared or live database for this work.
3. A hosted preview that is both access-protected and backed by a fixture-only database, if one is wanted. This branch used only the local disposable stack below.

Rollback: unset the flag and redeploy, which hides everything. The migration is additive. Its columns and RPCs can stay in place unused, and dropping them needs its own reviewed down-migration.

## Reproduce locally (disposable stack only)

These need Docker, Node 22 and `npm ci`. Everything stays on loopback ports
54421–54424 and 5183, under the existing `e2e/safety.ts` guard. All data is
fictional.

```bash
npm run e2e:up
```

```bash
npm run e2e:reset
```

```bash
npm run e2e:seed:community
```

`e2e:seed:community` creates three fictional creators and these puzzles: *A Little
Offbeat*, *The Usual Suspects*, *Something In The Air*, *Pantry Raid* and *Turn Of
The Tides* (listed); *Link Only Lighthouse* (Public, link-only); *Private Parlour
Games* (Private); *Anonymous Airship* (made by a guest). The unlisted ones have the
**most** plays on purpose. Credentials and share codes are written to the
git-ignored `e2e/.artifacts/community-preview.json`.

Run the SQL rules (in-process Postgres, no Docker needed):

```bash
npm run e2e:db:community
```

Run the browser checks and regenerate the review screenshots. This builds with the flag into `dist-e2e-community` and serves it on 127.0.0.1:5183:

```bash
npm run e2e:community
```

The browser checks change data (they create two puzzles), so run `e2e:reset` and
`e2e:seed:community` again before repeating them. To look at the preview yourself
after seeding:

```bash
VITE_COMMUNITY_PUZZLES=preview npx vite build --mode e2e --outDir dist-e2e-community
```

```bash
npx vite preview --outDir dist-e2e-community --host 127.0.0.1 --port 5183 --strictPort
```

Then open `http://127.0.0.1:5183/community`. If this Playwright version's own
browser isn't installed, set `COMMUNITY_CHROMIUM` to a local Chromium binary.

## Verified

* `npm run e2e:db:community`: the migration leaves existing rows byte-identical
  and unlisted, so old public, private and anonymous links don't appear in Newest,
  Most Played or search. It also covers explicit opt-in, the card-only payload
  (no words, group names, ids or owner), private rows refused by both the RPC and
  the CHECK, nobody able to list anonymous puzzles, another account getting 403 on
  list and unlist, unlist removing a puzzle from every sort and search while both
  links still resolve, re-list keeping its first time, admin-hidden and
  deleted-account puzzles dropping out, literal and bounded search, real
  Most Played counts, pagination (48 max, offset cap, `has_more`), and grants
  (anon can browse but can't list or read the table).
* `npm run e2e:community` (8 checks, real app plus local GoTrue/PostgREST):
  * screenshots at 1280, 390 and 320 px, light and dark, with no sideways scroll
    and a single column on phones;
  * the menu row, with existing links intact;
  * keyboard: Tab from search to the sort buttons to the first card, and Enter
    changes the sort;
  * a guest sees only listed puzzles in every sort and search, and the feed
    payload is card-only;
  * error → Retry;
  * a guest finds *Pantry Raid*, plays it to the end, and the feed's play count
    goes from 7 to 8;
  * the creator unlists *The Usual Suspects*: it's gone from both sorts and search,
    a guest still plays it from `/p/…` and `/custom/…`, and the creator re-lists it;
  * another account sees no control and gets 403 from the RPC, and a guest is refused;
  * `/create`: the checkbox is off by default, disabled for Private and for guests,
    a Public unticked puzzle isn't listed, and a ticked one is listed at the top
    of Newest.
* The existing E2E suite with the flag off: 76/76. Unit tests: all files pass,
  including `src/test/communityPuzzles.test.tsx` (flag-off menu is exactly the
  existing links). Typecheck (app, social, e2e) and lint are clean. `e2e:db:verify`
  passes, and `db:manifest -- --check` passes after regeneration.

Screenshots are in `evidence/community-preview/`.

## Not verified

* Real phones (only Chromium viewports at 320, 390 and 1280 px), Safari/WebKit and
  Firefox, and screen-reader output beyond roles and names.
* The real shared WorkOS sign-in round trip. Tests use local GoTrue sessions, as
  the rest of the E2E suite does.
* Any hosted database, hosted preview or production behaviour. None was used.
* Feed performance at production volume. The query is indexed for Newest, but
  Most Played and search scan eligible rows (bounded by page size and offset, not
  by table size).
