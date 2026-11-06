-- PROPOSED, UNNUMBERED, NEVER APPLIED. Hamburgle results in the shared hub
-- (docs/social/HAMBURGLE-GATEWAY-PROPOSAL.md). It gets the next free patch
-- number only when the coordinator serializes it with the other pending shared
-- patches (the Rainbow redesign's unapplied 0012_recent_completions.sql is one;
-- it touches none of these functions). Coordinate with the shared architecture
-- owner before application.
--
-- Runs on the released hub through Mini (0011). No grants, tables, data or
-- deletes: three function bodies only.
--   game_enabled   Hamburgle joins the enabled games.
--   result_fits    0011's body exactly, with only the hamburgle branch changed.
--   list_results   The released body, with one change: in a Hamburgle group a
--                  current member's earlier results show too (history on join).
-- Rollback: shared-service/proposed/hamburgle_results_rollback.sql.
begin;

-- Each function must be exactly as released (result_fits as 0011 left it), or
-- already exactly as this patch leaves it. Anything else, such as a hub without
-- Mini or another patch that replaced one of them first, is refused and nothing
-- changes: rebase this file on what is there instead.
do $$
declare
  v_expected constant jsonb := jsonb_build_object(
    'social.game_enabled(text)', jsonb_build_array('f74654f15b40d6cee25985a4d364872d', '6adb88582548314e095f1695fac6b419'),
    'social.result_fits(text,jsonb,jsonb)', jsonb_build_array('db3cb694e4cabaa4ce28f2119fb3ca53', '45f0419c3406b11df24bbc732a08f116'),
    'social.list_results(text,text,text,text)', jsonb_build_array('7a71c3053c5550e90f1690b7ba3dba5b', '1841b43f574c07c619a7ffc97eb607e4'));
  v_fn text;
  v_body text;
begin
  for v_fn in select jsonb_object_keys(v_expected) loop
    select md5(p.prosrc) into v_body from pg_proc p where p.oid = to_regprocedure(v_fn);
    if v_body is null or not (v_expected -> v_fn) ? v_body then
      raise exception 'hamburgle_results: % is not the released body this patch is based on (Mini 0011 for result_fits). Nothing was changed.', v_fn;
    end if;
  end loop;
end;
$$;

-- Only record_completion asks this.
create or replace function social.game_enabled(p_game text)
returns boolean
language sql
immutable
set search_path = social, pg_temp
as $$
  select coalesce(p_game in ('rainbow', 'crosspuns', 'cluevoyance', 'wtf', 'hamburgle'), false)
$$;

create or replace function social.result_fits(p_game text, p_summary jsonb, p_detail jsonb)
returns boolean
language plpgsql
immutable
set search_path = social, pg_temp
as $$
begin
  if p_summary is null or jsonb_typeof(p_summary) <> 'object' then
    return false;
  end if;
  case p_game
    when 'rainbow' then
      -- An optional solve time in whole seconds, at least 1. The Mini sends it;
      -- the Full never does, and a result without it still fits as before.
      return (social.has_keys(p_summary, array['mistakes', 'solved'])
              or (social.has_keys(p_summary, array['mistakes', 'seconds', 'solved'])
                  and case when social.is_count(p_summary -> 'seconds')
                           then (p_summary -> 'seconds')::numeric >= 1
                           else false end))
        and jsonb_typeof(p_summary -> 'solved') = 'boolean'
        and social.is_count(p_summary -> 'mistakes')
        and social.is_grid(p_detail);
    when 'crosspuns' then
      return social.has_keys(p_summary, array['seconds'])
        and social.is_count(p_summary -> 'seconds')
        and p_detail is null;
    when 'wtf' then
      return social.has_keys(p_summary, array['score'])
        and social.is_count(p_summary -> 'score')
        and social.is_answers(p_detail);
    when 'yodel', 'priceiswhat' then
      return social.has_keys(p_summary, array['score'])
        and social.is_count(p_summary -> 'score')
        and p_detail is null;
    when 'hamburgle' then
      -- Exactly { guesses, solved }: guesses a whole number of at least 1,
      -- solved true or false, and no detail.
      return social.has_keys(p_summary, array['guesses', 'solved'])
        and jsonb_typeof(p_summary -> 'solved') = 'boolean'
        and case when social.is_count(p_summary -> 'guesses')
                 then (p_summary -> 'guesses')::numeric >= 1
                 else false end
        and p_detail is null;
    else
      return false;
  end case;
