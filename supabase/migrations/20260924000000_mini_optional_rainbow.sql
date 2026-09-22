-- ===========================================================================
-- Mini 3x3 — the optional Rainbow category
--
-- WHAT THIS CHANGES
-- -----------------
-- Exactly one function: public.validate_puzzle_content(jsonb).
--
-- No table, column, index, constraint, grant or policy is touched. A Mini
-- Rainbow needs no new storage at all: puzzles.rainbow_herring (text[]),
-- .rainbow_category_name, .rainbow_hint_word, .rainbow_category_emoji and
-- .theme already exist and are format-agnostic, and game_sessions already
-- records found_rainbow / rainbow_solve_index / rainbow_source for any
-- session whatever its format. The ONLY thing standing between a Mini and a
-- Rainbow was this function's flat refusal, added in 20260923000000 when Mini
-- genuinely had no bonus category.
--
-- WHY IT WAS A REFUSAL RATHER THAN A GAP
-- --------------------------------------
-- 20260923000000 set `_has_rainbow := false` for mini and raised
-- "a mini puzzle cannot have a Rainbow category" on any herring. That was
-- deliberate and correct at the time: silently dropping a Rainbow an admin
-- had filled in would have been worse than refusing it. This migration
-- reverses that product decision, and nothing else.
--
-- THE NEW RULES, BY FORMAT
-- ------------------------
--   full  UNCHANGED in every respect. Optional 4-word rainbow_herring, each
--         word somewhere on the board. Its existing looser rule — the four
--         words need only BE board answers, not one per category — is
--         preserved exactly, because tightening it could retroactively
--         invalidate a live Full puzzle, and re-saving one must still produce
--         byte-identical canonical content and mint no new version.
--   mini  Optional 3-word rainbow_herring, and, when present, EXACTLY ONE
--         answer from each of the three categories. That is what a Mini
--         Rainbow is defined to be (one Green, one Blue, one Red), and it is
--         enforced here rather than trusted to the builder, so a hand-written
--         or replayed payload cannot store two Reds and no Blue.
--
-- The per-category rule is applied ONLY to a format that declares it
-- (_rainbow_one_per_category below), for the same "do not change Full" reason
-- the difficulty-range and colour-distinctness checks in 20260923000000 are
-- scoped that way. The technique for counting a group's contribution is
-- lifted from validate_custom_puzzle_content, which has enforced this same
-- rule for custom puzzles since 20260919020000 — including that migration's
-- hard-won lesson about re-deriving from _groups rather than building a
-- 2-D text array.
--
-- CANONICAL OUTPUT: byte-identical for every puzzle that was already valid,
-- of either format. A Full emits no `format` key, a Mini emits its own, the
-- key order is unchanged, and no field's canonicalisation changed. So this
-- migration creates no new puzzle_versions row for anything, and no existing
-- Full or Mini content is altered, re-canonicalised or re-validated on apply.
--
-- FORWARD-ONLY. 20260923000000 is applied in production and is not edited.
-- ===========================================================================

