# My Puzzles (owner library)

`/my-puzzles` lists the signed-in creator's own custom puzzles, so they never
need to keep a share link to find or manage one. A saved puzzle's words and
categories are never edited in place: **Rename** changes the title only, and
**Duplicate & Edit** opens a new draft to change and create as a new puzzle.

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
  * **Rename** (any active puzzle): title only, with create's rule (trimmed,
    1-100 characters). Same row, share id and short code, so the link,
    results, stats, favourites, ratings, cover, visibility and listing all
    stay as they were.
  * **Duplicate & Edit** (any active puzzle): reads the owner's own content
    (`get_my_custom_puzzle_source`), runs it through the builder's existing
    loader (categories, words, hints, emoji, starting board order and the
    Rainbow words in their own order) and saves it at once as a new draft in
    its own slot, then opens Create at `/create?draft=<slot>`. The title is
    "Copy of …"; a Private puzzle's copy stays Private; List in Community
    stays off until the creator ticks it. Nothing is published, and the copy
    has no link or stats, until Create Game. The source isn't changed.
* **Drafts:** the main Create draft keeps its own key; each copy has its own
  key (`rainbow-creator-draft-v1:copy:<slot>`) and Web Lock, so duplicating
  never overwrites an unrelated draft and each is recoverable on its own,
  even after an immediate reload. My Puzzles lists "Unsaved copies in this
  browser" (Resume, Discard), and the main Create page names them too.
  Creating a copy removes only that copy's slot.
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

A second additive migration, `supabase/migrations/0012_my_puzzles_rename_and_copy.sql`
(not applied anywhere):

* `rename_custom_puzzle(_share_id, _title)`: owner from `rainbow_uid()`;
  refused for guests, sessions without a Rainbow account, other accounts and
  hidden puzzles; updates `title` only.
* `get_my_custom_puzzle_source(_share_id)`: the owner's own active puzzle's
  title, designer name, visibility and content; refused for everyone else.
  Read-only.
* Both `authenticated` only. The table comment now says the title can be
  renamed by its creator (content stays immutable).
* Rollback: `supabase/ops/my-puzzles/rollback-0012.sql` (renamed titles stay
  renamed), then `npx supabase migration repair --status reverted 0012 --linked`.

Release order: apply `0011` and `0012` first (the live app never calls it), then merge.
If `0003` is still unapplied in production, apply `0011` and `0012` alone in the SQL
editor and record it with
`npx supabase migration repair --status applied 0011 0012 --linked`, as in
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
* `npm run e2e:db:my-puzzles-rename-copy`: rename is owner-only and changes
  the title only (same id, links, content, visibility, listing, cover,
  results, stats, favourites, ratings); create's title rule; the source read
  is owner-only, keeps the board and Rainbow orders and changes nothing;
  rollback is exact.
* `e2e/community/my-puzzles-rename-copy.spec.ts`: rename keeps the same link,
  results and listing, and another account and guests are refused; an
  unrelated partial draft is saved and its tab closed, a copy is duplicated
  and the page reloaded at once with no edits, and both drafts are
  recovered; the created copy is a new, unlisted puzzle with no results
  while the source is untouched; a Private source's copy stays Private;
  nobody else can read a puzzle's builder content.
* `src/test/myPuzzlesCopy.test.ts`: the copy mapping and the separate slots.
* `src/test/myPuzzles.test.tsx`, `socialHeaderMenu.test.tsx`,
  `socialControls.test.tsx`: every way in, and defensive reading of rows.
