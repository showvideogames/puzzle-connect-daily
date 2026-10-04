
-- Archive access table
CREATE TABLE public.archive_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE public.archive_access ENABLE ROW LEVEL SECURITY;

-- Users can check their own access
CREATE POLICY "Users can check own archive access"
ON public.archive_access FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Admins can manage all archive access
CREATE POLICY "Admins can manage archive access"
ON public.archive_access FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Function to check archive access
CREATE OR REPLACE FUNCTION public.has_archive_access(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.archive_access WHERE user_id = _user_id
  ) OR EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'admin'
  )
$$;

-- Function to get all published puzzles for archive listing (just metadata, no groups)
CREATE OR REPLACE FUNCTION public.get_archive_puzzles()
RETURNS TABLE(id uuid, date date, title text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.date, p.title
  FROM public.puzzles p
  WHERE p.is_published = true
  ORDER BY p.date DESC
$$;
