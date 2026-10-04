# Restore verification: local

Run 2026-10-04T08:46:32.050Z against the local database from `.runtime\phase2\restore`.

| check | expected | actual | ok |
|---|---|---|---|
| device_identities rows | 208 | 208 | yes |
| puzzles rows | 133 | 133 | yes |
| puzzle_versions rows | 157 | 157 | yes |
| puzzle_groups rows | 530 | 530 | yes |
| puzzle_aggregates rows | 68 | 68 | yes |
| luck_score_ceilings rows | 1 | 1 | yes |
| user_roles rows | 1 | 1 | yes |
| archive_access rows | 0 | 0 | yes |
| creator_profiles rows | 1 | 1 | yes |
| custom_puzzles rows | 2 | 2 | yes |
| custom_puzzle_stats rows | 2 | 2 | yes |
| custom_puzzle_favorites rows | 2 | 2 | yes |
| custom_puzzle_results rows | 3 | 3 | yes |
| game_sessions rows | 290 | 290 | yes |
| guess_events rows | 1522 | 1522 | yes |
| hint_events rows | 10 | 10 | yes |
| user_streaks rows | 44 | 44 | yes |
| puzzle_ratings rows | 50 | 50 | yes |
| feedback rows | 8 | 8 | yes |
| beta_playtests rows | 64 | 64 | yes |
| beta_feedback rows | 1 | 1 | yes |
| accounts rows | 0 | 0 | yes |
| game_sessions.device_id without device_identities row | 0 | 0 | yes |
| game_sessions.user_id without auth user | 0 | 0 | yes |
| guess_events without session | 0 | 0 | yes |
| hint_events without session | 0 | 0 | yes |
| user_streaks without owner (user or device) | 0 | 0 | yes |
| user_streaks.device_id without device | 0 | 0 | yes |
| puzzle_versions without puzzle | 0 | 0 | yes |
| puzzle_groups without puzzle | 0 | 0 | yes |
| puzzles whose current_version is not theirs | 0 | 0 | yes |
| puzzles without a current version | 0 | 0 | yes |
| retired devices without a reason | 0 | 0 | yes |
| live devices with a reason | 0 | 0 | yes |
| devices claimed by a missing user | 0 | 0 | yes |
| beta_playtests without device | 0 | 0 | yes |
| custom_puzzle_results without device | 0 | 0 | yes |
| puzzle_ratings without user | 0 | 0 | yes |
| accounts rows (none expected yet) | 0 | 0 | yes |

| derived stat (local) | value |
|---|---|
| completed games (won+lost) | 278 |
| won games | 241 |
| account-owned games | 132 |
| guest games | 158 |
| mini games | 7 |
| sessions whose puzzle no longer exists (no FK; kept) | 2 |
| puzzle_aggregates total_plays | 280 |
| published puzzles | 106 |
| mini puzzles | 2 |
| streak rows with an account | 6 |
| best longest streak | 41 |
| distinct account owners of games | 5 |
| retired devices imported / started_fresh | 8 / 50 |

Failures: 0
