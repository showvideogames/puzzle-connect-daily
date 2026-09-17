-- ============================================================================
-- Lightweight puzzle content versioning
--
-- THE PROBLEM THIS FIXES
--
-- Admin.handleSave() edits a live puzzle with three separate round trips:
--
--   1. UPDATE public.puzzles        (word_order, rainbow_herring, ...)
--   2. DELETE FROM puzzle_groups WHERE puzzle_id = ...
--   3. INSERT the new puzzle_groups
--
-- Two things follow from that, and both are player-visible.
--
-- First, it is not atomic. Between (2) and (3) the puzzle exists with ZERO
-- groups, and if (3) fails it stays that way. Anyone loading the puzzle in
-- that window gets a board with no words at all.
--
-- Second, and worse, there is only ever ONE definition of a puzzle. A player
-- who is midway through the old wording holds it only in React state. The
-- moment they refresh, navigate away and back, or reopen the browser, the
-- page re-fetches the NEW definition while localStorage restores the OLD
-- board: `shuffledWords` still lists words that no longer belong to any
-- group, `getWordGroupIndex` returns -1 for them, and `matchedGroupIndex`
-- can never match. Their remaining correct answers become unsubmittable —
-- the board is stuck, permanently, with no way to finish.
--
-- THE MODEL
--
--   PUZZLE (stable identity, one row, never re-created)
--     +-> PUZZLE_VERSIONS (immutable content snapshots, 1..N)
--     +-> current_version_id -> the newest snapshot
--
--   GAME_SESSION -> puzzle_version_id  (the snapshot THAT player is playing)
--
-- The puzzle id never changes, so every stat, aggregate, result and official
-- -result rule keys off exactly what it keyed off before. Versioning adds a
-- second, finer coordinate; it does not redefine puzzle identity, and it
-- deliberately changes NO counting semantics anywhere.
--
-- WHAT STAYS THE SAME ON PURPOSE
--
-- puzzles/puzzle_groups remain the live read path the game already uses.
-- Players load a board exactly as they do today — same query, same tables,
-- same policies, no new RPC on the critical path — which is what keeps the
-- availability-first rule intact: if everything added here were unreachable,
-- a puzzle would still load and still be playable. The version row is the
-- durable immutable COPY of that same content, written in the same
-- transaction by the save function below, never a second source of truth
-- that could drift.
--
-- ---------------------------------------------------------------------------
-- APPLY ORDER. Apply this migration BEFORE deploying the frontend that
-- accompanies it. create_game_session below keeps the old call shape working
-- (the new argument has a DEFAULT), so an already-deployed older bundle
-- continues to function during the window — it simply creates sessions with
-- no pinned version, exactly like a legacy session.
-- ---------------------------------------------------------------------------
-- ============================================================================


-- ===========================================================================
-- 1. puzzle_versions -- the immutable snapshots
-- ===========================================================================

-- One row per saved gameplay definition of a puzzle.
--
-- `content` is a single structured JSON snapshot rather than a duplicate of
-- the puzzles/puzzle_groups table shape. That is the smaller and safer
-- choice: there is exactly one thing to write, one thing to compare for
-- "did anything gameplay-relevant change?", and no possibility of a
-- half-copied version whose groups and header disagree. Its shape is
-- validated server-side by validate_puzzle_content() below -- it is never
-- trusted as free-form client JSON.
create table if not exists public.puzzle_versions (
  id uuid primary key default gen_random_uuid(),
  puzzle_id uuid not null references public.puzzles(id) on delete cascade,
  -- Unique and ordered per puzzle, allocated inside the save function under
  -- the puzzle row's own lock, so two admins saving at the same moment get
  -- 2 and 3 rather than both getting 2.
  version_number integer not null check (version_number >= 1),
  content jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique (puzzle_id, version_number)
);

comment on table public.puzzle_versions is
  'Immutable gameplay-content snapshots of a puzzle. Never updated, never deleted except by cascade when the puzzle itself is deleted. A game_sessions row pins the exact snapshot that player is playing.';

