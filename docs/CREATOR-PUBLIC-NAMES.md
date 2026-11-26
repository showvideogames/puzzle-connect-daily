# Rainbow creator public names
**Draft: no hosted database or deploy has been changed.**

Open **Account → Change Public Name** (also linked from the Friends & Groups
profile). It leads to the top of the signed-in My Puzzles page. Use a username
or your name. No email is used to infer this value, and two creators may
choose the same visible name. Their stable creator-page links remain distinct.

- The initial name is free. It can be picked here or by publishing the first
  signed-in puzzle. Legacy creator profiles count as existing names.
- The first actual rename is available immediately. Every actual rename starts
  a rolling 30-day (720-hour) wait. No-op saves never extend the wait.
- Community creator pages and newly published signed-in puzzles show the
  current public name. Existing puzzle credits are snapshots and are not
  rewritten. A guest's per-puzzle credit is unchanged.
- This is Rainbow's Community display name, not a login, friend name,
  cross-game profile field, or public slug.

Migration `0013_creator_public_name.sql` creates a private owner preference
and adds two own-account-only RPCs. The existing create RPC resolves the
byline server-side; old clients and stale drafts cannot bypass the cooldown
via the publish form. Apply the exact verified migration to the intended
environment before exposing the new frontend. Roll back the frontend first
if needed. The narrow emergency SQL in `supabase/ops/creator-name` restores
the old create RPC and disables the two new RPCs without deleting anyone's
chosen name or modifying any puzzle.

Local DB check: `node --experimental-strip-types e2e/scripts/verify-creator-public-name.ts`.
