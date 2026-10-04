-- ===========================================================================
-- Custom Puzzle Community layer
--
--   1. custom_puzzles.short_code   -- permanent, random, URL-safe /p/:shortCode
--   2. creator_profiles            -- minimal public slug for signed-in creators
--   3. custom_puzzle_favorites     -- one favorite per (account, puzzle)
--   4. RPCs: get_custom_puzzle_by_short_code, set_custom_puzzle_favorite,
--            get_my_favorites, get_creator_profile
--      Redefined (same signatures, extended safe result shape):
--            create_custom_puzzle, get_custom_puzzle
--
-- The definitions of create_custom_puzzle / get_custom_puzzle redefined here
-- are the LATEST ones (20260919000000; validate_custom_puzzle_content was
-- later repaired by 20260919020000 and is deliberately NOT touched here).
-- Every redefinition restates search_path, revoke and grants explicitly.
--
-- WHAT THIS DELIBERATELY DOES NOT TOUCH
--   No official/Beta table or function (puzzles, puzzle_groups, game_sessions,
--   guess_events, hint_events, game_results, user_streaks, puzzle_aggregates,
--   beta_*), no custom_puzzle_results rows, no existing custom puzzle content.
--   The two new tables are RLS-enabled with NO policies and NO grants to
--   anon/authenticated -- reachable only through the SECURITY DEFINER RPCs.
--
-- SHORT CODE
--   10 chars from a 54-character unambiguous alphabet (no 0/O/1/l/I/i):
--   54^10 ~ 2^57.5. Case-sensitive. Generated from gen_random_uuid() bytes
--   (a CSPRNG in core Postgres, no pgcrypto), skipping the fixed version/
--   variant bytes and rejecting bytes >= 216 so every character is uniform.
--   Uniqueness is enforced by a unique index; create_custom_puzzle retries on
--   collision. Possession of the code is the access mechanism for a Private
--   puzzle exactly as the long share_id already is; 57 bits is not
--   enumerable through an RPC. The long share_id keeps working forever.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Random helpers (internal: executed only by the SECURITY DEFINER RPCs)
-- ---------------------------------------------------------------------------
create or replace function public.custom_random_string(_alphabet text, _len integer)
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  _n     integer := length(_alphabet);
  _limit integer := 256 - (256 % _n);   -- reject the biased tail
  _out   text := '';
  _bytes bytea;
  _b     integer;
  _i     integer;
begin
  while length(_out) < _len loop
    _bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    for _i in 0 .. 15 loop
      -- bytes 6 and 8 carry the fixed UUID version/variant bits: not uniform.
      continue when _i in (6, 8);
      _b := get_byte(_bytes, _i);
      if _b < _limit then
        _out := _out || substr(_alphabet, (_b % _n) + 1, 1);
        exit when length(_out) = _len;
      end if;
    end loop;
  end loop;
  return _out;
end;
$$;

revoke all on function public.custom_random_string(text, integer) from public, anon, authenticated;

create or replace function public.custom_puzzle_new_short_code()
returns text
language sql
volatile
set search_path = public
as $$
  select public.custom_random_string(
    '23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz', 10)
$$;

revoke all on function public.custom_puzzle_new_short_code() from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. custom_puzzles.short_code (add -> unique -> backfill -> NOT NULL)
-- ---------------------------------------------------------------------------
alter table public.custom_puzzles add column short_code text;

create unique index custom_puzzles_short_code_key on public.custom_puzzles (short_code);

do $$
declare
  _r    record;
  _code text;
begin
  for _r in select id from public.custom_puzzles where short_code is null loop
    loop
      _code := public.custom_puzzle_new_short_code();
      begin
        update public.custom_puzzles set short_code = _code where id = _r.id;
        exit;
      exception when unique_violation then
        null; -- collision: draw another code for this row
      end;
    end loop;
  end loop;
end;
$$;

