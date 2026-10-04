# Hosted smoke (publishable key, as the client)

Run 2026-10-04T09:08:05.930Z.

| check | result | detail |
|---|---|---|
| ping() | pass | HTTP 200 |
| resolve_device_import() as anon is refused | pass | HTTP 401 |
| ensure_account() as anon | pass | HTTP 401 {"code":"42501","details":null,"hint":null,"message":"permission denied for func |
| get_archive_puzzles() | pass | 106 puzzles |
| published puzzles readable as anon | pass | latest Full: #102 (2026-09-22) |
| create_device_identity() | pass | device minted |
| create_game_session() as a guest | pass | session created |
| get_own_completed_sessions() for the new device | pass | HTTP 200, 0 rows |
| get_puzzle_stats() for today's puzzle | pass | HTTP 200 |
| cleanup | done | removed 1 session(s), 1 device |

All passed: true
