-- Score contract repair. Alters one existing INSERT policy, never stored rows.
-- Input validation only: these client-supplied scores are not verified gameplay.
-- Apply as one transaction after reviewing the target and the rollback script.
SET LOCAL lock_timeout = '3s';
LOCK TABLE public.scores IN SHARE ROW EXCLUSIVE MODE;

DO $preflight$
DECLARE
  current_policy pg_catalog.pg_policy%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class
                 WHERE oid = 'public.scores'::regclass AND relrowsecurity) THEN
    RAISE EXCEPTION 'scores RLS must already be enabled; review the target';
  END IF;
  SELECT * INTO STRICT current_policy FROM pg_catalog.pg_policy
    WHERE polrelid = 'public.scores'::regclass AND polname = 'add scores';
  IF current_policy.polcmd <> 'a' OR NOT current_policy.polpermissive
     OR current_policy.polroles <> ARRAY['anon'::regrole::oid]
     OR current_policy.polqual IS NOT NULL THEN
    RAISE EXCEPTION 'Unexpected score INSERT policy scope; review before applying';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy
             WHERE polrelid = 'public.scores'::regclass AND polcmd IN ('a','*')
               AND polname <> 'add scores') THEN
    RAISE EXCEPTION 'Additional score write policies exist; review policy composition';
  END IF;
  -- Known equivalent deparse forms from source PG17.6 and isolated PG17.11.
  IF pg_catalog.pg_get_expr(current_policy.polwithcheck,current_policy.polrelid)
     NOT IN (
       '(((correct >= 0) AND (correct <= 20)) AND ((level >= 1) AND (level <= 4)) AND ((char_length(name) >= 1) AND (char_length(name) <= 20)) AND ((char_length(group_code) >= 1) AND (char_length(group_code) <= 24)) AND ((char_length(quiz_id) >= 1) AND (char_length(quiz_id) <= 48)))',
       '((correct >= 0) AND (correct <= 20) AND ((level >= 1) AND (level <= 4)) AND ((char_length(name) >= 1) AND (char_length(name) <= 20)) AND ((char_length(group_code) >= 1) AND (char_length(group_code) <= 24)) AND ((char_length(quiz_id) >= 1) AND (char_length(quiz_id) <= 48)))'
     ) OR current_policy.polwithcheck IS NULL THEN
    RAISE EXCEPTION 'Score validation changed since review; refresh the baseline';
  END IF;
END
$preflight$;

ALTER POLICY "add scores" ON public.scores
WITH CHECK (
  char_length(name) BETWEEN 1 AND 20
  AND char_length(quiz_id) BETWEEN 1 AND 48
  AND CASE
    WHEN quiz_id = 'qc_piecebypiece' THEN
      -- Points / total correct answers / elapsed seconds. No round-count cap.
      correct >= 0 AND level >= 0 AND time_left >= 0
      AND correct::bigint BETWEEN 8::bigint * level AND 368::bigint * level
      AND group_code COLLATE "C" ~ '^(flags|planets|animals|objects|sports)(~[A-Z0-9_-]{1,24})?$'
    WHEN quiz_id = 'qc_jigsaw' THEN
      -- Exact tier/piece-count pairs, elapsed seconds, public or shared board.
      (level,correct) IN ((1,12),(2,24),(3,35),(4,48))
      AND time_left >= 0
      AND group_code COLLATE "C" ~ '^global(~[A-Z0-9_-]{1,24})?$'
    WHEN quiz_id IN ('qc_braincoaster','qc_braincoaster_general',
                    'qc_braincoaster_science','qc_braincoaster_history',
                    'qc_braincoaster_geo','qc_braincoaster_sport',
                    'qc_braincoaster_screen') THEN
      -- Cumulative hills / best streak. Update 170 if the six banks grow.
      correct BETWEEN 1 AND 170 AND level BETWEEN 1 AND correct
      AND time_left = 0
      AND (group_code = 'global' OR group_code COLLATE "C" ~ '^[A-Z0-9_-]{1,24}$')
    ELSE
      -- Keep the existing ordinary quiz contract, including its time handling.
      correct BETWEEN 0 AND 20 AND level BETWEEN 1 AND 4
      AND char_length(group_code) BETWEEN 1 AND 24
  END
);
