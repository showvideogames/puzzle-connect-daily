# Abandoned migrations

Files here were **never applied to production** and are **not in use**. They are
kept for history rather than deleted.

The Supabase CLI only scans `supabase/migrations/`, so nothing in this
directory is executable: it is invisible to `supabase db push`,
`supabase db diff` and `supabase migration list`. That is the point — it is
what actually stops an abandoned migration from being treated as pending.

Marking such a migration as `reverted` in the remote migration history would
**not** have been enough on its own. `migration repair` only edits the history
table; it does not disable the local file, so a later `db push` could still
pick it up. Moving the file out is the part that makes it inert.

Do not move a file back without re-verifying that its objects genuinely do not
already exist in production.

---

## `20260413095812_...` — `puzzle_stats` table

Never applied, and nothing references it.

Verified on 2026-09-16 against the live project (`zmauemcjcrdrgfjzkvgd`,
"Rainbow Categories"), while repairing migration history ahead of the Task #6
durable-session migration:

- **Not in production.** Confirmed two independent ways: it is absent from
  the PostgREST schema (a direct `select` returns HTTP 404 / `PGRST205`,
  "Could not find the table 'public.puzzle_stats' in the schema cache"), and
  it does not appear in a direct-database table listing taken over the CLI's
  own Postgres connection, which does not go through the schema cache.
- **Zero application references.** No `.from("puzzle_stats")` anywhere in
  `src/` or `supabase/functions/`.
- **Not to be confused with** two similarly-named things that DO exist and
  are in active use:
  - `puzzle_aggregates` — the per-puzzle totals table the app actually writes
    (see `increment_puzzle_aggregate`);
  - `get_puzzle_stats(_puzzle_id)` — an RPC, read by `DailyStatsModal` and
    `Admin`, which reads `game_results` and has nothing to do with this table.

The only remaining trace is a stale `puzzle_stats` entry in the generated
`src/integrations/supabase/types.ts`, which is type debt from a generation run
that included the never-applied schema. Harmless (nothing consumes it), and it
will disappear the next time those types are regenerated from the live
database.

`puzzle_stat_submissions` sits in that same file for the same reason. It was
briefly described here as a real table; a direct-database listing shows it does
not exist either. Neither name should be treated as evidence that anything was
applied.

If per-puzzle mistake histograms are wanted later, build them from
`game_sessions` / `guess_events`, which now carry the real per-session data —
do not resurrect this table.
