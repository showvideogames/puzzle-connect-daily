# My Puzzles (owner library)

`/my-puzzles` lists the signed-in creator's own custom puzzles, so they never
need to keep a share link to find or manage one. Nothing here edits a puzzle's
words or categories.

## What it shows

* Every puzzle the account made, newest first: older ones from before covers
  and Community (never listed, no cover), Public link-only, listed, Private,
  and any hidden by moderators. Puzzles made while signed out belong to no
  account and never appear. Another account's puzzles never appear.
* Per puzzle: cover (or the standard cover), title, a short status (In
  Community, Link only, Private, Hidden), Classic/Rainbow, the date it was
  made, and one line saying who can play it and whether it can be listed.
* Actions, all through calls that already exist:
  * **Open** (`/p/<code>`) and **Copy Link** (the same short share link);
  * **Add a cover / Edit cover**: the existing picker and
    `set_custom_puzzle_cover_emojis`;
  * **List in Community / Unlist from Community**: the existing
    `set_custom_puzzle_community_listing`, only for Public, active puzzles.
    Private and hidden puzzles say why they can't be listed. Opening the page
    never lists, publishes or changes anything.
* Hidden puzzles show their status only (their link doesn't open).
* Empty state points to Create A Puzzle. Favorites stay on their own page.
* Covers and listing need Community on; with `VITE_COMMUNITY_PUZZLES=off` the
  page still lists, opens and copies links.

## Ways in

* The account area of Settings ("Settings and menu" → **My Puzzles**, beside
  Edit Profile and Account) for every signed-in player.
* With the Friends & Groups beta: the header profile menu (**My puzzles**,
  under My profile) and a **My Puzzles** link on the My profile screen.
* The signed-in Account dropdown (**My puzzles**).
* Create A Puzzle: a **My Puzzles** link in its title bar, and "It's saved in
  My Puzzles" on the success screen (signed in only).

## Database

One additive migration, `supabase/migrations/0011_my_custom_puzzles.sql`
(not applied to any hosted database):

* `list_my_custom_puzzles(_limit, _offset)`: owner from `rainbow_uid()` on the
  server (no user id parameter); `authenticated` only, refused for anon and for
  a session without a Rainbow account; at most 48 rows per page, offset at most
  10000; newest first, short code breaking ties. Library fields only: share
  codes (for Open, Copy Link and the existing owner calls), title, the
  designer name the owner typed (the cover preview's byline), mode,
  visibility, hidden/listed/listable, cover keys, created time. Never content,
  answers, the internal id, `created_by` or account fields.
* One index, `custom_puzzles_owner_newest_idx`.
* Rollback: `supabase/ops/my-puzzles/rollback-0011.sql` (drops the function
  and index; no data touched), then
  `npx supabase migration repair --status reverted 0011 --linked`.

Release order: apply `0011` first (the live app never calls it), then merge.
If `0003` is still unapplied in production, apply `0011` alone in the SQL
editor and record it with
`npx supabase migration repair --status applied 0011 --linked`, as in
`docs/COMMUNITY-PUZZLES-RELEASE.md`.

## Checks (local, fictional data)

* `npm run e2e:db:my-puzzles`: additive and reversible; owner-only (another
  account, a fresh account, a guest, an auth-only session and the anon role
  get nothing); older/no-cover, link-only, listed, Private and hidden own
  puzzles, never guest-made ones; newest first; library fields only; bounded,
  deterministic paging; reading changes nothing.
* `e2e/community/my-puzzles.spec.ts` on the local stack: guest prompt and
  server refusal; owner from Settings and the Account menu; the older music
  puzzle gets a cover, is listed (appears in Community) and unlisted (link
  still plays); Copy Link and Open; a second account sees only its own and
  can't change Wren's; empty state → Create; a puzzle made in Create appears
  first, not listed. Phone (390) and desktop (1280).
* `src/test/myPuzzles.test.tsx`, `socialHeaderMenu.test.tsx`,
  `socialControls.test.tsx`: every way in, and defensive reading of rows.
