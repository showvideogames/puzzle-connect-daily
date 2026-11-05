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
