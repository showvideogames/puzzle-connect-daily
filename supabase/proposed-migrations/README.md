# Proposed (not-yet-applied) migrations

Files here are **not** executable Supabase migrations. The Supabase CLI only
scans `supabase/migrations/` — anything in this directory is invisible to
`supabase db push`, `supabase db diff`, and `supabase migration list`. That is
intentional: it is the mechanism that keeps a proposed schema change from
being silently applied by a future, unrelated `supabase db push`.

Treat a file here as a **reviewed, ready-to-apply SQL proposal** that is
deliberately being held back — usually because it's broader than currently
safe (e.g. it would need to be scoped once `entry_context`/puzzle-type work
lands), or because it needs a manual pre-check against live data first. Each
file explains its own hold reason and promotion criteria at the top.

**To apply one:** read its header for the current hold reason and any
required pre-checks, confirm those conditions are now met, then move it into
`supabase/migrations/` with a fresh timestamp prefix (so it sorts after
whatever has landed since) and apply it the normal way (`supabase db push`,
or paste directly into the Supabase SQL editor). Do not move a file back
without re-reading it — the reasoning that parked it may no longer be
accurate, but that has to be re-verified, not assumed.
