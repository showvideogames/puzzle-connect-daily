-- ============================================================================
-- Puzzle designer byline (designer_name)
--
-- WHAT THIS ADDS
--
-- A single text column on public.puzzles that names who designed the puzzle,
-- displayed in the header as "by <designer_name>" on both the Daily homepage
-- and Archive puzzle pages.
--
-- No suitable field already existed: created_by is a uuid FK to auth.users
-- (an internal admin account id, not a display name, and joining it would
-- expose account data that has nothing to do with puzzle authorship). This
-- column is the display-ready text a page can render directly.
--
-- DEFAULT/BACKFILL
--
-- `not null default 'Sam West'` does both jobs in one statement: every
-- existing row (added before Postgres ever rewrote the table for a constant
-- default, so no rewrite is needed here either) reads back 'Sam West', and
-- every future insert that omits the column -- including admin_save_puzzle's
-- fallback below -- gets the same value.
--
-- VERSIONING
--
-- designer_name is metadata, exactly like title/date/is_published/
-- emoji_puzzle_icon/is_free_puzzle/free_puzzle_order: it travels in
-- admin_save_puzzle's `_metadata` argument, never in `_content`, and changing
-- only this field creates no new puzzle_versions row. See
-- 20260917120000_puzzle_content_versioning.sql for the versioning model this
-- extends.
-- ============================================================================

alter table public.puzzles
  add column if not exists designer_name text not null default 'Sam West';

comment on column public.puzzles.designer_name is
  'Display name shown in the puzzle header as "by <designer_name>". Metadata, not gameplay content -- never versioned. Trimmed and defaulted to ''Sam West'' by admin_save_puzzle() when blank.';


-- ===========================================================================
-- admin_save_puzzle -- add designer_name as a metadata field
--
-- Same function, same signature (_puzzle_id, _metadata, _content) -- only the
-- body changes, to read, trim and default _metadata->>'designer_name' and
-- write it alongside the other metadata columns on both the insert and
-- update paths. Everything else (authorization, content validation, the
-- versioning comparison, the atomic groups rewrite) is unchanged from
-- 20260917120000.
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
  _uid           uuid := auth.uid();
  _canonical     jsonb;
  _current       jsonb;
  _next          integer;
  _vid           uuid;
  _created       boolean := false;
  _pid           uuid := _puzzle_id;
  _date          date;
  _designer_name text;
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

  -- Trimmed, and never blank: an admin clearing the field does not produce a
  -- nameless puzzle, it reverts to the official default.
  _designer_name := coalesce(nullif(btrim(coalesce(_metadata ->> 'designer_name', '')), ''), 'Sam West');

  if _pid is null then
    insert into public.puzzles (
      date, title, is_published, created_by, designer_name,
      word_order, rainbow_herring, rainbow_category_name, rainbow_hint_word,
      theme, is_emoji_puzzle, emoji_puzzle_icon, is_free_puzzle, free_puzzle_order
    ) values (
      _date,
      nullif(btrim(coalesce(_metadata ->> 'title', '')), ''),
      coalesce((_metadata ->> 'is_published')::boolean, false),
      _uid,
      _designer_name,
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
           designer_name         = _designer_name,
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
  -- admin retyped or whichever metadata field they changed (designer_name
  -- included -- it is deliberately absent from this comparison).
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
  'Atomically creates or updates a puzzle. Creates and promotes a new immutable version only when canonical gameplay content actually changed; metadata-only saves (including designer_name) and no-op saves create none. Admin role required, checked inside the function.';
