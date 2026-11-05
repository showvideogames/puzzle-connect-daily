-- Local/unapplied. Publication-date rolling reader; ordinary block/result paths unchanged.
-- Requires CrossPuns public.xw_accounts/xw_times/xw_solves/xw_puzzles + xw_today_local.
begin;
create or replace function social.crosspuns_standings_period(p_global_user_id text, p_group text, p_offset int, p_days int, p_through text)
returns jsonb language plpgsql security definer set search_path = social, pg_temp as $$
declare v_me uuid := social.person_of(p_global_user_id); v_group uuid := social.as_uuid(p_group); v_rows jsonb; v_total int; v_end date;
begin
  if p_days is null and p_through is null then return social.crosspuns_standings(p_global_user_id,p_group,p_offset); end if;
  if p_days is null or p_days not in (7,30,365) or p_through is null or p_through !~ '^\d{4}-\d{2}-\d{2}$' then return social.fail('not_found'); end if;
  begin v_end := p_through::date;
  exception when invalid_datetime_format or datetime_field_overflow then return social.fail('not_found'); end;
  if to_char(v_end,'YYYY-MM-DD') <> p_through then return social.fail('not_found'); end if;
  if v_me is null then return social.fail('not_linked'); end if;
  -- Hold the caller's membership through the read; concurrent departure waits.
  perform 1 from social.memberships where group_id=v_group and person_id=v_me for share;
  if not found then return social.fail('not_a_member'); end if;
  if p_offset is null or p_offset < 0 or p_offset > 10000 then return social.fail('not_found'); end if;
  -- All current memberships, including either-direction blocks, determine rank.
  -- Source precedence matches xw_group_board. No join-date cutoff or history write.
  with members as (
    select m.id, m.person_id, m.name, a.id as account_id, a.player_key
    from social.memberships m join social.persons p on p.id=m.person_id
    left join public.xw_accounts a on a.global_user_id=p.global_user_id
    where m.group_id=v_group
  ), eligible as (
    select m.id, t.puzzle_id, t.seconds from members m
      join public.xw_times t on t.player_key=m.player_key
      join public.xw_puzzles p on p.id=t.puzzle_id
      where p.publish_date <= public.xw_today_local()
        and p.publish_date between v_end-(p_days-1) and v_end
    union all
    select m.id, s.puzzle_id, s.seconds from members m
      join public.xw_solves s on s.account_id=m.account_id and s.used_help=false
      join public.xw_puzzles p on p.id=s.puzzle_id
      where p.publish_date <= public.xw_today_local()
        and p.publish_date between v_end-(p_days-1) and v_end
        and not exists(select 1 from public.xw_times t where t.player_key=m.player_key and t.puzzle_id=s.puzzle_id)
  ), placements as (
    select id, greatest(0,4-rank() over(partition by puzzle_id order by seconds)) as points from eligible
  ), totals as (
    select m.id,m.person_id,m.name,coalesce(sum(p.points),0)::bigint as points
      from members m left join placements p on p.id=m.id group by m.id,m.person_id,m.name
  ), ranked as (
    select *,rank() over(order by points desc) as rank from totals
  ), page as (
    select * from ranked order by rank,id offset p_offset limit 50
  )
  select (select count(*)::int from members), coalesce(jsonb_agg(
    case when social.blocked_either_way(v_me,person_id) then
      jsonb_build_object('blocked',true,'rank',rank,'label','This player is blocked')
    else jsonb_build_object('blocked',false,'rank',rank,'memberRef',id,'name',name,'points',points) end
    order by rank,id),'[]'::jsonb) into v_total,v_rows from page;
  return social.ok(jsonb_build_object('rows',v_rows,'total',v_total));
exception when undefined_table or undefined_function then
  -- Missing source deployment is unavailable, never an invented empty board.
  return social.fail('unavailable');
end;
$$;
revoke all on function social.crosspuns_standings_period(text,text,int,int,text) from public,anon,authenticated,service_role;
grant execute on function social.crosspuns_standings_period(text,text,int,int,text) to social_gateway;
commit;
