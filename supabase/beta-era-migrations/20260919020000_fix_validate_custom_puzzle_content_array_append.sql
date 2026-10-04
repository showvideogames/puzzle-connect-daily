-- ===========================================================================
-- Repair: validate_custom_puzzle_content's Rainbow-mode check crashed with
-- "function array_append(text, text) does not exist"
--
-- ROOT CAUSE
--
-- 20260919000000 declared:
--
--   _group_words text[][];
--   ...
--   _group_words := array_fill(null::text, array[4, 4]);
--   ...
--   _group_words[_i + 1] := array_append(_group_words[_i + 1], _w);
--   ...
--   select upper(x) from unnest(_group_words[_i]) x
--
-- Postgres has no genuinely distinct "2-D array" TYPE -- `text[][]` is not a
-- different type from `text[]`; the extra bracket pair is purely cosmetic in
-- the type declaration, and dimensionality lives only in the runtime VALUE,
-- never in the declared type. So `_group_words[_i + 1]`, a SINGLE-subscript
-- expression against a variable Postgres's type system considers to be
-- `text[]` (element type `text`), is statically typed by the parser as
-- `text` -- regardless of the fact that array_fill(..., array[4,4]) happens
-- to build a genuinely 2-dimensional VALUE at runtime. Overload resolution
-- for array_append() then sees (text, text), which does not exist (the real
-- signature is (anyarray, anyelement)), and raises before a single row is
-- ever touched.
--
-- This is why it was invisible in fakeSupabase.ts's JS mirror
-- (canonicalizeCustomPuzzleContent): JS arrays have no such static-typing
-- concept, so the mirror's equivalent logic (a real array of arrays) simply
-- worked -- there is nothing to port that fix to on the JS side. This is a
-- PL/pgSQL-only defect, only reachable in Rainbow mode (the only place
-- _group_words is read), which is consistent with this being caught by the
-- first real attempt.
--
-- CONFIRMED, LIVE: custom_puzzles and custom_puzzle_results were both empty
-- (0 rows) before this migration -- the failed attempt raised inside
-- validate_custom_puzzle_content, which create_custom_puzzle calls BEFORE
-- its insert statement, so nothing was ever written.
--
-- FIX
--
-- Drop the `_group_words` 2-D-array construct entirely. The per-group
-- Rainbow-answer-count check needs each group's 4 words as a real text[] --
-- it already has a perfectly good source for that: `_groups`, the original
-- jsonb array, still in scope. Re-deriving it there with
-- jsonb_array_elements_text(...) per group needs no array-of-arrays at all.
--
-- Everything else (the cross-group Small Hint fix from this same original
-- migration, all length limits, classic/rainbow content rules, word_order
-- validation, grants, search_path) is copied through unchanged.
-- ===========================================================================
create or replace function public.validate_custom_puzzle_content(_content jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  _mode        text;
  _groups      jsonb;
  _g           jsonb;
  _words       jsonb;
  _all         text[] := '{}';
  _hints       text[] := array[null, null, null, null];
  _out         jsonb := '[]'::jsonb;
  _herring     jsonb;
  _order       jsonb;
  _i           integer;
  _w           text;
  _hint        text;
  _herring_words text[];
  _hits        integer;
begin
  if _content is null or jsonb_typeof(_content) <> 'object' then
    raise exception 'puzzle content must be a JSON object' using errcode = 'invalid_parameter_value';
  end if;

  _mode := _content ->> 'mode';
  if _mode not in ('classic', 'rainbow') then
    raise exception 'mode must be classic or rainbow' using errcode = 'invalid_parameter_value';
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
    if length(btrim(_g ->> 'category')) > 80 then
      raise exception 'group % category name is too long (max 80 characters)', _i + 1 using errcode = 'invalid_parameter_value';
    end if;

    _words := _g -> 'words';
    if _words is null or jsonb_typeof(_words) <> 'array' or jsonb_array_length(_words) <> 4 then
      raise exception 'group % needs exactly 4 answers', _i + 1 using errcode = 'invalid_parameter_value';
    end if;

    for _w in select jsonb_array_elements_text(_words) loop
      if coalesce(btrim(_w), '') = '' then
        raise exception 'group % contains an empty answer', _i + 1 using errcode = 'invalid_parameter_value';
      end if;
      if length(_w) > 40 then
        raise exception 'group % has an answer that is too long (max 40 characters)', _i + 1 using errcode = 'invalid_parameter_value';
      end if;
      _all := _all || _w;
    end loop;

    -- Length-checked here, but NOT checked for duplication yet: _all only
    -- holds groups 0..i so far, and a hint must be compared against all 16
    -- board answers, including groups that haven't been processed yet (see
    -- the dedicated pass below, once _all is complete) -- unchanged from the
    -- 20260919000000 cross-group Small Hint fix.
    _hint := nullif(btrim(coalesce(_g ->> 'hint_word', '')), '');
    if _hint is not null and length(_hint) > 40 then
      raise exception 'group % Small Hint is too long (max 40 characters)', _i + 1 using errcode = 'invalid_parameter_value';
    end if;
    _hints[_i + 1] := _hint;

    _out := _out || jsonb_build_array(jsonb_build_object(
      'category',   btrim(_g ->> 'category'),
      'words',      _words,
      'hint_word',  _hint,
      'sort_order', _i
    ));
  end loop;

  if (select count(distinct upper(w)) from unnest(_all) w) <> 16 then
    raise exception 'a puzzle needs 16 unique answers' using errcode = 'invalid_parameter_value';
  end if;

  -- Now that _all holds all 16 board answers, check every group's hint
  -- against the COMPLETE board -- not just the groups seen before it.
  for _i in 1 .. 4 loop
    if _hints[_i] is not null and upper(_hints[_i]) = any (select upper(x) from unnest(_all) x) then
      raise exception 'group % Small Hint cannot duplicate a board answer', _i using errcode = 'invalid_parameter_value';
    end if;
  end loop;

  -- Rainbow: 'classic' must carry none at all; 'rainbow' must select EXACTLY
  -- one answer from EACH group (not merely 4-of-16 anywhere in the puzzle).
  _herring := _content -> 'rainbow_herring';
  _herring := case when _herring is null or jsonb_typeof(_herring) = 'null' then null else _herring end;

  if _mode = 'classic' then
    if _herring is not null then
      raise exception 'classic puzzles cannot include a Rainbow selection' using errcode = 'invalid_parameter_value';
    end if;
  else
    if _herring is null or jsonb_typeof(_herring) <> 'array' or jsonb_array_length(_herring) <> 4 then
      raise exception 'a Rainbow puzzle needs exactly one selected answer from each of the 4 groups' using errcode = 'invalid_parameter_value';
    end if;
    _herring_words := array(select jsonb_array_elements_text(_herring));
    for _i in 1 .. 4 loop
      -- Re-derived directly from _groups (still in scope) instead of the
      -- removed _group_words 2-D array -- see the migration header for why
      -- that construct never worked in Postgres.
      _hits := (
        select count(*)
          from unnest(_herring_words) hw
         where upper(hw) = any (
           select upper(gw) from jsonb_array_elements_text(_groups -> (_i - 1) -> 'words') gw
         )
      );
      if _hits <> 1 then
        raise exception 'group % must contribute exactly one Rainbow answer (got %)', _i, _hits
          using errcode = 'invalid_parameter_value';
      end if;
    end loop;
  end if;

  -- The starting tile layout: must be a permutation of this puzzle's own 16
  -- answers, exactly like validate_puzzle_content's word_order check.
  _order := _content -> 'word_order';
  if _order is not null and jsonb_typeof(_order) <> 'null' then
    if jsonb_typeof(_order) <> 'array' or jsonb_array_length(_order) <> 16 then
      raise exception 'the starting board must list all 16 answers' using errcode = 'invalid_parameter_value';
    end if;
    for _w in select jsonb_array_elements_text(_order) loop
      if not (upper(_w) = any (select upper(x) from unnest(_all) x)) then
        raise exception 'starting board answer "%" is not one of this puzzle''s 16 answers', _w
          using errcode = 'invalid_parameter_value';
      end if;
    end loop;
  else
    raise exception 'a starting board order is required' using errcode = 'invalid_parameter_value';
  end if;

  if _content ->> 'rainbow_category_name' is not null and length(btrim(_content ->> 'rainbow_category_name')) > 80 then
    raise exception 'Rainbow category name is too long (max 80 characters)' using errcode = 'invalid_parameter_value';
  end if;
  if _content ->> 'rainbow_hint_word' is not null and length(btrim(_content ->> 'rainbow_hint_word')) > 40 then
    raise exception 'Rainbow Small Hint is too long (max 40 characters)' using errcode = 'invalid_parameter_value';
  end if;

  return jsonb_build_object(
    'mode',                   _mode,
    'groups',                 _out,
    'word_order',             _order,
    'rainbow_herring',        _herring,
    'rainbow_category_name',  nullif(btrim(coalesce(_content ->> 'rainbow_category_name', '')), ''),
    'rainbow_hint_word',      nullif(btrim(coalesce(_content ->> 'rainbow_hint_word', '')), ''),
    'alphabetize_completed',  coalesce((_content ->> 'alphabetize_completed')::boolean, true)
  );
