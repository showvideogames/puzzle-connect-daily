-- Local, unapplied clubhouse description extension. Plain text, members only.
begin;
alter table social.groups add column if not exists description text check(description is null or char_length(description) <= 500);
create or replace function social.get_group_description(p_global_user_id text,p_group_id text)
returns jsonb language plpgsql security definer set search_path = social, pg_temp as $$
declare v_me uuid := social.person_of(p_global_user_id); v_group uuid := social.as_uuid(p_group_id); v_description text;
begin
 if v_me is null then return social.fail('not_linked'); end if;
 if not exists(select 1 from social.memberships where person_id=v_me and group_id=v_group) then return social.fail('not_a_member'); end if;
 select description into v_description from social.groups where id=v_group;
 return social.ok(jsonb_build_object('description',v_description));
end;
$$;
create or replace function social.set_group_description(p_global_user_id text,p_group_id text,p_description text)
returns jsonb language plpgsql security definer set search_path = social, pg_temp as $$
declare v_me uuid := social.person_of(p_global_user_id); v_group uuid := social.as_uuid(p_group_id); v_description text; v_refusal text;
begin
 if v_me is null then return social.fail('not_linked'); end if;
 perform 1 from social.groups where id=v_group for update;
 v_refusal := social.owner_refusal(v_group,v_me);
 if v_refusal is not null then return social.fail(v_refusal); end if;
 if p_description is not null and char_length(p_description)>500 then return social.fail('bad_description'); end if;
 v_description := social.clean_name(p_description,500);
 update social.groups set description=v_description,updated_at=now() where id=v_group;
 return social.ok(jsonb_build_object('description',v_description));
end;
$$;
revoke all on function social.get_group_description(text,text), social.set_group_description(text,text,text) from public,anon,authenticated,service_role;
grant execute on function social.get_group_description(text,text), social.set_group_description(text,text,text) to social_gateway;
commit;
