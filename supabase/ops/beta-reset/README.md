# Beta reset (Phase 2) — operator files

Nothing in this directory is scanned by the Supabase CLI. These files exist so
the one irreversible step of the launch plan is generated, rehearsed and
reviewed rather than typed.

| File | What it is |
|---|---|
| `extra-objects.json` | Rainbow objects that exist in the live shared project but in neither the launch manifest nor the beta-era inventory (created by hand, or production-only leftovers such as `increment_puzzle_aggregate`). Filled by the Phase 2 read-only comparison. Names with another tenant's prefix (`xw_`, `cv_`, `wtf_`) are refused by the generator. |
| `keep-auth-users.example.json` | The shape of the owner-supplied keep-list: the auth user ids that must survive (the other tenant's admin). The real file is passed on the command line and never committed. |
| `10_teardown.REHEARSAL.example.sql` | What the generator produces, with the example keep-list, ending in `ROLLBACK`. Regenerate with the real keep-list before use. |
| `hosted-evidence/` | What Phase 2 actually did to the hosted project on 2026-10-04: `before/` and `pre-apply/` inventories (schema, counts, auth ids, ledger, storage, classification, the local restore verification), `00_approved_policy_drops.sql` (owner-approved step 0), `10_teardown.APPLIED.sql`, `restore-plan.APPLIED.json`, and `after/` (inventory, hosted restore verification, before/after comparison, hosted smoke). |

```bash
npm run db:teardown-sql -- --keep-auth-users /path/to/keep-auth-users.json
#   -> supabase/ops/beta-reset/10_teardown.REHEARSAL.sql   (ROLLBACK at the end)
#   -> supabase/ops/beta-reset/10_teardown.sql             (COMMIT at the end)
npm run db:rehearse-reset          # the same generator, proven in process against decoy tenants
npm run db:teardown-sql -- --keep-auth-users <file> --live-inventory supabase/ops/beta-reset/hosted-evidence/<label>/inventory.json
#   also drops policies, triggers and foreign keys on Rainbow tables by their LIVE names (tables,
#   functions and types stay list-driven)
```

The hosted side (`npm run phase2:hosted`), the data salvage (`npm run phase2:restore`) and the
Staging-for-beta sign-in wiring (`npm run workos:hosted-beta`) are described in their script headers.

The full sequence, the pre-checks and the object-level preview are in
`docs/PHASE-2-HOSTED-CHANGE-PREVIEW.md`. Phase 2 needs its own explicit approval.
