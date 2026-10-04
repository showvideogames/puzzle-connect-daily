# Beta-era migrations (frozen history)

Nothing in this directory is executable by the Supabase CLI: it only scans
`supabase/migrations/`, and that directory now holds the launch baseline
(`0001_rainbow_baseline.sql`, `0002_rainbow_storage.sql`) which supersedes
everything here.

These files are kept because they carry the **reasoning** behind the schema
(the migration comments are the design record), and because the beta reset
needs an exact picture of what they built.

| Item | What it is |
|---|---|
| `2026*.sql` (32 files) | The migration chain that built Rainbow's beta schema in the shared project, in order. Applied to production through 2026-09-29 (the last five may still be pending there; the Phase 2 read-only comparison settles that). |
| `pre-git/` | The three files that reconstruct the six tables and eight columns created in Lovable's editor and never written as migrations. The chain above does not apply to a blank database without them. |
| `proposed-migrations/` | Two held-back proposals from the beta era, plus the hand-applied cutover script. Superseded; kept for the record. |
| `beta-era-inventory.json`, `BETA-ERA-INVENTORY.md` | The catalog inventory of the schema this chain + `pre-git/` produce on a blank Postgres. Generated once on 2026-09-30. The scoped teardown (`npm run db:teardown-sql`) and the Phase 2 change preview are derived from the difference between this and `supabase/rainbow-owned-objects.json`. |

Do not move a file from here back into `supabase/migrations/`. To change the
schema from now on, add a new forward migration after the baseline.
