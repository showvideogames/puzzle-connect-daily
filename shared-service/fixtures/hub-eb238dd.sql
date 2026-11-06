-- DRAFT. NOT A MIGRATION. NEVER APPLIED TO A HOSTED DATABASE.
-- This file must not move to supabase/migrations. It installs the shared Friends /
-- Groups hub (docs/shared-social/CONTRACT.md, version 0) on a throwaway Postgres or
-- a disposable local stack. A hosted install needs the single approval bundle in
-- docs/shared-social/RAINBOW-BETA-PLAN.md. uninstall.sql, beside this file, takes
-- it out again.
--
-- HOSTING AND OWNERSHIP: D1 is settled for the beta only, by that plan. Rule 6 of
-- docs/SHARED-ACCOUNTS.md means CrossPuns itself will not own this schema:
-- CrossPuns changes nothing outside its own objects, and this hub serves every game.
--
-- WHAT IT IS
--   One hub, keyed by the shared global id. Games never read these tables and
--   these tables never read a game's: nothing here refers to a game's tables, an
--   account table or the sign-in system. Its only play data is result cards: it
--   holds no solves in progress or streaks, and it is not the record of any
--   game's scores.
--
-- WHO GETS IN
--   Two roles, made here if they are missing, and only through the entry functions.
--   social_gateway runs the browser operations. social_game_server runs
--   record_completion and audience_global_ids and nothing else. Row-level security
--   is on and everything is revoked. No role has table rights, and anon,
--   authenticated and service_role get nothing at all. Each function takes the
--   caller's global id as its first argument; the gateway resolves that from a
--   verified token, never from the client. Two exceptions: preview_invite takes
--   null for a caller who isn't a usable account, and record_completion takes the
--   global id from the game's own server, the one exception in the contract. Every
--   answer is jsonb in the wire shape {"ok":true,"data":...} or
--   {"ok":false,"outcome":...}, except is_beta_tester, a plain true or false.
--   No answer on the gateway's role contains a global id. audience_global_ids is
--   the one function that returns them, and it is on the other role for that reason.
--
-- HOW THE GATEWAY CONNECTS
--   Both roles are nologin. The hosted gateway connects as postgres and takes one
--   of them with set local role, so postgres is made a member of both where a role
--   of that name exists. Nobody else is.
--
-- WHAT THE GATEWAY MUST ALREADY HAVE DONE
--   Refuse a disabled game, verify the token, and ask the game's own boundary
--   whether this person has an account there. The hub can do none of that: it
--   reads no game's tables and it doesn't hold GAME_STATUS. So ensure_person
--   accepts all seven known games, a disabled one included, and only an unknown
--   name gets game_disabled. record_completion is the exception: it refuses the
--   disabled games itself (game_enabled), so that route can't store a result for
--   one even if it forgets to check. The hub can't check an account there either:
--   a game server has already verified its own, so a known person with no link to
--   that game gets one, and the server must send only its own accounts. The
--   gateway must also answer unknown fields and a gameId that doesn't match the
--   route itself: positional arguments can't show either.
--
-- BETA LIST
--   beta_testers is the short allow-list for the beta. It has no client grants, and
--   rows go in by hand from an owner's session. The gateway asks is_beta_tester and
--   answers game_disabled for anyone else; the hub itself never consults the list.
--
-- INVITE CODES (D12)
--   Every code is looked up by its hash alone. A group code is also kept readable,
--   in invites.code, so an owner can share the link again: list_my_groups returns it
--   to the owner and null to everyone else. A friend code is hash-only and is shown
--   once, by create_friend_invite. The constraint invites_readable_code enforces both.
--
-- LOOKUP REFS
--   The requestRef from find_friend_by_code is stored only as a hash, tied to the
--   caller and good for one hour. The requestRef from list_friend_requests is the
--   request's own id, a different thing that can't stand in for it.
--
-- LOCKS
--   Person rows always come first, in id order (lock_persons). No function takes
--   one after a group or invite row. lock_persons uses for no key update, so it
--   doesn't wait on, or block, the key share lock a foreign key takes when a
--   membership or removal row is written under a group lock. A function that
--   locks two people finds the other one first and locks both in one call, then
--   reads again: taking them one at a time would break the id order.
--
-- NEEDS
--   Plain Postgres in a UTF8 database, no extensions, and the roles anon,
--   authenticated and service_role already present.
--
-- NOT DRAFTED YET
--   unlinkGame. getMe is answered by ensure_person.

create schema social;

-- social_gateway is the browser route's role. social_game_server is the server
-- route's, for record_completion and audience_global_ids and nothing else: the
-- gateway's role can't run those, so a browser route has no way to reach them.
-- Nologin: whatever runs the gateway is granted these. Either may survive from an
-- earlier install, because a role outlives a dropped schema. The grant only gives
-- postgres a way to set local role, and repeats harmlessly.
do $$
begin
  if not exists (select 1 from pg_roles r where r.rolname = 'social_gateway') then
    create role social_gateway nologin;
  end if;
  if not exists (select 1 from pg_roles r where r.rolname = 'social_game_server') then
    create role social_game_server nologin;
  end if;
  if exists (select 1 from pg_roles r where r.rolname = 'postgres') then
    grant social_gateway, social_game_server to postgres;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table social.persons (
  id uuid primary key default gen_random_uuid(),
  global_user_id text not null unique,
  display_name text,
  -- The setup default until someone chooses. The functions enforce the approved lists.
  animal_id text not null default 'fox',
  background_color text not null default '#DED1F2',
  -- Stored clean: six characters, no dash. person_of makes it.
  friend_code text not null unique,
  created_at timestamptz not null default now(),
  constraint persons_global_id_format check (global_user_id ~ '^user_[0-9A-Za-z]{10,64}$'),
  constraint persons_display_name_length check (display_name is null or char_length(display_name) between 1 and 24),
  constraint persons_friend_code_format check (friend_code ~ '^[A-HJ-NP-Z2-9]{6}$')
);

create table social.game_links (
  person_id uuid not null references social.persons (id) on delete cascade,
  game text not null,
  first_seen timestamptz not null default now(),
  primary key (person_id, game),
  constraint game_links_known_game check (game in ('rainbow', 'crosspuns', 'cluevoyance', 'wtf', 'yodel', 'hamburgle', 'priceiswhat'))
);

-- One row per pair, whoever invited whom: the lower id is always person_a. The
-- row's id is the friendRef both sides see. notice_a and notice_b are the notice
-- each person saw.
create table social.friendships (
  id uuid primary key default gen_random_uuid(),
  person_a uuid not null references social.persons (id) on delete cascade,
  person_b uuid not null references social.persons (id) on delete cascade,
  since timestamptz not null default date_trunc('milliseconds', now()),
  notice_a int not null,
  notice_b int not null,
  constraint friendships_unordered_pair check (person_a < person_b),
  constraint friendships_one_per_pair unique (person_a, person_b)
);

create index friendships_person_b_idx on social.friendships (person_b);

-- At most one between two people, in either direction. The row's id is the
-- requestRef on list_friend_requests. A declined row stays, because a decline
-- tells the sender nothing.
create table social.friend_requests (
  id uuid primary key default gen_random_uuid(),
  from_person uuid not null references social.persons (id) on delete cascade,
  to_person uuid not null references social.persons (id) on delete cascade,
  status text not null default 'pending',
  sent_at timestamptz not null default date_trunc('milliseconds', now()),
  notice_version int not null,
  constraint friend_requests_status check (status in ('pending', 'declined')),
  constraint friend_requests_not_self check (from_person <> to_person)
);

create unique index friend_requests_one_per_pair
  on social.friend_requests (least(from_person, to_person), greatest(from_person, to_person));
create index friend_requests_to_idx on social.friend_requests (to_person);
create index friend_requests_from_idx on social.friend_requests (from_person);

-- What find_friend_by_code handed out: good for one caller, one person, one hour.
-- Only a hash of the ref is stored.
create table social.friend_lookups (
  ref_hash text primary key,
  caller uuid not null references social.persons (id) on delete cascade,
  target uuid not null references social.persons (id) on delete cascade,
  expires_at timestamptz not null
);

create index friend_lookups_caller_idx on social.friend_lookups (caller);
create index friend_lookups_target_idx on social.friend_lookups (target);

-- One-way, and no response tells the blocked person. name is what the blocker
-- saw, so a block made through a group shares nothing beyond the name used there.
create table social.blocks (
  id uuid primary key default gen_random_uuid(),
  blocker uuid not null references social.persons (id) on delete cascade,
  blocked uuid not null references social.persons (id) on delete cascade,
  name text,
  created_at timestamptz not null default now(),
  constraint blocks_not_self check (blocker <> blocked),
  constraint blocks_one_per_pair unique (blocker, blocked)
);

create index blocks_blocked_idx on social.blocks (blocked);

create table social.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- No cascade: delete_person hands a group over or closes it first.
  owner_id uuid not null references social.persons (id),
  emblem_id text not null default 'campfire',
  accent_color text not null default '#DED1F2',
  -- A 256x256 JPEG, checked from its own bytes by check_photo. Shows instead of the emblem.
  photo bytea,
  photo_version int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint groups_name_length check (char_length(name) between 1 and 40),
  constraint groups_photo_size check (photo is null or octet_length(photo) <= 61440)
);

create index groups_owner_idx on social.groups (owner_id);

-- creator_id goes null when a person is deleted and their group lives on with a
-- new owner: the reusable code belongs to the group by then. notice_version is the
-- notice the creator of a friend invite saw, for the friendship it becomes; a
-- group's creator has theirs on their membership. code_hash is what every lookup
-- uses. code is the readable copy a group's owner gets back from list_my_groups,
-- and no function reads it to find an invite.
create table social.invites (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  code_hash text not null unique,
  code text,
  creator_id uuid references social.persons (id) on delete set null,
  group_id uuid references social.groups (id) on delete cascade,
  expires_at timestamptz,
  used_at timestamptz,
  notice_version int,
  created_at timestamptz not null default now(),
  constraint invites_kind check (kind in ('friend', 'group')),
  constraint invites_shape check (
    (kind = 'friend' and creator_id is not null and group_id is null and expires_at is not null and notice_version is not null)
    or (kind = 'group' and group_id is not null and expires_at is null and used_at is null and notice_version is null)
  ),
  -- Friend invites stay hash-only. Every group invite has its readable code.
  constraint invites_readable_code check ((kind = 'group') = (code is not null)),
  constraint invites_code_format check (code is null or code ~ '^[0-9a-z]{12}$')
);

