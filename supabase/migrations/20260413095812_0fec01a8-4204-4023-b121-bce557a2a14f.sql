
CREATE TABLE public.puzzle_stats (
  puzzle_id text PRIMARY KEY,
  mistakes_0 integer NOT NULL DEFAULT 0,
  mistakes_1 integer NOT NULL DEFAULT 0,
  mistakes_2 integer NOT NULL DEFAULT 0,
  mistakes_3 integer NOT NULL DEFAULT 0,
  mistakes_4 integer NOT NULL DEFAULT 0
);

ALTER TABLE public.puzzle_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read puzzle stats"
ON public.puzzle_stats
FOR SELECT
TO public
USING (true);

CREATE POLICY "Admins can manage puzzle stats"
ON public.puzzle_stats
FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));
