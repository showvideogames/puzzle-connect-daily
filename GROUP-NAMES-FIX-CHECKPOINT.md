# Group names and transient standings reads — 2026-11-06

Branch: codex/group-current-names, isolated worktree rainbow-group-fix. Base production main c5368ce8143c9fa43eccb53811fc0d65605ca36f. Original rainbow worktree and preview untouched.

Implemented:
- Additive shared-service/patches/0010_current_group_names.sql replaces list_members and the two standings readers. Names resolve viewer-private friendship nickname, current profile name, legacy membership name, then Player. Self never takes another viewer's nickname. Internal invoker helper has no gateway/public/client execution privilege. No records updated; masked standings remain only blocked/rank/label.
- MemoryHub matches the name precedence. Existing conformance/regression assertions updated to the intentional contract change while preserving identity, membership, historical data and paging checks.
- CrossPunsStandingsPanel quietly retries still_checking/stale_session at the existing reader interval. Genuine errors retain Try again. Timers and stale responses cancel on unmount/account/group switch; account identity participates in visible response selection.
- New SQL regression exercises three viewers, private nicknames, profile rename, legacy fallback, self, blocked rows, unchanged membership snapshots, restricted helper. UI tests cover both transient outcomes, recovery and cancellation/account switching.

Verified:
- 1,912 app tests / 74 files pass.
- 36 service extension tests and 76 hub regression tests pass (112 total).
- app and social TypeScript pass; changed TS/TSX lint pass; production Vite build pass; diff whitespace check pass.
- Live read-only function hashes match the existing post-release backup exactly: list_members 1eb7a775deba30feb21ab9acd6dbbe61; crosspuns_standings df03699305051b4202896d07517679b4; period 63bcdd2ad5863f386deb3e08d9144621. All three retain postgres/social_gateway execution only.
- CrossPuns recovery tables and active purge job at 17 4 * * * intact. No change to CrossPuns source or its scheduler.

Release blocker:
Automatic approval review rejected executing the guarded production migration in Supabase SQL Editor: specific application/deployment approval is required for this fix. The rejected action did not run. No migration, push, PR, merge or deployment performed for this fix. Staged SQL was replaced with a read-only verification query. Do not retry without materially new relevant explicit authorization.

Prepared outside Git in sibling release-backups: group-names-guarded.sql (transaction with exact baseline function hash guards), group-names-rollback.sql (restore the three original reader definitions). Existing social-post-migration-20261106.json contains matching full definitions and ACLs. No private snapshots added to repository.

Next:
1. Obtain explicit production-fix approval, recheck current main and live function/schema state; guarded SQL refuses concurrent changes.
2. Apply 0010, verify names/ACLs and no data changes. Gateway source needs no change or new grants.
3. Publish targeted PR, run CI, merge only on passing checks, verify Rainbow deployment and live group Today/members/all-time/rolling names and session retry. No forced user/profile edits.
4. Parent separately investigating ~5-second Friends load. No performance optimization included: readPerson currently serializes seven gateway reads plus puzzle lookup; per-call live timings still outstanding. Existing production optional preference/order flags are enabled. Do not conflate this with the confirmed retry gap or claim historical failed request cause proven.
