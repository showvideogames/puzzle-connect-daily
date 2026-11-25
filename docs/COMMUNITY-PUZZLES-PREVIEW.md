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

## Part 2: creators, Follow, Following, Favorites (add-on)

This is a separate commit on top of the base preview, with its own migration
`0005_community_follows.sql`. It is still behind `VITE_COMMUNITY_PUZZLES=preview`
and has not been applied to any hosted database.

**Reused, not duplicated**

* **Identity:** `creator_profiles` (public name and slug). There are no new accounts,
  profiles or stored avatars. Rainbow stores no profile pictures
  (`lib/sharedProfile.ts` only describes the shared format), so the avatar is a
  monogram of the public name on one of the approved `PROFILE_COLORS`, chosen
  from the slug (`lib/creatorAvatar.ts`).
* **Saves:** bookmarks are the existing Favorites. Signed in, they use
  `set_custom_puzzle_favorite` / `get_my_favorites`; as a guest, this browser's
  `custom-favorite:<shareId>` flags. A save made in Community shows on the
  puzzle page's Favorite button and on `/favorites`, and the other way round. As
  before, a guest's device saves aren't merged into an account on sign-in.
* **Creator page:** `/creator/:slug` with no `?view` is still the historical
  landing (every Public puzzle, totals, sorts, `get_creator_profile` unchanged).
  With the flag on it gains the avatar, public name, aggregate follower count,
  Follow, and an **In Community** view (`?view=community`) listing only opted-in
  puzzles. Community bylines link there. With the flag off, the page is exactly
  as before.

**New server pieces (`0005`)**

* `creator_follows(follower_id, creator_id)`: one-way, no self-follows, removed
  when either account is deleted. No client can read the table. A follower reads
  only their own follows through `get_following_feed`; everyone else sees an
  aggregate count.
* `search_community_creators(q)`: only creators with at least one puzzle in
  Community now, matched on public name or slug (a literal substring, no special
  syntax, titles not matched). It is bounded like the puzzle feed.
* `get_creator_community(slug)`: identity, counts, the caller's follow state and
  only listed puzzles.
* `set_creator_follow(slug, follow)`: account only, set rather than toggled.
  Starting a follow needs a creator with a puzzle in Community; unfollowing is
  always allowed.
* `get_following_feed()`: the caller's follows and those creators' puzzles in
  Community, newest listing first.
* `get_custom_puzzle_cards(share_ids)` and `custom_puzzle_share_id(short_code)`:
  card lookups, so the existing saves can be shown and set from cards. They
  return nothing the caller can't already get from the existing
  `get_custom_puzzle*` calls for ids they hold. The feeds still never include
  share ids.
* Every read re-checks 0004's rule (listed, Public, active, account-owned), so
  unlisting, an admin hide or a deleted account removes a puzzle from Explore,
  Creators search and Following immediately. Its direct links and anyone's saved
  copy stay valid. Following never lists anything by itself; old puzzles stay
  unlisted.

**UI.** `/community` has **Explore / Following / Favorites** tabs (`?tab=`). Explore
has a **Puzzles / Creators** switch (`?mode=creators`), search, and Newest (the
default) / Most Played. Cards have the bookmark at the top right and a violet
linked byline (the approved archive design's link colour; `violet-300` in dark
mode). Phones get a single column. Following shows who you follow (private to you)
and their newest puzzles. Favorites says it's private, and for guests that it's
device-only. Guests can still explore, search and play; Follow explains that it
needs sign-in.

**No unplayed filter.** Custom-puzzle results are recorded per browser device,
only for completed games, as best-effort writes, and aren't linked to accounts.
That isn't reliable enough to tell a player what they haven't played, so the
filter isn't offered.

Out of scope, as asked: email, comments, DMs, notifications, follower lists,
public player records and spoilers.

Reproduce part 2 the same way as below. `npm run e2e:db:follows` runs its SQL rules
in-process, and `npm run e2e:community` now runs both browser specs (12 checks).
Part 2's screenshots are in `evidence/community-preview-2/`; the base set in
`evidence/community-preview/` is unchanged. Part 3's are in `evidence/community-preview-3/`.

## Part 3: Explore visual overhaul and curation (add-on)

This is a third commit with its own migration, `0006_community_curation.sql`. It
is still behind `VITE_COMMUNITY_PUZZLES=preview`, not applied to any hosted
database, and its visual direction is the approved "B / Arcade Shelf" with a
compact Featured Puzzle taken from "A".

**Explore, phone first**

* **Header:** a compact header with the app's menu drawer, the real stacked
  Rainbow Categories wordmark (`public/rainbow-categories-logo-stacked-480.webp`,
  a 37 KB copy of the existing 221 KB file) and a search button. Below it sit the
  Explore / Following / Favorites tabs, with a violet underline on the current one.