create index invites_creator_idx on social.invites (creator_id);
-- A group has one current invite.
create unique index invites_one_per_group on social.invites (group_id) where kind = 'group';

-- The row's id is the memberRef: one person has unrelated ids in different groups.
-- joined_at keeps milliseconds and no more, because that is what the wire carries
-- and a paging cursor has to match the stored value exactly. notice_version is
-- the notice this person saw, whether they made the group or joined it.
create table social.memberships (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references social.groups (id) on delete cascade,
  person_id uuid not null references social.persons (id) on delete cascade,
  name text not null,
  joined_at timestamptz not null default date_trunc('milliseconds', now()),
  notice_version int not null,
  constraint memberships_one_per_group unique (group_id, person_id),
  constraint memberships_name_length check (char_length(name) between 1 and 24)
);

create index memberships_person_idx on social.memberships (person_id);
create index memberships_page_idx on social.memberships (group_id, joined_at, id);

-- The row's id is the removedRef.
create table social.removals (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references social.groups (id) on delete cascade,
  person_id uuid not null references social.persons (id) on delete cascade,
  name text not null,
  removed_at timestamptz not null default now(),
  constraint removals_one_per_group unique (group_id, person_id)
);

create index removals_person_idx on social.removals (person_id);

-- Recent creates, joins, friend invites and friend lookups, for the daily limits
-- and nothing else.
create table social.activity (
  person_id uuid not null references social.persons (id) on delete cascade,
  kind text not null,
  at timestamptz not null default now(),
  constraint activity_kind check (kind in ('create', 'join', 'friend_invite', 'friend_lookup'))
);

create index activity_idx on social.activity (person_id, kind, at);

-- One completed daily result. The first for a game, puzzle and person stands, so
-- a replay can't overwrite it. detail is null for a result that has none. Nothing
-- but list_results reads a card, and it leaves detail out until the viewer has a
-- card of their own for the same game and puzzle.
create table social.result_cards (
  game text not null,
  puzzle_id text not null,
  person_id uuid not null references social.persons (id) on delete cascade,
  completed_at timestamptz not null,
  summary jsonb not null,
  detail jsonb,
  created_at timestamptz not null default now(),
  constraint result_cards_one_per_puzzle unique (game, puzzle_id, person_id),
  constraint result_cards_known_game check (game in ('rainbow', 'crosspuns', 'cluevoyance', 'wtf', 'yodel', 'hamburgle', 'priceiswhat')),
  constraint result_cards_puzzle_id check (puzzle_id ~ '^[A-Za-z0-9:_-]{1,64}$')
);

create index result_cards_person_idx on social.result_cards (person_id);

-- The beta allow-list, in the same format as persons.global_user_id so a mistyped
-- id fails when it is added. No link to persons: a tester may not have used Friends
-- yet, and delete_person leaves this row alone, because the list is the owner's.
create table social.beta_testers (
  global_user_id text primary key,
  added_at timestamptz not null default now(),
  constraint beta_testers_global_id_format check (global_user_id ~ '^user_[0-9A-Za-z]{10,64}$')
);

alter table social.persons enable row level security;
alter table social.game_links enable row level security;
alter table social.friendships enable row level security;
alter table social.friend_requests enable row level security;
alter table social.friend_lookups enable row level security;
alter table social.blocks enable row level security;
alter table social.groups enable row level security;
alter table social.invites enable row level security;
alter table social.memberships enable row level security;
alter table social.removals enable row level security;
alter table social.activity enable row level security;
alter table social.result_cards enable row level security;
alter table social.beta_testers enable row level security;

-- ---------------------------------------------------------------------------
-- Helpers. Nobody but the entry functions below can call these.
-- ---------------------------------------------------------------------------

create function social.ok(p_data jsonb default '{}'::jsonb)
returns jsonb
language sql
immutable
set search_path = social, pg_temp
as $$
  select jsonb_build_object('ok', true, 'data', p_data)
$$;

create function social.fail(p_outcome text)
returns jsonb
language sql
immutable
set search_path = social, pg_temp
as $$
  select jsonb_build_object('ok', false, 'outcome', p_outcome)
$$;

create function social.is_global_id(p_global_user_id text)
returns boolean
language sql
immutable
set search_path = social, pg_temp
as $$
  select coalesce(p_global_user_id ~ '^user_[0-9A-Za-z]{10,64}$', false)
$$;

-- The internal id for a global id, made on first use. Null for a malformed id.
-- The insert only comes up empty if someone else just made this person, or if the
-- friend code it drew is taken, and going round again settles either.
create function social.person_of(p_global_user_id text)
returns uuid
language plpgsql
set search_path = social, pg_temp
as $$
declare
  v_id uuid;
begin
  if not social.is_global_id(p_global_user_id) then
    return null;
  end if;
  for attempt in 1..20 loop
    select p.id into v_id from social.persons p where p.global_user_id = p_global_user_id;
    if v_id is not null then
      return v_id;
    end if;
    insert into social.persons (global_user_id, friend_code)
    values (p_global_user_id, social.new_friend_code())
    on conflict do nothing;
  end loop;
  raise exception 'no free friend code';
end;
$$;

-- A ref or group id as a uuid, or null for anything else, so a made-up value is
-- answered the same way as an unknown one instead of raising an error.
create function social.as_uuid(p_text text)
returns uuid
language plpgsql
immutable
set search_path = social, pg_temp
as $$
begin
  return p_text::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

-- Trims exactly what JavaScript's trim removes, so a name means the same on
-- client and hub: the Unicode space separators, the line and paragraph
-- separators, the ASCII whitespace, and the byte order mark.
create function social.trimmed(p_text text)
returns text
language sql
immutable
set search_path = social, pg_temp
as $$
  select btrim(
    coalesce(p_text, ''),
    E'\u0009\u000A\u000B\u000C\u000D                  　﻿'
  )
$$;

-- Trimmed, and null unless it fits.
create function social.clean_name(p_name text, p_max int)
returns text
language sql
immutable
set search_path = social, pg_temp
as $$
  select case when char_length(t.name) between 1 and p_max then t.name end
    from (select social.trimmed(p_name) as name) t
$$;

-- Trimmed and in lower case, as the mock cleans a code, then hashed.
create function social.hash_of(p_code text)
returns text
language sql
stable
set search_path = social, pg_temp
as $$
  select encode(sha256(convert_to(lower(social.trimmed(p_code)), 'UTF8')), 'hex')
$$;

-- UTC ISO 8601 with milliseconds, the wire format: 2026-10-30T18:00:00.000Z.
create function social.iso(p_at timestamptz)
returns text
language sql
stable
set search_path = social, pg_temp
as $$
  select to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

-- Locks these people's rows in id order, whichever way round they are passed.
-- Anything that counts toward a person's limits, or changes what stands between
-- two people, takes this first.
create function social.lock_persons(p_a uuid, p_b uuid default null)
returns void
language plpgsql
set search_path = social, pg_temp
as $$
begin
  perform 1 from social.persons p where p.id in (p_a, p_b) order by p.id for no key update;
end;
$$;

-- 12 characters from a 32-letter alphabet (no i, l, o, u), taken from the fully
-- random bytes of a v4 uuid: 60 random bits.
create function social.new_code()
returns text
language plpgsql
volatile
set search_path = social, pg_temp
as $$
declare
  v_alpha constant text := '0123456789abcdefghjkmnpqrstvwxyz';
  v_bytes bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  v_code text := '';
  v_pos int[] := array[0, 1, 2, 3, 4, 5, 10, 11, 12, 13, 14, 15];
  i int;
