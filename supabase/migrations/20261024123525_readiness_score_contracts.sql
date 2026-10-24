-- Source-derived score units for six additional catalogue editions.
-- Client-reported score validation only, not authoritative gameplay proof.
-- Apply as one transaction. Rows, grants and all other policies stay intact.
SET LOCAL lock_timeout = '3s';
LOCK TABLE public.scores IN SHARE ROW EXCLUSIVE MODE;
DO $preflight$
DECLARE current_policy pg_catalog.pg_policy%ROWTYPE;
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
END
$preflight$;

-- Parse the reviewed predecessor on this PostgreSQL version, so the guard does
-- not depend on cross-version parentheses/whitespace in pg_get_expr().
-- The private temporary table is removed before the actual policy alteration.
CREATE TEMPORARY TABLE readiness_expected_score_contract
  (LIKE public.scores) ON COMMIT DROP;
CREATE POLICY readiness_expected ON pg_temp.readiness_expected_score_contract
  FOR INSERT TO anon WITH CHECK (
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
DO $predicate_guard$
DECLARE observed text; expected text;
BEGIN
  SELECT pg_catalog.pg_get_expr(polwithcheck,polrelid) INTO STRICT observed
    FROM pg_catalog.pg_policy
    WHERE polrelid = 'public.scores'::regclass AND polname = 'add scores';
  SELECT pg_catalog.pg_get_expr(polwithcheck,polrelid) INTO STRICT expected
    FROM pg_catalog.pg_policy
    WHERE polrelid = 'pg_temp.readiness_expected_score_contract'::regclass
      AND polname = 'readiness_expected';
  IF observed IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'Score validation changed since review; refresh the baseline';
  END IF;
END
$predicate_guard$;
DROP TABLE pg_temp.readiness_expected_score_contract;

ALTER POLICY "add scores" ON public.scores
WITH CHECK (
  char_length(name) BETWEEN 1 AND 20
  AND char_length(quiz_id) BETWEEN 1 AND 48
  AND CASE
    WHEN quiz_id IN ('qc_race','qc_tug','qc_ff2','qc_ff2_bible',
                     'qc_keep_mp','qc_core_mp','qc_labyrinth_mp') THEN
      -- Room messages belong only to the authenticated race RPCs.
      false
    WHEN quiz_id = 'qc_claim' THEN
      -- A complete 5x5 board: loss 0..12 plots, win 13..25 plots.
      ((level = 0 AND correct BETWEEN 0 AND 12)
        OR (level = 1 AND correct BETWEEN 13 AND 25))
      AND time_left >= 0
      AND group_code COLLATE "C" ~ '^[A-Z0-9_-]{1,24}$'
    WHEN quiz_id = 'qc_call-your-shot' THEN
      -- Twenty answers, +1/+2/+3 for right, 0/-1/-3 for wrong, four strikes.
      correct BETWEEN -12 AND 60 AND level BETWEEN 1 AND 4
      AND time_left BETWEEN 0 AND 210000
      AND group_code COLLATE "C" ~ '^[A-Z0-9_-]{1,24}$'
    WHEN quiz_id IN ('qc_five-clues','qc_five-clues-bible') THEN
      -- Twelve riddles, 1..5 points per solve, aggregate leftover milliseconds.
      correct BETWEEN 0 AND 60 AND level BETWEEN 1 AND 4
      AND time_left BETWEEN 0 AND 360000
      AND group_code COLLATE "C" ~ '^[A-Z0-9_-]{1,24}$'
    WHEN quiz_id IN ('qc_smudged','qc_smudged-bible') THEN
      -- Twenty messages: 25 per solve plus 10 per still-hidden A-Z letter.
      -- Five messages per tier. Maxima include base + expanded phrase banks.
      level BETWEEN 0 AND 20
      AND correct::bigint >= 25::bigint * level
      AND mod(correct::bigint - 25::bigint * level, 10) = 0
      AND correct::bigint <= 25::bigint * level + 10::bigint * (
        (CASE WHEN quiz_id = 'qc_smudged' THEN 15 ELSE 18 END) * least(level::bigint,5)
        + (CASE WHEN quiz_id = 'qc_smudged' THEN 26 ELSE 25 END) * least(greatest(level::bigint-5,0),5)
        + (CASE WHEN quiz_id = 'qc_smudged' THEN 27 ELSE 28 END) * least(greatest(level::bigint-10,0),5)
        + (CASE WHEN quiz_id = 'qc_smudged' THEN 39 ELSE 27 END) * least(greatest(level::bigint-15,0),5))
      AND time_left BETWEEN 0 AND 240
      AND group_code COLLATE "C" ~ '^[A-Z0-9_-]{1,24}$'
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
