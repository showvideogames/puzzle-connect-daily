# Current continuation status — 2026-11-05

Branch: `codex/rainbow-profile-menu`. The historical sections below describe earlier stages; the integrated menu and crop editor are already saved through `3b5cc7f`. The PNG slice is saved at `a17a96c`, with the production feature flag off and its shared-service patch unapplied. Clubhouse member management is now implemented and verified locally; see the final section for exact files and next steps. No push, merge or deployment.

# Rainbow Friends & Groups checkpoint — 2026-11-05

## Exact state
- Workspace: /Users/westbookair/Documents/Codex/2026-11-05/task/rainbow
- Branch: codex/rainbow-profile-menu
- Base: 6ad00ba3a1e788114d605606a0ef518855e6989c (current GitHub main, fetched this session).
- Isolated clone; original worktrees and their uncommitted files untouched. No push, PR, merge, deployment, or live service mutation.
- PR #107 independently rechecked: OPEN, unmerged, head 3a800a47a403b1fe906279958aada57e3e6f4ad2, feat/results-screen-friends. Do not incorporate that work implicitly.

## Saved slice
- src/components/account/ProfileMenu.tsx: reusable, presentational Radix menu with existing ProfileAvatar assets. One 44px top-right avatar trigger; yellow pending indicator; accessible notification count; My profile, Friends & Groups, Account options callbacks. Unknown counts do not imply zero notifications. Large counts display 99+ with the full accessible count.
- demo/profile-menu/{index.html,main.tsx,vite.config.ts,check.mjs}: isolated synthetic visual preview and repeatable browser check. It imports no account/service code. Navigation callbacks report the selected action only.
- evidence/menu-{320,390,1440}-{light,dark}.png: six local browser captures.
- This component is NOT wired into production headers yet. It does not replace PlayerAuth or change social data behavior. This is a verified first component, not a completed redesign.

## Verification
- App TypeScript: PASS (node node_modules/typescript/bin/tsc --noEmit -p tsconfig.app.json).
- Social regressions: PASS, 89/89 in src/test/socialView.test.ts and socialControls.test.tsx.
- Browser: PASS, local headless Chrome, six width/theme combinations; menu contained in viewport, no horizontal overflow; Enter opens, Escape closes and restores focus; all three callbacks; zero/unknown/105 notification states; no page errors. External requests blocked.
- Visually inspected final 320px dark capture: opaque menu, readable labels/count, correct existing fox avatar.
- ESLint changed TS/TSX: zero errors, one preview-only Fast Refresh export warning.
- git diff --check: PASS. Full test suite/build and real accounts were not tested; production entry points are unchanged.
- Earlier browser attempt failed due to fixture label matching and captured opening-animation frames; fixed explicit aria-label and capture wait, then the complete browser run passed.

## Run locally
Node available at /tmp/node-v24.10.0-darwin-arm64/bin/node (npm symlink is unusable here).
From this checkout:
```
/tmp/node-v24.10.0-darwin-arm64/bin/node node_modules/vite/bin/vite.js --config demo/profile-menu/vite.config.ts
/tmp/node-v24.10.0-darwin-arm64/bin/node demo/profile-menu/check.mjs
```
Preview: http://127.0.0.1:5215/ (restart if stopped). Dependencies copied into this isolated checkout from the existing Rainbow friends-flow checkout; no env files copied.

## Evidence and blockers
- Recovered actual user message Sentinel_fcddf4e491a4819187840c3e83cf521c, Nov 4: replace separate account/friends controls with profile-picture options including Friends and a yellow notification light.
- Parent recovered two Library mockups: libfile_2f9816cde730819187d01b716d494bb7 (four screens), libfile_62277b08241481918d6131635687e7e2 (clubhouse/editor). Materialization preparation succeeded, but bundled transfer helper failed to download both. System Python was initially incompatible; compatible Python 3.13 still returned `download failed`. No local image bytes were installed or inspected. Therefore this slice follows explicit text and existing styles only; broader visual matching remains blocked pending reference access.
- No auto-review rejection. Network/local server operations succeeded with escalation. Library download is an execution failure, not an approval denial.
- Local Codex memories directory absent; memories SQLite could not be opened. Existing worktree docs were read, but their Oct 30 status is stale relative to current main.

