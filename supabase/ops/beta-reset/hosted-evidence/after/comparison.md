# Hosted comparison: before -> after

Generated 2026-10-04T09:05:55.766Z.

## Rainbow objects on the hosted project vs the committed manifest

- identical: 22 tables, 59 functions, 25 policies, every column, constraint, index, trigger, policy and grant

## Non-Rainbow objects, before vs after

- table cv_puzzles: policy removed "Admins can manage cv puzzles" (owner-approved, step 0)
- table cv_wordbank: policy removed "Admins can manage cv wordbank" (owner-approved, step 0)
- table wtf_games: policy removed "Admins can manage wtf games" (owner-approved, step 0)

Unexplained differences: 0

## Non-Rainbow row counts

- unchanged (12 tables)

## Auth users

- unchanged: the same 9 user ids

## Storage

- objects and buckets unchanged: custom-emoji 43 objects, custom-emoji-backup-20260918 38 objects
- policies on storage.objects after: "custom-emoji: admins can delete", "custom-emoji: admins can replace", "custom-emoji: admins can upload", "custom-emoji: anyone can read"

## Migration ledger after

- 0001 rainbow_baseline
- 0002 rainbow_storage

Problems: 0