* **Look:** a true-white page in light mode (the game pages' existing
  `layout-refresh` theme), violet headings, links and Play buttons, and the
  existing dark tokens in dark mode.
* **Featured Puzzle:** one, compact, chosen by an admin. It appears only when
  one is set and eligible, with no empty shell, and makes no daily promise.
* **Editor's Picks:** up to six, in the admin's order, shown as two equal columns
  on phones from 360 px (one column below that), and never repeating the
  Featured Puzzle.
* **Newest:** every listed puzzle by its *first* Community listing time, newest
  first. It's independent of curation and popularity, includes new listings
  whether or not they are curated, and never bumps a puzzle back up on re-list.
  "See all" opens `?view=newest`, which is keyset-paged so listing changes
  between pages never repeat or skip a puzzle. Search moved to `?view=search`;
  old `?q=`, `?mode=creators` and `?sort=plays` links still open it.
* **Cards:** a cover, the title, a visible linked creator credit, an accessible
  bookmark (the existing Favorites) and a Play button on each. Zero counts and
  extra boxes are gone; a play count shows only when it's above zero. Create
  is a small "+ Create A Puzzle" link.

**Covers.** `components/community/PuzzleCover.tsx` holds eight flat SVG scenes,
each built around a Rainbow tile cluster, with three palettes each (24 looks,
a few KB in total). A puzzle's cover is picked from its public short code only
(`lib/puzzleCovers.ts`), never its title or content, so covers can't hint at
solutions, the same puzzle looks the same everywhere, and nobody draws or uploads
art. Covers are decorative (`aria-hidden`, no text). A small shelf can still
occasionally show the same look twice.