## Next coherent step
1. Recover and inspect both Library images before broader styling.
2. Wire ProfileMenu into GameHeader/MinimalHeader without a separate Friends icon; preserve guest sign-in and existing account actions. Resolve phone header fit with real hint/stats/settings controls before changing their placement.
3. Supply profile and actual pending counts from a session-keyed source; clear on account change, handle loading/errors honestly, avoid leaking previous-account state or duplicating fetches. Current readPerson gives incoming friend requests; no verified group invitation notification feed yet. Do not invent totals.
4. Reuse existing ProfileForm and account menu actions. Preview callbacks currently only demonstrate navigation.
5. Verify same-puzzle completion gates server-side and client-side when adding weekly friend activity. Current menu changes touch neither results nor permissions.

## Broader direction to preserve
Favorites first, excluding self; manual group order separate from leaderboard order. Friend profiles show weekly activity and private editable nicknames. Results unlock only after viewer completes the SAME puzzle (Full/Mini separate). No invented social feed or XP economy.
Groups: clubhouse description, picture, members, per-game results; circular crop/zoom, large-image shrink, transparency. Existing groupPicture.ts centers and emits JPEG on white; upload contract is JPEG-only, so transparency requires coordinated client/server changes preserving old photos. Owners transfer/delete/remove; inviting only owner or explicitly authorized members. Departure removes contributions from group standings, retains personal history. Pre-join history/scoring for Rainbow and detailed link policy undecided. Other sites are out of scope for this checkpoint.

## Resumed integration — 2026-11-05
This section supersedes the initial component-only status above. Integration changes survived the desktop disconnection intact.
- GameHeader (including signed-in Daily/Full/Mini) and MinimalHeader now render the lazy profile menu when the existing social flag is enabled. Guest/sign-in and flag-off paths remain available as before.
- SocialHeaderMenu reads only getMe and listFriendRequests; yellow counts are incoming FRIEND requests, not unsupported group invitations. It refreshes on menu open, route changes, focus/reconnect, every minute while visible, and successful social-page reloads. Session-keyed mounts discard stale identity/responses. No game results are fetched for headers.
- Existing profile editor is reused through /friends location state; repeat entry while already on that route now works. Account options reuse existing sign-out and account-delete confirmation; Escape support was added.
- Both Library reference images were successfully materialized using fresh authorized transfers and the system certificate bundle with Python 3.13, then visually inspected. Local paths: ../references/exec-e4e68d33-3aca-49a3-80a4-611ce6e633ac.png and ../references/exec-e4f5dc5f-0a78-49dd-be9f-d459a461de9c.png. Reference access is no longer blocked.
- App typecheck and build passed after integration. 63 focused tests passed. Full suite originally had 4 timeouts during heavy worker concurrency near the environment disconnect; rerun with --maxWorkers=2 passed 64 files, all 1834 tests, no timeout changes. Log: /tmp/rainbow-profile-menu-tests-limited.log.
- Local browser fixture uses real headers, ProfileMenu and SocialPage, with a synthetic service and network blocked outside localhost. 16 header width/theme captures completed (Daily/secondary, 320/390/768/1440, light/dark). Account options and delete Cancel were checked. Profile editor browser flow is still being verified; fixture route nesting needed correction to match the app.
- New fixture files: demo/profile-menu/{header.html,header-main.tsx,fixtureSocial.ts,fixtureSupabase.ts,check-header.mjs}. Integrated preview: http://127.0.0.1:5215/header.html.
- No push, PR, merge, deployment or live-service writes. Next planned slice: adjustable group-photo crop/zoom using current upload contract; do not claim transparency while server remains JPEG-only.
- Final integrated browser run PASSED: all 16 header layouts/themes, account actions and delete cancellation, notification clearing, profile navigation/save/reopen, and refreshed display name. No browser page errors. Changed production components and the new test pass ESLint with no warnings/errors; git diff --check passes.