alter table public.custom_puzzles alter column short_code set not null;
alter table public.custom_puzzles
  add constraint custom_puzzles_short_code_format
  check (short_code ~ '^[2-9A-HJKMNP-Za-hjkmnp-z]{8,12}$');

comment on column public.custom_puzzles.short_code is
  'Permanent random URL-safe code for /p/:shortCode. Case-sensitive, unique. Possession is the access mechanism for a Private puzzle, exactly like share_id.';


-- ---------------------------------------------------------------------------
-- 3. creator_profiles -- the smallest safe public identity for a signed-in creator
--
-- There was no profile/username table. Only a public slug and the display
-- name the creator already published on their puzzles are stored: no email,
-- no other account data. The route uses the slug, never the auth UUID.
-- ---------------------------------------------------------------------------
create table public.creator_profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  public_slug  text not null unique
               check (public_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(public_slug) between 3 and 48),
  display_name text not null,
  created_at   timestamptz not null default now()
);

alter table public.creator_profiles enable row level security;
revoke all on table public.creator_profiles from anon, authenticated;

comment on table public.creator_profiles is
  'Public creator identity for signed-in custom-puzzle authors: slug + the display name they already published. Created lazily by create_custom_puzzle. Read only through get_creator_profile.';

create or replace function public.custom_creator_new_slug(_name text)
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  _base text;
begin
  _base := btrim(regexp_replace(lower(btrim(coalesce(_name, ''))), '[^a-z0-9]+', '-', 'g'), '-');
  _base := btrim(left(_base, 30), '-');
  if length(_base) < 2 then
    _base := 'creator';
  end if;
  return _base || '-' || public.custom_random_string('23456789abcdefghjkmnpqrstuvwxyz', 4);
end;
$$;

revoke all on function public.custom_creator_new_slug(text) from public, anon, authenticated;

