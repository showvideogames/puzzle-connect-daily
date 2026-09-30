# Beta reset (Phase 2) — operator files

Nothing in this directory is scanned by the Supabase CLI. These files exist so
the one irreversible step of the launch plan is generated, rehearsed and
reviewed rather than typed.

| File | What it is |
|---|---|
| `extra-objects.json` | Rainbow objects that exist in the live shared project but in neither the launch manifest nor the beta-era inventory (created by hand, or production-only leftovers such as `increment_puzzle_aggregate`). Filled by the Phase 2 read-only comparison. Names with another tenant's prefix (`xw_`, `cv_`, `wtf_`) are refused by the generator. |
| `keep-auth-users.example.json` | The shape of the owner-supplied keep-list: the auth user ids that must survive (the other tenant's admin). The real file is passed on the command line and never committed. |
| `10_teardown.REHEARSAL.example.sql` | What the generator produces, with the example keep-list, ending in `ROLLBACK`. Regenerate with the real keep-list before use. |

```bash
npm run db:teardown-sql -- --keep-auth-users /path/to/keep-auth-users.json
#   -> supabase/ops/beta-reset/10_teardown.REHEARSAL.sql   (ROLLBACK at the end)
#   -> supabase/ops/beta-reset/10_teardown.sql             (COMMIT at the end)
npm run db:rehearse-reset          # the same generator, proven in process against decoy tenants
```

The full sequence, the pre-checks and the object-level preview are in
`docs/PHASE-2-HOSTED-CHANGE-PREVIEW.md`. Phase 2 needs its own explicit approval.
