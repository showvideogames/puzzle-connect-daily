-- Local, unapplied. Private navigation order only; no leaderboard/result changes.
begin;
alter table social.memberships add column if not exists private_position int check (private_position between 0 and 49);
create or replace function social.list_group_order(p_global_user_id text)
returns jsonb language plpgsql security definer set search_path = social, pg_temp as $$
declare v_me uuid := social.person_of(p_global_user_id); v_ids jsonb;
begin
  if v_me is null then return social.fail('not_linked'); end if;
  select coalesce(jsonb_agg(group_id order by private_position nulls last, joined_at, id),'[]'::jsonb) into v_ids
    from social.memberships where person_id = v_me;
  return social.ok(jsonb_build_object('groupIds',v_ids));
end;
$$;
create or replace function social.set_group_order(p_global_user_id text, p_group_ids text[])
returns jsonb language plpgsql security definer set search_path = social, pg_temp as $$
declare v_me uuid := social.person_of(p_global_user_id); v_count int;
begin
  if v_me is null then return social.fail('not_linked'); end if;
  if p_group_ids is null or cardinality(p_group_ids) > 50 or array_ndims(p_group_ids) > 1 then return social.fail('not_found'); end if;
  -- Serialize concurrent order saves. Membership operations retain their existing permissions.
  perform 1 from social.persons where id = v_me for update;
  select count(*) into v_count from social.memberships where person_id = v_me;
  if cardinality(p_group_ids) <> v_count
    or (select count(distinct social.as_uuid(g)) from unnest(p_group_ids) g) <> v_count
    or exists(select 1 from unnest(p_group_ids) g where not exists(select 1 from social.memberships m where m.person_id = v_me and m.group_id = social.as_uuid(g)))
    then return social.fail('not_found'); end if;
  update social.memberships m set private_position = ordered.position::int - 1
    from unnest(p_group_ids) with ordinality ordered(group_id,position)
    where m.person_id = v_me and m.group_id = social.as_uuid(ordered.group_id);
  return social.ok();
end;
$$;
revoke all on function social.list_group_order(text), social.set_group_order(text,text[]) from public, anon, authenticated, service_role;
grant execute on function social.list_group_order(text), social.set_group_order(text,text[]) to social_gateway;
commit;