## Group-picture slice — 2026-11-05
- Header integration is committed as 6ea7b63 (on top of initial a75b4c6).
- GroupAppearanceForm retains its established upload behavior and adds Adjust picture. New GroupPhotoCropper provides a circular preview, pointer drag, keyboard-accessible zoom/horizontal/vertical sliders, Cancel, and Use picture. It holds a local draft only; Save group is the service write. Existing/new images and uploads interrupted by a newer selection remain protected by the existing guards.
- groupPicture.ts now accepts an optional crop with clamped geometry; default remains the same centered crop. It still emits a 256x256 JPEG under 58,000 bytes, within the current shared contract. A new upload retains its original File in memory for repeated high-resolution cropping. Existing saved JPEGs can also be reopened locally. GroupEmblem now displays pictures/emblems in circular frames, following the later clubhouse reference; stored image bytes are unchanged.
- GroupPage exposes Edit group picture only to owners. GroupFlow reuses GroupAppearanceForm in picture-only mode and calls the existing setGroupAppearance, then reloads the group. It never creates a second group or silently renames one. Refused saves retain the draft. Memberships/results/invites are untouched.
- Browser verification passed at 320/1440, light/dark, using a synthetic 4000x2000 image: drag and sliders work; saved JPEG is 256x256 under 58KB; decoded output pixels match the selected side; cancelling another crop preserves the prior picture exactly. Captures: evidence/crop-{320,1440}-{light,dark}.png. Visually inspected 320px dark. Fixture: http://127.0.0.1:5215/group.html; run demo/profile-menu/check-crop.mjs with the same Node/Chrome setup.
- Focused verification: 158 tests passed across accountScreens/sharedProfile/groupCrop/socialControls. New tests cover geometry, byte handling, owner-only editor, exact save operation, and retaining a refused draft. Production build passes with the existing chunk-size/stale Browserslist notices. A TypeScript narrowing issue was corrected to the repository's explicit `ok === false` pattern; final typecheck/full suite is being rerun.
- Still limited by the shared service: true PNG transparency (current encoder/server JPEG-only), group descriptions, ownership transfer, delegated invite permission, private friend nicknames/favorites and expanded weekly/per-game standings. Do not implement these as browser-only claims. Current crop UI explicitly says transparent areas use white. No shared contract or server schema changed.
- Final app typecheck passes; focused header/session checks pass (27 tests) after adding a same-session background-check retry. Routine focus-triggered account checks no longer drop the badge until the retry completes; failed/different sessions still clear through the outer guard. This retry is separately committed.
- Final full run: all 65 test files and 1842 assertions passed, but the process reported ONE teardown exception and exited nonzero: `window is not defined` from `src/hooks/useGame.ts:1286`, a delayed `setShaking(false)` after betaPlaytesting.test.ts teardown. Both this gameplay hook and that test are byte-for-byte unchanged from base (verified git diff 6ad00ba). Earlier full header-only run was clean. Do not describe the final full suite as a clean pass; the existing uncancelled gameplay timeout remains a verification limitation. No unrelated gameplay fix was added. Log: /tmp/rainbow-friends-final-tests.log.
- Main production chunk was checked: none of listFriendRequests, createRainbowSocial, or social-gateway is present; the social header remains lazy. Crop and integrated-header browser runs both passed. No real sign-in, live social writes, Safari/Firefox or physical touch-device testing was performed.

## Backward-compatible transparency slice — 2026-11-05
- Located the shared hub in the separate CrossPuns checkout at `eb238dd`; inspected its contract, SQL and gateway. Its dirty working tree was not edited. Copied unchanged SQL/uninstall fixtures into `shared-service/fixtures` for local tests only.
- Added `shared-service/patches/0002_png_group_photos.sql`: PNG validation and correct MIME serialization alongside existing JPEGs, preserving stored bytes, photo versions, owner checks, memberships and function signatures. This is NOT a Rainbow migration and has not been applied remotely. See `shared-service/README.md` for provenance, release order and downgrade caveat.
- Changed `src/lib/groupPicture.ts`, `src/components/account/GroupPhotoCropper.tsx`, `src/social/{contract,memoryHub}.ts`: gated PNG encoding, alpha preview, reopening stored PNGs and matching local validation. `VITE_GROUP_PNG` defaults off; the isolated demo enables it. Opaque pictures still use JPEG. Over-limit transparent pictures get an explicit refusal rather than white flattening. Validation is structural, not a full image decoder/CRC check.
- Added `src/test/groupPhotoEncoding.test.ts`, `shared-service/tests/{pngGroupPhotos.test.ts,hub-regression.test.mjs}`, `shared-service/vitest.config.ts`, and `demo/profile-menu/check-transparency.mjs`. Browser evidence is under `evidence/transparency-*` plus the exact `browser-transparent-photo.png` exercised by SQL tests. Existing crop captures refreshed for the PNG-enabled demo.
- Verification: 474 existing focused tests plus 4 new encoding tests pass; all 75 shared-hub regression tests pass without skips; 6 PNG SQL tests pass including the actual browser output. App/social typechecks, production build and changed-file lint pass. Crop browser regression and transparency runs pass at 320/1440 in light/dark; visually inspected 320 dark.
- Full aggregate run now passes cleanly: 66 files, 1846 assertions, exit 0 (`/tmp/rainbow-png-full.log`). The previously documented gameplay timer teardown error did not recur; its source remains unchanged, so this does not claim that unrelated issue is fixed.
- Remaining rollout work requires separate release authorization: review/apply shared-service patch, verify the hosted gateway, then enable the Rainbow flag. No real accounts or hosted writes used. Portable source changes remain local for coordinated review.
- Next already-approved slice: clubhouse member management using existing `listMembers`/`removeMember`; favorites/private nicknames/manual ordering have no current service operations, and no browser-only substitute is being added. Description/ownership transfer/delegated invitations also need shared-service extensions. Weekly puzzle discovery, other-game scoring and pre-join history remain unresolved/unsupported as previously recorded.

