
-- Role enum for admin access
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator');

-- User roles table
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function to check roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- RLS for user_roles
CREATE POLICY "Users can view own roles" ON public.user_roles
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can manage roles" ON public.user_roles
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Puzzles table
CREATE TABLE public.puzzles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL UNIQUE,
  title TEXT,
  is_published BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
ALTER TABLE public.puzzles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read published puzzles" ON public.puzzles
  FOR SELECT USING (is_published = true);
CREATE POLICY "Admins can manage puzzles" ON public.puzzles
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Puzzle groups table
CREATE TABLE public.puzzle_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  puzzle_id UUID REFERENCES public.puzzles(id) ON DELETE CASCADE NOT NULL,
  category TEXT NOT NULL,
  words TEXT[] NOT NULL,
  difficulty INT NOT NULL CHECK (difficulty BETWEEN 1 AND 4),
  sort_order INT NOT NULL DEFAULT 0
);
ALTER TABLE public.puzzle_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read published puzzle groups" ON public.puzzle_groups
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.puzzles WHERE id = puzzle_id AND is_published = true)
  );
CREATE POLICY "Admins can manage puzzle groups" ON public.puzzle_groups
  FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Timestamp update function and trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_puzzles_updated_at
  BEFORE UPDATE ON public.puzzles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
