# Current status — 2026-11-05

All-time standings are implemented locally: dedicated shared SQL reader (0008), authenticated gateway operation, typed client/memory/conformance parity and Rainbow clubhouse panel. `VITE_CROSSPUNS_STANDINGS` defaults OFF. No deployment, hosted writes or CrossPuns website rollout occurred.

Deb accepted inference from small groups. Shared ranks are calculated before per-viewer masking; blocked rows contain only rank and generic label, with no source identity, scores or puzzle data. Existing block/result paths remain unchanged. Prior privacy-choice blockers in the historical notes below are resolved.

Verified: 1,904 app assertions, 105 service assertions, typecheck/lint/build, and 320/1440 light/dark browser flows including both block directions and account switching. Local SQL fixtures cover actual relevant source columns; target hosted schema/permissions still require verification before rollout.

Remaining product decision: publication date versus solve date for rolling 7/30/365-day scoring. Other games scoring remains undecided. No missing access prevents local all-time implementation; it is done.

---

# CrossPuns standings: source review and local scoring

2026-11-05. Local implementation only; nothing enabled, pushed or deployed.

## Confirmed product rules

- CrossPuns first; other games' scoring is undecided.
- Per-puzzle points: first 3, second 2, third 1. Competition ties: ranks 1, 1, 3 earn 3, 3, 1. Submission order must not break equal-time ties.
- Current members bring prior results into group standings. Do not filter by join date.
- Departed members no longer contribute to group totals or history; personal history stays intact.
- Updated direction: rolling last 7 / 30 / 365 local calendar days, including today, replaces Monday–Sunday weeks. The date basis for late solves in standings is still pending (published date versus solved date).
- Rankings remain common to the whole group. For either-direction blocks, the requested row is anonymous rather than omitted. No CSS blur of identifying data is acceptable.

## Actual source inspected

Read-only checkout: `/Users/westbookair/Documents/Codex/2026-10-29/task-3/claude-team-workspaces/crosspuns`, HEAD `eb238dd`. It has unrelated dirty files; none were changed. This is local source evidence, not a fresh production schema verification.

- `supabase/migrations/0007_accounts.sql`: `xw_accounts.global_user_id` is the shared stable identity; `id` is the CrossPuns account id; `player_key` links posted times. `xw_solves` preserves first solves, seconds, used_help and solved_at. Import/history paths exist.
- `0012_groups.sql`, `xw_group_board` around lines 389–425: existing legacy groups use CURRENT `xw_group_members` and read `xw_times`, falling back to `xw_solves` where used_help=false. They do not filter by joining date. They currently rank using row_number over seconds, submission time and membership id. That tie behavior does NOT implement the new competition rule.
- `0015_account_times_follow_solves.sql`: new account leaderboard inserts must match the first recorded unassisted solve; earlier rows and guest-history imports are not retroactively rewritten. Do not silently replace this established source precedence with minimum replay time.
- `0014_local_midnight.sql`: publication visibility uses UTC+14 so puzzles become available when that date begins anywhere. This is not a universal standings period boundary.
- `src/social/crosspunsAdapter.ts`: explicitly mock/off only, no live transport and not imported by the app. Existing legacy groups are not shared-hub groups. Do not copy membership ids between them or claim a CrossPuns rollout.
- Rainbow `supabase/functions/social-gateway/core.ts`: current completion ingestion handles Rainbow Full Daily only. `shared-service/fixtures/hub-eb238dd.sql` has CrossPuns result shapes but no verified ingestion of the complete CrossPuns historical source.
- Shared `social.list_results` suppresses blocked-person results and applies connection dates. That contract cannot simply be reused for newly approved pre-join group history. Friend visibility must remain unchanged.

## Completed independent implementation

`src/social/crosspunsStandings.ts` is a pure calculator accepting already-authorized members and eligible, deduplicated first-solve results. It awards competition points per puzzle, sums all supplied history, ranks equal totals equally, and excludes departed memberships without modifying inputs. It recalculates placements among the supplied current members, matching the existing dynamic membership model. Stable display ordering does not break score ties. Invalid/duplicate source results fail explicitly rather than silently choosing a time.

Six tests cover 3/2/1, multiple tie patterns, history on joining, departure/rejoin without personal-history mutation, replay/invalid input rejection and empty/no-result groups. Typecheck and lint pass. Historical foundation status: this was initially unwired; the current integration above supersedes that stage.

## Integration decisions still pending

1. Block privacy: Deb chose visible common rankings with masked blocked rows. `crosspunsStandingsView.ts` now supplies a tested, unconnected server-side projection: blocked rows contain only `blocked`, `rank`, and the generic label. No name, member/account/global id, avatar, nickname, points, puzzle count, times, dates, details or link is emitted. Ranking happens before masking. This does not yet change the shared service: `audience_global_ids` and `list_results` both exclude blocked results and must remain unchanged for ordinary friend/puzzle reads. A dedicated authorized standings reader is needed.
   **Substantive limitation:** `list_members` shows the whole roster, including blocked members. In a two-person group, the anonymous other row is inferable. Public CrossPuns times and repeated ranking comparisons can also identify a player or reveal participation. Rank-only masking prevents direct field disclosure but cannot promise anonymity or zero puzzle inference against outside knowledge. This was reported; no claim of that stronger guarantee or new production privacy policy was made.
2. Period attribution: for a late solve, use the puzzle's publication date or the player's solve date? The user has been asked. If solve date is selected, clarify/apply the existing device-local convention consistently at the server boundary. All-time scoring itself does not need this choice.

## Next concrete implementation

- Confirm that rank-only masking with the stated inference limitation meets the intended privacy requirement, then build a dedicated membership-authorized read contract for shared groups. Resolve shared person ids to CrossPuns accounts server-side; never return global ids, account ids or player keys. Reuse the actual first-solve source precedence above and explicitly test imported legacy records.
- Read prior results for current memberships only; do not mutate personal history or copy legacy group memberships. Keep friends' forward-only rule separate from group-history policy.
- Apply the calculator's competition semantics server-side, with bounded pagination and stable ordering. Test unauthorized/blocked/departed callers, join/remove/rejoin, prior history, duplicate sources, equal seconds and same totals. Preserve answer-detail spoiler gates; aggregate points must never include answers.
- Verify source table availability/privileges and the target schema before proposing rollout. Add local schema fixtures and SQL tests before proposing rollout. Existing result cards alone are not proof of complete backfilled history.
- Add a disabled-by-default Rainbow clubhouse panel only after the read contract is real. No CrossPuns website rollout or production writes are authorized here.

## Rolling activity and privacy projection verification

The Rainbow friend activity UI now shows the last seven local calendar dates through today. Shared range helpers cover 7/30/365 days, including DST and leap-year boundaries; they do not decide which date a CrossPuns solve belongs to. No 30/365-day standings UI or source filter is implied by these helpers. The standings projection is pure code, not a deployed endpoint or cosmetic client blur.
