# Mini results integration — local candidate, 2026-11-06

This is a local, unapplied candidate. No hosted database, gateway, PR, deployment or production record was changed. Baseline: GitHub main ed3cc9e4c4889651b50c537f82e621d4e3e1b04c; UI source: PR #107 at 3a800a47a403b1fe906279958aada57e3e6f4ad2. The uncommitted Mini service delta from feat/mini-results-service was applied onto current main, not released from its stale 6ad00ba base.

## Scope and compatibility

The SocialPage conflict preserves both dynamic profile-edit and Add friend navigation intents, consuming route state after either. SocialScreens responds to later Add friend intents on an already-mounted page. The socialView conflict preserves main's exported resultFor and adds positive safe-integer seconds mapping. Main's nicknames, favorites, group ordering, current names, profile editing, pagination, privacy/block checks and stale-read protections remain in place.

The results reader publishes group metadata before slow friend results complete. Missing Mini self results trigger at most four automatic retries after the initial successful read, then offer manual Refresh results. Each reader has at most one request in flight; close/unmount or account/puzzle changes discard late answers and cancel scheduled retries. Groups remain available without a self row. A read error is an error, never an empty ranking. No missing time is fabricated. Full uses mistakes, Mini uses stored positive integer seconds, untimed solved rows follow timed rows, completed losses follow solves, and self stays at its actual rank.

No timer completion rule, stored-time calculation, game save, stats or streak behavior changes. The service forwards only a valid existing Mini timer value; optional absent seconds remains legal. Existing result cards remain immutable on replay (ON CONFLICT DO NOTHING); missing old times are not backfilled. The SQL eligibility window is relative to the puzzle date, so an eligible historical completion can be lazily recorded when queried; this is not a promise that only today's records can be created.

## Minimal release order (requires separate publication authorization)

1. Coordinate the optional Rainbow seconds contract with the canonical shared-social/CrossPuns owner. Update its canonical contract/conformance copies before advertising a new revision. This repository's portable contract and in-memory adapter are updated locally only; no other repository was changed and no shared revision is declared published.
2. Read the actual target function definition, identity, owner/ACL and gateway bundle; compare with this reviewed predecessor. Capture those exact immediate predecessors privately. Verify current Friends operations are present. If drift exists, reconcile and rehearse again; do not use a stale snapshot as a rollback.
3. Apply only shared-service/patches/0011_rainbow_mini_seconds.sql in its transaction. It replaces social.result_fits(text,jsonb,jsonb), allowing optional Rainbow summary.seconds only when social.is_count and >=1. No table alteration, deletes, backfill, grant or credential change. Do not replay earlier patches just because they appear in the manifest. Verify previous summary shapes, optional seconds validation, existing card counts and detail isolation against controlled release fixtures.
4. Release the integrated CURRENT-main social-gateway core/index bundle. Preserve the newer Friends preference, group order, owner/invite and paging operations. Never deploy the old feat/mini-results-service bundle. Verify both existing Full and new Mini recording using controlled accounts and separately authorized hosted checks.
5. Release the integrated UI after backend verification. Verify Full/Mini pinned puzzle ids, ranking and delay recovery, and newer Friends features. The UI can safely show pending results if a service save is delayed.

## Rollback

Roll back the UI independently to its captured immediate predecessor if needed. Stop new Mini recording by restoring only the reviewed Mini delta in the current gateway, or the exact immediate pre-release gateway bundle captured in step 2. Both choices MUST preserve the newer live Friends operations. Never restore 6ad00ba's gateway or the approval packet's stale bundle.

Normally leave the additive validator in place while diagnosing: it is backward compatible and avoids rejecting legitimate optional seconds. If reverting it is necessary, first stop Mini writes, then restore the exact target predecessor function in a transaction. shared-service/rollback/0011_rainbow_mini_seconds.sql is the rehearsed current-main fixture predecessor, not proof of the deployed definition. Use it only after exact comparison to the captured target predecessor. Keep every existing result card, including cards containing seconds; do not delete, rewrite, zero or backfill them. Recheck Full, CrossPuns, privacy, blocks and Friends operations after rollback.

## Verification and visual decisions

The isolated PGlite suite applies the current-main baseline and patches 0002–0010 before the exact 0011 patch. It exercises rollback/reapply, unchanged function OID/security/search path/ACL, retained cards and private preferences, invalid time rejection, replay immutability, Full/Mini detail isolation, blocking, and the actual completion query against baseline tables. It does not establish the state of a hosted database or authenticate a deployed gateway.

Both supplied Library images were opened locally. They already show the settled ranking rules: Full Riley/Alex/Priya/loss; Mini timed Riley/Alex, untimed Priya, then loss. The candidate preserves that layout, highlighted ranked self, wrapped Mini metrics and square Up next cards. No settled-state design change was introduced by integration. The new absent-result status and Refresh results control replace the old all-or-nothing Mini fallback. Pending rows omit self rather than inventing a time. Phone light/dark and desktop light/dark were inspected in a secret-free local fixture using actual components. Captures have a synthetic background, browser focus/scale and gradient animation differences; they are not pixel-identical production screenshots.

The reference Library identities remain libfile_ec15346dbf4081918fcdb10b3b4c199d (image(20261106-065052).png) and libfile_47cdabffacd08191907c851d41c2f268 (image(20261106-065055).png). Nothing was uploaded or published.
