-- Add a manually-entered icon for Emoji Puzzle cards.
--
-- Emoji Puzzle cards (Archive.tsx, "Emoji Puzzles" section) previously derived
-- their displayed emoji by stripping a trailing emoji off rainbow_category_name,
-- which is fragile (breaks if that field's text changes) and not something an
-- admin can directly control per puzzle. This column lets an admin type/paste
-- the exact emoji to show, independent of any other field.
--
-- Nullable, with no default: existing Emoji Puzzles keep falling back to the
-- old trailing-emoji-extraction behavior in the app until an admin fills this
-- in for them.

ALTER TABLE public.puzzles
ADD COLUMN emoji_puzzle_icon text;
