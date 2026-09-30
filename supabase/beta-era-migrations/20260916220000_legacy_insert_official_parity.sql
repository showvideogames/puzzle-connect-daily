-- ===========================================================================
-- Legacy direct-INSERT parity for is_official
--
-- Follow-up to 20260916150000_durable_sessions_and_hint_events.sql.
--
-- THE GAP
-- -------
-- 20260916150000 deliberately kept the legacy INSERT policy on game_sessions
-- alive so that cached pre-Task-6 frontend bundles keep recording completions
-- while they age out of browser caches. Those clients do not use
-- create_game_session/finalize_game_session; they insert one already-completed
-- row directly.
--
-- is_official is set by finalize_game_session, so nothing set it on that path.
-- The column's default for new rows is false, which meant every completion
-- from a cached client landed non-official -- and both has_official_result()
-- and get_own_completed_sessions() require is_official. The consequence for a
-- real player: the game does not appear in their stats, and their board does
-- not lock, so they can replay a puzzle they already finished.
--
-- This was observed live: one genuine completion at 2026-09-16 21:28:39Z,
-- corrected in section 2 below.
--
-- THE RULE (unchanged from the new architecture)
-- ----------------------------------------------
--   first completed result for that puzzle + identity -> is_official = true
--   any later completed replay                        -> is_official = false
--
-- Identity is the row's own stored identity: the authenticated user when
-- user_id is present, otherwise the anonymous device. device_id = 'unknown'
-- is never an identity -- every storage-blocked browser shares that literal,
-- so treating it as one would let strangers claim each other's results.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Teach the stale-client repair trigger to decide is_official.
--
-- Only on INSERT. The RPC path reaches a completed state via UPDATE
-- (finalize_game_session), which decides is_official for itself and must keep
-- doing so -- so the UPDATE path is left entirely alone here.
--
-- SECURITY DEFINER is required and is new for this function. The existence
-- check has to read rows belonging to the identity being inserted, and after
-- 20260916150000 an anonymous caller has no SELECT policy on game_sessions at
-- all. Without it the check would see zero rows and mark every legacy
-- completion official, which is the opposite of the fix. The function reads
-- nothing back out to the caller -- it only computes a boolean onto NEW -- so
-- this does not widen what anyone can observe, and the RPC security model is
-- untouched.
--
-- Concurrency: the advisory lock is keyed on puzzle + identity, so two
-- simultaneous legacy completions for the SAME player and puzzle serialise.
-- The second waits for the first to commit; because each statement inside a
-- volatile PL/pgSQL function takes a fresh snapshot under READ COMMITTED, it
-- then sees the committed row and correctly marks itself non-official rather
-- than failing. The partial unique indexes from section 5 of the previous
-- migration remain the hard backstop if that reasoning is ever wrong: the
-- invariant cannot be violated, at worst an insert is rejected.
-- ---------------------------------------------------------------------------
create or replace function public.game_sessions_sync_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _identity text;
begin
  -- Unchanged: a legacy client sends won/lost with no status, because status
  -- did not exist when its bundle was built. Repair rather than reject.
  if new.status = 'in_progress' and new.won is not null then
    new.status := case when new.won then 'won' else 'lost' end;
    new.completed_at := coalesce(new.completed_at, now());
  end if;

  if tg_op = 'INSERT' then
    if new.status in ('won', 'lost') then
      if new.user_id is not null then
        _identity := 'u:' || new.user_id::text;
      elsif new.device_id is not null and new.device_id <> 'unknown' then
        _identity := 'd:' || new.device_id;
      else
        -- No usable identity. Such a row can never be anybody's permanent
        -- result, so it must not occupy the official slot.
        _identity := null;
      end if;

      if _identity is null then
        new.is_official := false;
      else
        perform pg_advisory_xact_lock(
          hashtextextended(coalesce(new.puzzle_id, '') || '|' || _identity, 0)
        );

        -- Note this OVERWRITES whatever the client supplied. A caller cannot
        -- assert its own completion is official.
        new.is_official := not exists (
          select 1
            from public.game_sessions gs
           where gs.puzzle_id = new.puzzle_id
             and gs.status in ('won', 'lost')
             and gs.is_official
             and gs.id is distinct from new.id
             and (
               (new.user_id is not null and gs.user_id = new.user_id)
               or (new.user_id is null
                   and gs.user_id is null
                   and gs.device_id = new.device_id)
             )
        );
      end if;
    else
      -- An unfinished session is not a result. Pinning this to false also
      -- closes a squatting hole: the partial unique indexes key on
      -- is_official without regard to status, so an in_progress row inserted
      -- with is_official = true would have blocked the real completion for
      -- that puzzle + identity.
      new.is_official := false;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.game_sessions_sync_status() is
  'BEFORE INSERT/UPDATE on game_sessions. Repairs status/completed_at for cached pre-Task-6 clients that predate the status column, and on INSERT decides is_official by the same first-completed-result rule finalize_game_session applies on the RPC path.';

