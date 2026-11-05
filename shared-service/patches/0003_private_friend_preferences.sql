-- Local, unapplied shared-hub extension. Deploy SQL and gateway before enabling the UI.
begin;
create table if not exists social.friend_preferences (
  person_id uuid not null references social.persons(id) on delete cascade,
  friendship_id uuid not null references social.friendships(id) on delete cascade,
  favorite boolean not null default false,
  nickname text check (nickname is null or (char_length(nickname) between 1 and 24)),
  primary key (person_id, friendship_id)
);
alter table social.friend_preferences enable row level security;
revoke all on social.friend_preferences from public, anon, authenticated, service_role, social_gateway;

create or replace function social.list_friend_preferences(p_global_user_id text)
returns jsonb language plpgsql security definer set search_path = social, pg_temp as $$
declare v_me uuid := social.person_of(p_global_user_id); v_rows jsonb;
begin
  if v_me is null then return social.fail('not_linked'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('friendRef', p.friendship_id, 'favorite', p.favorite, 'nickname', p.nickname) order by p.friendship_id), '[]'::jsonb)
    into v_rows from social.friend_preferences p join social.friendships f on f.id = p.friendship_id
    where p.person_id = v_me and v_me in (f.person_a, f.person_b);
  return social.ok(v_rows);
end;
$$;
create or replace function social.set_friend_preference(p_global_user_id text, p_friend_ref text, p_favorite boolean, p_nickname text)
returns jsonb language plpgsql security definer set search_path = social, pg_temp as $$
declare v_me uuid := social.person_of(p_global_user_id); v_ref uuid; v_nickname text;
begin
  if v_me is null then return social.fail('not_linked'); end if;
  -- Lock the relationship while saving so a concurrent removal cannot recreate preferences.
  select id into v_ref from social.friendships where id = social.as_uuid(p_friend_ref) and v_me in (person_a, person_b) for key share;
  if v_ref is null then return social.fail('not_found'); end if;
  if p_favorite is null then return social.fail('unavailable'); end if;
  if p_nickname is not null then
    v_nickname := social.clean_name(p_nickname, 24);
    if v_nickname is null then return social.fail('bad_name'); end if;
  end if;
  insert into social.friend_preferences(person_id, friendship_id, favorite, nickname) values(v_me, v_ref, p_favorite, v_nickname)
    on conflict(person_id, friendship_id) do update set favorite = excluded.favorite, nickname = excluded.nickname;
  return social.ok(jsonb_build_object('friendRef', v_ref, 'favorite', p_favorite, 'nickname', v_nickname));
end;
$$;
revoke all on function social.list_friend_preferences(text), social.set_friend_preference(text,text,boolean,text) from public, anon, authenticated, service_role;
grant execute on function social.list_friend_preferences(text), social.set_friend_preference(text,text,boolean,text) to social_gateway;
commit;
