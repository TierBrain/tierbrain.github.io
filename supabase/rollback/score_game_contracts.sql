-- Operator rollback for this score-policy batch, not an automatic migration.
-- Review first; this reintroduces the known rejections for the three games.
-- Apply as one transaction. Existing records remain untouched.
SET LOCAL lock_timeout = '3s';
LOCK TABLE public.scores IN SHARE ROW EXCLUSIVE MODE;
ALTER POLICY "add scores" ON public.scores
WITH CHECK (
  ((correct >= 0) AND (correct <= 20))
  AND ((level >= 1) AND (level <= 4))
  AND ((char_length(name) >= 1) AND (char_length(name) <= 20))
  AND ((char_length(group_code) >= 1) AND (char_length(group_code) <= 24))
  AND ((char_length(quiz_id) >= 1) AND (char_length(quiz_id) <= 48))
);