-- The trigger itself is unchanged and already bound to this function; it is
-- recreated only so this migration is self-contained if replayed.
drop trigger if exists game_sessions_sync_status_trigger on public.game_sessions;
create trigger game_sessions_sync_status_trigger
  before insert or update on public.game_sessions
  for each row execute function public.game_sessions_sync_status();


-- ---------------------------------------------------------------------------
-- 2. One-time correction of completions already written through the gap.
--
-- Scoped by the rule itself rather than by a hardcoded id, because more
-- cached-client completions may land between writing this file and applying
-- it. A row is promoted ONLY if no other completed official result exists for
-- the same puzzle + identity, so this cannot manufacture a duplicate and
-- cannot fight the unique indexes.
--
-- The deliberately demoted replay 6dd52b7d-61d2-4071-960c-62e4c09d4c28 is
-- excluded twice over: its first attempt (5a0aadb3-...) is official for the
-- same puzzle and user, so the not-exists guard already rejects it, and it is
-- named explicitly below so the intent survives a future reading.
--
-- Nothing else about any row changes. No gameplay result is altered, and
-- nothing is deleted.
-- ---------------------------------------------------------------------------
update public.game_sessions gs
   set is_official = true
 where gs.is_official = false
   and gs.status in ('won', 'lost')
   and gs.id <> '6dd52b7d-61d2-4071-960c-62e4c09d4c28'
   and (
     gs.user_id is not null
     or (gs.device_id is not null and gs.device_id <> 'unknown')
   )
   and not exists (
     select 1
       from public.game_sessions o
      where o.puzzle_id = gs.puzzle_id
        and o.id <> gs.id
        and o.status in ('won', 'lost')
        and o.is_official
        and (
          (gs.user_id is not null and o.user_id = gs.user_id)
          or (gs.user_id is null
              and o.user_id is null
              and o.device_id = gs.device_id)
        )
   );


-- ---------------------------------------------------------------------------
-- Self-verifying guard, matching the one in the previous migration.
--
-- Promoting rows is exactly the operation that could create a duplicate
-- official group, so re-check the invariant before committing. Raising here
-- rolls back this whole file rather than leaving a half-corrected table.
-- ---------------------------------------------------------------------------
do $$
declare
  n integer;
begin
  select count(*) into n from (
    select 1
      from public.game_sessions
     where is_official and user_id is not null
     group by puzzle_id, user_id
    having count(*) > 1
    union all
    select 1
      from public.game_sessions
     where is_official and user_id is null
       and device_id is not null and device_id <> 'unknown'
     group by puzzle_id, device_id
    having count(*) > 1
  ) d;

  if n > 0 then
    raise exception
      'Aborting: % duplicate official-session group(s) after promotion.', n;
  end if;
end
$$;
