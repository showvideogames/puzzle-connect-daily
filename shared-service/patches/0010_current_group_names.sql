-- Resolve group labels at read time; preserve membership snapshots and all scores.
begin;
create or replace function social.group_member_name(p_viewer uuid, p_subject uuid, p_legacy text)
returns text language sql stable set search_path = social, pg_temp as $$
 select coalesce(
   (select nullif(btrim(fp.nickname),'') from social.friend_preferences fp
     join social.friendships f on f.id=fp.friendship_id
     where fp.person_id=p_viewer and p_viewer<>p_subject
       and ((f.person_a=p_viewer and f.person_b=p_subject) or (f.person_b=p_viewer and f.person_a=p_subject))),
   (select nullif(btrim(p.display_name),'') from social.persons p where p.id=p_subject),
   nullif(btrim(p_legacy),''), 'Player');
$$;
revoke all on function social.group_member_name(uuid,uuid,text) from public, anon, authenticated, service_role, social_gateway, social_game_server;



create or replace function social.list_members(p_global_user_id text, p_group text, p_after_joined timestamptz default null, p_after_ref text default null, p_limit int default 100)
returns jsonb
language plpgsql
security definer
set search_path = social, pg_temp
as $$
declare
  v_me uuid := social.person_of(p_global_user_id);
  v_group uuid := social.as_uuid(p_group);
  v_owner uuid;
  v_rows jsonb;
begin
  if v_me is null then
    return social.fail('not_linked');
  end if;
  if not exists (select 1 from social.memberships m where m.group_id = v_group and m.person_id = v_me) then
    return social.fail('not_a_member');
  end if;
  select g.owner_id into v_owner from social.groups g where g.id = v_group;
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'memberRef', t.id,
               'name', t.name,
               'animalId', t.animal_id,
               'backgroundColor', t.background_color,
               'isOwner', t.person_id = v_owner,
               'isMe', t.person_id = v_me,
               'joinedAt', social.iso(t.joined_at)
             )
             order by t.joined_at, t.id
           ),
           '[]'::jsonb
         )
    into v_rows
    from (
      select m.id, social.group_member_name(v_me,m.person_id,m.name) as name, m.person_id, m.joined_at, p.animal_id, p.background_color
        from social.memberships m
        join social.persons p on p.id = m.person_id
       where m.group_id = v_group
         and (p_after_joined is null
              or (m.joined_at, m.id) > (p_after_joined, coalesce(social.as_uuid(p_after_ref), '00000000-0000-0000-0000-000000000000'::uuid)))
       order by m.joined_at, m.id
       limit least(greatest(coalesce(p_limit, 100), 1), 100)
    ) t;
  return social.ok(v_rows);
end;
$$;

create or replace function social.crosspuns_standings(p_global_user_id text, p_group text, p_offset int default 0)
returns jsonb language plpgsql security definer set search_path = social, pg_temp as $$
declare v_me uuid := social.person_of(p_global_user_id); v_group uuid := social.as_uuid(p_group); v_rows jsonb; v_total int;
begin
  if v_me is null then return social.fail('not_linked'); end if;
  -- Hold the caller's membership through the read; concurrent departure waits.
  perform 1 from social.memberships where group_id=v_group and person_id=v_me for share;
  if not found then return social.fail('not_a_member'); end if;
  if p_offset is null or p_offset < 0 or p_offset > 10000 then return social.fail('not_found'); end if;
  -- All current memberships, including either-direction blocks, determine rank.
  -- Source precedence matches xw_group_board. No join-date cutoff or history write.
  with members as (
    select m.id, m.person_id, social.group_member_name(v_me,m.person_id,m.name) as name, p.animal_id, p.background_color, a.id as account_id, a.player_key
    from social.memberships m join social.persons p on p.id=m.person_id
    left join public.xw_accounts a on a.global_user_id=p.global_user_id
    where m.group_id=v_group
  ), eligible as (
    select m.id, t.puzzle_id, t.seconds from members m
      join public.xw_times t on t.player_key=m.player_key
      join public.xw_puzzles p on p.id=t.puzzle_id
      where p.publish_date <= public.xw_today_local()
    union all
    select m.id, s.puzzle_id, s.seconds from members m
      join public.xw_solves s on s.account_id=m.account_id and s.used_help=false
      join public.xw_puzzles p on p.id=s.puzzle_id
      where p.publish_date <= public.xw_today_local()
        and not exists(select 1 from public.xw_times t where t.player_key=m.player_key and t.puzzle_id=s.puzzle_id)
  ), placements as (
    select id, greatest(0,4-rank() over(partition by puzzle_id order by seconds)) as points from eligible
  ), totals as (
    select m.id,m.person_id,m.name,m.animal_id,m.background_color,coalesce(sum(p.points),0)::bigint as points
      from members m left join placements p on p.id=m.id group by m.id,m.person_id,m.name,m.animal_id,m.background_color
  ), ranked as (
    select *,rank() over(order by points desc) as rank from totals
  ), page as (
    select * from ranked order by rank,id offset p_offset limit 25
  )
  select (select count(*)::int from members), coalesce(jsonb_agg(
    case when social.blocked_either_way(v_me,person_id) then
      jsonb_build_object('blocked',true,'rank',rank,'label','This player is blocked')
    else jsonb_build_object('blocked',false,'rank',rank,'memberRef',id,'name',name,'points',points,'animalId',animal_id,'backgroundColor',background_color) end
    order by rank,id),'[]'::jsonb) into v_total,v_rows from page;
  return social.ok(jsonb_build_object('rows',v_rows,'total',v_total));
exception when undefined_table or undefined_function then
  -- Missing source deployment is unavailable, never an invented empty board.
  return social.fail('unavailable');
end;
$$;

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
    select m.id, m.person_id, social.group_member_name(v_me,m.person_id,m.name) as name, p.animal_id, p.background_color, a.id as account_id, a.player_key
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
    select m.id,m.person_id,m.name,m.animal_id,m.background_color,coalesce(sum(p.points),0)::bigint as points
      from members m left join placements p on p.id=m.id group by m.id,m.person_id,m.name,m.animal_id,m.background_color
  ), ranked as (
    select *,rank() over(order by points desc) as rank from totals
  ), page as (
    select * from ranked order by rank,id offset p_offset limit 25
  )
  select (select count(*)::int from members), coalesce(jsonb_agg(
    case when social.blocked_either_way(v_me,person_id) then
      jsonb_build_object('blocked',true,'rank',rank,'label','This player is blocked')
    else jsonb_build_object('blocked',false,'rank',rank,'memberRef',id,'name',name,'points',points,'animalId',animal_id,'backgroundColor',background_color) end
    order by rank,id),'[]'::jsonb) into v_total,v_rows from page;
  return social.ok(jsonb_build_object('rows',v_rows,'total',v_total));
exception when undefined_table or undefined_function then
  -- Missing source deployment is unavailable, never an invented empty board.
  return social.fail('unavailable');
end;
$$;
commit;
