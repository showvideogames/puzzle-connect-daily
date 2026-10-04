-- Per-puzzle visual theme for the bonus category. NULL = default rainbow.
ALTER TABLE public.puzzles ADD COLUMN theme text DEFAULT NULL;