end;
$$;

-- Grants/search_path unchanged from 20260919000000 -- re-asserted here
-- explicitly (CREATE OR REPLACE preserves them on its own, but restating
-- them is what keeps this migration self-verifying without relying on that).
revoke all on function public.validate_custom_puzzle_content(jsonb) from public;
grant execute on function public.validate_custom_puzzle_content(jsonb) to anon, authenticated, service_role;

comment on function public.validate_custom_puzzle_content(jsonb) is
  'Validates and canonicalises a player-submitted custom puzzle. Unlike validate_puzzle_content, enforces one-Rainbow-answer-per-group (not just 4-of-16) and rejects any Rainbow content on a classic puzzle.';


-- ===========================================================================
-- Regression check -- runs against the REAL live Postgres engine, at
-- migration-apply time, not the JS fake (which never had this bug, since JS
-- has no equivalent to Postgres's flattened array-type system and so has
-- nothing to "port" this fix to). If validate_custom_puzzle_content is still
-- broken, this block raises and the whole migration fails to apply, rather
-- than silently deploying a still-broken function.
--
-- Exercises exactly the path that crashed: mode = 'rainbow', 4 groups, one
-- Rainbow answer selected from each -- plus the cross-group Small Hint check
-- from 20260919000000, to prove that fix also still holds.
-- ===========================================================================
do $$
declare
  _result jsonb;
