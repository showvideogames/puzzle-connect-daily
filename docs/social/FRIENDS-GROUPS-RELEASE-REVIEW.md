# Friends & Groups release review — 2026-11-05

**Status: local candidate reviewed; hosted schema/permission verification blocked by missing configured credentials. Not approved or ready to deploy.** No hosted queries, migrations, data/permission changes, pushes, merges or deployments occurred during this review.

## Candidate and current main

- Branch: `codex/rainbow-profile-menu`. Feature head reviewed: `1d69128`; the commit containing this document adds the review fixes/evidence.
- GitHub Rainbow main rechecked through authenticated read-only API: `6ad00ba3a1e788114d605606a0ef518855e6989c`. It is still this branch's merge base; no main integration conflict or rebase is needed at the time of this check.
- PR #107 remains open/unmerged at `3a800a47a403b1fe906279958aada57e3e6f4ad2`; its results/Mini work is separate.
- CrossPuns main rechecked: `3763359c83ce68fc461b07274ef324caff4d2d68`. Relevant source migrations 0001, 0002, 0007, 0012, 0014 and 0015 have identical Git blob hashes to the reviewed `eb238dd` source. Main contains no migration after 0015. This verifies source compatibility, not the hosted migration state.

## Review findings

1. **Fixed:** friend activity could label a newly rolled-over day before fetching its results if an unrelated rerender occurred just after midnight. Rendering and reads now use the same local-date snapshot; a regression test covers rerender then focus refresh.
2. **Strengthened verification:** CrossPuns standings SQL now runs against verbatim source table definitions and the actual publication-date helper, rather than minimal table approximations. Fixture inserts were updated for real required names, puzzle metadata and solve columns. All source definitions were checked against recorded `eb238dd`; these are still disposable fixtures, not a full hosted auth/policy deployment.
3. **Migration compatibility:** all additive patches 0002–0009 apply and reapply over populated fixtures without changing existing memberships, personal solve history, legacy group responses or standings. The original hub regression also verifies ACLs, old response shapes, persistence and schema-scoped uninstall.
4. **Privacy/security review:** authenticated identity stays at the gateway; sensitive operations enforce membership/ownership in SQL. Standings compute common ranks before masking, returning no blocked identity/reference/score/puzzle fields. Ordinary result blocking and per-puzzle detail gates remain unchanged. Shared group roster inference is explicitly accepted by Deb. Nicknames/preferences remain viewer-private. Parameterized queries and plain React text rendering are retained. No unresolved code-level release blocker was found in the reviewed paths; this is not a claim of a comprehensive external security audit.
5. **Known limits retained:** PNG checks validate bounded structure, not CRC/decompression. Existing reusable invitation links survive permission revocation. CrossPuns source precedence preserves historical posted/imported times; it does not retroactively repair legacy records. These behaviors are documented, tested where applicable, and not silently changed.

## Verification

- Full app: **74 files / 1,908 assertions passed**, no reported unhandled error (`/tmp/rainbow-release-review-full.log`).
- Service extension tests: **34 passed**, including source constraints and whole-chain reapplication (`/tmp/rainbow-release-migrations.log`). Combined hub regressions: **76 passed**, no skips (`/tmp/rainbow-period-hub.log`). Total service coverage: **110**.
- App, strict portable-social and e2e TypeScript checks pass. Changed-file lint and build pass. Existing bundle-size notice remains.
- Browser reruns pass: actual Daily/secondary headers at 320/390/768/1440 light/dark; notification/profile/account flows; transparent crop/resizing; rolling activity with same-puzzle locks and LA/Auckland timezone contexts; all-time/7/30/365 standings with shared ties, both block directions and account switching. Synthetic fixtures only, external requests blocked. Relevant evidence captures refreshed.
- Source comparison and current-main reads were read-only. Original worktrees were not modified.

## Exact hosted verification blocker

Target from `supabase/config.toml`: **zmauemcjcrdrgfjzkvgd**. No `SUPABASE_ACCESS_TOKEN`, `DATABASE_URL` or `SUPABASE_DB_URL` is configured in this execution environment; the documented Supabase token files in the source/original CrossPuns repositories and the standard token path are absent. This is missing access, not an automatic approval rejection or evidence of a bad live schema.

`shared-service/review-target.mjs` is prepared and syntax-checked. It refuses to run without a token. With configured authorized access, it makes only static catalog SELECT requests using the Management API's `read_only: true`, saving columns, constraints, role flags, function owners/search paths/hashes/execute grants and source SELECT/RLS metadata. It never reads player/account rows or applies anything. The missing-token run exited before any network request; no target-schema evidence file exists yet.

Smallest next step: configure authorized Supabase management read access in the execution environment (never paste credentials into chat or commit them), or supply an authorized equivalent catalog connection. Then run and review the catalog evidence. Compare the live social baseline with the fixture and verify that the intended security-definer owner can read CrossPuns source tables under their actual RLS/ownership configuration. Check function ACLs and schema drift before any deployment decision.

## Proposed release sequence — not executed

1. Complete the catalog-only target review above. Resolve any ownership, ACL, baseline or source-column mismatch without applying these patches blindly.
2. Review/apply the shared-service patches in filename order, **0002 through 0009**, under separate release authorization. `release-patch-manifest.json` records SHA-256 hashes. They deliberately live outside Rainbow migrations; do not install the test baseline/fixtures in production.
3. Deploy the matching gateway/portable revision only after the SQL is available. Keep old three-argument all-time SQL intact; new gateway rolling reads require 0009. Portable files include the two standings calculation/projection helpers.
4. Release the Rainbow frontend and enable only verified feature flags: VITE_GROUP_PNG, VITE_SOCIAL_PREFERENCES, VITE_GROUP_ORDER, VITE_GROUP_DESCRIPTIONS, VITE_GROUP_OWNER_ACTIONS, VITE_GROUP_INVITE_PERMISSIONS, VITE_CROSSPUNS_STANDINGS. All default off. Preserve the existing shared-social setting; no other site is part of this release.
5. Verify the intended hosted flows under separately authorized test-account work. Local fixture success does not substitute for this.

Rollback strategy: disable new frontend flags/revert the frontend while retaining additive service compatibility and stored history. Do not drop preference/history tables, flatten PNGs or revert PNG MIME support after transparent pictures exist. Do not run the fixture uninstall against a hosted database. No destructive rollback is proposed.
