-- Local, unapplied. Delegated access to the existing reusable invitation code.
-- Revocation prevents future reads; already-shared links keep their existing behavior.
begin;
alter table social.memberships add column if not exists may_invite boolean not null default false;
create or replace function social.get_group_invitation(p_global_user_id text,p_group_id text)
returns jsonb language plpgsql security definer set search_path = social, pg_temp as $$
declare v_me uuid:=social.person_of(p_global_user_id);v_group uuid:=social.as_uuid(p_group_id);v_owner boolean;v_allowed boolean;v_code text;v_refs jsonb:='[]'::jsonb;
begin
 if v_me is null then return social.fail('not_linked');end if;
 select g.owner_id=v_me,(g.owner_id=v_me or m.may_invite) into v_owner,v_allowed
   from social.groups g join social.memberships m on m.group_id=g.id and m.person_id=v_me where g.id=v_group;
 if not found then return social.fail('not_a_member');end if;
 if v_allowed then select code into v_code from social.invites where group_id=v_group and kind='group';end if;
 if v_owner then select coalesce(jsonb_agg(id order by id),'[]'::jsonb) into v_refs from social.memberships where group_id=v_group and may_invite;end if;
 return social.ok(jsonb_build_object('canInvite',v_allowed,'inviteCode',v_code,'grantedMemberRefs',v_refs));
end;
$$;
create or replace function social.set_member_invite_permission(p_global_user_id text,p_group_id text,p_member_ref text,p_allowed boolean)
returns jsonb language plpgsql security definer set search_path = social, pg_temp as $$
declare v_me uuid:=social.person_of(p_global_user_id);v_group uuid:=social.as_uuid(p_group_id);v_refusal text;
begin
 if v_me is null then return social.fail('not_linked');end if;
 perform 1 from social.groups where id=v_group for update;
 v_refusal:=social.owner_refusal(v_group,v_me);if v_refusal is not null then return social.fail(v_refusal);end if;
 if p_allowed is null then return social.fail('not_found');end if;
 update social.memberships set may_invite=p_allowed where group_id=v_group and id=social.as_uuid(p_member_ref) and person_id<>v_me;
 if not found then return social.fail('not_found');end if;
 return social.ok();
end;
$$;
revoke all on function social.get_group_invitation(text,text),social.set_member_invite_permission(text,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function social.get_group_invitation(text,text),social.set_member_invite_permission(text,text,text,boolean) to social_gateway;
commit;
