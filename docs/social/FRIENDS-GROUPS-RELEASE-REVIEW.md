# Friends & Groups release review — 2026-11-05

**Status: local candidate reviewed; hosted catalog/schema/permission checks completed through the existing authorized dashboard session. Release still requires separate authorization and hosted flow verification.** Only catalog SELECTs were run. No migrations, application-data/permission changes, pushes, merges or deployments occurred.

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

## Hosted verification — completed

The existing signed-in Chrome dashboard provided authorized access to the confirmed project **zmauemcjcrdrgfjzkvgd**. A separate SQL-editor snippet was used for catalog-only SELECTs; the existing score-repair query was left untouched. No credentials were extracted. The dashboard created a query snippet as part of its normal editor behavior; no application rows, migrations, settings or permissions were changed.

See `evidence/target-schema-review.md` for the observed results and exact comparison fingerprints. Shared columns/defaults/nullability, 56 non-NOT-NULL constraints and execution rights for the five boundary roles match the disposable baseline. All 13 shared tables are postgres-owned with RLS and owner-only table ACLs. All 34 security-definer functions use `social, pg_temp`; all 74 functions are postgres-owned. Anonymous, authenticated and service_role have no function execute grants; social_gateway has 32 and social_game_server has two, matching the baseline function-by-function.

The source columns needed for standings exist. The intended postgres definer owns and can SELECT all four CrossPuns source tables, has BYPASSRLS, and those tables do not force RLS. This supports the planned read contract without any new hosted grants. Both social service roles remain NOLOGIN and postgres has membership in them.

Function source/signature/return/security/search-path fingerprints match for 73 functions. The sole source-text difference is `social.trimmed`: hosted SQL uses Unicode escapes for the same whitespace code points that the fixture includes literally. Its displayed body is the same btrim/coalesce operation; preserve the live helper. The two existing functions replaced by the PNG patch match exactly. Source-text hashes are drift checks, not cryptographic security attestations or runtime flow tests.

Command-line management credentials remain absent; that is no longer a blocker to this catalog review. `shared-service/review-target.mjs` remains available for future authorized API evidence collection, but was not used against the host. No API JSON report is claimed. New feature functions/tables are not installed; release remains a separate action.

## Proposed release sequence — not executed

1. Review the completed catalog evidence above. Recheck it if the hosted baseline changes before release; preserve the live Unicode-escaped trimming helper.
2. Review/apply the shared-service patches in filename order, **0002 through 0009**, under separate release authorization. `release-patch-manifest.json` records SHA-256 hashes. They deliberately live outside Rainbow migrations; do not install the test baseline/fixtures in production.
3. Deploy the matching gateway/portable revision only after the SQL is available. Keep old three-argument all-time SQL intact; new gateway rolling reads require 0009. Portable files include the two standings calculation/projection helpers.
4. Release the Rainbow frontend and enable only verified feature flags: VITE_GROUP_PNG, VITE_SOCIAL_PREFERENCES, VITE_GROUP_ORDER, VITE_GROUP_DESCRIPTIONS, VITE_GROUP_OWNER_ACTIONS, VITE_GROUP_INVITE_PERMISSIONS, VITE_CROSSPUNS_STANDINGS. All default off. Preserve the existing shared-social setting; no other site is part of this release.
5. Verify the intended hosted flows under separately authorized test-account work. Local fixture success does not substitute for this.

Rollback strategy: disable new frontend flags/revert the frontend while retaining additive service compatibility and stored history. Do not drop preference/history tables, flatten PNGs or revert PNG MIME support after transparent pictures exist. Do not run the fixture uninstall against a hosted database. No destructive rollback is proposed.