create or replace function public.custom_ensure_creator_profile(_uid uuid, _name text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  _tries integer := 0;
begin
  if _uid is null or exists (select 1 from public.creator_profiles where user_id = _uid) then
    return;
  end if;
  loop
    begin
      insert into public.creator_profiles (user_id, public_slug, display_name)
      values (_uid, public.custom_creator_new_slug(_name), left(btrim(_name), 60))
      on conflict (user_id) do nothing;
      exit;
    exception when unique_violation then
      _tries := _tries + 1;      -- slug collision: draw a new suffix
      if _tries >= 10 then raise; end if;
    end;
  end loop;
end;
$$;

revoke all on function public.custom_ensure_creator_profile(uuid, text) from public, anon, authenticated;

-- Existing signed-in creators: one profile each, named after the byline of
-- their most recent puzzle (already public on that puzzle).
do $$
declare
  _r record;
begin
  for _r in
    select distinct on (created_by) created_by, creator_name
      from public.custom_puzzles
     where created_by is not null
     order by created_by, created_at desc
  loop
    perform public.custom_ensure_creator_profile(_r.created_by, _r.creator_name);
  end loop;
end;
$$;

-- Serves get_creator_profile's listing of one creator's public puzzles.
create index custom_puzzles_public_by_creator_idx
  on public.custom_puzzles (created_by, created_at desc)
  where visibility = 'public' and moderation_status = 'active' and created_by is not null;


-- ---------------------------------------------------------------------------
-- 4. custom_puzzle_favorites -- one favorite per (account, puzzle)
--
-- Anonymous/guest favorites never reach the database (they live in the
-- browser), so only authenticated favorites can ever count.
-- ---------------------------------------------------------------------------
create table public.custom_puzzle_favorites (
  custom_puzzle_id uuid not null references public.custom_puzzles(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  created_at       timestamptz not null default now(),
  primary key (custom_puzzle_id, user_id)
);

alter table public.custom_puzzle_favorites enable row level security;
revoke all on table public.custom_puzzle_favorites from anon, authenticated;

comment on table public.custom_puzzle_favorites is
  'One row per (account, custom puzzle). No email or profile data. Written only by set_custom_puzzle_favorite (auth.uid() only); read only in aggregate or as the caller''s own list.';

create index custom_puzzle_favorites_user_idx
  on public.custom_puzzle_favorites (user_id, created_at desc);


-- ---------------------------------------------------------------------------
-- 5. The single safe public puzzle shape, shared by BOTH lookups
--    (long share_id and short_code), so they can never drift apart.
-- ---------------------------------------------------------------------------
create or replace function public.custom_puzzle_public_json(_p public.custom_puzzles)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id',              _p.id,
    'share_id',        _p.share_id,
    'short_code',      _p.short_code,
    'title',           _p.title,
    'creator_name',    _p.creator_name,
    'visibility',      _p.visibility,
    'content',         _p.content,
    -- Only a signed-in creator has a profile; anonymous puzzles stay unlinked.
    'creator_slug',    (select cp.public_slug from public.creator_profiles cp where cp.user_id = _p.created_by),
    'favorite_count',  (select count(*) from public.custom_puzzle_favorites f where f.custom_puzzle_id = _p.id),
    'favorited_by_me', exists (
      select 1 from public.custom_puzzle_favorites f
       where f.custom_puzzle_id = _p.id and f.user_id = auth.uid()
    )
  )
$$;

revoke all on function public.custom_puzzle_public_json(public.custom_puzzles) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 6. create_custom_puzzle -- redefined from 20260919000000 (same signature)
--    + short_code with collision retry, + lazy creator profile.
-- ---------------------------------------------------------------------------
create or replace function public.create_custom_puzzle(
  _creator_name text,
  _title text,
  _visibility text,
  _content jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  _uid        uuid := auth.uid();
  _canonical  jsonb;
  _title_n    text;
  _creator_n  text;
  _share_id   text;
  _short_code text;
  _id         uuid;
  _tries      integer := 0;
begin
  if _visibility not in ('public', 'private') then
    raise exception 'visibility must be public or private' using errcode = 'invalid_parameter_value';
  end if;

  _canonical := public.validate_custom_puzzle_content(_content);

  _title_n := nullif(btrim(coalesce(_title, '')), '');
  if _title_n is null then
    raise exception 'a puzzle needs a title' using errcode = 'invalid_parameter_value';
  end if;
  if length(_title_n) > 100 then
    raise exception 'title is too long (max 100 characters)' using errcode = 'invalid_parameter_value';
  end if;

  _creator_n := nullif(btrim(coalesce(_creator_name, '')), '');
  if _creator_n is null then
    raise exception 'a designer name is required' using errcode = 'invalid_parameter_value';
  end if;
  if length(_creator_n) > 60 then
    raise exception 'designer name is too long (max 60 characters)' using errcode = 'invalid_parameter_value';
  end if;

  loop
    _share_id   := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    _short_code := public.custom_puzzle_new_short_code();
    begin
      insert into public.custom_puzzles (share_id, short_code, visibility, created_by, creator_name, title, content)
      values (_share_id, _short_code, _visibility, _uid, _creator_n, _title_n, _canonical)
      returning id into _id;
      exit;
    exception when unique_violation then
      -- share_id or short_code collided: draw both again.
      _tries := _tries + 1;
      if _tries >= 10 then raise; end if;
    end;
  end loop;

  perform public.custom_ensure_creator_profile(_uid, _creator_n);

  return jsonb_build_object('puzzle_id', _id, 'share_id', _share_id, 'short_code', _short_code);
end;
$$;

revoke all on function public.create_custom_puzzle(text, text, text, jsonb) from public;
grant execute on function public.create_custom_puzzle(text, text, text, jsonb) to anon, authenticated, service_role;

comment on function public.create_custom_puzzle(text, text, text, jsonb) is
  'Creates an immutable player custom puzzle for anon or authenticated callers. created_by comes only from auth.uid(); share_id and short_code are generated server-side (collision-retried); a signed-in creator gets a public creator profile lazily.';


-- ---------------------------------------------------------------------------
-- 7. Lookups: identical safe shape via custom_puzzle_public_json
-- ---------------------------------------------------------------------------
create or replace function public.get_custom_puzzle(_share_id text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.custom_puzzle_public_json(cp)
    from public.custom_puzzles cp
   where cp.share_id = _share_id
     and cp.moderation_status = 'active'
$$;

revoke all on function public.get_custom_puzzle(text) from public;
grant execute on function public.get_custom_puzzle(text) to anon, authenticated, service_role;

create or replace function public.get_custom_puzzle_by_short_code(_short_code text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.custom_puzzle_public_json(cp)
    from public.custom_puzzles cp
   where cp.short_code = _short_code          -- exact, case-sensitive
     and cp.moderation_status = 'active'
$$;

revoke all on function public.get_custom_puzzle_by_short_code(text) from public;
grant execute on function public.get_custom_puzzle_by_short_code(text) to anon, authenticated, service_role;

comment on function public.get_custom_puzzle_by_short_code(text) is
  'Fetches one custom puzzle by short_code (Public and Private alike; the code is the access mechanism). Same shape as get_custom_puzzle. Null if unknown or hidden by moderation.';


-- ---------------------------------------------------------------------------
-- 8. set_custom_puzzle_favorite -- explicit set (not toggle), so a double
--    click or retry can never flip the state or duplicate a row. Signed-in
--    only; a guest gets null and keeps the favorite in the browser.
-- ---------------------------------------------------------------------------
create or replace function public.set_custom_puzzle_favorite(_share_id text, _favorite boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _pid uuid;
begin
  if _uid is null then
    return null;
  end if;
  if _favorite is null then
    raise exception 'favorite is required' using errcode = 'invalid_parameter_value';
  end if;

  select id into _pid
    from public.custom_puzzles
   where share_id = _share_id
     and moderation_status = 'active';
  if _pid is null then
    return null;
  end if;

  if _favorite then
    insert into public.custom_puzzle_favorites (custom_puzzle_id, user_id)
    values (_pid, _uid)
    on conflict (custom_puzzle_id, user_id) do nothing;
  else
    -- Scoped to the caller's own row by auth.uid(): never another user's.
    delete from public.custom_puzzle_favorites
     where custom_puzzle_id = _pid and user_id = _uid;
  end if;

  return jsonb_build_object(
    'favorited', exists (select 1 from public.custom_puzzle_favorites where custom_puzzle_id = _pid and user_id = _uid),
    'favorite_count', (select count(*) from public.custom_puzzle_favorites where custom_puzzle_id = _pid)
  );
end;
$$;

revoke all on function public.set_custom_puzzle_favorite(text, boolean) from public, anon;
grant execute on function public.set_custom_puzzle_favorite(text, boolean) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 9. get_my_favorites -- the caller's own list only
-- ---------------------------------------------------------------------------
create or replace function public.get_my_favorites()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(q.item order by q.favorited_at desc), '[]'::jsonb)
    from (
      select f.created_at as favorited_at,
             jsonb_build_object(
               'title',          cp.title,
               'creator_name',   cp.creator_name,
               'creator_slug',   (select p.public_slug from public.creator_profiles p where p.user_id = cp.created_by),
               'mode',           cp.content ->> 'mode',
               'short_code',     cp.short_code,
               'favorite_count', (select count(*) from public.custom_puzzle_favorites x where x.custom_puzzle_id = cp.id),
               'favorited_at',   f.created_at
             ) as item
        from public.custom_puzzle_favorites f
        join public.custom_puzzles cp on cp.id = f.custom_puzzle_id
       where f.user_id = auth.uid()
         and cp.moderation_status = 'active'
       order by f.created_at desc
       limit 200
    ) q
$$;

revoke all on function public.get_my_favorites() from public, anon;
grant execute on function public.get_my_favorites() to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 10. get_creator_profile -- explicit safe fields only. Public + active
--     puzzles are filtered HERE, not in React. Never returns an email, an
--     auth UUID, a puzzle id, or any Private/hidden puzzle.
-- ---------------------------------------------------------------------------
create or replace function public.get_creator_profile(_slug text, _sort text default 'newest')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  _uid   uuid;
  _name  text;
  _s     text := case when _sort in ('newest', 'plays', 'favorites') then _sort else 'newest' end;
begin
  select user_id, display_name into _uid, _name
    from public.creator_profiles
   where public_slug = _slug;
  if _uid is null then
    return null;
  end if;

  return (
    with pub as (
      select cp.title,
             cp.content ->> 'mode' as mode,
             cp.short_code,
             (select count(*) from public.custom_puzzle_results r where r.custom_puzzle_id = cp.id) as plays,
             (select count(*) from public.custom_puzzle_favorites f where f.custom_puzzle_id = cp.id) as favs,
             cp.created_at
        from public.custom_puzzles cp
       where cp.created_by = _uid
         and cp.visibility = 'public'
         and cp.moderation_status = 'active'
    )
    select jsonb_build_object(
      'display_name',    _name,
      'public_slug',     _slug,
      'puzzle_count',    (select count(*) from pub),
      'total_plays',     (select coalesce(sum(plays), 0) from pub),
      'total_favorites', (select coalesce(sum(favs), 0) from pub),
      'puzzles',         coalesce((
        select jsonb_agg(
                 jsonb_build_object(
                   'title',          q.title,
                   'mode',           q.mode,
                   'short_code',     q.short_code,
                   'finished_plays', q.plays,
                   'favorite_count', q.favs,
                   'created_at',     q.created_at
                 )
                 order by (case _s when 'plays' then q.plays end) desc nulls last,
                          (case _s when 'favorites' then q.favs end) desc nulls last,
                          q.created_at desc)
          from (select * from pub
                 order by (case _s when 'plays' then plays end) desc nulls last,
                          (case _s when 'favorites' then favs end) desc nulls last,
                          created_at desc
                 limit 100) q
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.get_creator_profile(text, text) from public;
grant execute on function public.get_creator_profile(text, text) to anon, authenticated, service_role;

comment on function public.get_creator_profile(text, text) is
  'Public creator page data: display name, totals and the creator''s Public, non-moderated puzzles only (sort: newest | plays | favorites). Returns only explicitly listed safe fields.';


-- ===========================================================================
-- Apply-time checks against the REAL engine (read-only: no puzzle rows are
-- created). If any of these fail, the whole migration fails to apply.
-- ===========================================================================
do $$
declare
  _codes text[];
  _slug  text;
begin
  -- short-code format, uniformity of alphabet, distinctness
  select array_agg(public.custom_puzzle_new_short_code()) into _codes from generate_series(1, 300);
  if exists (select 1 from unnest(_codes) c where c !~ '^[2-9A-HJKMNP-Za-hjkmnp-z]{10}$') then
    raise exception 'check failed: short code outside the expected alphabet/length';
  end if;
  if (select count(distinct c) from unnest(_codes) c) < 300 then
    raise exception 'check failed: duplicate short codes in 300 draws';
  end if;

  -- every existing puzzle was backfilled
  if exists (select 1 from public.custom_puzzles where short_code is null) then
    raise exception 'check failed: a custom puzzle has no short_code after backfill';
  end if;

  -- slug generation, including a name with no usable characters
  _slug := public.custom_creator_new_slug('Samantha O''Brien 🌈');
  if _slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(_slug) < 3 then
    raise exception 'check failed: bad slug %', _slug;
  end if;
  if public.custom_creator_new_slug('🌈🌈') !~ '^creator-[2-9a-hjkmnp-z]{4}$' then
    raise exception 'check failed: fallback slug';
  end if;

  -- lookups are null-safe and identical in shape for unknown input
  if public.get_custom_puzzle_by_short_code('does-not-exist') is not null
     or public.get_custom_puzzle('does-not-exist') is not null
     or public.get_creator_profile('does-not-exist') is not null then
    raise exception 'check failed: unknown lookups must return null';
  end if;
end;
$$;
