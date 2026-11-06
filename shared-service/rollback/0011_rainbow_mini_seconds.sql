begin;
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
      return social.has_keys(p_summary, array['mistakes', 'solved'])
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
      return social.has_keys(p_summary, array['guesses'])
        and social.is_count(p_summary -> 'guesses')
        and p_detail is null;
    else
      return false;
  end case;
end;
$$;
commit;
