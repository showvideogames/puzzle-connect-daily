-- Local-only additive reader. Reads previously accepted official completion cards;
-- it never imports sessions or changes eligibility/replay/connection policy.
begin;
create index if not exists result_cards_recent_person on social.result_cards(game, person_id, completed_at desc, puzzle_id);
create or replace function social.recent_completions(p_global_user_id text, p_from text, p_until text, p_friend text default null)
returns jsonb language plpgsql security definer set search_path = social, pg_temp as $$
declare
 v_me uuid := social.person_of(p_global_user_id);
 v_from timestamptz;
 v_until timestamptz;
 v_rows jsonb;
begin
 if v_me is null then return social.fail('not_linked'); end if;
 -- Explicit UTC boundaries, computed from the viewer's local calendar. Max 8 days
 -- permits a seven-calendar-day window across daylight-saving changes.
 if p_from is null or p_until is null or p_from !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' or p_until !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' then return social.fail('unavailable'); end if;
 begin v_from := p_from::timestamptz; v_until := p_until::timestamptz;
 exception when others then return social.fail('unavailable'); end;
 if v_until <= v_from or v_until-v_from > interval '8 days' then return social.fail('unavailable'); end if;
 with eligible as (
  select f.id as friend_ref, other.id as person_id, other.display_name, other.animal_id, other.background_color,
         c.puzzle_id, c.completed_at, c.summary, c.detail is not null as has_detail,
         exists(select 1 from social.result_cards mine where mine.person_id=v_me and mine.game='rainbow' and mine.puzzle_id=c.puzzle_id) as unlocked
  from social.friendships f
  join social.persons other on other.id=case when f.person_a=v_me then f.person_b else f.person_a end
  join social.result_cards c on c.person_id=other.id and c.game='rainbow'
  where v_me in (f.person_a,f.person_b)
    and (p_friend is null or f.id=social.as_uuid(p_friend))
    and not social.blocked_either_way(v_me,other.id)
    and c.completed_at >= f.since
    and c.completed_at >= v_from and c.completed_at < v_until
    and c.completed_at <= now()
  order by c.completed_at desc, c.puzzle_id, f.id
  limit 26
 ), shaped as (
  select e.completed_at,e.puzzle_id,e.friend_ref,
   jsonb_build_object(
    'puzzleId',e.puzzle_id,
    'completedAt',to_char(e.completed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'puzzleDate',p.date::text,'puzzleTitle',p.title,
    'result',jsonb_build_object('friendRef',e.friend_ref,'isMe',false,'name',e.display_name,'animalId',e.animal_id,'backgroundColor',e.background_color,'summary',e.summary)
      || case when not e.has_detail then jsonb_build_object('detailLocked',false,'detail',null::jsonb) when e.unlocked then jsonb_build_object('detailLocked',false,'detail',(select d.detail from social.result_cards d where d.person_id=e.person_id and d.game='rainbow' and d.puzzle_id=e.puzzle_id))
              else jsonb_build_object('detailLocked',true) end
   ) as row
  from eligible e
  -- Never return unpublished puzzle metadata. Missing metadata doesn't erase a completion.
  left join public.puzzles p on p.id::text=e.puzzle_id and p.is_published is true and p.format='full'
 ) select coalesce(jsonb_agg(row order by completed_at desc,puzzle_id,friend_ref),'[]'::jsonb) into v_rows from shaped;
 return social.ok(jsonb_build_object('rows',coalesce((select jsonb_agg(value order by ordinality) from jsonb_array_elements(v_rows) with ordinality where ordinality<=25),'[]'::jsonb),'hasMore',jsonb_array_length(v_rows)>25));
end;
$$;
revoke all on function social.recent_completions(text,text,text,text) from public,anon,authenticated,service_role,social_game_server;
grant execute on function social.recent_completions(text,text,text,text) to social_gateway;
commit;
