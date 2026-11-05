-- Local, unapplied explicit owner actions. Existing invite policy is unchanged.
begin;
create or replace function social.transfer_group_ownership(p_global_user_id text,p_group_id text,p_member_ref text)
returns jsonb language plpgsql security definer set search_path = social, pg_temp as $$
declare v_me uuid:=social.person_of(p_global_user_id);v_group uuid:=social.as_uuid(p_group_id);v_target uuid;v_refusal text;
begin
 if v_me is null then return social.fail('not_linked');end if;
 perform 1 from social.groups where id=v_group for update;
 v_refusal:=social.owner_refusal(v_group,v_me);if v_refusal is not null then return social.fail(v_refusal);end if;
 select person_id into v_target from social.memberships where group_id=v_group and id=social.as_uuid(p_member_ref) for key share;
 if v_target is null then return social.fail('not_found');end if;
 update social.groups set owner_id=v_target,updated_at=now() where id=v_group;
 return social.ok();
end;
$$;
create or replace function social.delete_group(p_global_user_id text,p_group_id text)
returns jsonb language plpgsql security definer set search_path = social, pg_temp as $$
declare v_me uuid:=social.person_of(p_global_user_id);v_group uuid:=social.as_uuid(p_group_id);v_refusal text;
begin
 if v_me is null then return social.fail('not_linked');end if;
 perform 1 from social.groups where id=v_group for update;
 v_refusal:=social.owner_refusal(v_group,v_me);if v_refusal is not null then return social.fail(v_refusal);end if;
 -- Cascades only group-owned rows. Person/completion rows have no group ownership.
 delete from social.groups where id=v_group;
 return social.ok();
end;
$$;
revoke all on function social.transfer_group_ownership(text,text,text),social.delete_group(text,text) from public,anon,authenticated,service_role;
grant execute on function social.transfer_group_ownership(text,text,text),social.delete_group(text,text) to social_gateway;
commit;