comment on column public.puzzle_versions.content is
  'Canonical gameplay content: {groups:[{category,words[4],difficulty,hint_word,sort_order}] x4, word_order, rainbow_herring, rainbow_category_name, rainbow_hint_word, theme, is_emoji_puzzle}. Shape enforced by validate_puzzle_content().';

create index if not exists puzzle_versions_puzzle_idx
  on public.puzzle_versions (puzzle_id, version_number desc);


-- ---------------------------------------------------------------------------
-- Immutability, enforced rather than merely intended.
--
-- Rule 4 of this feature ("a player already playing an earlier version must
-- remain able to finish it") is only true if the snapshot they pinned cannot
-- change underneath them. A policy alone would not give that: admins hold
-- FOR ALL on every other puzzle table, and a future SECURITY DEFINER
-- function could be written carelessly. This trigger holds regardless of who
-- the caller is or how much privilege they have.
--
-- DELETE is deliberately NOT blocked here. Deleting a puzzle must still
-- work, and the cascade from puzzles is a referential action performed by
-- the system rather than an ordinary client write. Direct client deletes are
-- refused by the absence of any DELETE policy in section 5.
-- ---------------------------------------------------------------------------
create or replace function public.puzzle_versions_block_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception
    'puzzle_versions rows are immutable; save a new version instead (puzzle_id=%, version_number=%)',
    old.puzzle_id, old.version_number
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists puzzle_versions_immutable on public.puzzle_versions;
create trigger puzzle_versions_immutable
  before update on public.puzzle_versions
  for each row execute function public.puzzle_versions_block_update();


-- ===========================================================================
-- 2. puzzles.current_version_id -- the one current-version reference
-- ===========================================================================

-- The newest saved version, which is what every new player and every normal
-- Archive view uses. NULL only for a puzzle that predates this migration and
-- has not yet been backfilled (section 6 backfills all of them).
--
-- Deliberately NOT a foreign key. A real FK here would be circular
-- (puzzles -> puzzle_versions -> puzzles) and would make deleting a puzzle
-- depend on the order Postgres happens to run two cascades in. The trigger
-- below gives the property that actually matters -- and gives it more
-- strongly than a single-column FK could, because it also enforces that the
-- referenced version BELONGS TO THIS PUZZLE.
alter table public.puzzles
  add column if not exists current_version_id uuid;

comment on column public.puzzles.current_version_id is
  'The newest puzzle_versions row for this puzzle: the canonical current definition. Enforced to belong to this same puzzle. Written only by admin_save_puzzle().';

create or replace function public.puzzles_check_current_version()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  _owner uuid;
begin
  if new.current_version_id is null then
    return new;
  end if;

  select pv.puzzle_id into _owner
    from public.puzzle_versions pv
   where pv.id = new.current_version_id;

  if _owner is null then
    raise exception 'current_version_id % does not exist', new.current_version_id
      using errcode = 'foreign_key_violation';
  end if;

  -- The cross-puzzle guard: puzzle A can never point at a snapshot of
  -- puzzle B, so "the current version of this puzzle" is always content that
  -- was actually written for this puzzle.
  if _owner <> new.id then
    raise exception 'current_version_id % belongs to puzzle %, not %',
      new.current_version_id, _owner, new.id
      using errcode = 'foreign_key_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists puzzles_current_version_check on public.puzzles;
create trigger puzzles_current_version_check
  before insert or update of current_version_id on public.puzzles
  for each row execute function public.puzzles_check_current_version();


-- ===========================================================================
-- 3. game_sessions.puzzle_version_id -- the per-session pin
-- ===========================================================================

-- The exact snapshot this player's board was built from.
--
-- NULL is a truthful, supported value, and means exactly one thing: the
-- system does not know. That covers every session created before this
-- migration existed -- their real content is genuinely unknowable now, and
-- labelling them with today's version would be a fabrication. Such a session
-- resolves against the puzzle's current version, which is the same behaviour
-- it has always had.
--
-- ON DELETE SET NULL, not CASCADE: a version can only disappear when the
-- whole puzzle is deleted, and losing the pin must never delete a player's
-- gameplay record. game_sessions.puzzle_id is already text with no FK, so
-- sessions already outlive their puzzle; this matches that.
alter table public.game_sessions
  add column if not exists puzzle_version_id uuid
    references public.puzzle_versions(id) on delete set null;

comment on column public.game_sessions.puzzle_version_id is
  'The puzzle_versions snapshot this session is playing. NULL = unknown (legacy session predating versioning, or a client that did not pin one) -- never backfilled or guessed. Stats key on puzzle_id, NOT on this column: every version is the same puzzle.';

create index if not exists game_sessions_puzzle_version_idx
  on public.game_sessions (puzzle_version_id)
  where puzzle_version_id is not null;


-- ===========================================================================
-- 4. Content validation -- the server-side shape contract
--
-- The content column is jsonb, so without this it would accept absolutely
-- anything an admin's browser sent, including a snapshot that can never be
-- solved. Every rule below is one the Admin form already enforces in the UI;
-- restating them here is what makes them actually enforced, since the UI is
-- not a security boundary and a partially-saved bad snapshot would be
-- permanent (versions are immutable).
--
-- Returns the CANONICAL form. Canonicalisation is what makes the no-op and
-- metadata-only rules work: two saves that mean the same thing produce
-- byte-identical jsonb, so plain jsonb equality answers "did gameplay
-- actually change?" with no hashing, no extension dependency and no
-- field-by-field comparison to keep in sync.
-- ===========================================================================
create or replace function public.validate_puzzle_content(_content jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  _groups      jsonb;
  _g           jsonb;
  _words       jsonb;
  _all         text[] := '{}';
  _out         jsonb := '[]'::jsonb;
  _herring     jsonb;
  _order       jsonb;
  _i           integer;
  _w           text;
begin
  if _content is null or jsonb_typeof(_content) <> 'object' then
    raise exception 'puzzle content must be a JSON object' using errcode = 'invalid_parameter_value';
  end if;

  _groups := _content -> 'groups';
  if _groups is null or jsonb_typeof(_groups) <> 'array' or jsonb_array_length(_groups) <> 4 then
    raise exception 'puzzle content must contain exactly 4 groups' using errcode = 'invalid_parameter_value';
  end if;

  for _i in 0 .. 3 loop
    _g := _groups -> _i;
    if jsonb_typeof(_g) <> 'object' then
      raise exception 'group % must be an object', _i + 1 using errcode = 'invalid_parameter_value';
    end if;

    if coalesce(btrim(_g ->> 'category'), '') = '' then
      raise exception 'group % needs a category name', _i + 1 using errcode = 'invalid_parameter_value';
    end if;

    if (_g ->> 'difficulty') is null
       or (_g ->> 'difficulty') !~ '^[1-4]$' then
      raise exception 'group % needs a difficulty between 1 and 4', _i + 1 using errcode = 'invalid_parameter_value';
    end if;

    _words := _g -> 'words';
    if _words is null or jsonb_typeof(_words) <> 'array' or jsonb_array_length(_words) <> 4 then
      raise exception 'group % needs exactly 4 words', _i + 1 using errcode = 'invalid_parameter_value';
    end if;

    for _w in select jsonb_array_elements_text(_words) loop
      if coalesce(btrim(_w), '') = '' then
        raise exception 'group % contains an empty word', _i + 1 using errcode = 'invalid_parameter_value';
      end if;
      _all := _all || _w;
    end loop;

    -- Rebuilt key by key, in a fixed key set: anything the client sent that
    -- is not part of the gameplay contract is dropped here rather than
    -- silently preserved into an immutable snapshot.
    _out := _out || jsonb_build_array(jsonb_build_object(
      'category',   btrim(_g ->> 'category'),
      'words',      _words,
      'difficulty', (_g ->> 'difficulty')::int,
      'hint_word',  nullif(btrim(coalesce(_g ->> 'hint_word', '')), ''),
      -- Positional, always 0..3 in the order given. Difficulty ORDER is
      -- gameplay-defining (it drives the colour of every share-grid square),
      -- so it travels inside the snapshot rather than being re-derived.
      'sort_order', _i
    ));
  end loop;

  if (select count(distinct w) from unnest(_all) w) <> 16 then
    raise exception 'a puzzle needs 16 unique words' using errcode = 'invalid_parameter_value';
  end if;

  -- The Rainbow answer. Either absent entirely, or exactly 4 of this
  -- puzzle's own 16 words -- a herring referencing a word that is not on the
  -- board could never be submitted, so it is rejected rather than stored.
  _herring := _content -> 'rainbow_herring';
  if _herring is not null and jsonb_typeof(_herring) <> 'null' then
    if jsonb_typeof(_herring) <> 'array' or jsonb_array_length(_herring) <> 4 then
      raise exception 'rainbow_herring must have exactly 4 words' using errcode = 'invalid_parameter_value';
    end if;
    for _w in select jsonb_array_elements_text(_herring) loop
      if not (_w = any (_all)) then
        raise exception 'rainbow_herring word "%" is not one of this puzzle''s 16 words', _w
          using errcode = 'invalid_parameter_value';
      end if;
    end loop;
  else
    _herring := null;
  end if;

  -- The starting tile layout. Same rule: it must be a permutation of the
  -- board's own words, or it is not a layout of this board.
  _order := _content -> 'word_order';
  if _order is not null and jsonb_typeof(_order) <> 'null' then
    if jsonb_typeof(_order) <> 'array' or jsonb_array_length(_order) <> 16 then
      raise exception 'word_order must list all 16 words' using errcode = 'invalid_parameter_value';
    end if;
    for _w in select jsonb_array_elements_text(_order) loop
      if not (_w = any (_all)) then
        raise exception 'word_order word "%" is not one of this puzzle''s 16 words', _w
          using errcode = 'invalid_parameter_value';
      end if;
    end loop;
  else
    _order := null;
  end if;

  return jsonb_build_object(
    'groups',                _out,
    'word_order',            _order,
    'rainbow_herring',       _herring,
    'rainbow_category_name', nullif(btrim(coalesce(_content ->> 'rainbow_category_name', '')), ''),
    'rainbow_hint_word',     nullif(btrim(coalesce(_content ->> 'rainbow_hint_word', '')), ''),
    'theme',                 nullif(btrim(coalesce(_content ->> 'theme', '')), ''),
    'is_emoji_puzzle',       coalesce((_content ->> 'is_emoji_puzzle')::boolean, false)
  );
end;
$$;

revoke all on function public.validate_puzzle_content(jsonb) from public;
grant execute on function public.validate_puzzle_content(jsonb) to authenticated, service_role;

comment on function public.validate_puzzle_content(jsonb) is
  'Validates and canonicalises puzzle gameplay content. Canonical output is what makes jsonb equality a reliable "did gameplay change?" test.';


-- ===========================================================================
-- 5. ACCESS CONTROL for puzzle_versions
--
-- Read: the same audience as puzzle_groups -- anyone may read the versions
-- of a PUBLISHED puzzle, which is exactly what a player needs to resume a
-- board they already started. Nothing private is in this table: it holds
-- puzzle content, not player data.
--
-- Write: there is deliberately no INSERT, UPDATE or DELETE policy for ANY
-- role, admins included. The only way a version is ever created is
-- admin_save_puzzle() below, which is SECURITY DEFINER and checks the admin
-- role itself. That is what stops "only admins may create or promote
-- versions" from depending on the Admin UI hiding a button.
-- ===========================================================================
alter table public.puzzle_versions enable row level security;

drop policy if exists "Anyone can read published puzzle versions" on public.puzzle_versions;
create policy "Anyone can read published puzzle versions"
on public.puzzle_versions
for select
to public
using (
  exists (
    select 1 from public.puzzles p
     where p.id = puzzle_versions.puzzle_id
       and p.is_published = true
  )
);

drop policy if exists "Admins can read all puzzle versions" on public.puzzle_versions;
create policy "Admins can read all puzzle versions"
on public.puzzle_versions
for select
to authenticated
using (public.has_role(auth.uid(), 'admin'));

-- Table-level grants, so the absence of write POLICIES is not the only thing
-- standing between a client and this table.
revoke all on table public.puzzle_versions from anon, authenticated;
grant select on table public.puzzle_versions to anon, authenticated;


-- ===========================================================================
-- 6. Initial versions for existing puzzles
--
-- Every puzzle that already exists gets Version 1, built from its CURRENT
-- database definition -- which is the only definition that has ever been
-- recorded, so this is a faithful snapshot rather than a reconstruction.
--
-- Deliberately NOT done here: attaching existing sessions to it. A completed
-- session from last week may or may not have been played against today's
-- wording; the system has no record either way, and stamping it with this
-- new Version 1 would assert a fact nobody knows. Those sessions keep
-- puzzle_version_id NULL, keep every one of their raw guess events, and keep
-- counting in My Stats and Global Stats exactly as they do today -- none of
-- which reads this column.
-- ===========================================================================
do $$
declare
  _p record;
  _content jsonb;
  _vid uuid;
begin
  for _p in
    select p.id, p.word_order, p.rainbow_herring, p.rainbow_category_name,
           p.rainbow_hint_word, p.theme, p.is_emoji_puzzle, p.created_by
      from public.puzzles p
     where p.current_version_id is null
  loop
    -- Puzzles whose group data is incomplete (a half-saved draft from the
    -- old delete-then-insert path, which is exactly the failure this feature
    -- removes) are skipped rather than snapshotted into an immutable row
    -- that could never be valid. They get their first version the next time
    -- an admin saves them.
    if (select count(*) from public.puzzle_groups g where g.puzzle_id = _p.id) <> 4 then
      continue;
    end if;

    begin
      select jsonb_build_object(
               'groups', jsonb_agg(
                 jsonb_build_object(
                   'category',   g.category,
                   'words',      to_jsonb(g.words),
                   'difficulty', g.difficulty,
                   'hint_word',  g.hint_word
                 )
                 order by g.sort_order, g.id
               ),
               'word_order',            to_jsonb(_p.word_order),
               'rainbow_herring',       to_jsonb(_p.rainbow_herring),
               'rainbow_category_name', _p.rainbow_category_name,
               'rainbow_hint_word',     _p.rainbow_hint_word,
               'theme',                 _p.theme,
               'is_emoji_puzzle',       coalesce(_p.is_emoji_puzzle, false)
             )
        into _content
        from public.puzzle_groups g
       where g.puzzle_id = _p.id;

      _content := public.validate_puzzle_content(_content);
    exception when others then
      -- Same reasoning as the group-count skip above: a puzzle whose stored
      -- content cannot pass validation is left unversioned and untouched,
      -- rather than blocking this whole migration or being "repaired" into
      -- something no admin chose.
      raise notice 'skipping initial version for puzzle % (%)', _p.id, sqlerrm;
      continue;
    end;

    insert into public.puzzle_versions (puzzle_id, version_number, content, created_by)
    values (_p.id, 1, _content, _p.created_by)
    on conflict (puzzle_id, version_number) do nothing
    returning id into _vid;

    if _vid is null then
      select pv.id into _vid
        from public.puzzle_versions pv
       where pv.puzzle_id = _p.id and pv.version_number = 1;
    end if;

    update public.puzzles set current_version_id = _vid where id = _p.id;
  end loop;
end;
$$;


-- ===========================================================================
-- 7. admin_save_puzzle -- the single, atomic write path
--
-- Replaces the Admin screen's three separate round trips with one
-- transaction. That alone fixes the "half-old, half-new groups" window: the
-- delete and re-insert of puzzle_groups either both happen or neither does,
-- so a puzzle is never briefly wordless and a failed save leaves the
-- previous definition completely intact.
--
-- VERSIONING RULE, in one sentence: a new version is created exactly when
-- the canonical gameplay content differs from the current version's. That
-- single comparison delivers three of this feature's requirements at once --
-- a gameplay edit versions, a metadata-only edit does not, and a no-op save
-- does not -- without a list of "which fields count" that could drift out of
-- step with the fields themselves.
--
-- WHAT IS GAMEPLAY (inside _content, versioned):
--   all 16 words, category membership, category names, difficulty/order,
--   per-group hint words, the Rainbow answer, the Rainbow category name and
--   hint word, the theme, the emoji-puzzle flag, the starting word order.
--
-- WHAT IS METADATA (inside _metadata, never versioned):
--   date, title, is_published, emoji_puzzle_icon (an Archive card icon that
--   never appears on the board), is_free_puzzle, free_puzzle_order.
--
-- Returns a small object so the UI can tell the admin what actually
-- happened, rather than guessing from its own client-side diff.
-- ===========================================================================
create or replace function public.admin_save_puzzle(
  _puzzle_id uuid,
  _metadata jsonb,
  _content jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  _uid       uuid := auth.uid();
  _canonical jsonb;
  _current   jsonb;
  _next      integer;
  _vid       uuid;
  _created   boolean := false;
  _pid       uuid := _puzzle_id;
  _date      date;
begin
  -- Authorization first, and inside the function: this is SECURITY DEFINER,
  -- so everything below runs with the owner's rights regardless of who
  -- called it.
  if _uid is null or not public.has_role(_uid, 'admin') then
    raise exception 'admin role required to save puzzles' using errcode = 'insufficient_privilege';
  end if;

  _canonical := public.validate_puzzle_content(_content);

  _date := nullif(_metadata ->> 'date', '')::date;
  if _date is null then
    raise exception 'a puzzle needs a date' using errcode = 'invalid_parameter_value';
  end if;

  if _pid is null then
    insert into public.puzzles (
      date, title, is_published, created_by,
      word_order, rainbow_herring, rainbow_category_name, rainbow_hint_word,
      theme, is_emoji_puzzle, emoji_puzzle_icon, is_free_puzzle, free_puzzle_order
    ) values (
      _date,
      nullif(btrim(coalesce(_metadata ->> 'title', '')), ''),
      coalesce((_metadata ->> 'is_published')::boolean, false),
      _uid,
      case when _canonical -> 'word_order' = 'null'::jsonb then null
           else array(select jsonb_array_elements_text(_canonical -> 'word_order')) end,
      case when _canonical -> 'rainbow_herring' = 'null'::jsonb then null
           else array(select jsonb_array_elements_text(_canonical -> 'rainbow_herring')) end,
      _canonical ->> 'rainbow_category_name',
      _canonical ->> 'rainbow_hint_word',
      _canonical ->> 'theme',
      (_canonical ->> 'is_emoji_puzzle')::boolean,
      nullif(btrim(coalesce(_metadata ->> 'emoji_puzzle_icon', '')), ''),
      coalesce((_metadata ->> 'is_free_puzzle')::boolean, false),
      nullif(_metadata ->> 'free_puzzle_order', '')::int
    )
    returning id into _pid;
  else
    -- FOR UPDATE is what makes concurrent saves safe. Two admins (or one
    -- admin whose first attempt timed out and retried) serialise here, so
    -- the version_number read below cannot be read twice before either
    -- write lands -- which is what would otherwise produce two rows both
    -- claiming to be "Version 2". The unique index is the backstop; this
    -- lock is what stops the race from being reached at all.
    perform 1 from public.puzzles where id = _pid for update;
    if not found then
      raise exception 'puzzle % does not exist', _pid using errcode = 'no_data_found';
    end if;

    update public.puzzles
       set date                  = _date,
           title                 = nullif(btrim(coalesce(_metadata ->> 'title', '')), ''),
           is_published          = coalesce((_metadata ->> 'is_published')::boolean, false),
           word_order            = case when _canonical -> 'word_order' = 'null'::jsonb then null
                                        else array(select jsonb_array_elements_text(_canonical -> 'word_order')) end,
           rainbow_herring       = case when _canonical -> 'rainbow_herring' = 'null'::jsonb then null
                                        else array(select jsonb_array_elements_text(_canonical -> 'rainbow_herring')) end,
           rainbow_category_name = _canonical ->> 'rainbow_category_name',
           rainbow_hint_word     = _canonical ->> 'rainbow_hint_word',
           theme                 = _canonical ->> 'theme',
           is_emoji_puzzle       = (_canonical ->> 'is_emoji_puzzle')::boolean,
           emoji_puzzle_icon     = nullif(btrim(coalesce(_metadata ->> 'emoji_puzzle_icon', '')), ''),
           is_free_puzzle        = coalesce((_metadata ->> 'is_free_puzzle')::boolean, false),
           free_puzzle_order     = nullif(_metadata ->> 'free_puzzle_order', '')::int
     where id = _pid;
  end if;

  select pv.content, pv.id
    into _current, _vid
    from public.puzzle_versions pv
    join public.puzzles p on p.current_version_id = pv.id
   where p.id = _pid;

  -- The whole versioning decision, in one comparison. Canonical jsonb
  -- equality is exact: same words, same categories, same difficulties, same
  -- Rainbow, same order => same content => no new version, whatever the
  -- admin retyped or whichever metadata field they changed.
  if _current is null or _current <> _canonical then
    select coalesce(max(pv.version_number), 0) + 1
      into _next
      from public.puzzle_versions pv
     where pv.puzzle_id = _pid;

    insert into public.puzzle_versions (puzzle_id, version_number, content, created_by)
    values (_pid, _next, _canonical, _uid)
    returning id into _vid;

    update public.puzzles set current_version_id = _vid where id = _pid;
    _created := true;
  end if;

  -- The live read path, rewritten in the SAME transaction as the snapshot
  -- above. This is still a delete-and-reinsert, and that is fine now for the
  -- reason it was not before: it is atomic, so no reader can observe the
  -- gap, and a failure rolls the whole save back rather than leaving a
  -- puzzle with no words.
  delete from public.puzzle_groups where puzzle_id = _pid;

  insert into public.puzzle_groups (puzzle_id, category, words, difficulty, sort_order, hint_word)
  select _pid,
         g ->> 'category',
         array(select jsonb_array_elements_text(g -> 'words')),
         (g ->> 'difficulty')::int,
         (g ->> 'sort_order')::int,
         g ->> 'hint_word'
    from jsonb_array_elements(_canonical -> 'groups') g;

  select pv.version_number
    into _next
    from public.puzzle_versions pv
   where pv.id = _vid;

  return jsonb_build_object(
    'puzzle_id',       _pid,
    'version_id',      _vid,
    'version_number',  _next,
    'created_version', _created
  );
end;
$$;

revoke all on function public.admin_save_puzzle(uuid, jsonb, jsonb) from public;
grant execute on function public.admin_save_puzzle(uuid, jsonb, jsonb) to authenticated, service_role;

comment on function public.admin_save_puzzle(uuid, jsonb, jsonb) is
  'Atomically creates or updates a puzzle. Creates and promotes a new immutable version only when canonical gameplay content actually changed; metadata-only and no-op saves create none. Admin role required, checked inside the function.';


-- ===========================================================================
-- 8. create_game_session -- pin the version the player is actually looking at
--
-- The race this has to get right:
--
--   player opens Version 1  ->  admin publishes Version 2
--                           ->  player makes their first meaningful action
--
-- That player must start a VERSION 1 session, because Version 1 is what is
-- on their screen and what their next guess will be judged against. So the
-- version is supplied BY THE CLIENT, from the board it actually rendered --
-- not read here as "whatever is current now", which would pin the wrong one
-- for exactly the player this feature exists to protect.
--
-- Supplying it is not the same as being trusted with it. The function
-- verifies the snapshot belongs to THIS puzzle before storing it, so a
-- client cannot attach its session to another puzzle's version. It is
-- deliberately NOT required to be the current version -- that is the whole
-- point above.
--
-- The new argument has a DEFAULT and the previous 6-argument function is
-- dropped, so exactly ONE create_game_session exists: an older cached bundle
-- calling with the six original named arguments still resolves to it, and
-- PostgREST has no ambiguous overload to choose between. (We just removed
-- one such production conflict; this does not add another.)
--
-- The DROP comes FIRST, deliberately. Adding the new signature while the old
-- one still existed would leave two same-named functions that a six-argument
-- call could match either of -- exactly the ambiguity PostgREST cannot
-- resolve. Both statements are in this one migration/transaction, so there
-- is no window in which the function is missing.
-- ===========================================================================
drop function if exists public.create_game_session(text, text, text, text, integer, integer);

create or replace function public.create_game_session(
  _puzzle_id text,
  _device_id text,
  _device_token text,
  _entry_context text,
  _active_time_seconds integer default 0,
  _mistakes integer default 0,
  _puzzle_version_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  _id      uuid;
  _uid     uuid := auth.uid();
  _version uuid := _puzzle_version_id;
begin
  if not public.verify_device(_device_id, _device_token) then
    return null;
  end if;

  if _uid is not null then
    if not exists (
      select 1 from public.account_onboarding ao
       where ao.user_id = _uid and ao.status <> 'pending'
    ) then
      return null;
    end if;
  end if;

  if _version is not null then
    -- Compared as text on purpose: game_sessions.puzzle_id is text and is
    -- not guaranteed to be a parseable uuid, so casting it would raise
    -- instead of simply failing the check.
    if not exists (
      select 1 from public.puzzle_versions pv
       where pv.id = _version
         and pv.puzzle_id::text = _puzzle_id
    ) then
      -- A version that is not this puzzle's is refused outright rather than
      -- quietly dropped to NULL: silently recording "unknown version" for a
      -- client that asked for a wrong one would hide a real bug.
      raise exception 'puzzle version % does not belong to puzzle %', _version, _puzzle_id
        using errcode = 'foreign_key_violation';
    end if;
  end if;

  insert into public.game_sessions (
    puzzle_id, puzzle_version_id, user_id, device_id, entry_context,
    status, won, completed_at, started_at, last_activity_at,
    active_time_seconds, mistakes, found_rainbow, hints_used
  ) values (
    _puzzle_id, _version, _uid, _device_id, _entry_context,
    'in_progress', null, null, now(), now(),
    coalesce(_active_time_seconds, 0), coalesce(_mistakes, 0), false, false
  )
  returning id into _id;

  return _id;
end;
$$;

revoke all on function public.create_game_session(text, text, text, text, integer, integer, uuid) from public;
grant execute on function public.create_game_session(text, text, text, text, integer, integer, uuid) to anon, authenticated, service_role;

comment on function public.create_game_session(text, text, text, text, integer, integer, uuid) is
  'Creates an in_progress session, pinned to the puzzle version the player''s board was built from (verified to belong to that puzzle). NULL version = not pinned, which is legitimate for a legacy or pre-cutover client.';


-- ===========================================================================
-- 9. WHAT THIS MIGRATION DELIBERATELY DOES NOT TOUCH
--
-- Stats. get_puzzle_stats, get_own_completed_sessions, has_official_result,
-- finalize_game_session, the two partial unique official-result indexes and
-- puzzle_aggregates are all unchanged, and every one of them keys on
-- puzzle_id. That is the design: every version is the SAME puzzle, so
-- editing a puzzle adds no play, removes none, duplicates none, and cannot
-- turn one player's session into two. An official result stays one per
-- puzzle IDENTITY, never one per version, and Global Stats keep combining
-- official completed plays across every version because they never look at
-- the version at all.
--
-- Raw gameplay events. guess_events is untouched. If a player guessed APPLE,
-- that row still says APPLE after an admin replaces APPLE with ORANGE --
-- along with its original timestamp, correctness, One Away and Rainbow
-- classification and its place in the guess order. Corrected wording is a
-- presentation concern for the CURRENT solution display, and is never
-- written back over what somebody actually did.
--
-- game_sessions.puzzle_id stays text. Converting it to uuid is a separate
-- migration concern with its own risks, and nothing here needs it.
-- ===========================================================================
