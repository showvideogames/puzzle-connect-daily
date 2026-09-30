-- Tighten the game_sessions INSERT policy.
--
-- Before: "Anyone can insert game sessions" had WITH CHECK (true), which allowed
-- inserting a session stamped with ANY user_id -- including another logged-in
-- player's id, letting a direct API caller pollute that player's personal stats.
--
-- After: a session may be saved only if it is stamped with the caller's own
-- account id, OR left anonymous (user_id IS NULL). This preserves anonymous
-- (no-login) play -- which the app saves with user_id = NULL -- while blocking
-- impersonation of a real account. No legitimate client path is affected:
-- saveGameStats sets user_id to the signed-in user's id or NULL when anonymous.

DROP POLICY IF EXISTS "Anyone can insert game sessions" ON public.game_sessions;

CREATE POLICY "Users can insert own or anonymous game sessions"
ON public.game_sessions
FOR INSERT
TO public
WITH CHECK (
  (user_id = auth.uid()) OR (user_id IS NULL)
);
