
-- Game results table to track each player's puzzle completion
CREATE TABLE public.game_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  puzzle_id UUID REFERENCES public.puzzles(id) ON DELETE CASCADE NOT NULL,
  won BOOLEAN NOT NULL,
  mistakes INT NOT NULL DEFAULT 0,
  completed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, puzzle_id)
);

ALTER TABLE public.game_results ENABLE ROW LEVEL SECURITY;

-- Players can insert their own results
CREATE POLICY "Users can insert own results" ON public.game_results
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Players can read own results
CREATE POLICY "Users can read own results" ON public.game_results
  FOR SELECT USING (auth.uid() = user_id);

-- Admins can read all results
CREATE POLICY "Admins can read all results" ON public.game_results
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

-- Aggregated stats view for logged-in users (no personal data exposed)
CREATE OR REPLACE FUNCTION public.get_puzzle_stats(_puzzle_id UUID)
RETURNS JSON
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'total_players', COUNT(*)::int,
    'wins', COUNT(*) FILTER (WHERE won)::int,
    'losses', COUNT(*) FILTER (WHERE NOT won)::int,
    'guess_distribution', json_build_object(
      '0', COUNT(*) FILTER (WHERE won AND mistakes = 0)::int,
      '1', COUNT(*) FILTER (WHERE won AND mistakes = 1)::int,
      '2', COUNT(*) FILTER (WHERE won AND mistakes = 2)::int,
      '3', COUNT(*) FILTER (WHERE won AND mistakes = 3)::int
    )
  )
  FROM public.game_results
  WHERE puzzle_id = _puzzle_id
$$;