**Curation (admin only).** The page is `/admin/community` (flag-gated, `noIndex`).
It uses the existing `useAuth` admin check and `AdminLogin` / `AdminNoAccess`
screens, and the server checks `has_role(rainbow_uid(), 'admin')` like
`admin_set_custom_puzzle_status`. The admin picks one Featured Puzzle and up to six
ordered Picks, can reorder, replace and remove them, and saves the whole set at
once. Only puzzles listed in Community can be chosen. The page shows any curated
entry Explore is hiding, and why ("unlisted by its creator", "hidden by
moderation", …). There's no automatic or popularity-based selection, and no
reporting in this pass.

**Server (`0006`)**

* `community_curation`: one row per puzzle, so the Featured Puzzle can't also be
  a Pick. At most one Featured and Pick positions 0 to 5. RLS is on and no client
  can read the table.
* `get_community_explore()` (public) re-checks 0004's eligibility on every read,
  so an unlisted, hidden or account-deleted puzzle vanishes from Featured and
  Picks while its curation row waits. Re-listing brings it back where the admin
  left it.
* `list_community_newest(limit, before_listed_at, before_short_code)` (public)
  is ordered by `(community_listed_at desc, short_code)`.
* `admin_get_community_curation()` and `admin_set_community_curation(featured,
  picks)` are admin only. The set call validates and replaces the whole curation
  under an advisory lock.

Untouched: share links, creator search, Follow and Following, unlisting,
private saves, and the creator page.

## Part 4: creator covers and release

Creators can add an optional cover: exactly one emoji (1,898 standard Unicode
emoji from the pinned `emojibase-data@16.0.3`, normal skin tone, flags and
single composite sequences; only the 8 Emoji 16.0 additions are left out for
rendering support) on one of 24 preset backgrounds. It's stored as two keys and
validated by the server (`0008_community_covers.sql`). It shows on every
browsing card and on the puzzle page; Featured and Editor's Picks keep their
illustrated art. Community is now on by default, with `VITE_COMMUNITY_PUZZLES=off`
as the kill switch. The release order and rollback are in
`docs/COMMUNITY-PUZZLES-RELEASE.md`.

## Rollout gates (not met, so the flag stays off in production)

1. **A player report flow for custom puzzles (and creators).** Only the admin hide exists today. Until a report path, an admin queue for it, and a reviewed takedown time exist, `/community` should stay a private preview.
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
* `npm run e2e:db:follows` (part 2): 0005 changes no listing state. Creator search
  needs a puzzle in Community now (a creator with only an unlisted Public puzzle
  is excluded) and matches name or slug but not titles. Follow is account-only and
  can't target yourself, a creator with nothing listed, or an unknown slug. Only
  aggregate follower counts reach anyone but the follower. Following is
  newest-first and shows only listed puzzles: never old, private or unlisted ones,
  and a newly listed puzzle appears at the top. Unlist and admin hide remove a
  puzzle from Following, Explore and the creator view, while its links and the
  account's saved copy survive. Unlisting everything removes the creator from
  search, and unfollowing still works. Guest card lookups keep order, include
  link-only and private ids the guest holds, exclude hidden ones and are capped at
  200. Account deletion removes follows, and grants are checked.
* `npm run e2e:community` (12 checks; the first 8 are described here, the 4 part-2
  checks follow this list), real app plus local GoTrue/PostgREST:
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
* Part 2 in the browser:
  * guest: the tabs, Newest as the default, violet bylines linking to
    `/creator/…?view=community`, and the bookmark at the top right (44 px);
  * Creators search excludes Quin (only an unlisted puzzle), doesn't match titles,
    matches a bare slug suffix, and a guest Follow shows "Sign in";
  * the creator page's Community view lists only opted-in puzzles, and the
    historical All puzzles view still lists the link-only one;
  * a guest saves a legacy `/custom/<shareId>` link-only puzzle with the existing
    Favorite button and bookmarks a card; both appear in Favorites, the puzzle
    page agrees, the save survives reload, and another browser has none;
  * signed in, Pia finds Wren in Creators and follows them. Following matches
    Wren's Newest order. Wren creates a new puzzle with List in Community ticked:
    it tops Pia's Following, while one created without the opt-in never appears.
    Wren unlists Pantry Raid: it leaves Following, Explore and Wren's count, but
    stays in Pia's Favorites and its link plays. Odie sees "1 follower" and no
    names, Wren sees no Follow on their own page, and Pia unfollows;
  * dark mode, keyboard focus moving from card title to bookmark, and 320/390 px
    with no sideways scroll.
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
* No hosted preview exists for part 2 either. No access-protected, fixture-only hosted
  environment is available, so nothing was hosted; the local stack above is the
  reproducible preview.
* At volume, creator search and the Following feed are bounded per page but not
  separately indexed for name search.

## Verified in part 3

These are the focused checks you asked for, all on fictional fixtures against
the disposable stack:

* `npm run e2e:db:curation`:
  * 0006 is additive and admin only (guests and creators get 403);
  * validation covers only listed puzzles, no duplicates, the Featured Puzzle
    not also a Pick, and at most six Picks;
  * reads re-check eligibility: unlisting or hiding removes the entry with no
    empty shell, and re-listing restores it;
  * replace and remove work;
  * Newest follows first listing time regardless of curation, a newly listed
    puzzle comes first, and re-listing doesn't bump;
  * keyset pages match one big page at sizes 1, 2 and 4 and stay stable across
    an insert or an unlist between pages, with ties broken by short code;
  * grants are checked.
* `npm run e2e:community -- explore.spec.ts` (5 browser checks):
  * at 390 px: the real wordmark, a white background, three tabs, one compact
    Featured Puzzle, Picks in admin order in two equal columns, a credit,
    bookmark and Play on every card, no zero counts, covers with no text,
    "See all", and a small Create link;
  * keyboard order from the tabs into Featured (title, credit, Play, bookmark)
    with a visible focus ring;
  * 320 px with a single column and no sideways scroll, plus desktop and dark
    mode;
  * a guest plays from Featured and solves a category, then saves a Pick. The
    Newest row and the Favorites tab agree, and the puzzle page shows it
    Favorited;
  * Newest matches the server, a never-curated new listing comes first, the
    Featured Puzzle also appears in Newest, re-listing doesn't bump, and
    See all lists the same order;
  * curation: the admin page and RPC refuse a guest and a creator. Unlisting
    the Featured Puzzle and a Pick removes them with no empty Featured shell,
    and the link still plays. The admin sees why, replaces Featured, reorders,
    removes, and saves; Explore follows with no duplicate. Re-listing doesn't
    bring back removed curation, and with no curation Newest leads.
* `npm run e2e:community:flagoff`: a build without the flag returns 404 for
  `/community`, `?view=newest` and `/admin/community`. The menu has no
  Community row, `/p/` and `/custom/` links play with no owner control, the
  creator page is historical (totals, no Follow, avatar or Community view), and
  `/create` has no List in Community.
* The part 1 and 2 browser specs were updated for the new layout (search moved
  to `?view=search`) and re-run once to confirm that share links, creator
  search, Follow and Following, unlisting and private saves are preserved: 12/12.
  Their screenshots now go to the git-ignored `e2e/.artifacts/legacy-shots`, so
  the committed part 1 and 2 evidence is untouched. The 76-test main E2E suite
  was not re-run this pass (focused checks only); the flag-off check covers it.

Unit tests pass (all files, including the new `communityExplore.test.tsx`).
Typecheck is clean, lint shows nothing new, `e2e:db:verify` passes, and the
manifest was regenerated and checked.