begin
  foreach i in array v_pos loop
    v_code := v_code || substr(v_alpha, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  return v_code;
end;
$$;

-- Six characters from A to Z and 2 to 9, without O or I. That is 32 letters, so
-- five bits pick one, taken from the fully random bytes of a v4 uuid.
create function social.new_friend_code()
returns text
language plpgsql
volatile
set search_path = social, pg_temp
as $$
declare
  v_alpha constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  v_code text := '';
begin
  for i in 0..5 loop
    v_code := v_code || substr(v_alpha, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  return v_code;
end;
$$;

-- Ignoring case, spaces and the dash is all a lookup does.
create function social.clean_friend_code(p_code text)
returns text
language sql
stable
set search_path = social, pg_temp
as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[[:space:]-]', '', 'g'))
$$;

create function social.show_friend_code(p_code text)
returns text
language sql
immutable
set search_path = social, pg_temp
as $$
  select substr(p_code, 1, 3) || '-' || substr(p_code, 4)
$$;

-- A lookup ref's hash. Exact, unlike hash_of: software copies a ref, nobody types it.
create function social.hash_of_ref(p_ref text)
returns text
language sql
stable
set search_path = social, pg_temp
as $$
  select encode(sha256(convert_to(coalesce(p_ref, ''), 'UTF8')), 'hex')
$$;

-- The sharing notice the hub asks for: section 6 of the contract, version 1.
create function social.notice_ok(p_version int)
returns boolean
language sql
immutable
set search_path = social, pg_temp
as $$
  select coalesce(p_version = 1, false)
$$;

create function social.has_name(p_person uuid)
returns boolean
language sql
stable
set search_path = social, pg_temp
as $$
  select exists (select 1 from social.persons p where p.id = p_person and p.display_name is not null)
$$;

create function social.is_avatar(p_id text)
returns boolean
language sql
immutable
set search_path = social, pg_temp
as $$
  select coalesce(p_id = any (array[
    'bear', 'owl', 'fox', 'frog', 'cat', 'saint-bernard', 'rabbit', 'raccoon', 'penguin', 'koala',
    'red-panda', 'otter', 'hedgehog', 'panda', 'tiger', 'lion', 'elephant', 'giraffe', 'mouse', 'squirrel',
    'sloth', 'deer', 'basketball', 'football', 'soccer', 'baseball-bat', 'pizza', 'hamburger', 'ghost', 'frankenstein'
  ]), false)
$$;

-- For a person's background and a group's accent alike.
create function social.is_color(p_color text)
returns boolean
language sql
immutable
set search_path = social, pg_temp
as $$
  select coalesce(p_color = any (array['#DED1F2', '#F1CDDA', '#F8D0BD', '#F8E4A0', '#CCE6CA', '#CCE1F1']), false)
$$;

create function social.is_emblem(p_id text)
returns boolean
language sql
immutable
set search_path = social, pg_temp
as $$
  select coalesce(p_id = any (array['campfire', 'cabin', 'mountains', 'cards-dice', 'coffee', 'book', 'picnic', 'flowers', 'moon']), false)
$$;

-- Only record_completion asks this. See WHAT THE GATEWAY MUST ALREADY HAVE DONE.
create function social.game_enabled(p_game text)
returns boolean
language sql
immutable
set search_path = social, pg_temp
as $$
  select coalesce(p_game in ('rainbow', 'crosspuns', 'cluevoyance', 'wtf'), false)
$$;

-- True while the person is under p_per_day of this kind in the last 24 hours.
-- Forgets their own rows older than two days.
create function social.under_daily_limit(p_person uuid, p_kind text, p_per_day int)
returns boolean
language plpgsql
set search_path = social, pg_temp
as $$
begin
  delete from social.activity a where a.person_id = p_person and a.at < now() - interval '2 days';
  return (select count(*) from social.activity a
           where a.person_id = p_person and a.kind = p_kind and a.at > now() - interval '1 day') < p_per_day;
end;
$$;

create function social.blocked_either_way(p_a uuid, p_b uuid)
returns boolean
language sql
stable
set search_path = social, pg_temp
as $$
  select exists (
    select 1 from social.blocks b
     where (b.blocker = p_a and b.blocked = p_b) or (b.blocker = p_b and b.blocked = p_a)
  )
$$;

create function social.friend_count(p_person uuid)
returns bigint
language sql
stable
set search_path = social, pg_temp
as $$
  select count(*) from social.friendships f where p_person in (f.person_a, f.person_b)
$$;

-- Why this person may not do an owner-only thing, or null if they may. A group
-- they aren't in and a group that doesn't exist get the same answer.
create function social.owner_refusal(p_group uuid, p_person uuid)
returns text
language sql
stable
set search_path = social, pg_temp
as $$
  select case
    when not exists (select 1 from social.memberships m where m.group_id = p_group and m.person_id = p_person) then 'not_a_member'
    when exists (select 1 from social.groups g where g.id = p_group and g.owner_id = p_person) then null
    else 'not_the_creator'
  end
$$;

-- Someone leaves or goes. Ownership passes to the longest-standing member; the
-- last one out closes the group. Answers whether it closed. The caller holds the
-- group row's lock.
create function social.drop_member(p_group uuid, p_person uuid)
returns boolean
language plpgsql
set search_path = social, pg_temp
as $$
declare
  v_next uuid;
begin
  delete from social.memberships m where m.group_id = p_group and m.person_id = p_person;
  select m.person_id into v_next
    from social.memberships m
   where m.group_id = p_group
   order by m.joined_at, m.id
   limit 1;
  if v_next is null then
    delete from social.groups g where g.id = p_group;
    return true;
  end if;
  update social.groups g set owner_id = v_next, updated_at = now()
   where g.id = p_group and g.owner_id = p_person;
  return false;
end;
$$;

-- Every attempt counts, whatever it finds, so guessing at codes costs the same as
-- using one. The caller holds this person's lock.
create function social.spend_lookup(p_person uuid)
returns boolean
language plpgsql
set search_path = social, pg_temp
as $$
begin
  if not social.under_daily_limit(p_person, 'friend_lookup', 30) then
    return false;
  end if;
  insert into social.activity (person_id, kind) values (p_person, 'friend_lookup');
  return true;
end;
$$;

create function social.drop_requests(p_a uuid, p_b uuid)
returns void
language sql
set search_path = social, pg_temp
as $$
  delete from social.friend_requests r
   where least(r.from_person, r.to_person) = least(p_a, p_b)
     and greatest(r.from_person, r.to_person) = greatest(p_a, p_b)
$$;

-- Why these two can't start a friend request, or null. A block looks exactly like
-- a code nobody holds. The caller holds both people's locks.
create function social.request_refusal(p_a uuid, p_b uuid)
returns text
language sql
stable
set search_path = social, pg_temp
as $$
  select case
    when social.blocked_either_way(p_a, p_b) then 'not_found'
    when exists (
      select 1 from social.friendships f
       where f.person_a = least(p_a, p_b) and f.person_b = greatest(p_a, p_b)
    ) then 'already_friends'
    when exists (
      select 1 from social.friend_requests r
       where least(r.from_person, r.to_person) = least(p_a, p_b)
         and greatest(r.from_person, r.to_person) = greatest(p_a, p_b)
    ) then 'request_pending'
  end
$$;

-- The only way two people become friends, so no route leaves an old request
-- behind. p_my_notice goes with p_me and p_other_notice with p_other. The caller
-- holds both people's locks.
create function social.make_friendship(p_me uuid, p_other uuid, p_my_notice int, p_other_notice int)
returns uuid
language plpgsql
set search_path = social, pg_temp
as $$
declare
  v_ref uuid;
begin
  insert into social.friendships (person_a, person_b, notice_a, notice_b)
  values (
    least(p_me, p_other),
    greatest(p_me, p_other),
    case when p_me < p_other then p_my_notice else p_other_notice end,
    case when p_me < p_other then p_other_notice else p_my_notice end
  )
  on conflict (person_a, person_b) do nothing
  returning id into v_ref;
  if v_ref is null then
    -- Two invites crossing: the other one got there first.
    select f.id into v_ref
      from social.friendships f
     where f.person_a = least(p_me, p_other) and f.person_b = greatest(p_me, p_other);
  end if;
  perform social.drop_requests(p_me, p_other);
  return v_ref;
end;
$$;

-- All a valid group invitation shows of the people in it: up to three faces, the
-- owner first and then in joining order, the owner's name in this group, and the
-- count. Results never come near it.
create function social.member_preview(p_group uuid, p_owner uuid)
returns jsonb
language sql
stable
set search_path = social, pg_temp
as $$
  select jsonb_build_object(
    'faces', (
      select jsonb_agg(jsonb_build_object('animalId', t.animal_id, 'backgroundColor', t.background_color) order by t.place)
        from (
          select p.animal_id, p.background_color,
                 row_number() over (order by m.person_id = p_owner desc, m.joined_at, m.id) as place
            from social.memberships m
            join social.persons p on p.id = m.person_id
           where m.group_id = p_group
           order by m.person_id = p_owner desc, m.joined_at, m.id
           limit 3
        ) t
    ),
    'leadName', (select m.name from social.memberships m where m.group_id = p_group and m.person_id = p_owner),
    'memberCount', (select count(*) from social.memberships m where m.group_id = p_group)
  )
$$;

-- A group's picture on the wire: a data URL, without the line breaks encode() adds.
create function social.photo_url(p_photo bytea)
returns text
language sql
immutable
set search_path = social, pg_temp
as $$
  select case when p_photo is not null then 'data:image/jpeg;base64,' || replace(encode(p_photo, 'base64'), E'\n', '') end
$$;

-- Width and height of a baseline or progressive JPEG, read from its own markers.
-- Null for anything that isn't a well-formed JPEG. The same walk as the CrossPuns
-- group picture check in supabase/migrations/0012_groups.sql.
create function social.jpeg_size(p_jpeg bytea, out width int, out height int)
language plpgsql
immutable
set search_path = social, pg_temp
as $$
declare
  n int := coalesce(octet_length(p_jpeg), 0);
  i int := 2;
  m int;
  len int;
  steps int := 0;
begin
  if n < 4 or get_byte(p_jpeg, 0) <> 255 or get_byte(p_jpeg, 1) <> 216 then
    return;
  end if;
  while i + 3 < n and steps < 200 loop
    steps := steps + 1;
    if get_byte(p_jpeg, i) <> 255 then
      return;
    end if;
    m := get_byte(p_jpeg, i + 1);
    if m = 255 then           -- fill byte
      i := i + 1;
      continue;
    end if;
    if m = 216 or m = 1 or (m between 208 and 215) then   -- these markers carry no length
      i := i + 2;
      continue;
    end if;
    if m = 217 or m = 218 then  -- the image ended, or its scan began, before any frame header
      return;
    end if;
    len := get_byte(p_jpeg, i + 2) * 256 + get_byte(p_jpeg, i + 3);
    if len < 2 then
      return;
    end if;
    if m between 192 and 207 and m not in (196, 200, 204) then  -- a frame header
      if i + 8 >= n then
        return;
      end if;
      height := get_byte(p_jpeg, i + 5) * 256 + get_byte(p_jpeg, i + 6);
      width := get_byte(p_jpeg, i + 7) * 256 + get_byte(p_jpeg, i + 8);
      return;
    end if;
    i := i + 2 + len;
  end loop;
end;
$$;

-- A picture from the wire. refusal is the outcome for a bad one, and null for a
-- good one, when jpeg holds its bytes. The length test comes first, so an absurd
-- upload is never decoded. decode() forgives whitespace, missing padding and stray
-- trailing bits, so the text is checked first and must come back the same.
create function social.check_photo(p_photo text, out refusal text, out jpeg bytea)
language plpgsql
immutable
set search_path = social, pg_temp
as $$
declare
  v_prefix constant text := 'data:image/jpeg;base64,';
  v_encoded text;
  v_width int;
  v_height int;
begin
  if p_photo is null or left(p_photo, char_length(v_prefix)) <> v_prefix then
    refusal := 'not_a_picture';
    return;
  end if;
  v_encoded := substr(p_photo, char_length(v_prefix) + 1);
  if char_length(v_encoded) > 81920 then
    refusal := 'too_big';
    return;
  end if;
  if char_length(v_encoded) % 4 <> 0 or v_encoded !~ '^[A-Za-z0-9+/]+={0,2}$' then
    refusal := 'not_a_picture';
    return;
  end if;
  jpeg := decode(v_encoded, 'base64');
  if replace(encode(jpeg, 'base64'), E'\n', '') <> v_encoded then
    refusal := 'not_a_picture';
    return;
  end if;
  if octet_length(jpeg) > 61440 then
    refusal := 'too_big';
    return;
  end if;
  select s.width, s.height into v_width, v_height from social.jpeg_size(jpeg) s;
  if v_width is null then
    refusal := 'not_a_picture';
  elsif v_width <> 256 or v_height <> 256 then
    refusal := 'wrong_size';
  end if;
end;
$$;

-- The wire format exactly, and not in the future: a later date would slip past the
-- forward-only rule. Null for anything else.
create function social.completed_at(p_text text)
returns timestamptz
language plpgsql
stable
set search_path = social, pg_temp
as $$
declare
  v_at timestamptz;
begin
  if p_text is null or p_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' then
    return null;
  end if;
  begin
    v_at := p_text::timestamptz;
  exception when datetime_field_overflow or invalid_datetime_format then
    return null;
  end;
  -- Postgres reads 24:00:00 and :60 by rolling over. Those don't come back the same.
  if social.iso(v_at) <> p_text or v_at > now() then
    return null;
  end if;
  return v_at;
end;
$$;

-- A whole number of at least 0, as high as a JavaScript number stays exact.
create function social.is_count(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = social, pg_temp
as $$
declare
  v_number numeric;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'number' then
    return false;
  end if;
  v_number := p_value::numeric;
  return v_number >= 0 and v_number <= 9007199254740991 and v_number = trunc(v_number);
end;
$$;

-- A text grid.
create function social.is_grid(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = social, pg_temp
as $$
declare
  v_text text;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'string' then
    return false;
  end if;
  v_text := p_value #>> '{}';
  return social.trimmed(v_text) <> '' and char_length(v_text) <= 500;
end;
$$;

-- A list of true or false.
create function social.is_answers(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = social, pg_temp
as $$
begin
  if p_value is null or jsonb_typeof(p_value) <> 'array' then
    return false;
  end if;
  return jsonb_array_length(p_value) between 1 and 500
    and not exists (select 1 from jsonb_array_elements(p_value) e where jsonb_typeof(e.value) <> 'boolean');
end;
$$;

-- p_keys in sorted order. Only for an object: result_fits has made sure.
create function social.has_keys(p_object jsonb, p_keys text[])
returns boolean
language sql
immutable
set search_path = social, pg_temp
as $$
  select array(select k from jsonb_object_keys(p_object) k order by k) = p_keys
$$;

-- Each game's fixed shape: numbers and yes-or-no, so a summary can't hold free
-- text. p_detail is SQL null for no detail. Cluevoyance has no shape yet, and any
-- other name has none either. Yodel, Hamburgle and Price Is What are refused before
-- this, by game_enabled; their shapes wait here for the day they are switched on.
create function social.result_fits(p_game text, p_summary jsonb, p_detail jsonb)
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

-- ---------------------------------------------------------------------------
-- Entry functions: the gateway's only way in. The gateway has already checked
-- that the game is enabled and the token is real.
-- ---------------------------------------------------------------------------

-- Whether this global id is on the beta list. A plain true or false, not a wire
-- answer. It creates nobody, and a null or malformed id just isn't on the list.
create function social.is_beta_tester(p_global_user_id text)
returns boolean
language sql
stable
security definer
set search_path = social, pg_temp
as $$
  select exists (select 1 from social.beta_testers t where t.global_user_id = p_global_user_id)
$$;

-- First contact from a game. Also answers getMe. Whether the game is enabled is
-- the gateway's check, not this one: see the top of this file. A disabled game
-- that reached here would get a link and nothing more.
create function social.ensure_person(p_global_user_id text, p_game text)
returns jsonb
language plpgsql
security definer
set search_path = social, pg_temp
as $$
declare
  v_me uuid;
  v_data jsonb;
begin
  if p_game is null or p_game not in ('rainbow', 'crosspuns', 'cluevoyance', 'wtf', 'yodel', 'hamburgle', 'priceiswhat') then
    return social.fail('game_disabled');
  end if;
  v_me := social.person_of(p_global_user_id);
  if v_me is null then
    return social.fail('not_linked');
  end if;
  insert into social.game_links (person_id, game) values (v_me, p_game)
  on conflict (person_id, game) do nothing;
  select jsonb_build_object(
           'displayName', p.display_name,
           'animalId', p.animal_id,
           'backgroundColor', p.background_color,
           'friendCode', social.show_friend_code(p.friend_code),
           'friendCount', social.friend_count(v_me),
           'groupCount', (select count(*) from social.memberships m where m.person_id = v_me)
         )
    into v_data
    from social.persons p
   where p.id = v_me;
  return social.ok(v_data);
end;
$$;

create function social.set_display_name(p_global_user_id text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = social, pg_temp
as $$
declare
  v_me uuid := social.person_of(p_global_user_id);
  v_name text := social.clean_name(p_name, 24);
begin
  if v_me is null then
    return social.fail('not_linked');
  end if;
  if v_name is null then
    return social.fail('bad_my_name');
  end if;
  update social.persons p set display_name = v_name where p.id = v_me;
  return social.ok(jsonb_build_object('displayName', v_name));
end;
$$;

-- All three together or none of them.
create function social.set_profile(p_global_user_id text, p_display_name text, p_animal_id text, p_background_color text)
returns jsonb
language plpgsql
security definer
set search_path = social, pg_temp
as $$
declare
  v_me uuid := social.person_of(p_global_user_id);
  v_name text := social.clean_name(p_display_name, 24);
begin
  if v_me is null then
    return social.fail('not_linked');
  end if;
  if v_name is null then
    return social.fail('bad_my_name');
  end if;
  if not social.is_avatar(p_animal_id) then
    return social.fail('bad_avatar');
  end if;
  if not social.is_color(p_background_color) then
    return social.fail('bad_color');
  end if;
  perform social.lock_persons(v_me);
  update social.persons p
     set display_name = v_name, animal_id = p_animal_id, background_color = p_background_color
   where p.id = v_me;
  return social.ok(jsonb_build_object('displayName', v_name, 'animalId', p_animal_id, 'backgroundColor', p_background_color));
end;
$$;

create function social.create_friend_invite(p_global_user_id text, p_notice_version int)
returns jsonb
language plpgsql
security definer
set search_path = social, pg_temp
as $$
declare
  v_me uuid := social.person_of(p_global_user_id);
  v_code text := social.new_code();
  v_expires timestamptz := date_trunc('milliseconds', now()) + interval '14 days';
begin
  if v_me is null then
    return social.fail('not_linked');
  end if;
  if not social.has_name(v_me) then
    return social.fail('needs_display_name');
  end if;
  if not social.notice_ok(p_notice_version) then
    return social.fail('notice_required');
  end if;
  perform social.lock_persons(v_me);
  if not social.under_daily_limit(v_me, 'friend_invite', 30) then
    return social.fail('slow_down');
  end if;
  insert into social.invites (kind, code_hash, creator_id, expires_at, notice_version)
  values ('friend', social.hash_of(v_code), v_me, v_expires, p_notice_version);
  insert into social.activity (person_id, kind) values (v_me, 'friend_invite');
  return social.ok(jsonb_build_object('code', v_code, 'expiresAt', social.iso(v_expires)));
end;
$$;

-- What an invitation shows. p_global_user_id is null for anyone who isn't a usable
-- account: a guest, or an anonymous, unlinked or invalid token. They get both flags
-- false. A global id nobody has is treated the same, and nothing is created here.
-- Blocks are ignored on purpose: a blocked person sees what a guest sees.
create function social.preview_invite(p_global_user_id text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = social, pg_temp
as $$
declare
  v_me uuid;
  v_invite social.invites%rowtype;
  v_group social.groups%rowtype;
  v_member boolean;
  v_removed boolean;
  v_data jsonb;
begin
  select i.* into v_invite from social.invites i where i.code_hash = social.hash_of(p_code);
  if not found then
    return social.fail('invalid_code');
  end if;

  if v_invite.kind = 'friend' then
    if v_invite.used_at is not null then
      return social.fail('invite_used');
    end if;
    if now() > v_invite.expires_at then
      return social.fail('invite_expired');
    end if;
    select jsonb_build_object('inviterName', p.display_name, 'animalId', p.animal_id, 'backgroundColor', p.background_color)
      into v_data
      from social.persons p
     where p.id = v_invite.creator_id;
    return social.ok(v_data);
  end if;

  select g.* into v_group from social.groups g where g.id = v_invite.group_id;
  if not found then
    return social.fail('invalid_code');
  end if;
  select p.id into v_me from social.persons p where p.global_user_id = p_global_user_id;
  v_member := exists (select 1 from social.memberships m where m.group_id = v_group.id and m.person_id = v_me);
  v_removed := exists (select 1 from social.removals r where r.group_id = v_group.id and r.person_id = v_me);
  return social.ok(jsonb_build_object(
    'name', v_group.name,
    'emblemId', v_group.emblem_id,
    'accentColor', v_group.accent_color,
    'photo', social.photo_url(v_group.photo),
    'memberPreview', case when v_member or v_removed then null else social.member_preview(v_group.id, v_group.owner_id) end,
    'isMember', v_member,
    'isRemoved', v_removed
  ));
end;
$$;

create function social.accept_friend_invite(p_global_user_id text, p_code text, p_notice_version int)
returns jsonb
language plpgsql
security definer
set search_path = social, pg_temp
as $$
declare
  v_me uuid := social.person_of(p_global_user_id);
  v_hash text := social.hash_of(p_code);
  v_creator uuid;
  v_invite social.invites%rowtype;
  v_ref uuid;
  v_name text;
begin
  if v_me is null then
    return social.fail('not_linked');
  end if;
  if not social.has_name(v_me) then
    return social.fail('needs_display_name');
  end if;
  if not social.notice_ok(p_notice_version) then
    return social.fail('notice_required');
  end if;
  select i.creator_id into v_creator
    from social.invites i
   where i.code_hash = v_hash and i.kind = 'friend';
  if v_creator is null then
    return social.fail('invalid_code');
  end if;
  perform social.lock_persons(v_me, v_creator);
  -- Locked, so two people can't both use one invite. Read again, because it may
  -- have changed while the people were being locked.
  select i.* into v_invite
    from social.invites i
   where i.code_hash = v_hash and i.kind = 'friend'
   for update;
  if not found then
    return social.fail('invalid_code');
  end if;
  if v_invite.creator_id = v_me then
    return social.fail('own_invite');
  end if;
  if v_invite.used_at is not null then
    return social.fail('invite_used');
  end if;
  if now() > v_invite.expires_at then
    return social.fail('invite_expired');
  end if;
  -- Used up, just as if someone else had taken it, so a later preview agrees and
  -- the block can't be detected.
  if social.blocked_either_way(v_me, v_invite.creator_id) then
    update social.invites i set used_at = now() where i.id = v_invite.id;
    return social.fail('invite_used');
  end if;

  select p.display_name into v_name from social.persons p where p.id = v_invite.creator_id;

  -- Already friends: the invite stays unused, and only the notice I saw is noted.
  select f.id into v_ref
    from social.friendships f
   where f.person_a = least(v_me, v_invite.creator_id) and f.person_b = greatest(v_me, v_invite.creator_id);
  if v_ref is not null then
    update social.friendships f
       set notice_a = case when f.person_a = v_me then p_notice_version else f.notice_a end,
           notice_b = case when f.person_b = v_me then p_notice_version else f.notice_b end
     where f.id = v_ref;
    return social.ok(jsonb_build_object('friendRef', v_ref, 'name', v_name));
  end if;

  if social.friend_count(v_me) >= 500 or social.friend_count(v_invite.creator_id) >= 500 then
    return social.fail('too_many_friends');
  end if;

  v_ref := social.make_friendship(v_me, v_invite.creator_id, p_notice_version, v_invite.notice_version);
  update social.invites i set used_at = now() where i.id = v_invite.id;
  return social.ok(jsonb_build_object('friendRef', v_ref, 'name', v_name));
end;
$$;

-- Shows who a friend code belongs to, and makes nothing but the ref. The other
-- person is found before locking, because lock_persons takes both rows in one
-- call, and every attempt spends the daily allowance, whatever it finds.
create function social.find_friend_by_code(p_global_user_id text, p_friend_code text)
returns jsonb
language plpgsql
security definer
set search_path = social, pg_temp
as $$
declare
  v_me uuid := social.person_of(p_global_user_id);
  v_ref text := gen_random_uuid()::text;
  v_target uuid;
  v_refusal text;
  v_data jsonb;
begin
  if v_me is null then
    return social.fail('not_linked');
  end if;
  if not social.has_name(v_me) then
    return social.fail('needs_display_name');
  end if;
  select p.id into v_target from social.persons p where p.friend_code = social.clean_friend_code(p_friend_code);
  perform social.lock_persons(v_me, v_target);
  if not social.spend_lookup(v_me) then
    return social.fail('slow_down');
  end if;
  -- Read again: they may have gone while the people were being locked.
  select jsonb_build_object('requestRef', v_ref, 'name', p.display_name, 'animalId', p.animal_id, 'backgroundColor', p.background_color)
    into v_data
    from social.persons p
   where p.id = v_target;
  if v_data is null then
    return social.fail('not_found');
  end if;
  if v_target = v_me then
    return social.fail('own_code');
  end if;
  v_refusal := social.request_refusal(v_me, v_target);
  if v_refusal is not null then
    return social.fail(v_refusal);
  end if;
  delete from social.friend_lookups l where l.caller = v_me and l.expires_at < now();
  insert into social.friend_lookups (ref_hash, caller, target, expires_at)
  values (social.hash_of_ref(v_ref), v_me, v_target, now() + interval '1 hour');
  return social.ok(v_data);
end;
$$;

-- Only the caller who looked the person up can use the ref, and only for the hour.
-- Nobody becomes a friend here. The lookup stays, so sending again says why not.
create function social.send_friend_request(p_global_user_id text, p_request_ref text, p_notice_version int)
returns jsonb
language plpgsql
security definer
set search_path = social, pg_temp
as $$
declare
  v_me uuid := social.person_of(p_global_user_id);
  v_hash text := social.hash_of_ref(p_request_ref);
  v_target uuid;
  v_refusal text;
begin
  if v_me is null then
    return social.fail('not_linked');
  end if;
  if not social.has_name(v_me) then
    return social.fail('needs_display_name');
  end if;
  if not social.notice_ok(p_notice_version) then
    return social.fail('notice_required');
  end if;
  select l.target into v_target from social.friend_lookups l where l.ref_hash = v_hash and l.caller = v_me;
  perform social.lock_persons(v_me, v_target);
  if not social.spend_lookup(v_me) then
    return social.fail('slow_down');
  end if;
  -- Read again, because it may have changed while the people were being locked.
  select l.target into v_target
    from social.friend_lookups l
   where l.ref_hash = v_hash and l.caller = v_me and now() <= l.expires_at;
  if v_target is null then
    return social.fail('not_found');
  end if;
  v_refusal := social.request_refusal(v_me, v_target);
  if v_refusal is not null then
    return social.fail(v_refusal);
  end if;
  insert into social.friend_requests (from_person, to_person, notice_version)
  values (v_me, v_target, p_notice_version);
  return social.ok();
end;
$$;

-- A decline tells the sender nothing, so a declined row still shows as outgoing.
create function social.list_friend_requests(p_global_user_id text)
returns jsonb
language plpgsql
security definer
set search_path = social, pg_temp
as $$
declare
  v_me uuid := social.person_of(p_global_user_id);
  v_data jsonb;
begin
  if v_me is null then
    return social.fail('not_linked');
  end if;
  with mine as (
    select r.id, r.sent_at, r.to_person = v_me as incoming,
           case when r.to_person = v_me then r.from_person else r.to_person end as other
      from social.friend_requests r
     where r.from_person = v_me or (r.to_person = v_me and r.status = 'pending')
  ),
  listed as (
    select m.id, m.sent_at, m.incoming,
           jsonb_build_object('requestRef', m.id, 'name', p.display_name, 'animalId', p.animal_id, 'backgroundColor', p.background_color, 'sentAt', social.iso(m.sent_at)) as entry
      from mine m
      join social.persons p on p.id = m.other
  )
  select jsonb_build_object(
           'incoming', coalesce(jsonb_agg(t.entry order by t.sent_at, t.id) filter (where t.incoming), '[]'::jsonb),
           'outgoing', coalesce(jsonb_agg(t.entry order by t.sent_at, t.id) filter (where not t.incoming), '[]'::jsonb)
         )
    into v_data
    from listed t;
  return social.ok(v_data);
end;
$$;

create function social.accept_friend_request(p_global_user_id text, p_request_ref text, p_notice_version int)
returns jsonb
language plpgsql
security definer
set search_path = social, pg_temp
as $$
declare
  v_me uuid := social.person_of(p_global_user_id);
  v_ref uuid := social.as_uuid(p_request_ref);
  v_from uuid;
  v_notice int;
  v_friend uuid;
  v_name text;
begin
  if v_me is null then
    return social.fail('not_linked');
  end if;
  if not social.has_name(v_me) then
    return social.fail('needs_display_name');
  end if;
  if not social.notice_ok(p_notice_version) then
    return social.fail('notice_required');
  end if;
  select r.from_person into v_from
    from social.friend_requests r
   where r.id = v_ref and r.to_person = v_me and r.status = 'pending';
  if v_from is null then
    return social.fail('not_found');
  end if;
  perform social.lock_persons(v_me, v_from);
  -- Read again: it may have been cancelled or cleared while the people were being locked.
  select r.notice_version into v_notice
    from social.friend_requests r
   where r.id = v_ref and r.to_person = v_me and r.status = 'pending';
  if not found then
    return social.fail('not_found');
  end if;
  if social.friend_count(v_me) >= 500 or social.friend_count(v_from) >= 500 then
    return social.fail('too_many_friends');
  end if;
  v_friend := social.make_friendship(v_me, v_from, p_notice_version, v_notice);
  select p.display_name into v_name from social.persons p where p.id = v_from;
  return social.ok(jsonb_build_object('friendRef', v_friend, 'name', v_name));
end;
$$;

-- Silent: the row stays, and the sender's view of it doesn't change.
create function social.decline_friend_request(p_global_user_id text, p_request_ref text)
returns jsonb
language plpgsql
security definer
set search_path = social, pg_temp
as $$
declare
  v_me uuid := social.person_of(p_global_user_id);
  v_ref uuid := social.as_uuid(p_request_ref);
  v_from uuid;
begin
  if v_me is null then
    return social.fail('not_linked');
  end if;
  select r.from_person into v_from
    from social.friend_requests r
   where r.id = v_ref and r.to_person = v_me and r.status = 'pending';
  if v_from is null then
    return social.fail('not_found');
  end if;
  perform social.lock_persons(v_me, v_from);
  update social.friend_requests r set status = 'declined'
   where r.id = v_ref and r.to_person = v_me and r.status = 'pending';
  if not found then
    return social.fail('not_found');
  end if;
  return social.ok();
end;
$$;

-- The sender's alone, declined or not. It goes for both.
create function social.cancel_friend_request(p_global_user_id text, p_request_ref text)
returns jsonb
language plpgsql
security definer
set search_path = social, pg_temp
as $$
declare
  v_me uuid := social.person_of(p_global_user_id);
  v_ref uuid := social.as_uuid(p_request_ref);
  v_to uuid;
begin
  if v_me is null then
    return social.fail('not_linked');
  end if;
  select r.to_person into v_to
    from social.friend_requests r
   where r.id = v_ref and r.from_person = v_me;
  if v_to is null then
    return social.fail('not_found');
  end if;
  perform social.lock_persons(v_me, v_to);
  delete from social.friend_requests r where r.id = v_ref and r.from_person = v_me;
  if not found then
    return social.fail('not_found');
  end if;
  return social.ok();
end;
$$;

create function social.list_friends(p_global_user_id text)
returns jsonb
language plpgsql
security definer
set search_path = social, pg_temp
as $$
declare
  v_me uuid := social.person_of(p_global_user_id);
  v_rows jsonb;
begin
  if v_me is null then
    return social.fail('not_linked');
  end if;
  select coalesce(
           jsonb_agg(
             jsonb_build_object('friendRef', f.id, 'name', p.display_name, 'animalId', p.animal_id, 'backgroundColor', p.background_color, 'since', social.iso(f.since))
             order by f.since, f.id
           ),
           '[]'::jsonb
         )
    into v_rows
    from social.friendships f
    join social.persons p on p.id = case when f.person_a = v_me then f.person_b else f.person_a end
   where v_me in (f.person_a, f.person_b);
  return social.ok(v_rows);
end;
$$;

create function social.remove_friend(p_global_user_id text, p_friend_ref text)
returns jsonb
language plpgsql
security definer
set search_path = social, pg_temp
as $$
declare
  v_me uuid := social.person_of(p_global_user_id);
begin
  if v_me is null then
    return social.fail('not_linked');
  end if;
  delete from social.friendships f
   where f.id = social.as_uuid(p_friend_ref) and v_me in (f.person_a, f.person_b);
  if not found then
    return social.fail('not_found');
  end if;
  return social.ok();
end;
$$;

-- p_ref is a friendRef or a memberRef the caller can see. Ends any friendship
-- between the two and clears any request, in either direction, declined or not.
-- Has no effect on shared groups (D6).
create function social.block(p_global_user_id text, p_ref text)
returns jsonb
language plpgsql
security definer
set search_path = social, pg_temp
as $$
declare
  v_me uuid := social.person_of(p_global_user_id);
  v_ref uuid := social.as_uuid(p_ref);
  v_other uuid;
  v_name text;
  v_block uuid;
begin
  if v_me is null then
    return social.fail('not_linked');
  end if;
  select p.id, p.display_name into v_other, v_name
    from social.friendships f
    join social.persons p on p.id = case when f.person_a = v_me then f.person_b else f.person_a end
   where f.id = v_ref and v_me in (f.person_a, f.person_b);
  if v_other is null then
    select m.person_id, m.name into v_other, v_name
      from social.memberships m
      join social.memberships mine on mine.group_id = m.group_id and mine.person_id = v_me
     where m.id = v_ref;
  end if;
  if v_other is null or v_other = v_me then
    return social.fail('not_found');
  end if;

  perform social.lock_persons(v_me, v_other);
  insert into social.blocks (blocker, blocked, name) values (v_me, v_other, v_name)
  on conflict (blocker, blocked) do nothing;
  select b.id into v_block from social.blocks b where b.blocker = v_me and b.blocked = v_other;
  delete from social.friendships f
   where f.person_a = least(v_me, v_other) and f.person_b = greatest(v_me, v_other);
  perform social.drop_requests(v_me, v_other);
  return social.ok(jsonb_build_object('blockRef', v_block));
end;
$$;

-- The blocker's alone. It lets the two friend each other again and restores
-- nothing: what the block ended stays ended, and a block the other person made
-- stands. The other person is found first, because lock_persons takes both rows in
-- one call.
create function social.unblock(p_global_user_id text, p_block_ref text)
returns jsonb
language plpgsql
security definer
set search_path = social, pg_temp
as $$
declare
  v_me uuid := social.person_of(p_global_user_id);
  v_ref uuid := social.as_uuid(p_block_ref);
  v_blocked uuid;
begin
  if v_me is null then
    return social.fail('not_linked');
  end if;
  select b.blocked into v_blocked
    from social.blocks b
   where b.id = v_ref and b.blocker = v_me;
  if v_blocked is null then
    return social.fail('not_found');
  end if;
  perform social.lock_persons(v_me, v_blocked);
  delete from social.blocks b where b.id = v_ref and b.blocker = v_me;
  if not found then
    return social.fail('not_found');
  end if;
  return social.ok();
end;
$$;

-- The name is the one stored with the block, never a live name, so a change made
-- by someone blocked through a group doesn't reach the blocker.
create function social.list_blocks(p_global_user_id text)
returns jsonb
language plpgsql
security definer
set search_path = social, pg_temp
as $$
declare
  v_me uuid := social.person_of(p_global_user_id);
  v_rows jsonb;
begin
  if v_me is null then
    return social.fail('not_linked');
  end if;
  select coalesce(
           jsonb_agg(jsonb_build_object('blockRef', b.id, 'name', b.name) order by b.created_at, b.id),
           '[]'::jsonb
         )
    into v_rows
    from social.blocks b
   where b.blocker = v_me;
  return social.ok(v_rows);
end;
$$;

create function social.create_group(p_global_user_id text, p_name text, p_my_name text, p_notice_version int)
returns jsonb
language plpgsql
security definer
set search_path = social, pg_temp
as $$
declare
  v_me uuid := social.person_of(p_global_user_id);
  v_name text := social.clean_name(p_name, 40);
  v_my_name text := social.clean_name(p_my_name, 24);
  v_code text := social.new_code();
  v_id uuid;
begin
  if v_me is null then
    return social.fail('not_linked');
  end if;
  if not social.has_name(v_me) then
    return social.fail('needs_display_name');
  end if;
  if not social.notice_ok(p_notice_version) then
    return social.fail('notice_required');
  end if;
  if v_name is null then
    return social.fail('bad_name');
  end if;
  if v_my_name is null then
    return social.fail('bad_my_name');
  end if;
  perform social.lock_persons(v_me);
  if (select count(*) from social.groups g where g.owner_id = v_me) >= 20 then
    return social.fail('too_many_created');
  end if;
  if (select count(*) from social.memberships m where m.person_id = v_me) >= 50 then
    return social.fail('too_many_groups');
  end if;
  if not social.under_daily_limit(v_me, 'create', 5) then
    return social.fail('slow_down');
  end if;
  insert into social.groups (name, owner_id) values (v_name, v_me) returning id into v_id;
  insert into social.invites (kind, code_hash, code, creator_id, group_id)
  values ('group', social.hash_of(v_code), v_code, v_me, v_id);
  insert into social.memberships (group_id, person_id, name, notice_version) values (v_id, v_me, v_my_name, p_notice_version);
  insert into social.activity (person_id, kind) values (v_me, 'create');
  return social.ok(jsonb_build_object('groupId', v_id, 'inviteCode', v_code));
end;
$$;

create function social.join_group(p_global_user_id text, p_code text, p_my_name text, p_notice_version int)
returns jsonb
language plpgsql
security definer
set search_path = social, pg_temp
as $$
declare
  v_me uuid := social.person_of(p_global_user_id);
  v_my_name text := social.clean_name(p_my_name, 24);
  v_group uuid;
begin
  if v_me is null then
    return social.fail('not_linked');
  end if;
  if not social.has_name(v_me) then
    return social.fail('needs_display_name');
  end if;
  if not social.notice_ok(p_notice_version) then
    return social.fail('notice_required');
  end if;
  select i.group_id into v_group
    from social.invites i
   where i.code_hash = social.hash_of(p_code) and i.kind = 'group';
  if v_group is null then
    return social.fail('invalid_code');
  end if;
  perform social.lock_persons(v_me);
  -- Locked, so a full group can't be overfilled and a closing group can't gain a member.
  perform 1 from social.groups g where g.id = v_group for update;
  if not found then
    return social.fail('invalid_code');
  end if;
  -- Already in: only the notice I saw is noted.
  update social.memberships m set notice_version = p_notice_version
   where m.group_id = v_group and m.person_id = v_me;
  if found then
    return social.ok(jsonb_build_object('groupId', v_group));
  end if;
  if exists (select 1 from social.removals r where r.group_id = v_group and r.person_id = v_me) then
    return social.fail('removed');
  end if;
  if v_my_name is null then
    return social.fail('bad_my_name');
  end if;
  if (select count(*) from social.memberships m where m.person_id = v_me) >= 50 then
    return social.fail('too_many_groups');
  end if;
  if (select count(*) from social.memberships m where m.group_id = v_group) >= 10000 then
    return social.fail('group_full');
  end if;
  if not social.under_daily_limit(v_me, 'join', 30) then
    return social.fail('slow_down');
  end if;
  insert into social.memberships (group_id, person_id, name, notice_version)
  values (v_group, v_me, v_my_name, p_notice_version);
  insert into social.activity (person_id, kind) values (v_me, 'join');
  return social.ok(jsonb_build_object('groupId', v_group));
end;
$$;

-- inviteCode is always here: the group's code for its current owner, and null for
-- everyone else. See INVITE CODES at the top of this file.
create function social.list_my_groups(p_global_user_id text)
returns jsonb
language plpgsql
security definer
set search_path = social, pg_temp
as $$
declare
  v_me uuid := social.person_of(p_global_user_id);
  v_rows jsonb;
begin
  if v_me is null then
    return social.fail('not_linked');
  end if;
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'groupId', g.id,
               'name', g.name,
               'emblemId', g.emblem_id,
               'accentColor', g.accent_color,
               'photo', social.photo_url(g.photo),
               'photoVersion', g.photo_version,
               'memberCount', (select count(*) from social.memberships c where c.group_id = g.id),
               'isOwner', g.owner_id = v_me,
               'myName', mine.name,
               'inviteCode', case when g.owner_id = v_me then i.code end
             )
             order by mine.joined_at, g.id
           ),
           '[]'::jsonb
         )
    into v_rows
    from social.memberships mine
    join social.groups g on g.id = mine.group_id
    left join social.invites i on i.group_id = g.id and i.kind = 'group'
   where mine.person_id = v_me;
  return social.ok(v_rows);
end;
$$;

-- One page in joining order. For the next page pass the last row's joinedAt and
-- memberRef.
create function social.list_members(p_global_user_id text, p_group text, p_after_joined timestamptz default null, p_after_ref text default null, p_limit int default 100)
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
      select m.id, m.name, m.person_id, m.joined_at, p.animal_id, p.background_color
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

create function social.leave_group(p_global_user_id text, p_group text)
returns jsonb
language plpgsql
security definer
set search_path = social, pg_temp
as $$
declare
  v_me uuid := social.person_of(p_global_user_id);
  v_group uuid := social.as_uuid(p_group);
begin
  if v_me is null then
    return social.fail('not_linked');
  end if;
  -- Locked, so a hand-over or closing can't cross a join.
  perform 1 from social.groups g where g.id = v_group for update;
  if not exists (select 1 from social.memberships m where m.group_id = v_group and m.person_id = v_me) then
    return social.fail('not_a_member');
  end if;
  return social.ok(jsonb_build_object('closed', social.drop_member(v_group, v_me)));
end;
$$;

-- This group's name only: the display name and other groups don't change.
-- Membership is asked before the name, so a non-member learns nothing from a bad one.
create function social.rename_me_in_group(p_global_user_id text, p_group text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = social, pg_temp
as $$
declare
  v_me uuid := social.person_of(p_global_user_id);
  v_group uuid := social.as_uuid(p_group);
  v_name text := social.clean_name(p_name, 24);
begin
  if v_me is null then
    return social.fail('not_linked');
  end if;
  -- Locked, so a removal can't save a name that is being changed.
  perform 1 from social.groups g where g.id = v_group for update;
  if not exists (select 1 from social.memberships m where m.group_id = v_group and m.person_id = v_me) then
    return social.fail('not_a_member');
  end if;
  if v_name is null then
    return social.fail('bad_my_name');
  end if;
  update social.memberships m set name = v_name
   where m.group_id = v_group and m.person_id = v_me;
  return social.ok();
end;
$$;

-- Owner only. They stay out, with any code, until let back in.
create function social.remove_member(p_global_user_id text, p_group text, p_member_ref text)
returns jsonb
language plpgsql
security definer
set search_path = social, pg_temp
as $$
declare
  v_me uuid := social.person_of(p_global_user_id);
  v_group uuid := social.as_uuid(p_group);
  v_ref uuid := social.as_uuid(p_member_ref);
  v_refusal text;
  v_person uuid;
  v_name text;
begin
  if v_me is null then
    return social.fail('not_linked');
  end if;
  perform 1 from social.groups g where g.id = v_group for update;
  v_refusal := social.owner_refusal(v_group, v_me);
  if v_refusal is not null then
    return social.fail(v_refusal);
  end if;
  select m.person_id, m.name into v_person, v_name
    from social.memberships m
   where m.id = v_ref and m.group_id = v_group;
  if v_person is null then
    return social.fail('not_found');
  end if;
  if v_person = v_me then
    return social.fail('cannot_remove_self');
  end if;
  insert into social.removals (group_id, person_id, name) values (v_group, v_person, v_name)
  on conflict (group_id, person_id) do update set name = excluded.name, removed_at = now();
  delete from social.memberships m where m.id = v_ref;
  return social.ok();
end;
$$;

-- Owner only. Each name is the one saved at removal.
create function social.list_removed(p_global_user_id text, p_group text)
returns jsonb
language plpgsql
security definer
set search_path = social, pg_temp
as $$
declare
  v_me uuid := social.person_of(p_global_user_id);
  v_group uuid := social.as_uuid(p_group);
  v_refusal text;
  v_rows jsonb;
begin
  if v_me is null then
    return social.fail('not_linked');
  end if;
  -- Locked before asking who owns it, as the writers do. Only reading, so a share lock.
  perform 1 from social.groups g where g.id = v_group for share;
  v_refusal := social.owner_refusal(v_group, v_me);
  if v_refusal is not null then
    return social.fail(v_refusal);
  end if;
  select coalesce(
           jsonb_agg(jsonb_build_object('removedRef', r.id, 'name', r.name) order by r.removed_at, r.id),
           '[]'::jsonb
         )
    into v_rows
    from social.removals r
   where r.group_id = v_group;
  return social.ok(v_rows);
end;
$$;

create function social.let_back_in(p_global_user_id text, p_group text, p_removed_ref text)
returns jsonb
language plpgsql
security definer
set search_path = social, pg_temp
as $$
declare
  v_me uuid := social.person_of(p_global_user_id);
  v_group uuid := social.as_uuid(p_group);
  v_refusal text;
begin
  if v_me is null then
    return social.fail('not_linked');
  end if;
  -- Locked before asking who owns it: ownership can move while we look.
  perform 1 from social.groups g where g.id = v_group for update;
  v_refusal := social.owner_refusal(v_group, v_me);
  if v_refusal is not null then
    return social.fail(v_refusal);
  end if;
  delete from social.removals r where r.id = social.as_uuid(p_removed_ref) and r.group_id = v_group;
  if not found then
    return social.fail('not_found');
  end if;
  return social.ok();
end;
$$;

-- A fresh code; the old one and its hash are gone at once. Members stay members.
create function social.replace_invite(p_global_user_id text, p_group text)
returns jsonb
language plpgsql
security definer
set search_path = social, pg_temp
as $$
declare
  v_me uuid := social.person_of(p_global_user_id);
  v_group uuid := social.as_uuid(p_group);
  v_code text := social.new_code();
  v_refusal text;
begin
  if v_me is null then
    return social.fail('not_linked');
  end if;
  -- Locked before asking who owns it: ownership can move while we look.
  perform 1 from social.groups g where g.id = v_group for update;
  v_refusal := social.owner_refusal(v_group, v_me);
  if v_refusal is not null then
    return social.fail(v_refusal);
  end if;
  update social.invites i set code_hash = social.hash_of(v_code), code = v_code, creator_id = v_me
   where i.group_id = v_group and i.kind = 'group';
  return social.ok(jsonb_build_object('inviteCode', v_code));
end;
$$;

create function social.rename_group(p_global_user_id text, p_group text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = social, pg_temp
as $$
declare
  v_me uuid := social.person_of(p_global_user_id);
  v_group uuid := social.as_uuid(p_group);
  v_name text := social.clean_name(p_name, 40);
  v_refusal text;
begin
  if v_me is null then
    return social.fail('not_linked');
  end if;
  -- Locked before asking who owns it: ownership can move while we look.
  perform 1 from social.groups g where g.id = v_group for update;
  v_refusal := social.owner_refusal(v_group, v_me);
  if v_refusal is not null then
    return social.fail(v_refusal);
  end if;
  if v_name is null then
    return social.fail('bad_name');
  end if;
  update social.groups g set name = v_name, updated_at = now() where g.id = v_group;
  return social.ok();
end;
$$;

-- p_photo is a data:image/jpeg;base64, URL, or null for no picture. photoVersion
-- moves only when the picture itself changes.
create function social.set_group_appearance(p_global_user_id text, p_group text, p_emblem_id text, p_photo text, p_accent_color text)
returns jsonb
language plpgsql
security definer
set search_path = social, pg_temp
as $$
declare
  v_me uuid := social.person_of(p_global_user_id);
  v_group uuid := social.as_uuid(p_group);
  v_refusal text;
  v_photo bytea;
  v_version int;
begin
  if v_me is null then
    return social.fail('not_linked');
  end if;
  -- Locked before asking who owns it: ownership can move while we look.
  perform 1 from social.groups g where g.id = v_group for update;
  v_refusal := social.owner_refusal(v_group, v_me);
  if v_refusal is not null then
    return social.fail(v_refusal);
  end if;
  if not social.is_emblem(p_emblem_id) then
    return social.fail('bad_emblem');
  end if;
  if not social.is_color(p_accent_color) then
    return social.fail('bad_color');
  end if;
  if p_photo is not null then
    select c.refusal, c.jpeg into v_refusal, v_photo from social.check_photo(p_photo) c;
    if v_refusal is not null then
      return social.fail(v_refusal);
    end if;
  end if;
  update social.groups g
     set emblem_id = p_emblem_id,
         accent_color = p_accent_color,
         photo_version = g.photo_version + (g.photo is distinct from v_photo)::int,
         photo = v_photo,
         updated_at = now()
   where g.id = v_group
   returning g.photo_version into v_version;
  return social.ok(jsonb_build_object('photoVersion', v_version));
end;
$$;

-- The game's own server calls this, on a route no browser reaches, and it is the
-- one function that takes a global id it can't verify from a token. The person must
-- already exist: a result never creates one. The server has verified its own
-- account, so someone who has only used Friends in another game gets the link here,
-- and their result doesn't vanish. Only a result that fits makes a link. The first
-- result for a game, puzzle and person stands, so a replay gets ok and changes
-- nothing. p_detail is null, SQL or JSON, for a result that has none.
create function social.record_completion(p_global_user_id text, p_game text, p_puzzle_id text, p_completed_at text, p_summary jsonb, p_detail jsonb)
returns jsonb
language plpgsql
security definer
set search_path = social, pg_temp
as $$
declare
  v_detail jsonb := nullif(p_detail, 'null'::jsonb);
  v_at timestamptz := social.completed_at(p_completed_at);
  v_person uuid;
begin
  if not social.game_enabled(p_game) then
    return social.fail('game_disabled');
  end if;
  if p_global_user_id is null
     or p_puzzle_id is null
     or p_puzzle_id !~ '^[A-Za-z0-9:_-]{1,64}$'
     or v_at is null
     or not social.result_fits(p_game, p_summary, v_detail) then
    return social.fail('bad_result');
  end if;
  select p.id into v_person from social.persons p where p.global_user_id = p_global_user_id;
  if v_person is null then
    return social.fail('not_found');
  end if;
  perform social.lock_persons(v_person);
  -- Read again: they may have gone while being locked.
  if not exists (select 1 from social.persons p where p.id = v_person) then
    return social.fail('not_found');
  end if;
  insert into social.game_links (person_id, game) values (v_person, p_game)
  on conflict (person_id, game) do nothing;
  insert into social.result_cards (game, puzzle_id, person_id, completed_at, summary, detail)
  values (p_game, p_puzzle_id, v_person, v_at, p_summary, v_detail)
  on conflict (game, puzzle_id, person_id) do nothing;
  return social.ok();
end;
$$;

-- Everything about who sees what happens here, from the verified id alone.
--
-- p_group null: my friends and me. Otherwise that group, for its members only. Rows
-- come only for people with a result, only if it was completed at or after the two
-- connected, and never across a block, in either direction. Whoever isn't connected
-- to me right now has no row, so an ended connection needs no cleaning up. My own
-- row is mine whatever its date.
--
-- Detail: only the branch that returns it reads it. cards says whether there is a
-- detail and holds no detail, so a locked row never has it in hand.
create function social.list_results(p_global_user_id text, p_game text, p_puzzle_id text, p_group text default null)
returns jsonb
language plpgsql
security definer
set search_path = social, pg_temp
as $$
declare
  v_me uuid := social.person_of(p_global_user_id);
  v_group uuid := social.as_uuid(p_group);
  v_finished boolean;
  v_rows jsonb;
begin
  if v_me is null then
    return social.fail('not_linked');
  end if;
  -- Asks p_group, not v_group: a made-up id must get this answer, not the friends.
  if p_group is not null and not exists (
    select 1 from social.memberships m where m.group_id = v_group and m.person_id = v_me
  ) then
    return social.fail('not_a_member');
  end if;
  v_finished := exists (
    select 1 from social.result_cards c
     where c.game = p_game and c.puzzle_id = p_puzzle_id and c.person_id = v_me
  );

  with audience as (
    select jsonb_build_object('memberRef', m.id) as ref, m.person_id, m.name,
           greatest(m.joined_at, mine.joined_at) as connected_at, m.joined_at as place, m.id as tie
      from social.memberships m
      join social.memberships mine on mine.group_id = m.group_id and mine.person_id = v_me
     where m.group_id = v_group
    union all
    select jsonb_build_object('friendRef', f.id), other.id, other.display_name, f.since, f.since, f.id
      from social.friendships f
      join social.persons other on other.id = case when f.person_a = v_me then f.person_b else f.person_a end
     where p_group is null and v_me in (f.person_a, f.person_b)
    union all
    select jsonb_build_object('friendRef', null::uuid), me.id, me.display_name, '-infinity'::timestamptz, '-infinity'::timestamptz, me.id
      from social.persons me
     where p_group is null and me.id = v_me
  ),
  cards as (
    select c.person_id, c.completed_at, c.summary, c.detail is not null as has_detail
      from social.result_cards c
     where c.game = p_game and c.puzzle_id = p_puzzle_id
  )
  select coalesce(
           jsonb_agg(
             a.ref
             || jsonb_build_object('isMe', a.person_id = v_me, 'name', a.name, 'animalId', p.animal_id, 'backgroundColor', p.background_color, 'summary', c.summary)
             || case
                  when not c.has_detail then jsonb_build_object('detail', null::jsonb, 'detailLocked', false)
                  when v_finished then jsonb_build_object(
                    'detail', (
                      select d.detail from social.result_cards d
                       where d.game = p_game and d.puzzle_id = p_puzzle_id and d.person_id = a.person_id
                    ),
                    'detailLocked', false
                  )
                  else jsonb_build_object('detailLocked', true)
                end
             order by a.place, a.tie
           ),
           '[]'::jsonb
         )
    into v_rows
    from audience a
    join cards c on c.person_id = a.person_id
    join social.persons p on p.id = a.person_id
   where a.person_id = v_me
      or (c.completed_at >= a.connected_at and not social.blocked_either_way(v_me, a.person_id));
  return social.ok(v_rows);
end;
$$;

-- SERVER SIDE ONLY. These are global ids, for the gateway's server-side result read,
-- and this answer must never be returned to a browser. That is why this runs on
-- social_game_server and not on social_gateway, the role of the browser route.
--
-- p_group null: the caller and their friends. Otherwise that group's members, for
-- its members only: a group the caller isn't in, a made-up id and a group that
-- doesn't exist all get not_a_member, the same as list_results. Someone blocked
-- either way is left out, the caller never, because section 6 of the contract has
-- blocks enforced before results are read. Nothing here decides what a viewer sees:
-- list_results still applies forward-only and locked detail. A read creates nobody,
-- so an unknown global id gets not_found, as in record_completion.
create function social.audience_global_ids(p_global_user_id text, p_group text default null)
returns jsonb
language plpgsql
security definer
set search_path = social, pg_temp
as $$
declare
  v_group uuid := social.as_uuid(p_group);
  v_me uuid;
  v_ids jsonb;
begin
  if not social.is_global_id(p_global_user_id) then
    return social.fail('not_linked');
  end if;
  select p.id into v_me from social.persons p where p.global_user_id = p_global_user_id;
  -- Asks p_group, not v_group: a made-up id must get this answer, not the friends.
  if p_group is not null and not exists (
    select 1 from social.memberships m where m.group_id = v_group and m.person_id = v_me
  ) then
    return social.fail('not_a_member');
  end if;
  if v_me is null then
    return social.fail('not_found');
  end if;

  with audience as (
    select m.person_id
      from social.memberships m
     where m.group_id = v_group
    union
    select case when f.person_a = v_me then f.person_b else f.person_a end
      from social.friendships f
     where p_group is null and v_me in (f.person_a, f.person_b)
    union
    select me.id
      from social.persons me
     where p_group is null and me.id = v_me
  )
  select coalesce(jsonb_agg(p.global_user_id order by p.global_user_id), '[]'::jsonb)
    into v_ids
    from audience a
    join social.persons p on p.id = a.person_id
   where a.person_id = v_me or not social.blocked_either_way(v_me, a.person_id);
  return social.ok(v_ids);
end;
$$;

-- deleteMySocialData: the person, their profile and friend code, result cards,
-- friend requests and lookups either way, friendships, blocks, memberships, removal
-- records and friend invites all go. Owned groups hand over or close first (D11).
-- A group's reusable code stays with the group. Blocks and removals other people
-- made against this person go too, which is provisional (D13).
create function social.delete_person(p_global_user_id text)
returns jsonb
language plpgsql
security definer
set search_path = social, pg_temp
as $$
declare
  v_me uuid;
  v_group uuid;
begin
  if not social.is_global_id(p_global_user_id) then
    return social.fail('not_linked');
  end if;
  select p.id into v_me from social.persons p where p.global_user_id = p_global_user_id;
  if v_me is null then
    return social.ok();
  end if;
  perform social.lock_persons(v_me);
  -- In id order, so two deletions can't deadlock on the same groups.
  for v_group in
    select m.group_id from social.memberships m where m.person_id = v_me order by m.group_id
  loop
    perform 1 from social.groups g where g.id = v_group for update;
    perform social.drop_member(v_group, v_me);
  end loop;
  delete from social.invites i where i.kind = 'friend' and i.creator_id = v_me;
  delete from social.persons p where p.id = v_me;
  return social.ok();
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges. Everything is revoked, then exactly the entry functions are
-- granted: all but two to social_gateway, and only record_completion and
-- audience_global_ids to social_game_server. No function is granted to both. No
-- table is granted to anyone, and service_role gets nothing: it isn't the gateway.
-- ---------------------------------------------------------------------------

revoke all on schema social from public, anon, authenticated, service_role;
revoke all on all tables in schema social from public, anon, authenticated, service_role;
revoke all on all functions in schema social from public, anon, authenticated, service_role;

grant usage on schema social to social_gateway, social_game_server;

grant execute on function social.is_beta_tester(text) to social_gateway;
grant execute on function social.ensure_person(text, text) to social_gateway;
grant execute on function social.set_display_name(text, text) to social_gateway;
grant execute on function social.set_profile(text, text, text, text) to social_gateway;
grant execute on function social.create_friend_invite(text, int) to social_gateway;
grant execute on function social.preview_invite(text, text) to social_gateway;
grant execute on function social.accept_friend_invite(text, text, int) to social_gateway;
grant execute on function social.find_friend_by_code(text, text) to social_gateway;
grant execute on function social.send_friend_request(text, text, int) to social_gateway;
grant execute on function social.list_friend_requests(text) to social_gateway;
grant execute on function social.accept_friend_request(text, text, int) to social_gateway;
grant execute on function social.decline_friend_request(text, text) to social_gateway;
grant execute on function social.cancel_friend_request(text, text) to social_gateway;
grant execute on function social.list_friends(text) to social_gateway;
grant execute on function social.remove_friend(text, text) to social_gateway;
grant execute on function social.block(text, text) to social_gateway;
grant execute on function social.unblock(text, text) to social_gateway;
grant execute on function social.list_blocks(text) to social_gateway;
grant execute on function social.create_group(text, text, text, int) to social_gateway;
grant execute on function social.join_group(text, text, text, int) to social_gateway;
grant execute on function social.list_my_groups(text) to social_gateway;
grant execute on function social.list_members(text, text, timestamptz, text, int) to social_gateway;
grant execute on function social.leave_group(text, text) to social_gateway;
grant execute on function social.rename_me_in_group(text, text, text) to social_gateway;
grant execute on function social.remove_member(text, text, text) to social_gateway;
grant execute on function social.list_removed(text, text) to social_gateway;
grant execute on function social.let_back_in(text, text, text) to social_gateway;
grant execute on function social.replace_invite(text, text) to social_gateway;
grant execute on function social.rename_group(text, text, text) to social_gateway;
grant execute on function social.set_group_appearance(text, text, text, text, text) to social_gateway;
grant execute on function social.list_results(text, text, text, text) to social_gateway;
grant execute on function social.delete_person(text) to social_gateway;

grant execute on function social.record_completion(text, text, text, text, jsonb, jsonb) to social_game_server;
-- Never to social_gateway. See the comment on the function.
grant execute on function social.audience_global_ids(text, text) to social_game_server;