end;
$$;

create or replace function social.list_results(p_global_user_id text, p_game text, p_puzzle_id text, p_group text default null)
returns jsonb
language plpgsql
security definer
set search_path = social, pg_temp
as $$
declare
  v_me uuid := social.person_of(p_global_user_id);
  v_group uuid := social.as_uuid(p_group);
  v_finished boolean;
  v_rows jsonb;
begin
  if v_me is null then
    return social.fail('not_linked');
  end if;
  -- Asks p_group, not v_group: a made-up id must get this answer, not the friends.
  if p_group is not null and not exists (
    select 1 from social.memberships m where m.group_id = v_group and m.person_id = v_me
  ) then
    return social.fail('not_a_member');
  end if;
  v_finished := exists (
    select 1 from social.result_cards c
     where c.game = p_game and c.puzzle_id = p_puzzle_id and c.person_id = v_me
  );

  with audience as (
    select jsonb_build_object('memberRef', m.id) as ref, m.person_id, m.name,
           greatest(m.joined_at, mine.joined_at) as connected_at, m.joined_at as place, m.id as tie
      from social.memberships m
      join social.memberships mine on mine.group_id = m.group_id and mine.person_id = v_me
     where m.group_id = v_group
    union all
    select jsonb_build_object('friendRef', f.id), other.id, other.display_name, f.since, f.since, f.id
      from social.friendships f
      join social.persons other on other.id = case when f.person_a = v_me then f.person_b else f.person_a end
     where p_group is null and v_me in (f.person_a, f.person_b)
    union all
    select jsonb_build_object('friendRef', null::uuid), me.id, me.display_name, '-infinity'::timestamptz, '-infinity'::timestamptz, me.id
      from social.persons me
     where p_group is null and me.id = v_me
  ),
  cards as (
    select c.person_id, c.completed_at, c.summary, c.detail is not null as has_detail
      from social.result_cards c
     where c.game = p_game and c.puzzle_id = p_puzzle_id
  )
  select coalesce(
           jsonb_agg(
             a.ref
             || jsonb_build_object('isMe', a.person_id = v_me, 'name', a.name, 'animalId', p.animal_id, 'backgroundColor', p.background_color, 'summary', c.summary)
             || case
                  when not c.has_detail then jsonb_build_object('detail', null::jsonb, 'detailLocked', false)
                  when v_finished then jsonb_build_object(
                    'detail', (
                      select d.detail from social.result_cards d
                       where d.game = p_game and d.puzzle_id = p_puzzle_id and d.person_id = a.person_id
                    ),
                    'detailLocked', false
                  )
                  else jsonb_build_object('detailLocked', true)
                end
             order by a.place, a.tie
           ),
           '[]'::jsonb
         )
    into v_rows
    from audience a
    join cards c on c.person_id = a.person_id
    join social.persons p on p.id = a.person_id
   where a.person_id = v_me
      or (not social.blocked_either_way(v_me, a.person_id)
          and (c.completed_at >= a.connected_at
               -- Provisional (architecture owner decides the scope): in a Hamburgle
               -- group, a current member brings every earlier result too. Only
               -- current memberships are in the audience, so someone who left or
               -- was removed still has no row. Friends stay forward-only.
               or (p_group is not null and p_game = 'hamburgle')));
  return social.ok(v_rows);
end;
$$;

commit;
