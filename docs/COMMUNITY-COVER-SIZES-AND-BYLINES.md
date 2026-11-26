# Cover sizes, public names and creator bylines (preview)

**Draft: no hosted database or deploy has been changed.** Builds on the public
name in `docs/CREATOR-PUBLIC-NAMES.md` (migration `0013`, unchanged here).

## 1. Per-emoji cover sizes (`0014_cover_emoji_sizes.sql`)

* In Make A Cover (Create and My Puzzles → Add/Edit cover), each chosen
  emoji has its own **Size** slider: 50% to 250% of the standard size, in
  steps of 5, default 100%. It is a native range input, so mouse, touch and
  keyboard (arrows, Page Up/Down, Home/End) all work. Its name is
  "<Emoji> size" and screen readers hear "<n> percent". The preview updates
  as it moves.
* Sizes belong to their emoji: moving an emoji takes its size with it, and
  removing one removes its size. Neighbours keep theirs. Order and background
  are unchanged.
* The art crops its own emoji (`overflow: hidden` plus paint containment), so
  a large hero emoji never draws over a title, card or button. 250% fills a
  small thumbnail edge to edge and stays recognisable; 50% is clearly small
  but still legible on the smallest card.
* Stored additively as `custom_puzzles.cover_emoji_sizes smallint[]`, one per
  occupied slot, with a check constraint (same count as the emoji, each
  50-250). Null means standard; that is every existing cover, and any cover
  saved with all sizes at 100. Older covers look exactly as before.
* Set only through `set_custom_puzzle_cover_sized`, which runs every existing
  cover check first (owner from the Rainbow account, allowlisted distinct
  emoji, 1-3, preset background) and then the size bounds. The older setters
  still work and reset sizes to standard. `cover_sizes` is returned on every
  cover payload: Community cards (Newest, See all, search, creator shelf),
  the puzzle page, Favorites, cover cards and My Puzzles. Featured and
  Editor's Picks keep their editorial illustrations.
* Rollback: `supabase/ops/cover-sizes/rollback-0014.sql` (restores the earlier
  function bodies, drops the setter and the column).

## 2. Public name (`0013`, from PR #131, unchanged)

The Account / My Profile entry and the first signed-in puzzle fallback are
kept. Semantics, as checked by `npm run e2e:db:public-name` and the browser
smoke:

* The initial name has no wait. That's the first explicit choice, or the
  byline of the first signed-in puzzle (an older creator profile counts as
  that first choice).
* The first actual rename is immediate and starts a rolling 30-day
  (720-hour) wait. Saving the same name (spacing aside) never starts or
  resets it.
* Earlier puzzle bylines stay as saved; new puzzles use the current name.
  Creator URLs (slugs) never change. It isn't a sign-in or unique handle.

## 3. Creator bylines (`0015_listed_owner_creator_profile.sql`)

**Diagnosis.** A Community card links its byline whenever the card carries a
creator slug, and the slug comes only from `creator_profiles` for the
puzzle's owner (`created_by`). That row is created by `create_custom_puzzle`.
No app path reassigns `created_by`; older ownership transfers were done by
hand, so the new owner can have no creator profile. Their listed puzzle then
has no page to link to, and its byline renders as plain text. The renderer
is right; the profile is missing.

**Fix (bounded, owner-safe, no bulk rewrite, no name matching):**

* `custom_ensure_listed_owner_profile` (internal): for one account with no
  creator profile, and only if it owns a puzzle that is in Community, it
  creates the profile with a new stable slug. It is named with the account's
  chosen public name, else the given byline, else its newest listed puzzle's
  saved byline. It never renames or re-slugs an existing profile.
* It runs when an owner lists a puzzle, when they save a public name, and
  when they open My Puzzles (`ensure_my_creator_profile`, for the signed-in
  owner only).
* `admin_ensure_puzzle_creator_profile(short_code)`: admin only, one reported
  puzzle. It resolves that puzzle's actual owner and does the same. Use it for
  a reported live puzzle whose owner hasn't been back; nothing in this PR
  runs it against live data.
* Bylines link to `/creator/<slug>?view=community`, the creator's shelf of
  only their listed puzzles (older linked ones included). This applies on
  Community cards and now also on the puzzle header when Community is on.
  Guest and unlinked bylines stay plain text: no empty or dead links.
* Ownership, titles, bylines, visibility, contents and stats are untouched.
* Rollback: `supabase/ops/creator-profile/rollback-0015.sql`. Pages already
  created stay, since links may point to them.

## Release order

Apply `0013`, `0014` and `0015` to the intended environment first (the live
app never calls them), then merge. If `0003` is still unapplied in
production, apply them in the SQL editor and record them with
`npx supabase migration repair --status applied 0013 0014 0015 --linked`, as
in `docs/COMMUNITY-PUZZLES-RELEASE.md`.

## Checks (local, fictional data)

* `npm run e2e:db:sizes-creators` (PGlite):
  * 0014: additive; older covers read as standard; independent sizes on all
    seven cover payloads; bounds, shape, owner and guest refused; older
    setters reset sizes; exact rollback.
  * 0015: rewrites nobody; owner, listing, public-name and admin one-puzzle
    paths; only listed puzzles on the shelf; no page without a listing or for
    guest puzzles; exact rollback.
* `npm run e2e:db:public-name`: 0013 (now located by name, so later
  migrations don't shift it).
* `e2e/community/rainbow-followup.spec.ts` (local stack):
  * three independent sizes by keyboard and value, kept after a reload on My
    Puzzles, Newest, search and the puzzle page, clipped beside the title;
  * two sizes through Create;
  * the immediate rename and the 30-day wait, no-op unchanged, earlier
    bylines and the URL kept;
  * a reassigned legacy puzzle's plain byline that becomes a link to only the
    owner's listed puzzles.

## Known limitation

The creator page's second tab, **All puzzles**, is the pre-Community creator
page. It lists the creator's Public puzzles, including link-only ones (never
Private). Bylines don't open it; they open **In Community**. Whether to
retire that tab is a separate product decision.