## Clubhouse member management — 2026-11-05
- Added `src/components/account/GroupMembers.tsx`. Everyone in a group can open View members. The roster uses existing real avatars and joining order, separately from results. Only owners see removal controls, never for themselves/the owner. Controls have 44px minimum touch targets. Removal requires a second confirmation; cancellation sends nothing. Refusals retain the member and explain the failure.
- Updated `src/components/account/GroupPage.tsx`, `src/components/social/GroupFlow.tsx`, `src/components/social/socialData.ts`, and `src/lib/socialView.ts`: retain the members already read page by page, map safe avatar/color values, call existing `removeMember` with the exact group/member references, remove confirmed rows locally and reload the parent group count. No new service operation, preference storage, scoring or result-detail access was invented. Existing server authorization and personal result storage are unchanged.
- Added 3 interaction tests in `src/test/socialControls.test.tsx`. Added isolated real-GroupFlow browser fixture `demo/profile-menu/{members.html,members-main.tsx,check-members.mjs}` and four `evidence/members-{320,1440}-{light,dark}.png` captures. Synthetic service only; all external browser requests blocked. Visually reviewed the 320px dark roster.
- Verification: 95 focused social tests pass; app typecheck, changed-file ESLint, production build and diff whitespace checks pass. Browser checks pass for all four layouts, cancellation, confirmed removal, no self-removal control, refreshed result rows/group count, no horizontal overflow or page errors. Final aggregate: **66 files / 1849 assertions, clean exit 0**, log `/tmp/rainbow-members-full.log`. The earlier gameplay teardown error again did not recur; unrelated gameplay code remains unchanged.
- The shared-hub regression suite already checks owner permissions/removal and that removed people lose group access; conformance also checks departure/removal audience filtering. No historical-total feature exists here to modify. Personal histories are not deleted by this UI.

## Remaining work / exact boundaries
1. Transparency is implemented locally but not live. Review the shared-service PNG patch against the actual target service, coordinate its portable source changes, then separately authorize service rollout and the Rainbow flag. No hosted gateway verification was performed.
2. The current shared `Operations` contract has **no** favorites, private nickname, manual group ordering, group description, ownership-transfer, explicit delete-group or delegated-invitation operations. These need coordinated shared-service extensions before their production UI can honestly save them; no localStorage substitute or fictional endpoint was added. Existing removeMember was sufficient for this turn's second slice.
3. Weekly friend activity needs a supported source of dated puzzle IDs/history; the real adapter currently exposes today's Full puzzle only. Preserve the same-puzzle completion gate when adding this. Per-game standings/scoring and pre-join history remain undecided; do not invent them or import PR #107 implicitly.
4. Next implementation planning should define the persistent private preference contract (favorites/nicknames/manual order) with the shared hub source, then add its SQL/client/conformance coverage and Rainbow UI together. Keep rollout to other sites separate. Description/owner transfer/delete/invite permissions similarly require real service support.
5. No push, PR, merge or deployment. No live users, memberships, photos or personal results were changed. Other dirty worktrees and the results-screen branch remain untouched. Preview server, if still running: port 5215; member view `/members.html`, crop `/group.html`, integrated header `/header.html`.