begin
  _result := public.validate_custom_puzzle_content('{
    "mode": "rainbow",
    "groups": [
      {"category": "Colors", "words": ["Blue", "Green", "Red", "Yellow"], "hint_word": "Purple"},
      {"category": "Car Parts", "words": ["Battery", "Hood", "Tire", "Trunk"], "hint_word": "Wheel"},
      {"category": "Singers", "words": ["Houston", "Mars", "Mercury", "Swift"], "hint_word": "Gaga"},
      {"category": "House", "words": ["Bird", "Dog", "Tree", "White"], "hint_word": "Haunted"}
    ],
    "word_order": ["Blue","Green","Red","Yellow","Battery","Hood","Tire","Trunk","Houston","Mars","Mercury","Swift","Bird","Dog","Tree","White"],
    "rainbow_herring": ["Blue", "Tire", "Swift", "Tree"],
    "rainbow_category_name": "Mixed Bag",
    "rainbow_hint_word": null,
    "alphabetize_completed": true
  }'::jsonb);

  if _result is null or _result -> 'rainbow_herring' is null then
    raise exception 'regression check failed: validate_custom_puzzle_content did not return a valid canonical payload for a valid Rainbow puzzle';
  end if;

  -- The cross-group Small Hint check must still reject a hint that
  -- duplicates a LATER group's answer (the 20260919000000 fix).
  begin
    perform public.validate_custom_puzzle_content('{
      "mode": "classic",
      "groups": [
        {"category": "Colors", "words": ["Blue", "Green", "Red", "Yellow"], "hint_word": "Tire"},
        {"category": "Car Parts", "words": ["Battery", "Hood", "Tire", "Trunk"], "hint_word": null},
        {"category": "Singers", "words": ["Houston", "Mars", "Mercury", "Swift"], "hint_word": null},
        {"category": "House", "words": ["Bird", "Dog", "Tree", "White"], "hint_word": null}
      ],
      "word_order": ["Blue","Green","Red","Yellow","Battery","Hood","Tire","Trunk","Houston","Mars","Mercury","Swift","Bird","Dog","Tree","White"],
      "rainbow_herring": null,
      "rainbow_category_name": null,
      "rainbow_hint_word": null,
      "alphabetize_completed": true
    }'::jsonb);
    raise exception 'regression check failed: cross-group Small Hint duplicate was not rejected';
  exception
    when invalid_parameter_value then
      null; -- expected: the cross-group hint-duplicate rejection fired correctly.
  end;
end;
$$;
