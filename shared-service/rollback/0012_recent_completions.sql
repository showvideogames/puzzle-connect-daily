-- Undo 0012: removes exactly what it added (the reader function and its index).
-- No table, data, grant on anything else, or other function changes. Safe to
-- re-run. Run only with the gateway's recentCompletions unused (no client flag),
-- or that one operation answers `unavailable` until 0012 is applied again.
begin;
drop function if exists social.recent_completions(text,text,text,text);
drop index if exists social.result_cards_recent_person;
commit;
