-- Fix: resolve_onboarding() raised 42702 "column reference "status" is
-- ambiguous" and could never complete the sign-in it exists to serve.
--
-- WHAT WAS WRONG
-- --------------
-- The function RETURNS TABLE (outcome text, status text, ...), which makes
-- `status` an OUT parameter — a PL/pgSQL variable. Two of its statements
-- then referenced the account_onboarding column of the same name unqualified:
--
--     update public.account_onboarding
--        set status = ..., decided_at = now()
--      where user_id = _uid and status = 'pending';   -- <- ambiguous
--
-- The SET clause is fine (its left-hand side is always a column). The WHERE
-- clause is not: Postgres cannot tell the column from the OUT parameter and
-- aborts the statement with 42702.
--
-- Both statements sit on the paths a NEW ACCOUNT takes — signing up or
-- signing in from a browser with no importable guest history — so the RPC
-- returned a 400 and OnboardingGate could not resolve the one-time import
-- decision. `create_game_session` refuses an account still marked pending,
-- so the account was left unable to record a game.
--
-- HOW IT SURVIVED
-- ---------------
-- Nothing executed it. The JS fake in src/test/fakeSupabase.ts mirrors the
-- RULES of this SQL but is not PL/pgSQL, so an ambiguity the real planner
-- rejects is invisible to it — the same class of gap that hid the
-- array_append and cross-group-hint bugs recorded in the custom-puzzle work.
-- It was found the first time a clean database built from these migrations
-- was driven through a real browser sign-in (e2e/tests/admin.spec.ts).
--
-- If production has been carrying a hand-applied correction, this is a no-op
-- there and simply puts the corrected definition back under version control,
-- where it belongs.
--
-- ONLY the two WHERE clauses changed; every other line of the function is
-- byte-identical to 20260917000000_device_credentials_and_account_onboarding.sql.

create or replace function public.resolve_onboarding(
  _device_id text default null,
  _device_token text default null
)
returns table (
  outcome        text,
  status         text,
  games_played   integer,
  current_streak integer,
  longest_streak integer
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  _uid    uuid := auth.uid();
  _status text;
begin
  outcome := 'unauthenticated';
  status := null;
  games_played := 0;
  current_streak := 0;
  longest_streak := 0;

  if _uid is null then
    return next;
    return;
  end if;

  -- No row means the account did not exist when section 3 classified every
  -- account as legacy, so it is genuinely new. ON CONFLICT DO NOTHING makes
  -- this safe from two tabs at once.
  insert into public.account_onboarding (user_id, status)
  values (_uid, 'pending')
  on conflict (user_id) do nothing;

  select ao.status into _status
    from public.account_onboarding ao
   where ao.user_id = _uid;

  if _status is distinct from 'pending' then
    outcome := 'already_resolved';
    status := _status;
    return next;
    return;
  end if;

  -- A browser with no identity at all cannot be holding guest history. This
  -- is the ordinary "signed up on a fresh browser" path and the path a
  -- legacy browser reaches after replacing its unusable credential.
  if _device_id is null or _device_token is null
     or btrim(_device_id) = '' or _device_id = 'unknown' then
    update public.account_onboarding
       set status = 'no_guest_history', decided_at = now()
     where account_onboarding.user_id = _uid
       and account_onboarding.status = 'pending';
    outcome := 'no_guest_history';
    status := 'no_guest_history';
    return next;
    return;
  end if;

  if not public.verify_device(_device_id, _device_token) then
    outcome := 'credential_invalid';
    status := 'pending';
    return next;
    return;
  end if;

  if not public.device_has_importable_history(_device_id) then
    update public.account_onboarding
       set status = 'no_guest_history', decided_at = now()
     where account_onboarding.user_id = _uid
       and account_onboarding.status = 'pending';
    outcome := 'no_guest_history';
    status := 'no_guest_history';
    return next;
    return;
  end if;

  outcome := 'import_available';
  status := 'pending';

  select count(*)::integer into games_played
    from public.game_sessions gs
   where gs.device_id = _device_id
     and gs.user_id is null
     and gs.status in ('won', 'lost');

  -- A device can legitimately carry more than one anonymous streak row (there
  -- is no unique constraint on user_streaks.device_id, and production already
  -- contains such pairs), so this picks the strongest rather than assuming
  -- one exists.
  select coalesce(us.current_streak, 0), coalesce(us.longest_streak, 0)
    into current_streak, longest_streak
    from public.user_streaks us
   where us.device_id = _device_id
     and us.user_id is null
   order by coalesce(us.longest_streak, 0) desc, coalesce(us.current_streak, 0) desc
   limit 1;

  current_streak := coalesce(current_streak, 0);
  longest_streak := coalesce(longest_streak, 0);
  return next;
end;
$$;

revoke all on function public.resolve_onboarding(text, text) from public, anon;
grant execute on function public.resolve_onboarding(text, text) to authenticated, service_role;