create or replace function public.validate_puzzle_content(_content jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  _format      text;
  _groups      jsonb;
  _g           jsonb;
  _words       jsonb;
  _all         text[] := '{}';
  _out         jsonb := '[]'::jsonb;
  _herring     jsonb;
  _order       jsonb;
  _i           integer;
  _w           text;
  _emoji       text;
  _cats        integer;   -- categories in this format
  _per         integer;   -- answers per category
  _tiles       integer;   -- total answers on the board
  _first_diff  integer;   -- difficulty of the EASIEST category
  _diffs       integer[] := '{}';
  _has_rainbow boolean;
  -- Does this format require the Rainbow to take exactly one answer from
  -- each category? See the header: Mini does, Full keeps its original rule.
  _rainbow_one_per_category boolean;
  _herring_words text[];
  _hits        integer;
begin
  if _content is null or jsonb_typeof(_content) <> 'object' then
    raise exception 'puzzle content must be a JSON object' using errcode = 'invalid_parameter_value';
  end if;

  -- Absent/null format means Full. That single line is what keeps every
  -- puzzle, draft and payload written before Mini valid and unchanged.
  _format := coalesce(nullif(btrim(coalesce(_content ->> 'format', '')), ''), 'full');
  if _format not in ('full', 'mini') then
    raise exception 'unknown puzzle format "%"', _format using errcode = 'invalid_parameter_value';
  end if;

  if _format = 'mini' then
    -- A Mini CAN now carry a Rainbow: three answers, one per category.
    _cats := 3; _per := 3; _tiles := 9; _first_diff := 2;
    _has_rainbow := true; _rainbow_one_per_category := true;
  else
    _cats := 4; _per := 4; _tiles := 16; _first_diff := 1;
    _has_rainbow := true; _rainbow_one_per_category := false;
  end if;

  _groups := _content -> 'groups';
  if _groups is null or jsonb_typeof(_groups) <> 'array' or jsonb_array_length(_groups) <> _cats then
    raise exception 'a % puzzle must contain exactly % groups', _format, _cats using errcode = 'invalid_parameter_value';
  end if;

  for _i in 0 .. _cats - 1 loop
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

    -- A format restricted to a SUBSET of the difficulty ladder must use only
    -- its own colours. Mini is Green/Blue/Red = 2, 3, 4, so a Mini can never
    -- be stored claiming Yellow.
    --
    -- Applied only where the format actually restricts the range. Full keeps
    -- its original rule -- any difficulty 1-4, in any group order -- exactly
    -- as it has always been, because reordering a Full puzzle's difficulties
    -- without reordering its groups is a save an admin can legitimately make
    -- and has always been able to make.
    if _first_diff > 1 and (_g ->> 'difficulty')::int not between _first_diff and _first_diff + _cats - 1 then
      raise exception 'a % puzzle needs difficulties between % and % (group % has %)',
        _format, _first_diff, _first_diff + _cats - 1, _i + 1, (_g ->> 'difficulty')::int
        using errcode = 'invalid_parameter_value';
    end if;
    _diffs := _diffs || (_g ->> 'difficulty')::int;

    _words := _g -> 'words';
    if _words is null or jsonb_typeof(_words) <> 'array' or jsonb_array_length(_words) <> _per then
      raise exception 'group % needs exactly % words', _i + 1, _per using errcode = 'invalid_parameter_value';
    end if;

    for _w in select jsonb_array_elements_text(_words) loop
      if coalesce(btrim(_w), '') = '' then
        raise exception 'group % contains an empty word', _i + 1 using errcode = 'invalid_parameter_value';
      end if;
      _all := _all || _w;
    end loop;

    _emoji := nullif(btrim(coalesce(_g ->> 'category_emoji', '')), '');
    if _emoji is not null and length(_emoji) > 40 then
      raise exception 'group % Category Emoji is too long (max 40 characters)', _i + 1 using errcode = 'invalid_parameter_value';
    end if;

    _out := _out || jsonb_build_array(jsonb_build_object(
      'category',   btrim(_g ->> 'category'),
      'words',      _words,
      'difficulty', (_g ->> 'difficulty')::int,
      'hint_word',  nullif(btrim(coalesce(_g ->> 'hint_word', '')), ''),
      'sort_order', _i
    ) || case when _emoji is null then '{}'::jsonb else jsonb_build_object('category_emoji', _emoji) end);
  end loop;

  if (select count(distinct w) from unnest(_all) w) <> _tiles then
    raise exception 'a % puzzle needs % unique words', _format, _tiles using errcode = 'invalid_parameter_value';
  end if;

  -- Two categories sharing a colour is meaningless on any board. Enforced
  -- only for a restricted-range format, for the same "do not change Full"
  -- reason as the range check above.
  if _first_diff > 1 and (select count(distinct d) from unnest(_diffs) d) <> _cats then
    raise exception 'a % puzzle needs one category per colour', _format using errcode = 'invalid_parameter_value';
  end if;

  _herring := _content -> 'rainbow_herring';
  if _herring is not null and jsonb_typeof(_herring) <> 'null' then
    -- Kept for shape: both shipped formats can carry a Rainbow today, so this
    -- never fires. It stays so that adding a format that genuinely cannot
    -- (a future size, a themed variant) is a one-line change here and not a
    -- silently accepted Rainbow on a board that has nowhere to show it.
    if not _has_rainbow then
      raise exception 'a % puzzle cannot have a Rainbow category', _format using errcode = 'invalid_parameter_value';
    end if;
    if jsonb_typeof(_herring) <> 'array' or jsonb_array_length(_herring) <> _cats then
      raise exception 'rainbow_herring must have exactly % words', _cats using errcode = 'invalid_parameter_value';
    end if;
    for _w in select jsonb_array_elements_text(_herring) loop
      if not (_w = any (_all)) then
        raise exception 'rainbow_herring word "%" is not one of this puzzle''s % words', _w, _tiles
          using errcode = 'invalid_parameter_value';
      end if;
    end loop;

    -- ONE ANSWER PER CATEGORY (Mini). The length check above only proves the
    -- Rainbow has the right NUMBER of board answers; without this, three
    -- answers all taken from the Red category would pass, and the resulting
    -- puzzle would be unsolvable as a Rainbow while looking valid.
    --
    -- Counted by re-deriving each group's words from _groups, exactly as
    -- validate_custom_puzzle_content does -- see 20260919020000 on why the
    -- 2-D text array approach does not work in Postgres.
    if _rainbow_one_per_category then
      _herring_words := array(select jsonb_array_elements_text(_herring));
      for _i in 1 .. _cats loop
        _hits := (
          select count(*)
            from unnest(_herring_words) hw
           where hw = any (
             select gw from jsonb_array_elements_text(_groups -> (_i - 1) -> 'words') gw
           )
        );
        if _hits <> 1 then
          raise exception 'group % must contribute exactly one Rainbow answer (got %)', _i, _hits
            using errcode = 'invalid_parameter_value';
        end if;
      end loop;
    end if;
  else
    _herring := null;
  end if;

  if not _has_rainbow
     and (nullif(btrim(coalesce(_content ->> 'rainbow_category_name', '')), '') is not null
          or nullif(btrim(coalesce(_content ->> 'rainbow_hint_word', '')), '') is not null
          or nullif(btrim(coalesce(_content ->> 'rainbow_category_emoji', '')), '') is not null) then
    raise exception 'a % puzzle cannot have Rainbow category details', _format using errcode = 'invalid_parameter_value';
  end if;

  _order := _content -> 'word_order';
  if _order is not null and jsonb_typeof(_order) <> 'null' then
    if jsonb_typeof(_order) <> 'array' or jsonb_array_length(_order) <> _tiles then
      raise exception 'word_order must list all % words', _tiles using errcode = 'invalid_parameter_value';
    end if;
    for _w in select jsonb_array_elements_text(_order) loop
      if not (_w = any (_all)) then
        raise exception 'word_order word "%" is not one of this puzzle''s % words', _w, _tiles
          using errcode = 'invalid_parameter_value';
      end if;
    end loop;
  else
    _order := null;
  end if;

  if length(coalesce(nullif(btrim(coalesce(_content ->> 'rainbow_category_emoji', '')), ''), '')) > 40 then
    raise exception 'Rainbow Category Emoji is too long (max 40 characters)' using errcode = 'invalid_parameter_value';
  end if;

  return
    -- A Full puzzle emits NO format key, so its canonical content is
    -- byte-identical to what it has always been and re-saving it unchanged
    -- creates no new version. A Mini says what it is.
    (case when _format = 'full' then '{}'::jsonb else jsonb_build_object('format', _format) end)
    || jsonb_build_object(
      'groups',                _out,
      'word_order',            _order,
      'rainbow_herring',       _herring,
      'rainbow_category_name', nullif(btrim(coalesce(_content ->> 'rainbow_category_name', '')), ''),
      'rainbow_hint_word',     nullif(btrim(coalesce(_content ->> 'rainbow_hint_word', '')), ''),
      'theme',                 nullif(btrim(coalesce(_content ->> 'theme', '')), ''),
      'is_emoji_puzzle',       coalesce((_content ->> 'is_emoji_puzzle')::boolean, false),
      'alphabetize_completed', coalesce((_content ->> 'alphabetize_completed')::boolean, true)
    )
    || case when nullif(btrim(coalesce(_content ->> 'rainbow_category_emoji', '')), '') is null then '{}'::jsonb else jsonb_build_object('rainbow_category_emoji', nullif(btrim(coalesce(_content ->> 'rainbow_category_emoji', '')), '')) end;
end;
$$;

revoke all on function public.validate_puzzle_content(jsonb) from public;
grant execute on function public.validate_puzzle_content(jsonb) to authenticated, service_role;

comment on function public.validate_puzzle_content(jsonb) is
  'Canonicalises and validates official puzzle content for its format (absent format = full). Full: 4 groups of 4, difficulties 1-4, optional 4-word Rainbow. Mini: 3 groups of 3, difficulties 2-4, optional 3-word Rainbow taking exactly one answer from each category.';
